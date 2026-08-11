// Vérifie le harnais lui-même : sans lui, les tests d'intégration qui suivent
// ne prouveraient rien. Un harnais qui se tromperait de base, ou qui laisserait
// traîner ses foyers, rendrait tous les autres tests trompeurs.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  chargerPrisma,
  reinitialiserCadenceEssais,
} from "./aide/harnais.js";
import { creerClient } from "./aide/client.js";

// Ce fichier enchaîne les connexions : sans remise à zéro, le plafond de
// cadence finirait par se déclencher et les tests échoueraient à tort.
before(async () => {
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
});
after(async () => {
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
});

test("le harnais annonce clairement s'il dispose d'une base d'essai", () => {
  assert.equal(typeof baseDEssaiDisponible, "boolean");
  assert.equal(baseDEssaiDisponible, Boolean(process.env.DATABASE_URL_TEST));
});

test("la base d'essai, quand elle existe, n'est pas celle de développement", () => {
  if (!process.env.DATABASE_URL_TEST) return;
  // On ne peut pas comparer à la valeur du .env — le harnais l'a déjà
  // remplacée. On vérifie donc que la substitution a bien eu lieu.
  assert.equal(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
});

testIntegration("le serveur démarre sur un port libre et répond", async () => {
  const serveur = await demarrerServeur();
  try {
    assert.match(serveur.base, /^http:\/\/127\.0\.0\.1:\d+\/api$/);
    const client = creerClient(serveur.base);
    const r = await client.appel("/ping");
    assert.equal(r.code, 200);
    assert.deepEqual(r.corps, { ok: true });
  } finally {
    await serveur.arreter();
  }
});

testIntegration("deux serveurs coexistent sans se disputer de port", async () => {
  const [a, b] = [await demarrerServeur(), await demarrerServeur()];
  try {
    assert.notEqual(a.base, b.base);
    assert.equal((await creerClient(a.base).appel("/ping")).code, 200);
    assert.equal((await creerClient(b.base).appel("/ping")).code, 200);
  } finally {
    await Promise.all([a.arreter(), b.arreter()]);
  }
});

testIntegration("un foyer jetable est utilisable, puis ne laisse rien derrière lui", async () => {
  const serveur = await demarrerServeur();
  const prisma = await chargerPrisma();
  let foyerId = null;

  try {
    await avecFoyer(async (contexte) => {
      foyerId = contexte.foyer.id;
      const client = await clientConnecte(serveur.base, contexte);

      const etat = await client.appel("/etat");
      assert.equal(etat.code, 200, "le foyer jetable doit être accessible une fois connecté");
      assert.deepEqual(etat.corps.membres, [], "un foyer neuf n'a aucun membre");

      // Il doit être écrivable, sinon les tests suivants ne pourraient rien monter.
      const membre = await client.appel("/membres", "POST", { nom: "Témoin", revenu: 1000 });
      assert.equal(membre.code, 201);
    });

    assert.equal(
      await prisma.foyer.count({ where: { id: foyerId } }),
      0,
      "le foyer doit avoir été supprimé à la sortie",
    );
    assert.equal(
      await prisma.membre.count({ where: { foyerId } }),
      0,
      "ses données doivent avoir suivi en cascade",
    );
  } finally {
    await serveur.arreter();
  }
});

testIntegration("le foyer est nettoyé même quand le scénario échoue", async () => {
  const prisma = await chargerPrisma();
  let foyerId = null;

  await assert.rejects(
    avecFoyer(async (contexte) => {
      foyerId = contexte.foyer.id;
      throw new Error("échec volontaire");
    }),
    /échec volontaire/,
  );

  assert.equal(
    await prisma.foyer.count({ where: { id: foyerId } }),
    0,
    "un test en échec ne doit pas laisser de foyer derrière lui",
  );
});

testIntegration("le client retient la session et l'oublie à la déconnexion", async () => {
  const serveur = await demarrerServeur();
  try {
    await avecFoyer(async (contexte) => {
      const client = await clientConnecte(serveur.base, contexte);
      assert.ok(client.cookie, "la connexion doit poser un cookie");
      assert.equal((await client.appel("/auth/moi")).code, 200);

      await client.appel("/auth/deconnexion", "POST");
      assert.equal(client.cookie, null, "le cookie effacé doit être oublié côté client");
      assert.equal((await client.appel("/auth/moi")).code, 401);
    });
  } finally {
    await serveur.arreter();
  }
});

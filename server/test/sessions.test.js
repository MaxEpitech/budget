// Sessions visibles et révocables, et dates réelles des transactions.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  chargerPrisma,
  machineDEssai,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { creerClient } from "./aide/client.js";
import { nommerAppareil } from "../src/auth/sessions.js";

let serveur = null;
let rendreLaParole = null;

before(async () => {
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
  if (rendreLaParole) rendreLaParole();
});

/* ─── Nom d'appareil (fonction pure) ─────────────────────────────────────── */

test("l'appareil est nommé de façon lisible, pas techniquement", () => {
  const cas = [
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36", "Chrome sur Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17.0 Mobile Safari/604", "Safari sur iPhone ou iPad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36", "Chrome sur Mac"],
    ["Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/121.0", "Firefox sur Linux"],
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120", "Edge sur Windows"],
  ];
  for (const [entete, attendu] of cas) assert.equal(nommerAppareil(entete), attendu);
});

test("un en-tête absent ou incompréhensible ne donne pas de nom bancal", () => {
  for (const valeur of [undefined, null, "", "curl/8.0", 42]) {
    assert.equal(nommerAppareil(valeur), null);
  }
});

test("aucune adresse IP n'entre dans le nom d'appareil", () => {
  // La liste sert à se reconnaître, pas à identifier une machine : une adresse
  // serait une donnée personnelle de plus, sans rien apporter.
  const nom = nommerAppareil("Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36");
  assert.ok(!/\d+\.\d+\.\d+\.\d+/.test(nom));
});

/* ─── Sessions ───────────────────────────────────────────────────────────── */

testIntegration("chaque connexion apparaît dans la liste, avec son appareil", async () => {
  await avecFoyer(async (contexte) => {
    const chrome = creerClient(serveur.base, {
      ...machineDEssai(),
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    });
    await chrome.appel("/auth/connexion", "POST", { email: contexte.email, motDePasse: contexte.motDePasse });

    const telephone = creerClient(serveur.base, {
      ...machineDEssai(),
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/604",
    });
    await telephone.appel("/auth/connexion", "POST", { email: contexte.email, motDePasse: contexte.motDePasse });

    const r = await chrome.appel("/auth/sessions");
    assert.equal(r.code, 200);
    assert.equal(r.corps.length, 2);
    const noms = r.corps.map((s) => s.appareil).sort();
    assert.deepEqual(noms, ["Chrome sur Windows", "Safari sur iPhone ou iPad"]);

    // Une seule est marquée comme celle d'où l'on regarde.
    assert.equal(r.corps.filter((s) => s.actuelle).length, 1);
    assert.equal(r.corps.find((s) => s.actuelle).appareil, "Chrome sur Windows");
  });
});

testIntegration("fermer une autre connexion la révoque vraiment", async () => {
  await avecFoyer(async (contexte) => {
    const ici = await clientConnecte(serveur.base, contexte);
    const ailleurs = await clientConnecte(serveur.base, contexte);

    const liste = await ici.appel("/auth/sessions");
    const autre = liste.corps.find((s) => !s.actuelle);
    assert.ok(autre, "la seconde connexion doit apparaître");

    assert.equal((await ici.appel(`/auth/sessions/${autre.id}`, "DELETE")).code, 204);
    assert.equal((await ailleurs.appel("/auth/moi")).code, 401, "l'autre appareil doit être déconnecté");
    assert.equal((await ici.appel("/auth/moi")).code, 200, "celle d'où l'on agit survit");
  });
});

testIntegration("on ne ferme pas la connexion depuis laquelle on agit", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const liste = await client.appel("/auth/sessions");
    const actuelle = liste.corps.find((s) => s.actuelle);

    const r = await client.appel(`/auth/sessions/${actuelle.id}`, "DELETE");
    assert.equal(r.code, 400, "c'est ce que fait le bouton « Se déconnecter »");
    assert.equal((await client.appel("/auth/moi")).code, 200);
  });
});

testIntegration("les sessions d'un autre compte sont hors de portée", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const prisma = await chargerPrisma();
      const client = await clientConnecte(serveur.base, mien);
      const sienne = await clientConnecte(serveur.base, voisin);

      const sessionVoisine = await prisma.session.findFirst({ where: { utilisateurId: voisin.utilisateur.id } });
      // Introuvable, pas refusée : la réponse ne doit pas révéler son existence.
      assert.equal((await client.appel(`/auth/sessions/${sessionVoisine.id}`, "DELETE")).code, 404);
      assert.equal((await sienne.appel("/auth/moi")).code, 200, "elle doit être intacte");
    });
  });
});

testIntegration("l'activité est suivie sans écrire à chaque requête", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);

    const avant = await prisma.session.findFirst({ where: { utilisateurId: contexte.utilisateur.id } });
    for (let i = 0; i < 3; i++) await client.appel("/etat");
    const apres = await prisma.session.findFirst({ where: { id: avant.id } });

    // Écrire à chaque appel doublerait le coût de la lecture de session pour
    // un gain nul : l'horodatage ne bouge qu'au-delà de quelques minutes.
    assert.equal(
      apres.derniereActivite.getTime(),
      avant.derniereActivite.getTime(),
      "trois requêtes rapprochées ne doivent produire aucune écriture",
    );
  });
});

/* ─── Dates réelles ──────────────────────────────────────────────────────── */

testIntegration("une ligne ponctuelle reçoit une date, une récurrente non", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    const ponctuelle = await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Restaurant", montant: 45, categorie: "Loisirs",
      recurrent: false, mois: "2026-08",
    });
    assert.equal(ponctuelle.code, 201);
    assert.ok(ponctuelle.corps.date, "une opération datée doit porter sa date");
    assert.equal(new Date(ponctuelle.corps.date).toISOString().slice(0, 10), "2026-08-01");

    const recurrente = await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Loyer", montant: 980, categorie: "Logement", recurrent: true,
    });
    assert.equal(recurrente.corps.date, null, "une récurrente revient tous les mois, elle n'arrive pas un jour");
  });
});

testIntegration("un jour précis est conservé quand il est fourni", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Courses", montant: 62.4, categorie: "Courses",
      recurrent: false, mois: "2026-08", date: "2026-08-17",
    });
    assert.equal(r.code, 201);
    assert.equal(new Date(r.corps.date).toISOString().slice(0, 10), "2026-08-17");
  });
});

testIntegration("les tables métier portent leurs horodatages", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);

    const membre = await client.appel("/membres", "POST", { nom: "Alex", revenu: 2450 });
    const avant = await prisma.membre.findUnique({ where: { id: membre.corps.id } });
    assert.ok(avant.creeLe && avant.modifieLe, "création et modification doivent être datées");

    await new Promise((r) => setTimeout(r, 1100));
    await client.appel(`/membres/${membre.corps.id}`, "PUT", { revenu: 2500 });
    const apres = await prisma.membre.findUnique({ where: { id: membre.corps.id } });

    assert.equal(apres.creeLe.getTime(), avant.creeLe.getTime(), "la date de création ne bouge pas");
    assert.ok(apres.modifieLe > avant.modifieLe, "celle de modification doit suivre");
  });
});

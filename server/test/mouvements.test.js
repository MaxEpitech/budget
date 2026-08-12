// Mouvements d'un support d'épargne.
//
// Jusqu'ici la valeur d'un placement s'écrasait : rien ne restait de ce qui
// s'était passé entre deux saisies, alors que le budget annonçait un versement
// mensuel. Ces tests couvrent ce que la mémoire doit garantir — que le
// mouvement et la valeur bougent ensemble, et que les refus tombent avant
// d'écrire quoi que ce soit.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import { MouvementSchema } from "../src/schemas.js";
import { mouvementVersApi } from "../src/conversion.js";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  chargerPrisma,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";

/* ─── Gabarit et conversion — sans base ─── */

test("un mouvement n'a que deux sens", () => {
  for (const type of ["versement", "retrait"]) {
    assert.ok(MouvementSchema.safeParse({ type, montant: 150 }).success, type);
  }
  const r = MouvementSchema.safeParse({ type: "interets", montant: 150 });
  assert.equal(r.success, false, "les intérêts ne sont l'acte de personne : pas un mouvement");
  assert.match(r.error.issues[0].message, /versement.*retrait/);
});

test("un mouvement sans « pour » est un mouvement du foyer", () => {
  const r = MouvementSchema.parse({ type: "versement", montant: 150 });
  assert.equal(r.pour, "foyer");
});

test("un montant nul ou négatif est refusé : le sens est porté par le type", () => {
  assert.equal(MouvementSchema.safeParse({ type: "retrait", montant: 0 }).success, false);
  assert.equal(MouvementSchema.safeParse({ type: "retrait", montant: -40 }).success, false);
});

test("le mouvement revient en euros, avec le solde qu'il a laissé", () => {
  const vers = mouvementVersApi({
    id: "m1", type: "retrait", montant: 4000, valeurApres: 851000, date: "2026-08-12T10:00:00Z", membreId: null,
  });
  assert.deepEqual(vers, {
    id: "m1", type: "retrait", montant: 40, valeurApres: 8510, date: "2026-08-12T10:00:00Z", pour: "foyer",
  });
});

/* ─── Bout en bout ─── */

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

const creerSupport = (client, extra = {}) =>
  client.appel("/placements", "POST", { libelle: "Livret A", valeur: 8400, versement: 150, rendement: 2.4, ...extra });

testIntegration("un versement fait monter la valeur, et laisse une trace", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { corps: support } = await creerSupport(client);

    const { code, corps: mouvement } = await client.appel(`/placements/${support.id}/mouvements`, "POST", {
      type: "versement", montant: 150,
    });
    assert.equal(code, 201);
    assert.equal(mouvement.montant, 150);
    assert.equal(mouvement.valeurApres, 8550);

    // La valeur du support suit : un historique qui raconterait autre chose que
    // le solde ne servirait à rien.
    const { corps: apres } = await client.appel("/placements");
    assert.equal(apres[0].valeur, 8550);
    assert.equal(apres[0].mouvements.length, 1);
  });
});

testIntegration("un retrait fait descendre la valeur, et ne peut pas la passer sous zéro", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { corps: support } = await creerSupport(client);

    assert.equal((await client.appel(`/placements/${support.id}/mouvements`, "POST", { type: "retrait", montant: 400 })).code, 201);
    assert.equal((await client.appel("/placements")).corps[0].valeur, 8000);

    const trop = await client.appel(`/placements/${support.id}/mouvements`, "POST", { type: "retrait", montant: 9000 });
    assert.equal(trop.code, 400);
    assert.match(trop.corps.erreur, /dépasse la valeur/);
    // Le refus tombe avant d'écrire : ni valeur touchée, ni mouvement en trop.
    const { corps: apres } = await client.appel("/placements");
    assert.equal(apres[0].valeur, 8000);
    assert.equal(apres[0].mouvements.length, 1);
  });
});

testIntegration("un versement au-delà du plafond est refusé plutôt que rogné", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { corps: support } = await creerSupport(client, { valeur: 22900, plafond: 22950 });

    const refuse = await client.appel(`/placements/${support.id}/mouvements`, "POST", { type: "versement", montant: 150 });
    assert.equal(refuse.code, 400);
    assert.match(refuse.corps.erreur, /plafond/);

    // Tronquer en silence aurait donné un historique ne correspondant à aucune
    // opération réelle : la banque, elle, refuse le virement entier.
    const { corps: apres } = await client.appel("/placements");
    assert.equal(apres[0].valeur, 22900);
    assert.equal(apres[0].mouvements.length, 0);

    // Le versement qui tient exactement dans le plafond, lui, passe.
    assert.equal((await client.appel(`/placements/${support.id}/mouvements`, "POST", { type: "versement", montant: 50 })).code, 201);
    assert.equal((await client.appel("/placements")).corps[0].valeur, 22950);
  });
});

testIntegration("supprimer un mouvement retire aussi son effet de la valeur", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { corps: support } = await creerSupport(client);
    const { corps: verse } = await client.appel(`/placements/${support.id}/mouvements`, "POST", { type: "versement", montant: 150 });

    assert.equal((await client.appel(`/placements/${support.id}/mouvements/${verse.id}`, "DELETE")).code, 204);

    const { corps: apres } = await client.appel("/placements");
    assert.equal(apres[0].valeur, 8400, "un mouvement qui n'a jamais eu lieu n'a jamais rien déposé");
    assert.equal(apres[0].mouvements.length, 0);
  });
});

testIntegration("le mouvement d'un autre foyer est introuvable, pas interdit", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (autre) => {
      const clientA = await clientConnecte(serveur.base, mien);
      const clientB = await clientConnecte(serveur.base, autre);
      const { corps: support } = await creerSupport(clientB);
      const { corps: mouvement } = await clientB.appel(`/placements/${support.id}/mouvements`, "POST", { type: "versement", montant: 150 });

      // 404 et non 403 : un identifiant venu d'ailleurs se comporte exactement
      // comme un identifiant inexistant, sinon la réponse révèle son existence.
      assert.equal((await clientA.appel(`/placements/${support.id}/mouvements`, "POST", { type: "versement", montant: 10 })).code, 404);
      assert.equal((await clientA.appel(`/placements/${support.id}/mouvements/${mouvement.id}`, "DELETE")).code, 404);

      // Et rien n'a bougé chez le voisin.
      assert.equal((await clientB.appel("/placements")).corps[0].valeur, 8550);
    });
  });
});

testIntegration("supprimer un versement de projet corrige l'épargne toute seule", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { corps: projet } = await client.appel("/projets", "POST", {
      libelle: "Voyage", objectif: 6000, echeance: "2027-08", versement: 250,
    });
    const { corps: premier } = await client.appel(`/projets/${projet.id}/versements`, "POST", { montant: 1200 });
    await client.appel(`/projets/${projet.id}/versements`, "POST", { montant: 400 });
    assert.equal((await client.appel("/projets")).corps[0].epargne, 1600);

    assert.equal((await client.appel(`/projets/${projet.id}/versements/${premier.id}`, "DELETE")).code, 204);

    // L'épargne étant la somme des versements, rien n'est à recalculer.
    const { corps: apres } = await client.appel("/projets");
    assert.equal(apres[0].epargne, 400);
    assert.equal(apres[0].versements.length, 1);

    // Un second appel ne trouve plus rien.
    assert.equal((await client.appel(`/projets/${projet.id}/versements/${premier.id}`, "DELETE")).code, 404);
  });
});

// Agrégation bancaire — parcours complet contre un faux serveur GoCardless.
//
// Ce qui est éprouvé ici, c'est ce qui coûterait cher en production : que les
// données bancaires d'un compte ne soient jamais servies à un autre, que la
// banque ne soit pas interrogée à chaque affichage, et qu'une panne chez elle
// ne déconnecte ni ne bloque personne.
import assert from "node:assert/strict";
import { before, after, beforeEach } from "node:test";
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
import { creerClient } from "./aide/client.js";
import { demarrerFausseBanque } from "./aide/fausseBanque.js";

let serveur = null;
let banque = null;
let rendreLaParole = null;

const configurer = () => {
  process.env.GOCARDLESS_BASE_URL = banque.base;
  process.env.GOCARDLESS_SECRET_ID = "id-essai";
  process.env.GOCARDLESS_SECRET_KEY = "cle-essai";
};

before(async () => {
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  banque = await demarrerFausseBanque();
  configurer();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (banque) await banque.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
  if (rendreLaParole) rendreLaParole();
});

beforeEach(() => {
  if (!banque) return;
  configurer();
  Object.assign(banque.etat, { statutRequisition: "CR", panneComptes: null, appels: [], requisitionsSupprimees: [] });
  banque.etat.operations = [
    { bookingDate: "2026-07-28", transactionAmount: { amount: "2450.00" }, remittanceInformationUnstructured: "SALAIRE JUILLET" },
    { bookingDate: "2026-08-28", transactionAmount: { amount: "2450.00" }, remittanceInformationUnstructured: "SALAIRE AOUT" },
    { bookingDate: "2026-09-28", transactionAmount: { amount: "2450.00" }, remittanceInformationUnstructured: "SALAIRE SEPTEMBRE" },
    { bookingDate: "2026-07-02", transactionAmount: { amount: "-900.00" }, creditorName: "Agence du Parc" },
    { bookingDate: "2026-08-02", transactionAmount: { amount: "-900.00" }, creditorName: "Agence du Parc" },
    { bookingDate: "2026-09-02", transactionAmount: { amount: "-900.00" }, creditorName: "Agence du Parc" },
    { bookingDate: "2026-08-17", transactionAmount: { amount: "-1299.00" }, creditorName: "Magasin de meubles" },
  ];
});

/** Mène un compte jusqu'à la liaison aboutie. */
async function relier(client) {
  const initie = await client.appel("/gocardless/initiate", "POST", { institutionId: "ALPHA_BANK" });
  assert.equal(initie.code, 201);
  banque.etat.statutRequisition = "LN";
  const retour = await client.appel("/gocardless/callback");
  assert.equal(retour.code, 200);
  return retour.corps;
}

const compteEnBase = async (contexte) =>
  (await chargerPrisma()).utilisateur.findUnique({ where: { id: contexte.utilisateur.id } });

testIntegration("sans session, aucune route bancaire ne répond", async () => {
  const anonyme = creerClient(serveur.base);
  for (const [chemin, methode] of [
    ["/gocardless/statut", "GET"],
    ["/gocardless/institutions", "GET"],
    ["/gocardless/callback", "GET"],
    ["/gocardless/financial-data", "GET"],
    ["/gocardless/initiate", "POST"],
  ]) {
    assert.equal((await anonyme.appel(chemin, methode, methode === "POST" ? { institutionId: "ALPHA_BANK" } : undefined)).code, 401, chemin);
  }
  assert.equal(banque.etat.appels.length, 0, "la banque n'a pas à être sollicitée pour un inconnu");
});

testIntegration("sans clés GoCardless, l'application reste en saisie manuelle", async () => {
  await avecFoyer(async (contexte) => {
    delete process.env.GOCARDLESS_SECRET_ID;
    const client = await clientConnecte(serveur.base, contexte);

    const statut = await client.appel("/gocardless/statut");
    assert.equal(statut.code, 200);
    assert.equal(statut.corps.disponible, false);

    // 503 et non 401 ou 403 : le client lirait ceux-là comme une session tombée.
    const institutions = await client.appel("/gocardless/institutions");
    assert.equal(institutions.code, 503);
    assert.equal(institutions.corps.motif, "agregation-indisponible");
    assert.equal((await client.appel("/gocardless/initiate", "POST", { institutionId: "ALPHA_BANK" })).code, 503);
  });
});

testIntegration("la liste des banques arrive triée, réduite à ce que l'écran affiche", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/gocardless/institutions");
    assert.equal(r.code, 200);
    assert.deepEqual(r.corps, [
      { id: "ALPHA_BANK", nom: "Alpha Banque" },
      { id: "ZETA_BANK", nom: "Zêta Banque" },
    ]);
    assert.equal((await client.appel("/gocardless/institutions?pays=France")).code, 400);
  });
});

testIntegration("parcours complet : consentement, retour de la banque, puis chiffres", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    const initie = await client.appel("/gocardless/initiate", "POST", { institutionId: "ALPHA_BANK" });
    assert.equal(initie.code, 201);
    assert.equal(initie.corps.link, "https://banque.invalid/consentement");
    assert.equal(banque.etat.derniereRequisition.institution_id, "ALPHA_BANK");
    assert.match(banque.etat.derniereRequisition.redirect, /\/\?banque=retour$/, "le retour se fait sur le client");
    assert.ok(banque.etat.derniereRequisition.reference, "référence unique exigée par GoCardless");

    // L'utilisateur n'a pas encore validé chez sa banque.
    const attente = await client.appel("/gocardless/callback");
    assert.equal(attente.code, 200);
    assert.deepEqual(
      { reliee: attente.corps.reliee, enAttente: attente.corps.enAttente, active: attente.corps.active },
      { reliee: false, enAttente: true, active: false },
    );
    assert.equal((await client.appel("/gocardless/financial-data")).code, 409);

    banque.etat.statutRequisition = "LN";
    const retour = await client.appel("/gocardless/callback");
    assert.deepEqual(
      { reliee: retour.corps.reliee, enAttente: retour.corps.enAttente, active: retour.corps.active },
      { reliee: true, enAttente: false, active: true },
    );
    const enBase = await compteEnBase(contexte);
    assert.equal(enBase.goCardlessAccountId, "compte-principal", "le premier compte fait office de compte principal");
    assert.equal(enBase.agregationActive, true);

    const donnees = await client.appel("/gocardless/financial-data");
    assert.equal(donnees.code, 200);
    assert.equal(donnees.corps.source, "gocardless");
    assert.equal(donnees.corps.perime, false);
    assert.deepEqual(donnees.corps.foyer, { emprunteurPrincipalNet: 2450, chargesCourantesFixes: 900 });
    assert.equal(donnees.corps.solde, 1520.37);
    assert.equal(donnees.corps.periode.jours, 90);
    assert.deepEqual(donnees.corps.detail, { nbOperations: 7, nbRevenus: 3, nbChargesRecurrentes: 1 });
  });
});

testIntegration("une synthèse récente est resservie sans réinterroger la banque", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);

    const premiere = await client.appel("/gocardless/financial-data");
    const seconde = await client.appel("/gocardless/financial-data");
    assert.deepEqual(seconde.corps, premiere.corps);
    assert.equal(banque.compter("/transactions/"), 1, "le quota journalier de la banque est compté");
    assert.equal(banque.compter("/balances/"), 1);

    // Passé le délai de fraîcheur, la banque est de nouveau consultée.
    const prisma = await chargerPrisma();
    await prisma.utilisateur.update({
      where: { id: contexte.utilisateur.id },
      data: { agregationSynchroLe: new Date(Date.now() - 7 * 60 * 60 * 1000) },
    });
    await client.appel("/gocardless/financial-data");
    assert.equal(banque.compter("/transactions/"), 2);
  });
});

testIntegration("banque en panne : la dernière synthèse connue est resservie, marquée périmée", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);
    const fraiche = await client.appel("/gocardless/financial-data");

    const prisma = await chargerPrisma();
    await prisma.utilisateur.update({
      where: { id: contexte.utilisateur.id },
      data: { agregationSynchroLe: new Date(Date.now() - 7 * 60 * 60 * 1000) },
    });
    banque.etat.panneComptes = 429;

    const resservie = await client.appel("/gocardless/financial-data");
    assert.equal(resservie.code, 200);
    assert.equal(resservie.corps.perime, true);
    assert.deepEqual(resservie.corps.foyer, fraiche.corps.foyer);
  });
});

testIntegration("banque en panne sans synthèse : une erreur lisible, jamais un 401", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);

    // Consentement expiré : GoCardless répond 401 sur le compte. Relayé tel
    // quel, le client croirait la session tombée et déconnecterait.
    banque.etat.panneComptes = 401;
    const refus = await client.appel("/gocardless/financial-data");
    assert.equal(refus.code, 502);
    assert.equal(refus.corps.motif, "banque-indisponible");
    assert.equal((await client.appel("/gocardless/statut")).code, 200, "la session tient toujours");

    banque.etat.panneComptes = 429;
    const quota = await client.appel("/gocardless/financial-data");
    assert.equal(quota.code, 429);
    assert.equal(quota.corps.motif, "quota-banque");
  });
});

testIntegration("consentement refusé chez la banque : la liaison est effacée", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/gocardless/initiate", "POST", { institutionId: "ALPHA_BANK" });

    banque.etat.statutRequisition = "RJ";
    const retour = await client.appel("/gocardless/callback");
    assert.equal(retour.code, 200);
    assert.equal(retour.corps.refusee, true);
    assert.equal(retour.corps.enAttente, false);
    assert.equal((await compteEnBase(contexte)).goCardlessRequisitionId, null);
    assert.equal((await client.appel("/gocardless/callback")).code, 409, "plus rien à confirmer");
  });
});

testIntegration("revenir à la saisie manuelle garde la liaison, la dissocier la retire", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    // On ne peut pas activer ce qui n'est pas relié.
    assert.equal((await client.appel("/gocardless", "PUT", { active: true })).code, 409);

    await relier(client);
    const coupe = await client.appel("/gocardless", "PUT", { active: false });
    assert.deepEqual({ active: coupe.corps.active, reliee: coupe.corps.reliee }, { active: false, reliee: true });
    assert.equal((await client.appel("/gocardless/financial-data")).code, 409);

    const repris = await client.appel("/gocardless", "PUT", { active: true });
    assert.equal(repris.corps.active, true);
    assert.equal((await client.appel("/gocardless/financial-data")).code, 200);

    const requisition = (await compteEnBase(contexte)).goCardlessRequisitionId;
    assert.equal((await client.appel("/gocardless", "DELETE")).code, 204);
    assert.deepEqual(banque.etat.requisitionsSupprimees, [requisition], "le consentement est retiré chez la banque");
    const apres = await compteEnBase(contexte);
    assert.deepEqual(
      [apres.agregationActive, apres.goCardlessRequisitionId, apres.goCardlessAccountId, apres.agregationSynthese, apres.agregationSynchroLe],
      [false, null, null, null, null],
    );
  });
});

testIntegration("relier une autre banque retire le consentement précédent", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);
    const ancienne = (await compteEnBase(contexte)).goCardlessRequisitionId;

    await client.appel("/gocardless/initiate", "POST", { institutionId: "ZETA_BANK" });
    assert.deepEqual(banque.etat.requisitionsSupprimees, [ancienne]);
    const apres = await compteEnBase(contexte);
    assert.notEqual(apres.goCardlessRequisitionId, ancienne);
    assert.equal(apres.goCardlessAccountId, null, "l'ancien compte ne reste pas relié");
    assert.equal(apres.agregationActive, false);
  });
});

testIntegration("les données bancaires d'un compte sont hors de portée d'un autre", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const sonClient = await clientConnecte(serveur.base, voisin);
      await relier(sonClient);
      await sonClient.appel("/gocardless/financial-data");
      const avant = await compteEnBase(voisin);

      const client = await clientConnecte(serveur.base, mien);
      // Aucune route ne prend d'identifiant : il n'y a rien à falsifier.
      assert.equal((await client.appel(`/gocardless/financial-data/${voisin.utilisateur.id}`)).code, 404);
      assert.equal((await client.appel(`/gocardless/financial-data?userId=${voisin.utilisateur.id}`)).code, 409);
      assert.equal((await client.appel("/gocardless/statut")).corps.reliee, false);

      // Et un identifiant glissé dans le corps est ignoré.
      await client.appel("/gocardless/initiate", "POST", { institutionId: "ZETA_BANK", userId: voisin.utilisateur.id });
      await client.appel("/gocardless", "DELETE");
      const apres = await compteEnBase(voisin);
      assert.equal(apres.goCardlessRequisitionId, avant.goCardlessRequisitionId);
      assert.equal(apres.goCardlessAccountId, avant.goCardlessAccountId);
      assert.equal(apres.agregationSynthese, avant.agregationSynthese);
    });
  });
});

testIntegration("supprimer son compte retire aussi le consentement bancaire", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);
    const requisition = (await compteEnBase(contexte)).goCardlessRequisitionId;

    assert.equal((await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse })).code, 204);
    assert.deepEqual(banque.etat.requisitionsSupprimees, [requisition]);
  });
});

testIntegration("une banque injoignable n'empêche pas de supprimer son compte", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);

    process.env.GOCARDLESS_BASE_URL = "http://127.0.0.1:9";
    assert.equal((await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse })).code, 204);
    assert.equal(await compteEnBase(contexte), null);
  });
});

testIntegration("l'export de ses données mentionne l'état de la liaison, pas ses identifiants", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client);
    const exporte = (await client.appel("/auth/mes-donnees")).corps;
    assert.equal(exporte.banque.reliee, true);
    assert.equal(exporte.banque.synchronisationActive, true);
    assert.ok(!JSON.stringify(exporte).includes("compte-principal"));
  });
});

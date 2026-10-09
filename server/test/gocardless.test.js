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
  process.env.CLE_CHIFFREMENT = "une phrase de chiffrement pour les essais seulement";
  Object.assign(banque.etat, { statutRequisition: "CR", panneComptes: null, appels: [], requisitionsSupprimees: [], comptesUtilises: [] });
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
    assert.equal(donnees.corps.source, "banque");
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

/* ─── Identifiants GoCardless saisis par le foyer ────────────────────────── */

const DU_FOYER = { secretId: "id-du-foyer-1234", secretKey: "cle-secrete-du-foyer" };

const sansIdentifiantsDInstallation = () => {
  delete process.env.GOCARDLESS_SECRET_ID;
  delete process.env.GOCARDLESS_SECRET_KEY;
};

// Le réglage tel que l'écran le lit, sans l'adresse de retour (elle dépend du
// port du serveur d'essai).
const reglage = ({ enregistrementPossible, source, fournisseur, identifiant, peutModifier }) =>
  ({ enregistrementPossible, source, fournisseur, identifiant, peutModifier });

/** Un second compte du même foyer, simple membre. */
async function ajouterMembre(contexte) {
  const email = contexte.email.replace("essai-", "essai-membre-");
  await contexte.prisma.utilisateur.create({
    data: {
      email,
      motDePasseHash: contexte.utilisateur.motDePasseHash,
      emailValideLe: new Date(),
      foyerId: contexte.foyer.id,
      role: "membre",
    },
  });
  return { ...contexte, email };
}

testIntegration("le propriétaire configure GoCardless depuis l'interface, sans variable d'hébergement", async () => {
  await avecFoyer(async (contexte) => {
    sansIdentifiantsDInstallation();
    const client = await clientConnecte(serveur.base, contexte);

    const avant = await client.appel("/gocardless/configuration");
    assert.deepEqual(reglage(avant.corps), { enregistrementPossible: true, source: null, fournisseur: null, identifiant: null, peutModifier: true });
    assert.equal((await client.appel("/gocardless/statut")).corps.disponible, false);

    const pose = await client.appel("/gocardless/configuration", "PUT", DU_FOYER);
    assert.equal(pose.code, 200);
    assert.deepEqual(reglage(pose.corps), { enregistrementPossible: true, source: "foyer", fournisseur: "gocardless", identifiant: "••••1234", peutModifier: true });
    assert.equal((await client.appel("/gocardless/statut")).corps.disponible, true);

    // Le parcours bancaire passe désormais par le compte GoCardless du foyer.
    await relier(client);
    assert.equal((await client.appel("/gocardless/financial-data")).code, 200);
    assert.ok(banque.etat.comptesUtilises.length > 0);
    assert.ok(banque.etat.comptesUtilises.every((id) => id === DU_FOYER.secretId), "aucun appel sous un autre compte");
  });
});

testIntegration("la clé n'est jamais rendue, ni stockée en clair", async () => {
  await avecFoyer(async (contexte) => {
    sansIdentifiantsDInstallation();
    const client = await clientConnecte(serveur.base, contexte);
    const pose = await client.appel("/gocardless/configuration", "PUT", DU_FOYER);

    const enBase = await contexte.prisma.foyer.findUnique({ where: { id: contexte.foyer.id } });
    assert.equal(enBase.goCardlessSecretId, DU_FOYER.secretId);
    assert.ok(enBase.goCardlessSecretKeyChiffre.startsWith("v1."));
    assert.ok(!enBase.goCardlessSecretKeyChiffre.includes(DU_FOYER.secretKey));

    const partout = JSON.stringify([
      pose.corps,
      (await client.appel("/gocardless/configuration")).corps,
      (await client.appel("/gocardless/statut")).corps,
      (await client.appel("/auth/mes-donnees")).corps,
    ]);
    assert.ok(!partout.includes(DU_FOYER.secretKey), "la clé ne ressort par aucune route");
    assert.ok(!partout.includes(DU_FOYER.secretId), "l'identifiant ne ressort que masqué");
  });
});

testIntegration("des identifiants refusés par GoCardless ne sont pas enregistrés", async () => {
  await avecFoyer(async (contexte) => {
    sansIdentifiantsDInstallation();
    const client = await clientConnecte(serveur.base, contexte);

    const refus = await client.appel("/gocardless/configuration", "PUT", { secretId: "id-du-foyer-1234", secretKey: "mauvaise-cle" });
    // 400 et non 401 : le client lirait un 401 comme une session tombée.
    assert.equal(refus.code, 400);
    assert.equal(refus.corps.motif, "identifiants-refuses");
    assert.equal((await client.appel("/gocardless/configuration")).corps.source, null);
    assert.equal((await client.appel("/gocardless/configuration", "PUT", { secretId: "x", secretKey: "" })).code, 400);
  });
});

testIntegration("un simple membre voit l'état du réglage mais ne peut pas y toucher", async () => {
  await avecFoyer(async (contexte) => {
    sansIdentifiantsDInstallation();
    const proprietaire = await clientConnecte(serveur.base, contexte);
    await proprietaire.appel("/gocardless/configuration", "PUT", DU_FOYER);

    const membre = await clientConnecte(serveur.base, await ajouterMembre(contexte));
    const vu = await membre.appel("/gocardless/configuration");
    assert.deepEqual(reglage(vu.corps), { enregistrementPossible: true, source: "foyer", fournisseur: "gocardless", identifiant: "••••1234", peutModifier: false });
    assert.equal((await membre.appel("/gocardless/configuration", "PUT", DU_FOYER)).code, 403);
    assert.equal((await membre.appel("/gocardless/configuration", "DELETE")).code, 403);
    // Il profite en revanche des identifiants du foyer pour relier SA banque.
    assert.equal((await membre.appel("/gocardless/statut")).corps.disponible, true);
    assert.equal((await proprietaire.appel("/gocardless/configuration")).corps.source, "foyer");
  });
});

testIntegration("les identifiants d'un foyer ne servent qu'à lui", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      sansIdentifiantsDInstallation();
      await (await clientConnecte(serveur.base, voisin)).appel("/gocardless/configuration", "PUT", DU_FOYER);

      const client = await clientConnecte(serveur.base, mien);
      assert.equal((await client.appel("/gocardless/configuration")).corps.source, null);
      assert.equal((await client.appel("/gocardless/statut")).corps.disponible, false);
      assert.equal((await client.appel("/gocardless/institutions")).code, 503);
      assert.equal(banque.etat.comptesUtilises.length, 0, "aucun appel n'est parti sous le compte du voisin");
    });
  });
});

testIntegration("sans clé de chiffrement, rien ne s'enregistre", async () => {
  await avecFoyer(async (contexte) => {
    sansIdentifiantsDInstallation();
    delete process.env.CLE_CHIFFREMENT;
    const client = await clientConnecte(serveur.base, contexte);

    assert.equal((await client.appel("/gocardless/configuration")).corps.enregistrementPossible, false);
    const refus = await client.appel("/gocardless/configuration", "PUT", DU_FOYER);
    assert.equal(refus.code, 503);
    assert.equal(refus.corps.motif, "chiffrement-indisponible");
    const enBase = await contexte.prisma.foyer.findUnique({ where: { id: contexte.foyer.id } });
    assert.equal(enBase.goCardlessSecretKeyChiffre, null);
  });
});

testIntegration("une clé de chiffrement changée rend les identifiants absents, pas faux", async () => {
  await avecFoyer(async (contexte) => {
    sansIdentifiantsDInstallation();
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/gocardless/configuration", "PUT", DU_FOYER);

    process.env.CLE_CHIFFREMENT = "une tout autre phrase de chiffrement, changée depuis";
    assert.equal((await client.appel("/gocardless/configuration")).corps.source, null);
    assert.equal((await client.appel("/gocardless/institutions")).code, 503);
  });
});

testIntegration("les identifiants du foyer passent avant ceux de l'installation", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    assert.equal((await client.appel("/gocardless/configuration")).corps.source, "installation");

    await client.appel("/gocardless/configuration", "PUT", DU_FOYER);
    await client.appel("/gocardless/institutions");
    assert.equal(banque.etat.comptesUtilises.at(-1), DU_FOYER.secretId);

    // Les retirer fait retomber sur ceux de l'installation.
    const retire = await client.appel("/gocardless/configuration", "DELETE");
    assert.equal(retire.corps.source, "installation");
    await client.appel("/gocardless/institutions");
    assert.equal(banque.etat.comptesUtilises.at(-1), "id-essai");
  });
});

testIntegration("changer ou retirer les identifiants défait les liaisons du foyer", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await relier(client); // sous les identifiants de l'installation
    const requisition = (await compteEnBase(contexte)).goCardlessRequisitionId;

    await client.appel("/gocardless/configuration", "PUT", DU_FOYER);
    // Le consentement est retiré sous le compte qui l'avait ouvert.
    assert.deepEqual(banque.etat.requisitionsSupprimees, [requisition]);
    const apres = await compteEnBase(contexte);
    assert.deepEqual([apres.goCardlessRequisitionId, apres.goCardlessAccountId, apres.agregationActive], [null, null, false]);
    assert.equal((await client.appel("/gocardless/statut")).corps.reliee, false);

    await relier(client); // cette fois sous ceux du foyer
    assert.equal((await client.appel("/gocardless/configuration", "DELETE")).code, 200);
    assert.equal((await compteEnBase(contexte)).goCardlessAccountId, null);
    assert.equal(banque.etat.requisitionsSupprimees.length, 2);
  });
});

// Enable Banking — client, puis parcours complet contre un faux serveur qui
// vérifie réellement la signature des jetons.
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { createVerify, generateKeyPairSync } from "node:crypto";
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
import { demarrerFausseEnableBanking, fabriquerApplication } from "./aide/fausseEnableBanking.js";
import { signerJeton, defautDeLaCle, normaliserOperation, lireIdBanque } from "../src/banque/enablebanking.js";

const application = fabriquerApplication();
const IDENTIFIANTS = { fournisseur: "enablebanking", appId: application.appId, clePrivee: application.clePrivee };

/* ─── Client : ce qui se vérifie sans réseau ─────────────────────────────── */

test("le jeton est un JWT RS256 que la clé publique de l'application valide", () => {
  const [entete, corps, signature] = signerJeton(IDENTIFIANTS, Date.UTC(2026, 9, 8)).split(".");
  assert.deepEqual(JSON.parse(Buffer.from(entete, "base64url")), { typ: "JWT", alg: "RS256", kid: application.appId });
  const revendications = JSON.parse(Buffer.from(corps, "base64url"));
  assert.equal(revendications.iss, "enablebanking.com");
  assert.equal(revendications.aud, "api.enablebanking.com");
  assert.equal(revendications.iat, Date.UTC(2026, 9, 8) / 1000);
  assert.ok(revendications.exp - revendications.iat <= 86400, "au-delà de 24 h, Enable Banking refuse le jeton");
  assert.ok(createVerify("RSA-SHA256").update(`${entete}.${corps}`).verify(application.clePublique, Buffer.from(signature, "base64url")));
});

test("une clé privée illisible ou du mauvais type est dite avant tout appel", () => {
  assert.equal(defautDeLaCle(application.clePrivee), null);
  assert.match(defautDeLaCle("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"), /illisible/);
  assert.match(defautDeLaCle(""), /illisible/);
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  assert.match(defautDeLaCle(privateKey), /RSA/);
});

test("une opération est ramenée à la forme commune, avec un montant signé", () => {
  const debit = normaliserOperation({
    transaction_amount: { amount: "39.99", currency: "EUR" },
    credit_debit_indicator: "DBIT",
    booking_date: "2026-08-05",
    remittance_information: ["PRLV SEPA", "Fournisseur Internet"],
    creditor: { name: "Fournisseur Internet" },
  });
  assert.equal(debit.transactionAmount.amount, "-39.99");
  assert.equal(debit.bookingDate, "2026-08-05");
  assert.equal(debit.creditorName, "Fournisseur Internet");
  assert.deepEqual(debit.remittanceInformationUnstructuredArray, ["PRLV SEPA", "Fournisseur Internet"]);

  const credit = normaliserOperation({ transaction_amount: { amount: "2450.00" }, credit_debit_indicator: "CRDT", value_date: "2026-08-28" });
  assert.equal(credit.transactionAmount.amount, "2450.00");
  assert.equal(credit.bookingDate, "2026-08-28", "à défaut de date comptable, la date de valeur");
  // Un signe déjà présent ne doit pas se doubler.
  assert.equal(normaliserOperation({ transaction_amount: { amount: "-12.00" }, credit_debit_indicator: "DBIT" }).transactionAmount.amount, "-12.00");
});

test("l'identifiant d'une banque porte son pays et son nom, deux-points compris", () => {
  assert.deepEqual(lireIdBanque("FR:Alpha: Banque"), { country: "FR", name: "Alpha: Banque" });
  for (const v of ["", "Alpha Banque", "FRA:Alpha", "FR:", null]) assert.equal(lireIdBanque(v), null);
});

/* ─── Parcours complet ───────────────────────────────────────────────────── */

let serveur = null;
let banque = null;
let rendreLaParole = null;

const op = (date, montant, sens, extra = {}) => ({
  booking_date: date, status: "BOOK", credit_debit_indicator: sens, transaction_amount: { amount: montant, currency: "EUR" }, ...extra,
});

before(async () => {
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  banque = await demarrerFausseEnableBanking([application]);
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
  process.env.ENABLEBANKING_BASE_URL = banque.base;
  process.env.CLE_CHIFFREMENT = "une phrase de chiffrement pour les essais seulement";
  process.env.APP_URL = "https://budget.exemple";
  delete process.env.GOCARDLESS_SECRET_ID;
  delete process.env.GOCARDLESS_SECRET_KEY;
  Object.assign(banque.etat, {
    redirections: ["https://budget.exemple/banque/retour"], active: true, panneComptes: null,
    comptes: [{ uid: "uid-principal" }, { uid: "uid-secondaire" }],
    appels: [], requetes: [], sessionsSupprimees: [], derniereAutorisation: null,
    pages: [
      [
        op("2026-07-28", "2450.00", "CRDT", { remittance_information: ["SALAIRE JUILLET"] }),
        op("2026-08-28", "2450.00", "CRDT", { remittance_information: ["SALAIRE AOUT"] }),
        op("2026-07-02", "900.00", "DBIT", { creditor: { name: "Agence du Parc" } }),
      ],
      [
        op("2026-09-28", "2450.00", "CRDT", { remittance_information: ["SALAIRE SEPTEMBRE"] }),
        op("2026-08-02", "900.00", "DBIT", { creditor: { name: "Agence du Parc" } }),
        op("2026-09-02", "900.00", "DBIT", { creditor: { name: "Agence du Parc" } }),
        // En attente : peut encore changer, donc hors analyse.
        { ...op("2026-10-07", "5000.00", "CRDT", { remittance_information: ["SALAIRE EN ATTENTE"] }), status: "PDNG" },
      ],
    ],
  });
});

const compteEnBase = async (contexte) => (await chargerPrisma()).utilisateur.findUnique({ where: { id: contexte.utilisateur.id } });

/** Mène un foyer jusqu'à la demande d'accès ouverte ; rend l'état attendu au retour. */
async function ouvrir(client, contexte) {
  assert.equal((await client.appel("/banque/configuration", "PUT", IDENTIFIANTS)).code, 200);
  const initie = await client.appel("/banque/initiate", "POST", { institutionId: "FR:Alpha: Banque" });
  assert.equal(initie.code, 201);
  return { lien: initie.corps.link, etat: (await compteEnBase(contexte)).enableBankingEtat };
}

const retourDeLaBanque = (client, etat, code = "code-de-la-banque") =>
  client.appel(`/banque/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(etat)}`);

testIntegration("le propriétaire enregistre son application Enable Banking", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const avant = (await client.appel("/banque/configuration")).corps;
    assert.equal(avant.source, null);
    assert.equal(avant.redirections.enablebanking, "https://budget.exemple/banque/retour");

    const pose = await client.appel("/banque/configuration", "PUT", IDENTIFIANTS);
    assert.equal(pose.code, 200);
    assert.deepEqual(
      [pose.corps.source, pose.corps.fournisseur, pose.corps.identifiant, pose.corps.avertissement],
      ["foyer", "enablebanking", "••••abcd", null],
    );
    const statut = (await client.appel("/banque/statut")).corps;
    assert.deepEqual([statut.disponible, statut.fournisseur], [true, "enablebanking"]);

    // La clé privée est chiffrée en base, et ne ressort par aucune route.
    const enBase = await contexte.prisma.foyer.findUnique({ where: { id: contexte.foyer.id } });
    assert.ok(enBase.enableBankingClePriveeChiffre.startsWith("v1."));
    assert.ok(!enBase.enableBankingClePriveeChiffre.includes("PRIVATE KEY"));
    const partout = JSON.stringify([pose.corps, (await client.appel("/banque/configuration")).corps, statut, (await client.appel("/auth/mes-donnees")).corps]);
    assert.ok(!partout.includes("PRIVATE KEY") && !partout.includes(application.appId));
  });
});

testIntegration("des identifiants faux ou une clé illisible ne sont pas enregistrés", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    // Clé valide, mais qui n'est pas celle de l'application : signature refusée.
    const autre = fabriquerApplication("99999999-0000-0000-0000-000000000000");
    const refus = await client.appel("/banque/configuration", "PUT", { ...IDENTIFIANTS, clePrivee: autre.clePrivee });
    assert.equal(refus.code, 400, "400 et non 401 : le client lirait un 401 comme une session tombée");
    assert.equal(refus.corps.motif, "identifiants-refuses");

    const illisible = await client.appel("/banque/configuration", "PUT", { ...IDENTIFIANTS, clePrivee: `-----BEGIN PRIVATE KEY-----\n${"A".repeat(120)}\n-----END PRIVATE KEY-----` });
    assert.equal(illisible.code, 400);
    assert.match(illisible.corps.erreur, /illisible/);
    assert.equal(banque.compter("/application"), 1, "une clé illisible ne part même pas");

    assert.equal((await client.appel("/banque/configuration", "PUT", { fournisseur: "autre", appId: "x" })).code, 400);
    assert.equal((await client.appel("/banque/configuration")).corps.source, null);
  });
});

testIntegration("un avertissement signale une adresse de retour non déclarée, ou une application inactive", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    banque.etat.redirections = ["https://ailleurs.exemple/retour"];
    const sansRetour = await client.appel("/banque/configuration", "PUT", IDENTIFIANTS);
    assert.equal(sansRetour.code, 200, "les identifiants sont bons : ils sont gardés");
    assert.match(sansRetour.corps.avertissement, /https:\/\/budget\.exemple\/banque\/retour/);

    banque.etat.redirections = ["https://budget.exemple/banque/retour"];
    banque.etat.active = false;
    assert.match((await client.appel("/banque/configuration", "PUT", IDENTIFIANTS)).corps.avertissement, /pas encore active/);
  });
});

testIntegration("parcours complet : demande, retour avec code, puis chiffres sur plusieurs pages", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { lien, etat } = await ouvrir(client, contexte);

    assert.equal(lien, "https://banque.invalid/autorisation");
    const demande = banque.etat.derniereAutorisation;
    assert.deepEqual(demande.aspsp, { name: "Alpha: Banque", country: "FR" });
    assert.equal(demande.redirect_url, "https://budget.exemple/banque/retour");
    assert.equal(demande.psu_type, "personal");
    assert.equal(demande.state, etat);
    assert.ok(etat.length >= 32, "l'état doit être imprévisible");
    const jours = (new Date(demande.access.valid_until) - Date.now()) / 86400000;
    assert.ok(jours > 89 && jours <= 90, `accès demandé pour ${jours} jours`);
    assert.equal((await client.appel("/banque/statut")).corps.enAttente, true);

    const retour = await retourDeLaBanque(client, etat);
    assert.equal(retour.code, 200);
    assert.deepEqual([retour.corps.reliee, retour.corps.active, retour.corps.enAttente], [true, true, false]);
    const enBase = await compteEnBase(contexte);
    assert.deepEqual(
      [enBase.enableBankingSessionId, enBase.enableBankingAccountId, enBase.enableBankingEtat],
      ["session-1", "uid-principal", null],
    );

    const donnees = await client.appel("/banque/financial-data");
    assert.equal(donnees.code, 200);
    // Trois salaires et trois loyers répartis sur deux pages ; l'opération en
    // attente n'est pas comptée.
    assert.deepEqual(donnees.corps.foyer, { emprunteurPrincipalNet: 2450, chargesCourantesFixes: 900 });
    assert.deepEqual(donnees.corps.detail, { nbOperations: 6, nbRevenus: 3, nbChargesRecurrentes: 1 });
    assert.equal(donnees.corps.solde, 2210.55);
    assert.equal(banque.compter("/transactions"), 2, "deux pages, deux appels");
    const lecture = banque.etat.requetes.find((r) => r.chemin.endsWith("/transactions"));
    assert.equal(lecture.chemin, "/accounts/uid-principal/transactions");
    assert.match(lecture.params.date_from, /^\d{4}-\d{2}-\d{2}$/);

    // Resservie sans réinterroger la banque.
    await client.appel("/banque/financial-data");
    assert.equal(banque.compter("/transactions"), 2);
  });
});

testIntegration("un retour qui ne répond pas à la demande du compte ne relie rien", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { etat } = await ouvrir(client, contexte);

    // Lien forgé : un code valable, mais pas l'état de CETTE demande.
    const forge = await retourDeLaBanque(client, "etat-invente");
    assert.equal(forge.code, 200);
    assert.deepEqual([forge.corps.reliee, forge.corps.enAttente], [false, true]);
    assert.equal(banque.compter("/sessions"), 0, "le code n'est même pas présenté à Enable Banking");

    // Sans code du tout — onglet refermé en chemin — la demande reste en attente.
    assert.equal((await client.appel("/banque/callback")).corps.enAttente, true);
    // Et le bon retour aboutit toujours.
    assert.equal((await retourDeLaBanque(client, etat)).corps.reliee, true);
  });
});

testIntegration("accès refusé chez la banque : la demande est effacée", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { etat } = await ouvrir(client, contexte);

    const refus = await client.appel(`/banque/callback?error=access_denied&state=${etat}`);
    assert.equal(refus.corps.refusee, true);
    assert.equal(refus.corps.enAttente, false);
    assert.equal((await compteEnBase(contexte)).enableBankingEtat, null);
    assert.equal((await client.appel("/banque/callback")).code, 409);
  });
});

testIntegration("mode restreint sans compte lié : dit clairement, et la session est refermée", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { etat } = await ouvrir(client, contexte);

    banque.etat.comptes = [];
    const retour = await retourDeLaBanque(client, etat);
    assert.equal(retour.corps.refusee, true);
    assert.match(retour.corps.raison, /liés à votre application/);
    assert.deepEqual(banque.etat.sessionsSupprimees, ["session-1"]);
    assert.equal((await compteEnBase(contexte)).enableBankingSessionId, null);
  });
});

testIntegration("session expirée : jamais un 401, et la dernière synthèse est resservie", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { etat } = await ouvrir(client, contexte);
    await retourDeLaBanque(client, etat);

    banque.etat.panneComptes = { statut: 401, error: "EXPIRED_SESSION" };
    const sansSynthese = await client.appel("/banque/financial-data");
    assert.equal(sansSynthese.code, 502);
    assert.equal((await client.appel("/banque/statut")).code, 200, "la session de l'application tient toujours");

    banque.etat.panneComptes = null;
    const fraiche = await client.appel("/banque/financial-data");
    await contexte.prisma.utilisateur.update({ where: { id: contexte.utilisateur.id }, data: { agregationSynchroLe: new Date(Date.now() - 7 * 3600 * 1000) } });
    banque.etat.panneComptes = { statut: 429, error: "ASPSP_RATE_LIMIT_EXCEEDED" };
    const resservie = await client.appel("/banque/financial-data");
    assert.equal(resservie.corps.perime, true);
    assert.deepEqual(resservie.corps.foyer, fraiche.corps.foyer);
  });
});

testIntegration("dissocier, ou supprimer son compte, referme la session chez Enable Banking", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { etat } = await ouvrir(client, contexte);
    await retourDeLaBanque(client, etat);

    assert.equal((await client.appel("/banque", "DELETE")).code, 204);
    assert.deepEqual(banque.etat.sessionsSupprimees, ["session-1"]);
    const apres = await compteEnBase(contexte);
    assert.deepEqual([apres.enableBankingSessionId, apres.enableBankingAccountId, apres.agregationActive], [null, null, false]);

    const relance = await client.appel("/banque/initiate", "POST", { institutionId: "FR:Alpha: Banque" });
    assert.equal(relance.code, 201);
    await retourDeLaBanque(client, (await compteEnBase(contexte)).enableBankingEtat);
    assert.equal((await client.appel("/auth/moi", "DELETE", { motDePasse: contexte.motDePasse })).code, 204);
    assert.equal(banque.etat.sessionsSupprimees.length, 2);
  });
});

testIntegration("changer de prestataire défait la liaison et efface les identifiants de l'autre", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { etat } = await ouvrir(client, contexte);
    await retourDeLaBanque(client, etat);

    // Retirer l'application : la session est refermée sous ses identifiants.
    assert.equal((await client.appel("/banque/configuration", "DELETE")).corps.source, null);
    assert.deepEqual(banque.etat.sessionsSupprimees, ["session-1"]);
    assert.equal((await compteEnBase(contexte)).enableBankingAccountId, null);
    const foyer = await contexte.prisma.foyer.findUnique({ where: { id: contexte.foyer.id } });
    assert.deepEqual([foyer.enableBankingAppId, foyer.enableBankingClePriveeChiffre], [null, null]);
    assert.equal((await client.appel("/banque/institutions")).code, 503);
  });
});

testIntegration("une banque inconnue du prestataire est refusée sans rien ouvrir", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/banque/configuration", "PUT", IDENTIFIANTS);
    assert.equal((await client.appel("/banque/initiate", "POST", { institutionId: "ALPHA_BANK" })).code, 400);
    assert.equal(banque.compter("/auth"), 0);
    assert.deepEqual((await client.appel("/banque/institutions")).corps, [
      { id: "FR:Alpha: Banque", nom: "Alpha: Banque" },
      { id: "FR:Zêta Banque", nom: "Zêta Banque" },
    ]);
  });
});

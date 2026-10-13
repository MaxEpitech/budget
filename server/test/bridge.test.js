// Bridge — client, puis parcours complet contre un faux serveur qui contrôle
// les identifiants d'application, la version d'API et le jeton d'utilisateur.
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
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
import { demarrerFausseBridge, compte } from "./aide/fausseBridge.js";
import {
  normaliserOperation,
  lireTransactions,
  listerBanques,
  verifierIdentifiants,
  choisirCompte,
  creerUtilisateur,
} from "../src/banque/bridge.js";
import { ErreurBanque } from "../src/banque/erreurs.js";

const CLIENT_ID = "bridge-client-abcd";
const CLIENT_SECRET = "bridge-secret-secret-1234";
const IDENTIFIANTS = { fournisseur: "bridge", clientId: CLIENT_ID, clientSecret: CLIENT_SECRET };

// Les dates sont relatives à aujourd'hui : la synchronisation lit les 90 derniers jours.
const ilYa = (jours) => new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10);
const demain = () => new Date(Date.now() + 86400000).toISOString().slice(0, 10);

let banque = null;
let serveur = null;
let rendreLaParole = null;

before(async () => {
  banque = await demarrerFausseBridge({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (banque) await banque.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
  if (rendreLaParole) rendreLaParole();
});

beforeEach(() => {
  process.env.BRIDGE_BASE_URL = banque.base;
  process.env.CLE_CHIFFREMENT = "une phrase de chiffrement pour les essais seulement";
  process.env.APP_URL = "https://budget.exemple";
  delete process.env.GOCARDLESS_SECRET_ID;
  delete process.env.GOCARDLESS_SECRET_KEY;
  Object.assign(banque.etat, {
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    banques: [
      { id: 12, name: "Zêta Banque" },
      { id: 7, name: "Alpha Banque" },
    ],
    taillePage: 500,
    panne: null,
    jetons: new Map(),
    utilisateurs: new Map(),
    utilisateursSupprimes: [],
    connexions: [],
    sessions: [],
    appels: [],
    requetes: [],
  });
});

/* ─── Client : sans base de données ──────────────────────────────────────── */

test("une opération garde son signe, prend la date comptable puis la date, et ne double pas les libellés", () => {
  const debit = normaliserOperation({
    amount: -39.99,
    currency_code: "EUR",
    booking_date: "2026-08-05",
    date: "2026-08-04",
    provider_description: "PRLV SEPA FOURNISSEUR INTERNET",
    clean_description: "Fournisseur Internet",
  });
  assert.equal(debit.transactionAmount.amount, "-39.99");
  assert.equal(debit.transactionAmount.currency, "EUR");
  assert.equal(debit.bookingDate, "2026-08-05", "la date comptable prime sur la date");
  assert.deepEqual(debit.remittanceInformationUnstructuredArray, ["PRLV SEPA FOURNISSEUR INTERNET", "Fournisseur Internet"]);

  const credit = normaliserOperation({ amount: 2450, date: "2026-08-28", provider_description: "SALAIRE AOUT", clean_description: "SALAIRE AOUT" });
  assert.equal(credit.transactionAmount.amount, "2450", "un crédit reste positif");
  assert.equal(credit.bookingDate, "2026-08-28", "à défaut de date comptable, la date");
  assert.deepEqual(credit.remittanceInformationUnstructuredArray, ["SALAIRE AOUT"], "deux libellés identiques n'en font qu'un");

  // Libellés vides ou absents : rien à garder.
  assert.deepEqual(normaliserOperation({ amount: -1, date: "2026-08-01", provider_description: "  ", clean_description: null }).remittanceInformationUnstructuredArray, []);
  // Signe déjà présent sur un montant décimal : ni doublé, ni perdu.
  assert.equal(normaliserOperation({ amount: -12.5 }).transactionAmount.amount, "-12.5");
});

test("les banques ont un identifiant texte et sont triées par nom", async () => {
  banque.etat.banques = [{ id: 12, name: "Zêta Banque" }, { id: 7, name: "Alpha Banque" }, { id: 9, name: "Émile Banque" }, { id: 3 }];
  const liste = await listerBanques(IDENTIFIANTS, "fr");
  assert.deepEqual(liste, [
    { id: "7", nom: "Alpha Banque" },
    { id: "9", nom: "Émile Banque" },
    { id: "12", nom: "Zêta Banque" },
  ]);
  const requete = banque.requetes("/v3/providers")[0];
  assert.equal(requete.params.country_code, "FR", "le pays est mis en majuscules");
  assert.equal(requete.params.capabilities, "aggregation");
  assert.equal(requete.entetes["bridge-version"], "2025-01-15");
  assert.equal(requete.entetes["client-id"], CLIENT_ID);
});

test("des identifiants faux sont refusés par un 401, des identifiants justes passent", async () => {
  await verifierIdentifiants(IDENTIFIANTS);

  await assert.rejects(
    verifierIdentifiants({ clientId: CLIENT_ID, clientSecret: "mauvais-secret" }),
    (e) => e instanceof ErreurBanque && e.statut === 401 && e.code === "client.authentication.unauthorized",
  );
  await assert.rejects(
    verifierIdentifiants({ clientId: "autre-client", clientSecret: CLIENT_SECRET }),
    (e) => e instanceof ErreurBanque && e.statut === 401,
  );
  // Rien à envoyer : l'appel ne part même pas.
  banque.etat.appels = [];
  await assert.rejects(verifierIdentifiants({ clientId: CLIENT_ID }), (e) => e instanceof ErreurBanque && e.statut === 0);
  assert.equal(banque.etat.appels.length, 0);
});

test("seules les opérations passées et non supprimées sont lues, sur toutes les pages", async () => {
  const utilisateur = await creerUtilisateur(IDENTIFIANTS);
  const op = (id, date, montant, extra = {}) => ({ id, date, amount: montant, provider_description: `OP ${id}`, ...extra });
  banque.lier(utilisateur, {
    itemId: 4242,
    comptes: [compte(222), compte(333)],
    operations: [
      op(1, ilYa(50), -10),
      op(2, ilYa(40), -20),
      op(3, ilYa(30), 2450, { booking_date: ilYa(29) }),
      op(4, ilYa(20), -40, { deleted: true }),
      op(5, ilYa(10), -50),
      // Débit différé : pas encore sur le compte.
      op(6, ilYa(1), -60, { future: true }),
      // Hors de la période demandée.
      op(7, ilYa(200), -70),
      // Autre compte du même utilisateur.
      op(8, ilYa(30), -80, { account_id: 333 }),
    ],
  });
  banque.etat.taillePage = 2;

  const operations = await lireTransactions(IDENTIFIANTS, utilisateur, "222", ilYa(90), ilYa(0));
  assert.deepEqual(operations.map((o) => o.transactionAmount.amount), ["-10", "-20", "2450", "-50"]);
  assert.equal(operations[2].bookingDate, ilYa(29));
  assert.equal(banque.compter("GET /v3/aggregation/transactions"), 3, "quatre opérations retenues sur cinq lues, deux par page : trois pages");

  const premiere = banque.requetes("/v3/aggregation/transactions")[0];
  assert.deepEqual([premiere.params.account_id, premiere.params.min_date, premiere.params.max_date], ["222", ilYa(90), ilYa(0)]);
  assert.match(premiere.entetes.authorization, /^Bearer jeton-/);
  // Les pages suivantes sont demandées par le chemin relatif donné, avec le même jeton.
  assert.ok(banque.requetes("/v3/aggregation/transactions")[1].params.offset);
});

test("le compte à lire est le courant dont l'accès est accordé, et il est cherché chez l'utilisateur", async () => {
  const utilisateur = await creerUtilisateur(IDENTIFIANTS);
  const lier = (comptes, itemId = 4242) => {
    banque.etat.connexions = [];
    banque.lier(utilisateur, { itemId, comptes });
  };

  lier([compte(1, "savings"), compte(2, "card"), compte(3, "checking")]);
  assert.equal(await choisirCompte(IDENTIFIANTS, utilisateur, "4242"), "3", "le compte courant prime sur la carte");

  lier([compte(1, "savings"), compte(2, "card"), compte(3, "checking", { data_access: "disabled" })]);
  assert.equal(await choisirCompte(IDENTIFIANTS, utilisateur, "4242"), "2", "un accès « disabled » est ignoré");

  lier([compte(1, "savings"), compte(3, "checking", { data_access: "disabled" })]);
  assert.equal(await choisirCompte(IDENTIFIANTS, utilisateur, "4242"), null, "ni courant ni carte exploitable");

  // Un item qui n'est pas celui demandé, ou qui appartient à un autre utilisateur, ne donne rien.
  lier([compte(3, "checking")]);
  assert.equal(await choisirCompte(IDENTIFIANTS, utilisateur, "9999"), null);
  const autre = await creerUtilisateur(IDENTIFIANTS);
  assert.equal(await choisirCompte(IDENTIFIANTS, autre, "4242"), null, "le jeton d'un autre utilisateur ne voit pas ces comptes");
});

/* ─── Parcours complet ───────────────────────────────────────────────────── */

// Les opérations du foyer sont celles de son compte courant (222), pas du premier compte listé.
const op = (id, date, montant, description) => ({ id, account_id: 222, date, amount: montant, provider_description: description });

/** Les opérations d'un foyer : trois salaires, trois loyers, une supprimée, une à venir. */
const operationsDuFoyer = () => [
  op(1, ilYa(62), 2450, "SALAIRE JUILLET"),
  op(2, ilYa(32), 2450, "SALAIRE AOUT"),
  op(3, ilYa(2), 2450, "SALAIRE SEPTEMBRE"),
  op(4, ilYa(61), -900, "LOYER AGENCE DU PARC"),
  op(5, ilYa(31), -900, "LOYER AGENCE DU PARC"),
  op(6, ilYa(1), -900, "LOYER AGENCE DU PARC"),
  { ...op(7, ilYa(5), 5000, "SALAIRE SUPPRIME"), deleted: true },
  { ...op(8, demain(), 5000, "SALAIRE A VENIR"), future: true },
];

const compteEnBase = async (contexte) => (await chargerPrisma()).utilisateur.findUnique({ where: { id: contexte.utilisateur.id } });

/** Mène un foyer jusqu'à la demande ouverte chez Bridge ; rend ce qu'il faut pour répondre au retour. */
async function ouvrir(client, contexte) {
  assert.equal((await client.appel("/banque/configuration", "PUT", IDENTIFIANTS)).code, 200);
  const initie = await client.appel("/banque/initiate", "POST", { institutionId: "7" });
  assert.equal(initie.code, 201);
  const enBase = await compteEnBase(contexte);
  return { lien: initie.corps.link, contexteBridge: enBase.bridgeEtat, userUuid: enBase.bridgeUserUuid };
}

/** Ce que Bridge ajoute à l'adresse de retour. */
const retourDeBridge = (client, contexteBridge, { itemId = "4242", succes = "true" } = {}) =>
  client.appel(`/banque/callback?context=${encodeURIComponent(contexteBridge)}&item_id=${itemId}&success=${succes}`);

/** Comme si la personne avait relié sa banque chez Bridge. */
const relierChezBridge = (userUuid, extra = {}) =>
  banque.lier(userUuid, { itemId: 4242, comptes: [compte(111, "savings"), compte(222, "checking"), compte(333, "checking", { data_access: "disabled" })], operations: operationsDuFoyer(), ...extra });

testIntegration("le propriétaire enregistre son application Bridge, et un avertissement rappelle le domaine", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const avant = (await client.appel("/banque/configuration")).corps;
    assert.equal(avant.source, null);
    assert.equal(avant.redirections.bridge, "https://budget.exemple/banque/retour");

    const pose = await client.appel("/banque/configuration", "PUT", IDENTIFIANTS);
    assert.equal(pose.code, 200);
    assert.deepEqual([pose.corps.source, pose.corps.fournisseur, pose.corps.identifiant], ["foyer", "bridge", "••••abcd"]);
    assert.match(pose.corps.avertissement, /budget\.exemple/);
    assert.match(pose.corps.avertissement, /Redirections authorized domains/);

    const statut = (await client.appel("/banque/statut")).corps;
    assert.deepEqual([statut.disponible, statut.fournisseur], [true, "bridge"]);

    // Le secret est chiffré en base, et ne ressort par aucune route.
    const enBase = await contexte.prisma.foyer.findUnique({ where: { id: contexte.foyer.id } });
    assert.equal(enBase.bridgeClientId, CLIENT_ID);
    assert.ok(enBase.bridgeClientSecretChiffre.startsWith("v1."));
    assert.ok(!enBase.bridgeClientSecretChiffre.includes(CLIENT_SECRET));
    const partout = JSON.stringify([pose.corps, (await client.appel("/banque/configuration")).corps, statut, (await client.appel("/auth/mes-donnees")).corps]);
    assert.ok(!partout.includes(CLIENT_SECRET));
  });
});

testIntegration("des identifiants Bridge faux ne sont pas enregistrés", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    const refus = await client.appel("/banque/configuration", "PUT", { ...IDENTIFIANTS, clientSecret: "mauvais-secret-1234" });
    assert.equal(refus.code, 400, "400 et non 401 : le client lirait un 401 comme une session tombée");
    assert.equal(refus.corps.motif, "identifiants-refuses");
    assert.match(refus.corps.erreur, /Bridge/);

    assert.equal((await client.appel("/banque/configuration", "PUT", { fournisseur: "bridge", clientId: "court" })).code, 400);
    assert.equal((await client.appel("/banque/configuration")).corps.source, null);
  });
});

testIntegration("les banques proposées viennent de Bridge, triées, avec un identifiant texte", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    assert.equal((await client.appel("/banque/institutions")).code, 503, "pas encore configuré");

    await client.appel("/banque/configuration", "PUT", IDENTIFIANTS);
    assert.deepEqual((await client.appel("/banque/institutions")).corps, [
      { id: "7", nom: "Alpha Banque" },
      { id: "12", nom: "Zêta Banque" },
    ]);
    assert.equal((await client.appel("/banque/institutions?pays=france")).code, 400);
  });
});

testIntegration("la demande ouvre une session Bridge Connect avec un contexte imprévisible et l'adresse de retour", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { lien, contexteBridge, userUuid } = await ouvrir(client, contexte);

    assert.equal(lien, "https://connect.bridge.invalid/session");
    assert.equal(banque.etat.sessions.length, 1);
    const session = banque.etat.sessions[0];
    assert.equal(session.context, contexteBridge);
    assert.match(contexteBridge, /^[0-9a-f]{48}$/, "lettres et chiffres seulement, imprévisible");
    assert.ok(session.callback_url.endsWith("/banque/retour"));
    assert.equal(session.callback_url, "https://budget.exemple/banque/retour");
    assert.equal(session.user_email, contexte.email);
    assert.equal(session.provider_id, 7);
    // La session est ouverte sous l'utilisateur Bridge créé pour cette demande.
    assert.equal(session.utilisateur, banque.etat.utilisateurs.get(userUuid).uuid);
    assert.match(banque.etat.utilisateurs.get(userUuid).external_user_id, /^budget-/);

    const statut = (await client.appel("/banque/statut")).corps;
    assert.deepEqual([statut.enAttente, statut.reliee, statut.active], [true, false, false]);
  });
});

testIntegration("un retour qui ne répond pas à la demande du compte ne relie rien", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { contexteBridge, userUuid } = await ouvrir(client, contexte);
    relierChezBridge(userUuid);

    // Lien forgé : une connexion réussie, mais pas le contexte de CETTE demande.
    for (const forge of ["context=contexte-invente&item_id=4242&success=true", "context=contexte-invente&item_id=4242&success=false"]) {
      const r = await client.appel(`/banque/callback?${forge}`);
      assert.equal(r.code, 200);
      assert.deepEqual([r.corps.reliee, r.corps.enAttente, r.corps.refusee], [false, true, undefined]);
    }
    assert.equal(banque.compter("/v3/aggregation/accounts"), 0, "aucun compte n'est même demandé à Bridge");
    assert.deepEqual(banque.etat.utilisateursSupprimes, []);

    // Sans rien du tout — onglet refermé en chemin — la demande reste en attente.
    assert.equal((await client.appel("/banque/callback")).corps.enAttente, true);
    // Et le bon retour aboutit toujours.
    assert.equal((await retourDeBridge(client, contexteBridge)).corps.reliee, true);
  });
});

testIntegration("parcours complet : retour réussi, compte courant retenu, puis chiffres sur plusieurs pages", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { contexteBridge, userUuid } = await ouvrir(client, contexte);
    relierChezBridge(userUuid);
    banque.etat.taillePage = 3;

    const retour = await retourDeBridge(client, contexteBridge);
    assert.equal(retour.code, 200);
    assert.deepEqual([retour.corps.reliee, retour.corps.active, retour.corps.enAttente], [true, true, false]);
    const enBase = await compteEnBase(contexte);
    assert.deepEqual([enBase.bridgeUserUuid, enBase.bridgeAccountId, enBase.bridgeEtat], [userUuid, "222", null]);

    const donnees = await client.appel("/banque/financial-data");
    assert.equal(donnees.code, 200);
    // Trois salaires et trois loyers ; la ligne supprimée et celle à venir ne comptent pas.
    assert.deepEqual(donnees.corps.foyer, { emprunteurPrincipalNet: 2450, chargesCourantesFixes: 900 });
    assert.deepEqual(donnees.corps.detail, { nbOperations: 6, nbRevenus: 3, nbChargesRecurrentes: 1 });
    assert.equal(donnees.corps.solde, 2210.55);
    // Huit opérations lues, trois par page.
    assert.equal(banque.compter("GET /v3/aggregation/transactions"), 3);
    const lecture = banque.requetes("/v3/aggregation/transactions")[0];
    assert.equal(lecture.params.account_id, "222");
    assert.match(lecture.params.min_date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(banque.compter("GET /v3/aggregation/accounts/222"), 1);

    // Resservie sans réinterroger la banque.
    await client.appel("/banque/financial-data");
    assert.equal(banque.compter("GET /v3/aggregation/transactions"), 3);
    assert.deepEqual(banque.etat.utilisateursSupprimes, [], "l'utilisateur Bridge reste : c'est lui qui porte la connexion");
  });
});

testIntegration("connexion refusée chez Bridge : la demande est effacée et l'utilisateur Bridge supprimé", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { contexteBridge, userUuid } = await ouvrir(client, contexte);

    const refus = await client.appel(`/banque/callback?context=${contexteBridge}&success=false`);
    assert.equal(refus.code, 200);
    assert.equal(refus.corps.refusee, true);
    assert.equal(refus.corps.enAttente, false);
    assert.deepEqual(banque.etat.utilisateursSupprimes, [userUuid]);
    const enBase = await compteEnBase(contexte);
    assert.deepEqual([enBase.bridgeUserUuid, enBase.bridgeEtat, enBase.bridgeAccountId], [null, null, null]);
    assert.equal((await client.appel("/banque/callback")).code, 409);
  });
});

testIntegration("aucun compte courant partagé : dit clairement, et l'utilisateur Bridge est supprimé", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { contexteBridge, userUuid } = await ouvrir(client, contexte);
    relierChezBridge(userUuid, { comptes: [compte(111, "savings"), compte(333, "checking", { data_access: "disabled" })] });

    const retour = await retourDeBridge(client, contexteBridge);
    assert.equal(retour.corps.refusee, true);
    assert.match(retour.corps.raison, /aucun compte courant/);
    assert.deepEqual(banque.etat.utilisateursSupprimes, [userUuid]);
    assert.equal((await compteEnBase(contexte)).bridgeUserUuid, null);
  });
});

testIntegration("dissocier la banque supprime l'utilisateur Bridge, et une nouvelle demande en crée un autre", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const { contexteBridge, userUuid } = await ouvrir(client, contexte);
    relierChezBridge(userUuid);
    await retourDeBridge(client, contexteBridge);

    assert.equal((await client.appel("/banque", "DELETE")).code, 204);
    assert.deepEqual(banque.etat.utilisateursSupprimes, [userUuid]);
    const apres = await compteEnBase(contexte);
    assert.deepEqual([apres.bridgeUserUuid, apres.bridgeAccountId, apres.agregationActive], [null, null, false]);

    const relance = await client.appel("/banque/initiate", "POST", { institutionId: "12" });
    assert.equal(relance.code, 201);
    const nouveau = (await compteEnBase(contexte)).bridgeUserUuid;
    assert.ok(nouveau && nouveau !== userUuid);
    assert.equal(banque.etat.sessions.at(-1).provider_id, 12);

    // Relancer sans avoir terminé retire d'abord la demande précédente.
    await client.appel("/banque/initiate", "POST", { institutionId: "7" });
    assert.deepEqual(banque.etat.utilisateursSupprimes, [userUuid, nouveau]);
  });
});

testIntegration("session Bridge impossible à ouvrir : rien ne traîne chez Bridge ni en base", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/banque/configuration", "PUT", IDENTIFIANTS);

    // Les identifiants deviennent faux entre-temps : la création d'utilisateur échoue.
    banque.etat.clientSecret = "autre-secret-1234";
    const echec = await client.appel("/banque/initiate", "POST", { institutionId: "7" });
    assert.equal(echec.code, 502, "jamais un 401 relayé au client");
    assert.deepEqual([...banque.etat.utilisateurs.keys()], []);
    assert.equal((await compteEnBase(contexte)).bridgeUserUuid, null);
    banque.etat.clientSecret = CLIENT_SECRET;
  });
});

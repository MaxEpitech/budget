// Agrégation bancaire facultative, via GoCardless Bank Account Data (DSP2).
//
// Parcours : le client choisit une banque (`/institutions`), demande un lien de
// consentement (`/initiate`), part s'authentifier chez sa banque, revient sur
// l'application qui confirme la liaison (`/callback`), puis lit les chiffres
// tirés de ses opérations (`/financial-data`).
//
// ─── Qui est concerné ─────────────────────────────────────────────────────
// Toujours le compte de la session, jamais un identifiant reçu du client. Une
// route « /financial-data/:userId » laisserait n'importe quel compte connecté
// demander les données bancaires d'un autre en changeant un paramètre : ici il
// n'y a simplement rien à changer.
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { InitierAgregationSchema, ActiverAgregationSchema, IdentifiantsAgregationSchema } from "../schemas.js";
import { syntheseBancaireVersApi } from "../conversion.js";
import { journal } from "../journal.js";
import { urlApplication } from "../email/gabarits.js";
import {
  ErreurGoCardless,
  verifierIdentifiants,
  listerInstitutions,
  creerRequisition,
  lireRequisition,
  lireSoldes,
  lireTransactions,
} from "../banque/gocardless.js";
import { revoquerConsentement, defaireLiaisonsDuFoyer, LIAISON_VIDE } from "../banque/consentement.js";
import { identifiantsDuFoyer, enregistrerIdentifiants, effacerIdentifiants, masquer } from "../banque/identifiants.js";
import { chiffrementDisponible } from "../banque/chiffrement.js";
import { analyserOperations, soldePrincipal, JOURS_ANALYSES } from "../banque/analyse.js";

const routeur = Router();

// Durée pendant laquelle une synthèse est resservie sans réinterroger la
// banque. GoCardless n'autorise qu'une poignée d'appels par jour et par compte :
// sans cette retenue, quelques rechargements de page épuiseraient le quota.
const FRAICHEUR_MS = 6 * 60 * 60 * 1000;

// Adresse de retour après l'authentification chez la banque. Elle pointe sur le
// client, qui appelle ensuite `/callback` : la session voyage ainsi dans une
// requête de même origine, quelle que soit la politique du cookie.
const adresseDeRetour = () => `${urlApplication()}/?banque=retour`;

/* ─── Aides ────────────────────────────────────────────────────────────── */

/** Ce que le client a besoin de savoir pour afficher le bon écran. */
const statutDe = (req, u = req.utilisateur) => ({
  // Faux quand ni le foyer ni l'installation n'ont d'identifiants GoCardless :
  // seule la saisie manuelle est alors proposée.
  disponible: Boolean(req.identifiantsBanque),
  active: Boolean(u.agregationActive && u.goCardlessAccountId),
  reliee: Boolean(u.goCardlessAccountId),
  // Un consentement a été demandé mais n'a pas encore abouti.
  enAttente: Boolean(u.goCardlessRequisitionId && !u.goCardlessAccountId),
  synchroniseLe: u.agregationSynchroLe ?? null,
});

const majCompte = (req, data) => prisma.utilisateur.update({ where: { id: req.utilisateur.id }, data });

// Les identifiants GoCardless dépendent du foyer : ils sont lus une fois par
// requête, puis passés à chaque appel. `null` s'il n'y en a aucun.
routeur.use(attraper(async (req, _res, suite) => {
  req.identifiantsBanque = await identifiantsDuFoyer(req.utilisateur.foyerId);
  suite();
}));

const exigerConfiguration = (req, res, suite) => {
  if (req.identifiantsBanque) return suite();
  res.status(503).json({
    erreur: "La synchronisation bancaire n'est pas configurée pour ce foyer.",
    motif: "agregation-indisponible",
  });
};

// Même règle que pour les invitations : les réglages du foyer sont l'affaire
// de ses propriétaires.
const exigerProprietaire = (req, res, suite) => {
  if (req.utilisateur.role === "proprietaire") return suite();
  res.status(403).json({ erreur: "Seul un propriétaire du foyer peut faire cela." });
};

/** Ce que l'écran de réglage montre des identifiants : jamais la clé. */
const configurationDe = (req) => ({
  // Sans clé de chiffrement sur le serveur, rien ne peut être enregistré.
  enregistrementPossible: chiffrementDisponible(),
  // "foyer" : saisis ici · "installation" : fournis par l'hébergement · null : aucun.
  source: req.identifiantsBanque?.source ?? null,
  secretId: req.identifiantsBanque?.source === "foyer" ? masquer(req.identifiantsBanque.secretId) : null,
  peutModifier: req.utilisateur.role === "proprietaire",
});

/**
 * Traduit une erreur GoCardless en réponse lisible.
 *
 * Ses 401 et 403 ne sont JAMAIS relayés tels quels : le client les lirait comme
 * une session tombée et renverrait vers la connexion, alors que c'est la banque
 * qui refuse, pas nous.
 */
function repondreErreurBanque(req, res, e) {
  journal.alerte("appel GoCardless en échec", { identifiant: req.identifiant, statut: e.statut, detail: e.message });
  if (e.statut === 429) {
    return res.status(429).json({
      erreur: "La banque limite le nombre de synchronisations par jour. Réessayez plus tard.",
      motif: "quota-banque",
    });
  }
  res.status(502).json({ erreur: "Le service bancaire n'a pas répondu comme prévu. Réessayez dans un instant.", motif: "banque-indisponible" });
}

/** Comme `attraper`, mais les erreurs GoCardless deviennent une réponse 502/429. */
const avecBanque = (fn) =>
  attraper(async (req, res, suite) => {
    try {
      await fn(req, res, suite);
    } catch (e) {
      if (!(e instanceof ErreurGoCardless)) throw e;
      repondreErreurBanque(req, res, e);
    }
  });

const jour = (date) => date.toISOString().slice(0, 10);

function lireSynthese(u) {
  if (!u.agregationSynthese || !u.agregationSynchroLe) return null;
  try {
    return JSON.parse(u.agregationSynthese);
  } catch {
    return null; // synthèse illisible : on fera comme s'il n'y en avait pas
  }
}

/* ─── Routes ───────────────────────────────────────────────────────────── */

routeur.get("/statut", (req, res) => res.json(statutDe(req)));

/* ─── Identifiants GoCardless du foyer ─────────────────────────────────── */

routeur.get("/configuration", (req, res) => res.json(configurationDe(req)));

/**
 * Enregistre les identifiants GoCardless du foyer.
 *
 * Ils sont essayés auprès de GoCardless avant d'être gardés : une faute de
 * frappe se voit tout de suite, ici, plutôt qu'au moment de relier une banque.
 * Les liaisons ouvertes sous les identifiants précédents sont défaites — elles
 * appartiennent à un autre compte GoCardless et ne répondraient plus.
 */
routeur.put("/configuration", exigerProprietaire, valider(IdentifiantsAgregationSchema), attraper(async (req, res) => {
  if (!chiffrementDisponible()) {
    return res.status(503).json({
      erreur: "L'enregistrement est impossible : la clé de chiffrement (CLE_CHIFFREMENT) n'est pas configurée sur le serveur.",
      motif: "chiffrement-indisponible",
    });
  }

  try {
    await verifierIdentifiants(req.donnees);
  } catch (e) {
    if (!(e instanceof ErreurGoCardless)) throw e;
    if (e.statut === 401 || e.statut === 403) {
      return res.status(400).json({ erreur: "GoCardless refuse ces identifiants. Vérifiez le Secret ID et la Secret key.", motif: "identifiants-refuses" });
    }
    return repondreErreurBanque(req, res, e);
  }

  const foyerId = req.utilisateur.foyerId;
  await defaireLiaisonsDuFoyer(foyerId);
  await enregistrerIdentifiants(foyerId, req.donnees);
  req.identifiantsBanque = await identifiantsDuFoyer(foyerId);
  res.json(configurationDe(req));
}));

/** Retire les identifiants du foyer, et les liaisons ouvertes avec eux. */
routeur.delete("/configuration", exigerProprietaire, attraper(async (req, res) => {
  const foyerId = req.utilisateur.foyerId;
  if (req.identifiantsBanque?.source === "foyer") {
    await defaireLiaisonsDuFoyer(foyerId);
    await effacerIdentifiants(foyerId);
  }
  req.identifiantsBanque = await identifiantsDuFoyer(foyerId);
  res.json(configurationDe(req));
}));

/* ─── Liaison du compte connecté ───────────────────────────────────────── */

/** Banques proposées, pour le sélecteur. `?pays=FR` par défaut. */
routeur.get("/institutions", exigerConfiguration, avecBanque(async (req, res) => {
  const pays = String(req.query.pays ?? "FR");
  if (!/^[a-zA-Z]{2}$/.test(pays)) return res.status(400).json({ erreur: "pays : code à deux lettres attendu" });
  res.json(await listerInstitutions(req.identifiantsBanque, pays));
}));

/**
 * A. Ouvre une demande de consentement et renvoie l'adresse où s'authentifier.
 *
 * Une demande précédente, aboutie ou non, est d'abord retirée : en laisser
 * traîner une ouvrirait un consentement que plus rien ne référence ici.
 */
routeur.post("/initiate", exigerConfiguration, valider(InitierAgregationSchema), avecBanque(async (req, res) => {
  await revoquerConsentement(req.identifiantsBanque, req.utilisateur.goCardlessRequisitionId);

  const requisition = await creerRequisition(req.identifiantsBanque, {
    institutionId: req.donnees.institutionId,
    redirection: adresseDeRetour(),
    // GoCardless exige une référence unique par demande ; elle ne sert à rien
    // d'autre, d'où un simple identifiant aléatoire.
    reference: randomUUID(),
  });

  await majCompte(req, { ...LIAISON_VIDE, goCardlessRequisitionId: requisition.id });
  res.status(201).json({ link: requisition.lien });
}));

/**
 * B. Retour de la banque : confirme la liaison et retient le compte principal.
 *
 * Appelée par le client une fois revenu sur l'application. Sans effet si la
 * liaison est déjà faite ; si l'utilisateur a rebroussé chemin chez sa banque,
 * la demande reste simplement en attente et peut être reprise.
 */
routeur.get("/callback", exigerConfiguration, avecBanque(async (req, res) => {
  const u = req.utilisateur;
  if (!u.goCardlessRequisitionId) {
    return res.status(409).json({ erreur: "Aucune connexion bancaire n'est en cours.", motif: "aucune-demande" });
  }
  if (u.goCardlessAccountId) return res.json(statutDe(req));

  const requisition = await lireRequisition(req.identifiantsBanque, u.goCardlessRequisitionId);

  if (requisition.statut === "LN" && requisition.comptes.length > 0) {
    // Le premier compte fait office de compte principal.
    const modifie = await majCompte(req, { goCardlessAccountId: requisition.comptes[0], agregationActive: true });
    return res.json(statutDe(req, modifie));
  }

  if (requisition.statut === "RJ" || requisition.statut === "EX") {
    // Refusée ou expirée : elle n'aboutira plus, autant repartir d'une page blanche.
    await revoquerConsentement(req.identifiantsBanque, u.goCardlessRequisitionId);
    const modifie = await majCompte(req, LIAISON_VIDE);
    return res.json({ ...statutDe(req, modifie), refusee: true });
  }

  res.json(statutDe(req));
}));

/**
 * Bascule entre synchronisation et saisie manuelle, sans défaire la liaison :
 * revenir à la saisie manuelle ne doit pas obliger à repasser par sa banque
 * pour changer d'avis.
 */
routeur.put("/", valider(ActiverAgregationSchema), attraper(async (req, res) => {
  if (req.donnees.active && !req.utilisateur.goCardlessAccountId) {
    return res.status(409).json({ erreur: "Reliez d'abord un compte bancaire.", motif: "aucun-compte" });
  }
  const modifie = await majCompte(req, { agregationActive: req.donnees.active });
  res.json(statutDe(req, modifie));
}));

/**
 * C. Revenus et charges tirés des opérations des 90 derniers jours.
 *
 * La synthèse est gardée quelques heures. Si la banque ne répond pas — panne,
 * quota, consentement expiré — la dernière synthèse connue est resservie avec
 * `perime: true` plutôt que de laisser l'écran vide.
 */
routeur.get("/financial-data", exigerConfiguration, avecBanque(async (req, res) => {
  const u = req.utilisateur;
  if (!u.goCardlessAccountId || !u.agregationActive) {
    return res.status(409).json({ erreur: "La synchronisation bancaire n'est pas active.", motif: "agregation-inactive" });
  }

  const connue = lireSynthese(u);
  if (connue && Date.now() - u.agregationSynchroLe.getTime() < FRAICHEUR_MS) {
    return res.json(syntheseBancaireVersApi(connue, { synchroniseLe: u.agregationSynchroLe }));
  }

  const maintenant = new Date();
  const du = jour(new Date(maintenant.getTime() - JOURS_ANALYSES * 24 * 60 * 60 * 1000));
  const au = jour(maintenant);

  let operations, soldes;
  try {
    [operations, soldes] = await Promise.all([
      lireTransactions(req.identifiantsBanque, u.goCardlessAccountId, du, au),
      lireSoldes(req.identifiantsBanque, u.goCardlessAccountId),
    ]);
  } catch (e) {
    if (!(e instanceof ErreurGoCardless) || !connue) throw e;
    journal.alerte("synthèse bancaire resservie", { identifiant: req.identifiant, statut: e.statut });
    return res.json(syntheseBancaireVersApi(connue, { synchroniseLe: u.agregationSynchroLe, perime: true }));
  }

  const synthese = {
    ...analyserOperations(operations, { jours: JOURS_ANALYSES }),
    solde: soldePrincipal(soldes),
    du,
    au,
    jours: JOURS_ANALYSES,
  };
  await majCompte(req, { agregationSynthese: JSON.stringify(synthese), agregationSynchroLe: maintenant });
  res.json(syntheseBancaireVersApi(synthese, { synchroniseLe: maintenant }));
}));

/** Défait la liaison : consentement retiré chez la banque, identifiants effacés. */
routeur.delete("/", attraper(async (req, res) => {
  await revoquerConsentement(req.identifiantsBanque, req.utilisateur.goCardlessRequisitionId);
  await majCompte(req, LIAISON_VIDE);
  res.status(204).end();
}));

export default routeur;

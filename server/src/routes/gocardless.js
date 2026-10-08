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
import { InitierAgregationSchema, ActiverAgregationSchema } from "../schemas.js";
import { syntheseBancaireVersApi } from "../conversion.js";
import { journal } from "../journal.js";
import { urlApplication } from "../email/gabarits.js";
import {
  agregationConfiguree,
  ErreurGoCardless,
  listerInstitutions,
  creerRequisition,
  lireRequisition,
  lireSoldes,
  lireTransactions,
} from "../banque/gocardless.js";
import { revoquerConsentement } from "../banque/consentement.js";
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
const statutDe = (u) => ({
  // Faux quand le déploiement n'a pas de clés GoCardless : seule la saisie
  // manuelle est alors proposée.
  disponible: agregationConfiguree(),
  active: Boolean(u.agregationActive && u.goCardlessAccountId),
  reliee: Boolean(u.goCardlessAccountId),
  // Un consentement a été demandé mais n'a pas encore abouti.
  enAttente: Boolean(u.goCardlessRequisitionId && !u.goCardlessAccountId),
  synchroniseLe: u.agregationSynchroLe ?? null,
});

const LIAISON_VIDE = {
  agregationActive: false,
  goCardlessRequisitionId: null,
  goCardlessAccountId: null,
  agregationSynthese: null,
  agregationSynchroLe: null,
};

const majCompte = (req, data) => prisma.utilisateur.update({ where: { id: req.utilisateur.id }, data });

const exigerConfiguration = (_req, res, suite) => {
  if (agregationConfiguree()) return suite();
  res.status(503).json({
    erreur: "La synchronisation bancaire n'est pas disponible sur cette installation.",
    motif: "agregation-indisponible",
  });
};

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

routeur.get("/statut", (req, res) => res.json(statutDe(req.utilisateur)));

/** Banques proposées, pour le sélecteur. `?pays=FR` par défaut. */
routeur.get("/institutions", exigerConfiguration, avecBanque(async (req, res) => {
  const pays = String(req.query.pays ?? "FR");
  if (!/^[a-zA-Z]{2}$/.test(pays)) return res.status(400).json({ erreur: "pays : code à deux lettres attendu" });
  res.json(await listerInstitutions(pays));
}));

/**
 * A. Ouvre une demande de consentement et renvoie l'adresse où s'authentifier.
 *
 * Une demande précédente, aboutie ou non, est d'abord retirée : en laisser
 * traîner une ouvrirait un consentement que plus rien ne référence ici.
 */
routeur.post("/initiate", exigerConfiguration, valider(InitierAgregationSchema), avecBanque(async (req, res) => {
  await revoquerConsentement(req.utilisateur.goCardlessRequisitionId);

  const requisition = await creerRequisition({
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
  if (u.goCardlessAccountId) return res.json(statutDe(u));

  const requisition = await lireRequisition(u.goCardlessRequisitionId);

  if (requisition.statut === "LN" && requisition.comptes.length > 0) {
    // Le premier compte fait office de compte principal.
    const modifie = await majCompte(req, { goCardlessAccountId: requisition.comptes[0], agregationActive: true });
    return res.json(statutDe(modifie));
  }

  if (requisition.statut === "RJ" || requisition.statut === "EX") {
    // Refusée ou expirée : elle n'aboutira plus, autant repartir d'une page blanche.
    await revoquerConsentement(u.goCardlessRequisitionId);
    const modifie = await majCompte(req, LIAISON_VIDE);
    return res.json({ ...statutDe(modifie), refusee: true });
  }

  res.json(statutDe(u));
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
  res.json(statutDe(modifie));
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
      lireTransactions(u.goCardlessAccountId, du, au),
      lireSoldes(u.goCardlessAccountId),
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
  await revoquerConsentement(req.utilisateur.goCardlessRequisitionId);
  await majCompte(req, LIAISON_VIDE);
  res.status(204).end();
}));

export default routeur;

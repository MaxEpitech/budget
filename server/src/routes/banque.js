// Synchronisation bancaire facultative (DSP2), via le prestataire du foyer :
// Enable Banking ou GoCardless Bank Account Data.
//
// Parcours : le client choisit une banque (`/institutions`), demande un lien de
// consentement (`/initiate`), part s'authentifier chez sa banque, revient sur
// l'application qui confirme la liaison (`/callback`), puis lit les chiffres
// tirés de ses opérations (`/financial-data`).
//
// Ce fichier ne sait pas parler aux prestataires : il passe par leur façade
// commune (banque/fournisseurs.js), choisie d'après les identifiants du foyer.
//
// ─── Qui est concerné ─────────────────────────────────────────────────────
// Toujours le compte de la session, jamais un identifiant reçu du client. Une
// route « /financial-data/:userId » laisserait n'importe quel compte connecté
// demander les données bancaires d'un autre en changeant un paramètre : ici il
// n'y a simplement rien à changer.
import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { InitierAgregationSchema, ActiverAgregationSchema, IdentifiantsAgregationSchema, RetourBanqueSchema, ReleveSchema } from "../schemas.js";
import { syntheseBancaireVersApi, enEuros } from "../conversion.js";
import { lireReleve, fenetreRecente, ErreurReleve } from "../banque/releve.js";
import { preparerOperations } from "../banque/import.js";
import { montantEnCentimes } from "../banque/analyse.js";
import { journal } from "../journal.js";
import { urlApplication } from "../email/gabarits.js";
import { ErreurBanque, identifiantsRefuses } from "../banque/erreurs.js";
import { FOURNISSEURS, fournisseurDe, LIAISON_VIDE } from "../banque/fournisseurs.js";
import { revoquerConsentement, defaireLiaisonsDuFoyer } from "../banque/consentement.js";
import { identifiantsDuFoyer, enregistrerIdentifiants, effacerIdentifiants, identifiantPublic, masquer } from "../banque/identifiants.js";
import { chiffrementDisponible } from "../banque/chiffrement.js";
import { analyserOperations, soldePrincipal, JOURS_ANALYSES } from "../banque/analyse.js";

const routeur = Router();

// Durée pendant laquelle une synthèse est resservie sans réinterroger la
// banque. Les banques n'autorisent qu'une poignée de lectures par jour et par
// compte : sans cette retenue, quelques rechargements épuiseraient le quota.
const FRAICHEUR_MS = 6 * 60 * 60 * 1000;

/* ─── Aides ────────────────────────────────────────────────────────────── */

/** Ce que le client a besoin de savoir pour afficher le bon écran. */
const statutDe = (req, u = req.utilisateur) => {
  const f = req.fournisseur;
  return {
    // Faux quand ni le foyer ni l'installation n'ont d'identifiants : seule la
    // saisie manuelle est alors proposée.
    disponible: Boolean(f),
    fournisseur: f ? req.identifiantsBanque.fournisseur : null,
    active: Boolean(f && u.agregationActive && f.reliee(u)),
    reliee: Boolean(f?.reliee(u)),
    // Un consentement a été demandé mais n'a pas encore abouti.
    enAttente: Boolean(f?.enAttente(u)),
    synchroniseLe: u.agregationSynchroLe ?? null,
  };
};

const majCompte = (req, data) => prisma.utilisateur.update({ where: { id: req.utilisateur.id }, data });

// Les identifiants dépendent du foyer : ils sont lus une fois par requête, avec
// la façade du prestataire correspondant. `null` s'il n'y en a aucun.
const chargerIdentifiants = async (req) => {
  req.identifiantsBanque = await identifiantsDuFoyer(req.utilisateur.foyerId);
  req.fournisseur = fournisseurDe(req.identifiantsBanque);
};

routeur.use(attraper(async (req, _res, suite) => {
  await chargerIdentifiants(req);
  suite();
}));

const exigerConfiguration = (req, res, suite) => {
  if (req.fournisseur) return suite();
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

/** Ce que l'écran de réglage montre des identifiants : jamais un secret. */
const configurationDe = (req) => {
  const duFoyer = req.identifiantsBanque?.source === "foyer";
  return {
    // Sans clé de chiffrement sur le serveur, rien ne peut être enregistré.
    enregistrementPossible: chiffrementDisponible(),
    // "foyer" : saisis ici · "installation" : fournis par l'hébergement · null : aucun.
    source: req.identifiantsBanque?.source ?? null,
    fournisseur: req.identifiantsBanque?.fournisseur ?? null,
    identifiant: duFoyer ? masquer(identifiantPublic(req.identifiantsBanque)) : null,
    peutModifier: req.utilisateur.role === "proprietaire",
    // L'adresse de retour à déclarer chez chaque prestataire qui l'exige.
    redirections: { enablebanking: FOURNISSEURS.enablebanking.redirection(urlApplication()) },
  };
};

/**
 * Traduit l'erreur d'un prestataire en réponse lisible.
 *
 * Ses 401 et 403 ne sont JAMAIS relayés tels quels : le client les lirait comme
 * une session tombée et renverrait vers la connexion, alors que c'est la banque
 * qui refuse, pas nous.
 */
function repondreErreurBanque(req, res, e) {
  journal.alerte("appel au prestataire bancaire en échec", { identifiant: req.identifiant, statut: e.statut, code: e.code, detail: e.message });
  if (e.statut === 429) {
    return res.status(429).json({
      erreur: "La banque limite le nombre de synchronisations par jour. Réessayez plus tard.",
      motif: "quota-banque",
    });
  }
  res.status(502).json({ erreur: "Le service bancaire n'a pas répondu comme prévu. Réessayez dans un instant.", motif: "banque-indisponible" });
}

/** Comme `attraper`, mais les erreurs d'un prestataire deviennent une réponse 502/429. */
const avecBanque = (fn) =>
  attraper(async (req, res, suite) => {
    try {
      await fn(req, res, suite);
    } catch (e) {
      if (!(e instanceof ErreurBanque)) throw e;
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

/* ─── Relevé téléchargé depuis la banque ───────────────────────────────── */

/**
 * Lit un relevé (CSV, OFX ou QIF) et rend deux choses : les revenus et charges
 * mensuels qu'on en tire, et ses opérations prêtes à entrer dans le flux.
 *
 * Aucun prestataire, aucun identifiant : c'est la voie qui marche avec toutes
 * les banques. Rien n'est enregistré ici — le fichier est lu, analysé, oublié.
 * Les opérations n'entrent en base que si l'utilisateur les valide ensuite
 * (`POST /api/transactions/import`).
 */
routeur.post("/releve", valider(ReleveSchema), attraper(async (req, res) => {
  const { pour } = req.donnees;
  // Le titulaire doit être le foyer, ou l'un de SES membres.
  if (pour !== "foyer" && !(await prisma.membre.findFirst({ where: { id: pour, foyerId: req.utilisateur.foyerId }, select: { id: true } }))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }

  let lu;
  try {
    lu = lireReleve(req.donnees.contenu);
  } catch (e) {
    if (!(e instanceof ErreurReleve)) throw e;
    return res.status(400).json({ erreur: e.message, motif: "releve-illisible" });
  }

  // L'estimation ne regarde que la fin du relevé ; l'import, lui, propose tout.
  const recent = fenetreRecente(lu.operations, JOURS_ANALYSES);
  const synthese = {
    ...analyserOperations(recent.operations, { jours: recent.jours }),
    solde: lu.solde === null ? null : montantEnCentimes(lu.solde),
    du: recent.du,
    au: recent.au,
    jours: recent.jours,
  };

  const lignes = preparerOperations(lu.operations, pour);
  const connues = new Set(
    (
      await prisma.transaction.findMany({
        where: { foyerId: req.utilisateur.foyerId, importCle: { in: lignes.map((l) => l.cle) } },
        select: { importCle: true },
      })
    ).map((t) => t.importCle),
  );

  const avertissements = [];
  if (recent.jours < 45) {
    avertissements.push(
      "Ce relevé couvre moins de deux mois : les charges qui reviennent ne peuvent pas être repérées. Exportez au moins trois mois pour une estimation fiable.",
    );
  }
  if (synthese.nbRevenus === 0) {
    avertissements.push("Aucun versement n'a été reconnu comme salaire : le revenu est à saisir à la main.");
  }

  res.json({
    ...syntheseBancaireVersApi(synthese, { synchroniseLe: new Date() }),
    source: "releve",
    format: lu.format,
    nom: req.donnees.nom ?? null,
    pour,
    lignesIgnorees: lu.ignorees,
    avertissements,
    operations: lignes.map((l) => ({ ...l, montant: enEuros(l.montant), dejaImportee: connues.has(l.cle) })),
  });
}));

/* ─── Identifiants du foyer chez son prestataire ───────────────────────── */

routeur.get("/configuration", (req, res) => res.json(configurationDe(req)));

/**
 * Enregistre les identifiants du foyer chez un prestataire.
 *
 * Ils sont essayés auprès de lui avant d'être gardés : une faute de frappe se
 * voit tout de suite, ici, plutôt qu'au moment de relier une banque. Les
 * liaisons ouvertes sous les identifiants précédents sont défaites — elles
 * appartiennent à un autre compte, voire à un autre prestataire.
 */
routeur.put("/configuration", exigerProprietaire, valider(IdentifiantsAgregationSchema), attraper(async (req, res) => {
  if (!chiffrementDisponible()) {
    return res.status(503).json({
      erreur: "L'enregistrement est impossible : la clé de chiffrement (CLE_CHIFFREMENT) n'est pas configurée sur le serveur.",
      motif: "chiffrement-indisponible",
    });
  }

  const fournisseur = FOURNISSEURS[req.donnees.fournisseur];
  let avertissement;
  try {
    avertissement = await fournisseur.verifier(req.donnees, urlApplication());
  } catch (e) {
    if (!(e instanceof ErreurBanque)) throw e;
    if (e.code === "CLE_ILLISIBLE") return res.status(400).json({ erreur: e.message, motif: "identifiants-refuses" });
    if (identifiantsRefuses(e)) {
      return res.status(400).json({ erreur: `${fournisseur.nom} refuse ces identifiants. Vérifiez-les, puis réessayez.`, motif: "identifiants-refuses" });
    }
    return repondreErreurBanque(req, res, e);
  }

  const foyerId = req.utilisateur.foyerId;
  await defaireLiaisonsDuFoyer(foyerId);
  await enregistrerIdentifiants(foyerId, req.donnees);
  await chargerIdentifiants(req);
  res.json({ ...configurationDe(req), avertissement: avertissement ?? null });
}));

/** Retire les identifiants du foyer, et les liaisons ouvertes avec eux. */
routeur.delete("/configuration", exigerProprietaire, attraper(async (req, res) => {
  const foyerId = req.utilisateur.foyerId;
  if (req.identifiantsBanque?.source === "foyer") {
    await defaireLiaisonsDuFoyer(foyerId);
    await effacerIdentifiants(foyerId);
  }
  await chargerIdentifiants(req);
  res.json(configurationDe(req));
}));

/* ─── Liaison du compte connecté ───────────────────────────────────────── */

/** Banques proposées, pour le sélecteur. `?pays=FR` par défaut. */
routeur.get("/institutions", exigerConfiguration, avecBanque(async (req, res) => {
  const pays = String(req.query.pays ?? "FR");
  if (!/^[a-zA-Z]{2}$/.test(pays)) return res.status(400).json({ erreur: "pays : code à deux lettres attendu" });
  res.json(await req.fournisseur.listerBanques(req.identifiantsBanque, pays));
}));

/**
 * A. Ouvre une demande de consentement et renvoie l'adresse où s'authentifier.
 *
 * Une demande précédente, aboutie ou non, est d'abord retirée : en laisser
 * traîner une ouvrirait un consentement que plus rien ne référence ici.
 *
 * L'adresse de retour pointe sur le client, qui appelle ensuite `/callback` :
 * la session voyage ainsi dans une requête de même origine, quelle que soit la
 * politique du cookie.
 */
routeur.post("/initiate", exigerConfiguration, valider(InitierAgregationSchema), avecBanque(async (req, res) => {
  await revoquerConsentement(req.identifiantsBanque, req.utilisateur);

  let demande;
  try {
    demande = await req.fournisseur.ouvrir(req.identifiantsBanque, { banque: req.donnees.institutionId, app: urlApplication() });
  } catch (e) {
    if (e instanceof ErreurBanque && e.statut === 400) return res.status(400).json({ erreur: "Cette banque n'est pas reconnue par le prestataire." });
    throw e;
  }

  await majCompte(req, { ...LIAISON_VIDE, ...demande.colonnes });
  res.status(201).json({ link: demande.lien });
}));

const RAISONS_REFUS = {
  "aucun-compte":
    "La banque a répondu, mais aucun compte n'est accessible. En mode restreint, seuls les comptes que vous avez liés à votre application dans le panneau Enable Banking le sont.",
};

/**
 * B. Retour de la banque : confirme la liaison et retient le compte principal.
 *
 * Appelée par le client une fois revenu sur l'application, avec ce que la
 * banque a ajouté à l'adresse de retour (`code`, `state`, `error`). Sans effet
 * si la liaison est déjà faite ; si l'utilisateur a rebroussé chemin chez sa
 * banque, la demande reste simplement en attente et peut être relancée.
 */
routeur.get("/callback", exigerConfiguration, avecBanque(async (req, res) => {
  const u = req.utilisateur;
  const f = req.fournisseur;
  if (f.reliee(u)) return res.json(statutDe(req));
  if (!f.enAttente(u)) {
    return res.status(409).json({ erreur: "Aucune connexion bancaire n'est en cours.", motif: "aucune-demande" });
  }

  const retour = RetourBanqueSchema.safeParse(req.query);
  if (!retour.success) return res.status(400).json({ erreur: "Retour de la banque illisible." });

  const issue = await f.confirmer(req.identifiantsBanque, u, {
    code: retour.data.code,
    etat: retour.data.state,
    erreur: retour.data.error,
  });

  if (issue.etat === "reliee") {
    const modifie = await majCompte(req, { ...issue.colonnes, agregationActive: true });
    return res.json(statutDe(req, modifie));
  }
  if (issue.etat === "refusee") {
    // Elle n'aboutira plus : autant repartir d'une page blanche.
    await revoquerConsentement(req.identifiantsBanque, u);
    const modifie = await majCompte(req, LIAISON_VIDE);
    return res.json({ ...statutDe(req, modifie), refusee: true, raison: RAISONS_REFUS[issue.raison] ?? null });
  }
  res.json(statutDe(req));
}));

/**
 * Bascule entre synchronisation et saisie manuelle, sans défaire la liaison :
 * revenir à la saisie manuelle ne doit pas obliger à repasser par sa banque
 * pour changer d'avis.
 */
routeur.put("/", valider(ActiverAgregationSchema), attraper(async (req, res) => {
  if (req.donnees.active && !req.fournisseur?.reliee(req.utilisateur)) {
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
  if (!req.fournisseur.reliee(u) || !u.agregationActive) {
    return res.status(409).json({ erreur: "La synchronisation bancaire n'est pas active.", motif: "agregation-inactive" });
  }

  const connue = lireSynthese(u);
  if (connue && Date.now() - u.agregationSynchroLe.getTime() < FRAICHEUR_MS) {
    return res.json(syntheseBancaireVersApi(connue, { synchroniseLe: u.agregationSynchroLe }));
  }

  const maintenant = new Date();
  const du = jour(new Date(maintenant.getTime() - JOURS_ANALYSES * 24 * 60 * 60 * 1000));
  const au = jour(maintenant);

  let lu;
  try {
    lu = await req.fournisseur.lire(req.identifiantsBanque, u, du, au);
  } catch (e) {
    if (!(e instanceof ErreurBanque) || !connue) throw e;
    journal.alerte("synthèse bancaire resservie", { identifiant: req.identifiant, statut: e.statut, code: e.code });
    return res.json(syntheseBancaireVersApi(connue, { synchroniseLe: u.agregationSynchroLe, perime: true }));
  }

  const synthese = {
    ...analyserOperations(lu.operations, { jours: JOURS_ANALYSES }),
    solde: soldePrincipal(lu.soldes),
    du,
    au,
    jours: JOURS_ANALYSES,
  };
  await majCompte(req, { agregationSynthese: JSON.stringify(synthese), agregationSynchroLe: maintenant });
  res.json(syntheseBancaireVersApi(synthese, { synchroniseLe: maintenant }));
}));

/** Défait la liaison : consentement retiré chez la banque, identifiants effacés. */
routeur.delete("/", attraper(async (req, res) => {
  await revoquerConsentement(req.identifiantsBanque, req.utilisateur);
  await majCompte(req, LIAISON_VIDE);
  res.status(204).end();
}));

export default routeur;

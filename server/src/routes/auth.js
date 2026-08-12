import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { InscriptionSchema, ConnexionSchema, EmailSeulSchema, JetonSchema, ReinitialisationSchema, SuppressionCompteSchema, AccepterInvitationSchema } from "../schemas.js";
import { membreVersApi, transactionVersApi, creditVersApi, projetVersApi, placementVersApi } from "../conversion.js";
import { hacherMotDePasse, verifierMotDePasse } from "../auth/motDePasse.js";
import { emettreJeton, consommerJeton } from "../auth/jetons.js";
import { ouvrirSession, fermerSession, fermerToutesLesSessions, poserCookieSession, effacerCookieSession, lireCookieSession } from "../auth/sessions.js";
import { fabriquerSecret } from "../auth/secrets.js";
import { confirmationEmailRequise } from "../auth/reglages.js";
import { lireInvitation, consommerInvitation } from "../auth/invitations.js";
import { cadenceConnexion, cadenceConnexionIp, cadenceEmail, cadenceEmailIp, cadenceJeton } from "../auth/cadence.js";
import { envoyerEmail } from "../email/envoyer.js";
import {
  gabaritValidation,
  gabaritInscriptionExistante,
  gabaritReinitialisation,
  gabaritReinitialisationSansCompte,
  gabaritInvitation,
} from "../email/gabarits.js";

const routeur = Router();

// Ce que le client apprend de son propre compte. Volontairement minimal.
const profil = (utilisateur) => ({
  email: utilisateur.email,
  emailValide: Boolean(utilisateur.emailValideLe),
});

/* ─── Ne pas révéler qui possède un compte ─────────────────────────────────
   Inscription et renvoi répondent toujours la même chose, que l'adresse soit
   connue ou non. Sinon le formulaire d'inscription devient un annuaire : il
   suffirait d'essayer des adresses pour savoir lesquelles sont enregistrées. */
const REPONSE_EMAIL_ENVOYE = {
  message: "Si cette adresse peut recevoir un compte, un email vient d'y être envoyé. Pensez à regarder les indésirables.",
};

const IDENTIFIANTS_REFUSES = "Adresse email ou mot de passe incorrect.";

/**
 * Envoie l'email sans jamais faire échouer la requête : le compte existe, et
 * l'utilisateur peut toujours redemander un envoi.
 *
 * L'envoi est ATTENDU. Il ne l'était pas auparavant, pour que la durée de la
 * réponse ne trahisse pas l'existence d'un compte ; mais l'API tourne en
 * fonctions sans état, qui peuvent être gelées dès la réponse émise — un envoi
 * lancé sans être attendu risquerait de ne jamais partir. Un email de
 * confirmation perdu coûte plus cher que le canal temporel qu'on referme
 * ailleurs (voir le commentaire de la route d'inscription).
 */
async function envoyerSansEchouer(destinataire, gabarit) {
  try {
    await envoyerEmail({ destinataire, ...gabarit });
  } catch (e) {
    console.error(`Échec d'envoi à ${destinataire} :`, e.message);
  }
}

/**
 * Consomme le même temps de calcul qu'une vérification réelle, quand l'adresse
 * est inconnue. Sans cela, une réponse instantanée trahirait l'absence de
 * compte alors qu'une adresse connue coûterait ses ~235 ms de scrypt.
 */
let empreinteFactice = null;
async function brulerLeTempsDeVerification(motDePasse) {
  empreinteFactice ??= await hacherMotDePasse(fabriquerSecret());
  await verifierMotDePasse(motDePasse, empreinteFactice);
}

/* ─── Inscription ────────────────────────────────────────────────────────── */

routeur.post("/inscription", cadenceEmailIp, cadenceEmail, valider(InscriptionSchema), attraper(async (req, res) => {
  const { email, motDePasse } = req.donnees;
  const confirmationRequise = confirmationEmailRequise();

  // Le hachage a lieu AVANT de savoir si l'adresse existe : les deux chemins
  // coûtent alors le même temps, sans quoi la durée de la réponse suffirait à
  // distinguer une adresse connue d'une adresse libre.
  const motDePasseHash = await hacherMotDePasse(motDePasse);

  // Sans confirmation par email, l'inscription ouvre la session immédiatement.
  // Elle ne peut donc plus taire l'existence d'un compte : réussir ou échouer
  // le dit de toute façon. On répond alors franchement plutôt que de laisser
  // quelqu'un croire qu'un email est parti. La connexion, elle, garde son
  // message unique quelle que soit l'adresse.
  async function adresseDejaPrise() {
    if (!confirmationRequise) {
      return res.status(409).json({ erreur: "Cette adresse a déjà un compte. Connectez-vous." });
    }
    await envoyerSansEchouer(email, gabaritInscriptionExistante({ email }));
    return res.status(201).json(REPONSE_EMAIL_ENVOYE);
  }

  const existant = await prisma.utilisateur.findUnique({ where: { email } });
  if (existant) return adresseDejaPrise();

  let utilisateur;
  try {
    // Le foyer et son compte naissent ensemble : un compte sans foyer serait
    // inutilisable, un foyer sans compte, inaccessible.
    utilisateur = await prisma.$transaction(async (tx) => {
      const foyer = await tx.foyer.create({ data: {} });
      return tx.utilisateur.create({
        data: {
          email,
          motDePasseHash,
          foyerId: foyer.id,
          // Rien à confirmer quand la confirmation n'est pas exigée.
          emailValideLe: confirmationRequise ? null : new Date(),
        },
      });
    });
  } catch (e) {
    // Deux inscriptions simultanées sur la même adresse : la seconde retombe
    // sur le cas « adresse déjà connue ».
    if (e?.code === "P2002") return adresseDejaPrise();
    throw e;
  }

  if (!confirmationRequise) {
    poserCookieSession(res, await ouvrirSession(utilisateur.id, req.headers["user-agent"]));
    return res.status(201).json(profil(utilisateur));
  }

  const jeton = await emettreJeton(utilisateur.id, "validation");
  await envoyerSansEchouer(email, gabaritValidation({ email, jeton }));
  res.status(201).json(REPONSE_EMAIL_ENVOYE);
}));

/* ─── Confirmation de l'adresse ──────────────────────────────────────────── */

routeur.post("/validation", cadenceJeton, valider(JetonSchema), attraper(async (req, res) => {
  const utilisateurId = await consommerJeton(req.donnees.jeton, "validation");
  if (!utilisateurId) {
    return res.status(400).json({ erreur: "Lien invalide ou expiré. Demandez un nouvel email de confirmation." });
  }

  const utilisateur = await prisma.utilisateur.update({
    where: { id: utilisateurId },
    data: { emailValideLe: new Date() },
  });

  // Ouvrir la session dans la foulée évite de redemander le mot de passe juste
  // après avoir cliqué. Qui intercepte cet email pourrait de toute façon
  // réinitialiser le mot de passe : la commodité ne coûte rien de plus.
  poserCookieSession(res, await ouvrirSession(utilisateur.id, req.headers["user-agent"]));
  res.json(profil(utilisateur));
}));

routeur.post("/renvoyer-validation", cadenceEmailIp, cadenceEmail, valider(EmailSeulSchema), attraper(async (req, res) => {
  const { email } = req.donnees;
  const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });
  if (utilisateur && !utilisateur.emailValideLe) {
    const jeton = await emettreJeton(utilisateur.id, "validation");
    await envoyerSansEchouer(email, gabaritValidation({ email, jeton }));
  }
  res.json(REPONSE_EMAIL_ENVOYE);
}));

/* ─── Connexion et déconnexion ───────────────────────────────────────────── */

routeur.post("/connexion", cadenceConnexionIp, cadenceConnexion, valider(ConnexionSchema), attraper(async (req, res) => {
  const { email, motDePasse } = req.donnees;
  const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });

  if (!utilisateur) {
    await brulerLeTempsDeVerification(motDePasse);
    return res.status(401).json({ erreur: IDENTIFIANTS_REFUSES });
  }
  if (!(await verifierMotDePasse(motDePasse, utilisateur.motDePasseHash))) {
    return res.status(401).json({ erreur: IDENTIFIANTS_REFUSES });
  }
  // Le mot de passe est bon : dire que l'adresse n'est pas confirmée n'apprend
  // rien à qui le connaît déjà, et évite un échec incompréhensible.
  if (confirmationEmailRequise() && !utilisateur.emailValideLe) {
    return res.status(403).json({
      erreur: "Adresse email non confirmée. Ouvrez le lien reçu par email, ou demandez-en un nouveau.",
      motif: "email_non_valide",
    });
  }

  poserCookieSession(res, await ouvrirSession(utilisateur.id, req.headers["user-agent"]));
  res.json(profil(utilisateur));
}));

routeur.post("/deconnexion", attraper(async (req, res) => {
  await fermerSession(lireCookieSession(req));
  effacerCookieSession(res);
  res.status(204).end();
}));

/* ─── Mot de passe oublié ────────────────────────────────────────────────── */

routeur.post("/mot-de-passe-oublie", cadenceEmailIp, cadenceEmail, valider(EmailSeulSchema), attraper(async (req, res) => {
  const { email } = req.donnees;
  const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });

  if (utilisateur) {
    const jeton = await emettreJeton(utilisateur.id, "reinitialisation");
    await envoyerSansEchouer(email, gabaritReinitialisation({ email, jeton }));
  } else {
    // L'écran répond la même chose dans les deux cas ; ce message évite en
    // contrepartie de laisser quelqu'un guetter un courrier qui ne viendra pas.
    await envoyerSansEchouer(email, gabaritReinitialisationSansCompte({ email }));
  }
  res.json(REPONSE_EMAIL_ENVOYE);
}));

routeur.post("/reinitialiser", cadenceJeton, valider(ReinitialisationSchema), attraper(async (req, res) => {
  const { jeton, motDePasse } = req.donnees;

  // Hachage avant consommation : si le calcul échouait après coup, le lien
  // serait brûlé sans que le mot de passe ait changé.
  const motDePasseHash = await hacherMotDePasse(motDePasse);

  const utilisateurId = await consommerJeton(jeton, "reinitialisation");
  if (!utilisateurId) {
    return res.status(400).json({ erreur: "Lien invalide ou expiré. Demandez une nouvelle réinitialisation." });
  }

  const avant = await prisma.utilisateur.findUnique({ where: { id: utilisateurId } });
  const utilisateur = await prisma.utilisateur.update({
    where: { id: utilisateurId },
    data: {
      motDePasseHash,
      // Avoir suivi ce lien prouve l'accès à la boîte mail : autant valider
      // l'adresse si ce n'était pas déjà fait, sinon un compte dont le lien de
      // confirmation a été perdu resterait inutilisable pour toujours.
      // La date de première validation, elle, n'est jamais réécrite.
      emailValideLe: avant?.emailValideLe ?? new Date(),
    },
  });

  // Un mot de passe change souvent parce qu'on le croit compromis : toutes les
  // sessions ouvertes ailleurs tombent, y compris celles d'un éventuel intrus.
  await fermerToutesLesSessions(utilisateur.id);
  poserCookieSession(res, await ouvrirSession(utilisateur.id, req.headers["user-agent"]));
  res.json(profil(utilisateur));
}));

/** Nombre d'enregistrements métier d'un foyer : sert à savoir s'il est vide. */
async function contenuFoyer(foyerId) {
  const compteurs = await Promise.all([
    prisma.membre.count({ where: { foyerId } }),
    prisma.transaction.count({ where: { foyerId } }),
    prisma.credit.count({ where: { foyerId } }),
    prisma.projet.count({ where: { foyerId } }),
    prisma.placement.count({ where: { foyerId } }),
  ]);
  return compteurs.reduce((s, n) => s + n, 0);
}

/* ─── Invitations ────────────────────────────────────────────────────────── */

/** De quoi présenter l'écran d'accueil, sans consommer le lien. */
routeur.get("/invitation", cadenceJeton, attraper(async (req, res) => {
  const invitation = await lireInvitation(req.query.jeton);
  if (!invitation) {
    return res.status(400).json({ erreur: "Invitation invalide ou expirée. Demandez-en une nouvelle." });
  }
  const compteExistant = await prisma.utilisateur.findUnique({ where: { email: invitation.email } });
  res.json({
    email: invitation.email,
    role: invitation.role,
    membre: invitation.membre ? { id: invitation.membre.id, nom: invitation.membre.nom } : null,
    // L'écran doit savoir s'il faut demander un mot de passe ou une connexion.
    compteExistant: Boolean(compteExistant),
  });
}));

/**
 * Acceptation. Deux chemins, et le second est celui qu'on oublie :
 *
 * — Aucun compte à cette adresse : on en crée un, directement dans le foyer.
 *   Avoir suivi le lien prouve l'accès à la boîte mail, l'adresse est donc
 *   confirmée du même coup.
 *
 * — Un compte existe déjà : il faut être connecté avec lui. On le rattache
 *   alors au foyer, à condition que le sien soit vide — sinon ses propres
 *   données seraient abandonnées derrière lui.
 */
routeur.post("/invitation", cadenceJeton, valider(AccepterInvitationSchema), attraper(async (req, res) => {
  const apercu = await lireInvitation(req.donnees.jeton);
  if (!apercu) {
    return res.status(400).json({ erreur: "Invitation invalide ou expirée. Demandez-en une nouvelle." });
  }

  const compteExistant = await prisma.utilisateur.findUnique({ where: { email: apercu.email } });

  if (compteExistant) {
    if (req.utilisateur?.id !== compteExistant.id) {
      return res.status(401).json({
        erreur: "Un compte existe déjà pour cette adresse. Connectez-vous avec, puis rouvrez le lien.",
        motif: "connexion_requise",
      });
    }
    if (compteExistant.foyerId === apercu.foyerId) {
      return res.status(409).json({ erreur: "Vous faites déjà partie de ce foyer." });
    }

    const ancienFoyerId = compteExistant.foyerId;
    const restant = await contenuFoyer(ancienFoyerId);
    const autresComptes = await prisma.utilisateur.count({ where: { foyerId: ancienFoyerId, id: { not: compteExistant.id } } });
    if (restant > 0) {
      return res.status(409).json({
        erreur: "Votre foyer actuel contient des données. Exportez-les puis videz-le avant de rejoindre un autre foyer.",
      });
    }

    const invitation = await consommerInvitation(req.donnees.jeton);
    if (!invitation) return res.status(400).json({ erreur: "Invitation déjà utilisée." });

    const utilisateur = await prisma.$transaction(async (tx) => {
      const deplace = await tx.utilisateur.update({
        where: { id: compteExistant.id },
        data: { foyerId: invitation.foyerId, role: invitation.role },
      });
      if (invitation.membreId) {
        await tx.membre.update({ where: { id: invitation.membreId }, data: { utilisateurId: deplace.id } });
      }
      // Le foyer quitté disparaît s'il ne servait plus à personne.
      if (autresComptes === 0) await tx.foyer.delete({ where: { id: ancienFoyerId } });
      return deplace;
    });

    poserCookieSession(res, await ouvrirSession(utilisateur.id, req.headers["user-agent"]));
    return res.json(profil(utilisateur));
  }

  if (!req.donnees.motDePasse) {
    return res.status(400).json({ erreur: "mot de passe : 12 caractères minimum", motif: "mot_de_passe_requis" });
  }

  const motDePasseHash = await hacherMotDePasse(req.donnees.motDePasse);
  const invitation = await consommerInvitation(req.donnees.jeton);
  if (!invitation) return res.status(400).json({ erreur: "Invitation déjà utilisée." });

  const utilisateur = await prisma.$transaction(async (tx) => {
    const cree = await tx.utilisateur.create({
      data: {
        email: invitation.email,
        motDePasseHash,
        // Suivre le lien prouve l'accès à la boîte : rien à confirmer de plus.
        emailValideLe: new Date(),
        foyerId: invitation.foyerId,
        role: invitation.role,
      },
    });
    if (invitation.membreId) {
      await tx.membre.update({ where: { id: invitation.membreId }, data: { utilisateurId: cree.id } });
    }
    return cree;
  });

  poserCookieSession(res, await ouvrirSession(utilisateur.id, req.headers["user-agent"]));
  res.status(201).json(profil(utilisateur));
}));

/* ─── Ses sessions ───────────────────────────────────────────────────────── */

/**
 * Les sessions ouvertes de son compte.
 *
 * Devenu un standard, et d'autant plus justifié qu'un foyer partagé multiplie
 * les accès : voir « Chrome sur Windows, actif il y a deux minutes » est le seul
 * moyen de repérer une connexion qu'on n'a pas ouverte.
 */
routeur.get("/sessions", attraper(async (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  const sessions = await prisma.session.findMany({
    where: { utilisateurId: req.utilisateur.id, expireLe: { gt: new Date() } },
    orderBy: { derniereActivite: "desc" },
    select: { id: true, appareil: true, creeLe: true, derniereActivite: true },
  });
  res.json(
    sessions.map((s) => ({
      ...s,
      // Se fermer soi-même depuis cette liste n'aurait aucun sens : c'est ce que
      // fait le bouton « Se déconnecter ».
      actuelle: s.id === req.utilisateur.sessionId,
    })),
  );
}));

routeur.delete("/sessions/:id", attraper(async (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  if (req.params.id === req.utilisateur.sessionId) {
    return res.status(400).json({ erreur: "Pour fermer celle-ci, déconnectez-vous." });
  }
  // Bornée au compte : une session d'un autre compte est introuvable, pas refusée.
  const { count } = await prisma.session.deleteMany({
    where: { id: req.params.id, utilisateurId: req.utilisateur.id },
  });
  if (count === 0) return res.status(404).json({ erreur: "Session introuvable" });
  res.status(204).end();
}));

/* ─── Compte courant ─────────────────────────────────────────────────────── */

routeur.get("/moi", (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  res.json(profil(req.utilisateur));
});

/**
 * Export de toutes les données du foyer, à l'usage de son propriétaire.
 *
 * Un script d'administration existait déjà, mais en ligne de commande : la
 * portabilité suppose que l'utilisateur puisse récupérer ses données seul. Le
 * fichier reprend les montants en euros et les noms de champs de l'API — on
 * doit pouvoir l'ouvrir et le comprendre, pas seulement le réimporter.
 */
routeur.get("/mes-donnees", attraper(async (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  const foyerId = req.utilisateur.foyerId;

  const [foyer, membres, transactions, credits, projets, placements] = await Promise.all([
    prisma.foyer.findUnique({ where: { id: foyerId } }),
    prisma.membre.findMany({ where: { foyerId }, orderBy: { id: "asc" } }),
    prisma.transaction.findMany({ where: { foyerId }, orderBy: { id: "asc" } }),
    prisma.credit.findMany({ where: { foyerId }, orderBy: { id: "asc" } }),
    prisma.projet.findMany({ where: { foyerId }, include: { versements: { orderBy: { date: "asc" } } }, orderBy: { id: "asc" } }),
    prisma.placement.findMany({ where: { foyerId }, orderBy: { id: "asc" } }),
  ]);

  res.json({
    exporteLe: new Date().toISOString(),
    compte: { email: req.utilisateur.email, creeLe: req.utilisateur.creeLe },
    foyer: { repartition: foyer.repartition },
    membres: membres.map(membreVersApi),
    transactions: transactions.map(transactionVersApi),
    credits: credits.map(creditVersApi),
    projets: projets.map(projetVersApi),
    placements: placements.map(placementVersApi),
  });
}));

/**
 * Suppression de son compte.
 *
 * Deux situations, qu'il serait grave de confondre :
 *
 * — Seul sur son foyer : c'est le FOYER qui est supprimé, pas l'utilisateur.
 *   Les cascades partent de lui, et supprimer le compte seul laisserait derrière
 *   un foyer que plus personne ne pourrait ni consulter ni effacer.
 *
 * — Foyer partagé : seul le compte s'en va. Le budget appartient aussi aux
 *   autres, l'emporter serait leur détruire leurs données. Le membre du budget
 *   que ce compte incarnait reste en place, avec son revenu et ses lignes.
 *
 * Un foyer partagé doit par ailleurs garder un propriétaire : le dernier ne peut
 * pas partir sans transmettre le rôle, faute de quoi plus personne ne pourrait
 * inviter ni supprimer le foyer.
 *
 * Le mot de passe est redemandé dans tous les cas : une session laissée ouverte
 * sur un poste partagé ne doit pas suffire au geste le plus irréversible de
 * l'application.
 */
routeur.delete("/moi", cadenceConnexionIp, valider(SuppressionCompteSchema), attraper(async (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });

  if (!(await verifierMotDePasse(req.donnees.motDePasse, req.utilisateur.motDePasseHash))) {
    return res.status(403).json({ erreur: "Mot de passe incorrect." });
  }

  const foyerId = req.utilisateur.foyerId;
  const autres = await prisma.utilisateur.findMany({
    where: { foyerId, id: { not: req.utilisateur.id } },
    select: { id: true, role: true },
  });

  if (autres.length === 0) {
    await prisma.foyer.delete({ where: { id: foyerId } });
    effacerCookieSession(res);
    return res.status(204).end();
  }

  if (req.utilisateur.role === "proprietaire" && !autres.some((u) => u.role === "proprietaire")) {
    return res.status(409).json({
      erreur:
        "Vous êtes le dernier propriétaire de ce foyer. Nommez d'abord quelqu'un d'autre propriétaire, ou retirez les autres comptes.",
    });
  }

  await prisma.utilisateur.delete({ where: { id: req.utilisateur.id } });
  effacerCookieSession(res);
  res.status(204).end();
}));

export default routeur;

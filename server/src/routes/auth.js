import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { InscriptionSchema, ConnexionSchema, EmailSeulSchema, JetonSchema, ReinitialisationSchema } from "../schemas.js";
import { hacherMotDePasse, verifierMotDePasse } from "../auth/motDePasse.js";
import { emettreJeton, consommerJeton } from "../auth/jetons.js";
import { ouvrirSession, fermerSession, fermerToutesLesSessions, poserCookieSession, effacerCookieSession, lireCookieSession } from "../auth/sessions.js";
import { fabriquerSecret } from "../auth/secrets.js";
import { cadenceConnexion, cadenceConnexionIp, cadenceEmail, cadenceEmailIp, cadenceJeton } from "../auth/cadence.js";
import { envoyerEmail } from "../email/envoyer.js";
import {
  gabaritValidation,
  gabaritInscriptionExistante,
  gabaritReinitialisation,
  gabaritReinitialisationSansCompte,
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
 * Envoie sans faire attendre la réponse HTTP, et sans jamais la faire échouer.
 *
 * Ne pas attendre tient à deux raisons. D'abord un échec d'envoi ne doit pas
 * faire échouer l'inscription : le compte existe, l'utilisateur peut redemander
 * un email. Ensuite le temps de réponse ne doit rien trahir — attendre un appel
 * réseau dont la durée dépend du chemin emprunté rendrait mesurable la
 * différence entre une adresse connue et une adresse libre.
 */
function envoyerSansAttendre(destinataire, gabarit) {
  envoyerEmail({ destinataire, ...gabarit }).catch((e) => {
    console.error(`Échec d'envoi à ${destinataire} :`, e.message);
  });
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

  // Le hachage a lieu AVANT de savoir si l'adresse existe : les deux chemins
  // coûtent alors le même temps, sans quoi la durée de la réponse suffirait à
  // distinguer une adresse connue d'une adresse libre.
  const motDePasseHash = await hacherMotDePasse(motDePasse);

  const existant = await prisma.utilisateur.findUnique({ where: { email } });
  if (existant) {
    envoyerSansAttendre(email, gabaritInscriptionExistante({ email }));
    return res.status(201).json(REPONSE_EMAIL_ENVOYE);
  }

  let utilisateur;
  try {
    // Le foyer et son compte naissent ensemble : un compte sans foyer serait
    // inutilisable, un foyer sans compte, inaccessible.
    utilisateur = await prisma.$transaction(async (tx) => {
      const foyer = await tx.foyer.create({ data: {} });
      return tx.utilisateur.create({ data: { email, motDePasseHash, foyerId: foyer.id } });
    });
  } catch (e) {
    // Deux inscriptions simultanées sur la même adresse : la seconde retombe
    // sur le cas « adresse déjà connue ».
    if (e?.code === "P2002") {
      envoyerSansAttendre(email, gabaritInscriptionExistante({ email }));
      return res.status(201).json(REPONSE_EMAIL_ENVOYE);
    }
    throw e;
  }

  const jeton = await emettreJeton(utilisateur.id, "validation");
  envoyerSansAttendre(email, gabaritValidation({ email, jeton }));
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
  poserCookieSession(res, await ouvrirSession(utilisateur.id));
  res.json(profil(utilisateur));
}));

routeur.post("/renvoyer-validation", cadenceEmailIp, cadenceEmail, valider(EmailSeulSchema), attraper(async (req, res) => {
  const { email } = req.donnees;
  const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });
  if (utilisateur && !utilisateur.emailValideLe) {
    const jeton = await emettreJeton(utilisateur.id, "validation");
    envoyerSansAttendre(email, gabaritValidation({ email, jeton }));
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
  if (!utilisateur.emailValideLe) {
    return res.status(403).json({
      erreur: "Adresse email non confirmée. Ouvrez le lien reçu par email, ou demandez-en un nouveau.",
      motif: "email_non_valide",
    });
  }

  poserCookieSession(res, await ouvrirSession(utilisateur.id));
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
    envoyerSansAttendre(email, gabaritReinitialisation({ email, jeton }));
  } else {
    // L'écran répond la même chose dans les deux cas ; ce message évite en
    // contrepartie de laisser quelqu'un guetter un courrier qui ne viendra pas.
    envoyerSansAttendre(email, gabaritReinitialisationSansCompte({ email }));
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
  poserCookieSession(res, await ouvrirSession(utilisateur.id));
  res.json(profil(utilisateur));
}));

/* ─── Compte courant ─────────────────────────────────────────────────────── */

routeur.get("/moi", (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  res.json(profil(req.utilisateur));
});

export default routeur;

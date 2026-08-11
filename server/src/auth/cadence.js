// Limitation de cadence sur les routes sensibles.
//
// Deux compteurs distincts, volontairement :
//   • par adresse email, pour qu'une attaque sur un compte précis soit freinée
//     même si elle change d'adresse IP ;
//   • par adresse IP, pour qu'un balayage de nombreux comptes soit freiné même
//     s'il change d'email à chaque essai.
// L'un sans l'autre laisse une porte ouverte.
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const refus = (message) => (_req, res) => res.status(429).json({ erreur: message });

// L'email est lu dans le corps de la requête ; à défaut on retombe sur l'IP.
// ipKeyGenerator normalise les adresses IPv6 (sinon un attaquant change
// simplement de bit dans son préfixe /64 pour repartir de zéro).
const parEmail = (req) => {
  const email = req.body?.email;
  return typeof email === "string" && email.length > 0
    ? `email:${email.trim().toLowerCase()}`
    : ipKeyGenerator(req.ip);
};

const parIp = (req) => ipKeyGenerator(req.ip);

const commun = { standardHeaders: true, legacyHeaders: false };

/** Connexion : 10 essais par quart d'heure et par compte. */
export const cadenceConnexion = rateLimit({
  ...commun,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: parEmail,
  handler: refus("Trop de tentatives de connexion. Réessayez dans un quart d'heure."),
});

/** Connexion : garde-fou global par machine, pour le balayage de comptes. */
export const cadenceConnexionIp = rateLimit({
  ...commun,
  windowMs: 15 * 60 * 1000,
  limit: 50,
  keyGenerator: parIp,
  handler: refus("Trop de tentatives de connexion. Réessayez dans un quart d'heure."),
});

/** Envoi d'emails (inscription, renvoi, mot de passe oublié) : 5 par heure. */
export const cadenceEmail = rateLimit({
  ...commun,
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: parEmail,
  handler: refus("Trop de demandes pour cette adresse. Réessayez dans une heure."),
});

/** Et un plafond par machine, pour éviter d'en arroser beaucoup d'un coup. */
export const cadenceEmailIp = rateLimit({
  ...commun,
  windowMs: 60 * 60 * 1000,
  limit: 20,
  keyGenerator: parIp,
  handler: refus("Trop de demandes. Réessayez plus tard."),
});

/** Consommation de jeton : freine la recherche d'un lien valide par tâtonnement. */
export const cadenceJeton = rateLimit({
  ...commun,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  keyGenerator: parIp,
  handler: refus("Trop de tentatives. Réessayez dans un quart d'heure."),
});

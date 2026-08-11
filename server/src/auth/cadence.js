// Limitation de cadence sur les routes sensibles.
//
// Deux compteurs distincts par route, volontairement :
//   • par adresse email, pour qu'une attaque sur un compte précis soit freinée
//     même si elle change d'adresse IP ;
//   • par adresse IP, pour qu'un balayage de nombreux comptes soit freiné même
//     s'il change d'email à chaque essai.
// L'un sans l'autre laisse une porte ouverte.
//
// Les compteurs vivent en base (voir magasinCadence.js) : l'API tourne en
// fonctions sans état, un compteur en mémoire disparaîtrait avec l'instance.
import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { MagasinPostgres } from "./magasinCadence.js";

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

/**
 * Fabrique un limiteur. Le préfixe est indispensable : tous les compteurs
 * partagent une même table, et sans lui deux limiteurs qui classent par la même
 * adresse email additionneraient leurs coups dans la même case.
 */
const limiteur = ({ prefixe, fenetreMs, plafond, cle, message }) =>
  rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    store: new MagasinPostgres(),
    windowMs: fenetreMs,
    limit: plafond,
    keyGenerator: (req) => `${prefixe}:${cle(req)}`,
    handler: refus(message),
  });

const QUART_HEURE = 15 * 60 * 1000;
const UNE_HEURE = 60 * 60 * 1000;

const TROP_DE_CONNEXIONS = "Trop de tentatives de connexion. Réessayez dans un quart d'heure.";

/** Connexion : 10 essais par quart d'heure et par compte. */
export const cadenceConnexion = limiteur({
  prefixe: "connexion-email",
  fenetreMs: QUART_HEURE,
  plafond: 10,
  cle: parEmail,
  message: TROP_DE_CONNEXIONS,
});

/** Connexion : garde-fou global par machine, pour le balayage de comptes. */
export const cadenceConnexionIp = limiteur({
  prefixe: "connexion-ip",
  fenetreMs: QUART_HEURE,
  plafond: 50,
  cle: parIp,
  message: TROP_DE_CONNEXIONS,
});

/** Envoi d'emails (inscription, renvoi, mot de passe oublié) : 5 par heure. */
export const cadenceEmail = limiteur({
  prefixe: "email-adresse",
  fenetreMs: UNE_HEURE,
  plafond: 5,
  cle: parEmail,
  message: "Trop de demandes pour cette adresse. Réessayez dans une heure.",
});

/** Et un plafond par machine, pour éviter d'en arroser beaucoup d'un coup. */
export const cadenceEmailIp = limiteur({
  prefixe: "email-ip",
  fenetreMs: UNE_HEURE,
  plafond: 20,
  cle: parIp,
  message: "Trop de demandes. Réessayez plus tard.",
});

/** Consommation de jeton : freine la recherche d'un lien valide par tâtonnement. */
export const cadenceJeton = limiteur({
  prefixe: "jeton-ip",
  fenetreMs: QUART_HEURE,
  plafond: 30,
  cle: parIp,
  message: "Trop de tentatives. Réessayez dans un quart d'heure.",
});

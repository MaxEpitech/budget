// Middlewares d'accès.
import { attraper } from "../middleware.js";
import { lireSession, lireCookieSession } from "./sessions.js";
import { confirmationEmailRequise } from "./reglages.js";

/**
 * Renseigne req.utilisateur et req.foyerId si un cookie de session valide est
 * présent, sans jamais bloquer. Monté globalement : les routes publiques
 * (inscription, connexion) le traversent sans effet.
 */
export const chargerSession = attraper(async (req, _res, suite) => {
  const utilisateur = await lireSession(lireCookieSession(req));
  if (utilisateur) {
    req.utilisateur = utilisateur;
    req.foyerId = utilisateur.foyerId;
  }
  suite();
});

/**
 * Exige une session valide — et une adresse confirmée lorsque le réglage
 * CONFIRMATION_EMAIL_REQUISE l'impose. Monté sur toutes les routes métier.
 */
export const exigerAuth = (req, res, suite) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  if (confirmationEmailRequise() && !req.utilisateur.emailValideLe) {
    return res.status(403).json({ erreur: "Adresse email non validée" });
  }
  suite();
};

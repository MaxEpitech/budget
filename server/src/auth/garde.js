// Middlewares d'accès.
import { attraper } from "../middleware.js";
import { lireSession, lireCookieSession } from "./sessions.js";

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
 * Exige une session valide et une adresse validée.
 *
 * Ce garde n'est pas encore monté sur les routes métier : il le sera à la
 * dernière étape, quand l'inscription et les écrans de connexion existeront.
 * D'ici là, l'application reste accessible sans compte.
 */
export const exigerAuth = (req, res, suite) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: "Connexion requise" });
  if (!req.utilisateur.emailValideLe) {
    return res.status(403).json({ erreur: "Adresse email non validée" });
  }
  suite();
};

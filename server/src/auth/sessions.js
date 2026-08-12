// Sessions en base plutôt que JWT : révocables immédiatement (déconnexion,
// changement de mot de passe), et l'identifiant qui circule dans le cookie
// n'est qu'un secret opaque dont seule l'empreinte est stockée.
import { prisma } from "../db.js";
import { fabriquerSecret, empreinte, DUREES } from "./secrets.js";

const NOM_COOKIE = "session";

/**
 * Nom d'appareil lisible, tiré de l'en-tête du navigateur.
 *
 * Volontairement grossier : il sert à se reconnaître dans une liste — « c'est
 * mon téléphone » — pas à identifier une machine. Une chaîne brute serait
 * illisible, et une adresse IP n'aiderait personne tout en ajoutant une donnée
 * personnelle à conserver.
 */
export function nommerAppareil(entete) {
  if (typeof entete !== "string" || !entete) return null;
  const systeme =
    /Android/i.test(entete) ? "Android"
    : /iPhone|iPad|iPod/i.test(entete) ? "iPhone ou iPad"
    : /Mac OS X|Macintosh/i.test(entete) ? "Mac"
    : /Windows/i.test(entete) ? "Windows"
    : /Linux/i.test(entete) ? "Linux"
    : null;
  const navigateur =
    /Edg\//i.test(entete) ? "Edge"
    : /OPR\/|Opera/i.test(entete) ? "Opera"
    : /Firefox\//i.test(entete) ? "Firefox"
    : /Chrome\//i.test(entete) ? "Chrome"
    : /Safari\//i.test(entete) ? "Safari"
    : null;
  if (!systeme && !navigateur) return null;
  return [navigateur, systeme].filter(Boolean).join(" sur ");
}

/** Ouvre une session et renvoie le secret à déposer dans le cookie. */
export async function ouvrirSession(utilisateurId, entete) {
  const secret = fabriquerSecret();
  await prisma.session.create({
    data: {
      utilisateurId,
      jetonHache: empreinte(secret),
      expireLe: new Date(Date.now() + DUREES.session),
      appareil: nommerAppareil(entete),
    },
  });
  return secret;
}

// Le suivi d'activité n'écrit qu'au-delà de ce délai : une écriture à chaque
// requête doublerait le coût de la lecture de session pour un gain nul.
const PAS_ACTIVITE = 5 * 60 * 1000;

/** Utilisateur derrière un secret de session, ou null si absente ou périmée. */
export async function lireSession(secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  const session = await prisma.session.findUnique({
    where: { jetonHache: empreinte(secret) },
    include: { utilisateur: true },
  });
  if (!session) return null;
  if (session.expireLe <= new Date()) {
    // Périmée : on en profite pour faire le ménage.
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  if (Date.now() - session.derniereActivite.getTime() > PAS_ACTIVITE) {
    await prisma.session
      .update({ where: { id: session.id }, data: { derniereActivite: new Date() } })
      .catch(() => {});
  }

  // L'identifiant de la session en cours sert à la distinguer des autres dans
  // la liste, et à empêcher qu'on la referme sans le savoir.
  return { ...session.utilisateur, sessionId: session.id };
}

/** Ferme une session précise (déconnexion). */
export async function fermerSession(secret) {
  if (typeof secret !== "string" || secret.length === 0) return;
  await prisma.session.deleteMany({ where: { jetonHache: empreinte(secret) } });
}

/** Ferme toutes les sessions d'un utilisateur (changement de mot de passe). */
export async function fermerToutesLesSessions(utilisateurId) {
  await prisma.session.deleteMany({ where: { utilisateurId } });
}

/* ─── Cookie ─────────────────────────────────────────────────────────────── */

// `Secure` seulement en production : en développement l'app est servie en HTTP,
// un cookie Secure ne serait jamais renvoyé par le navigateur.
const optionsCookie = () => ({
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: DUREES.session,
  path: "/",
});

export const poserCookieSession = (res, secret) => res.cookie(NOM_COOKIE, secret, optionsCookie());

export const effacerCookieSession = (res) =>
  res.clearCookie(NOM_COOKIE, { ...optionsCookie(), maxAge: undefined });

export const lireCookieSession = (req) => req.cookies?.[NOM_COOKIE];

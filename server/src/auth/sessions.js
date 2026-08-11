// Sessions en base plutôt que JWT : révocables immédiatement (déconnexion,
// changement de mot de passe), et l'identifiant qui circule dans le cookie
// n'est qu'un secret opaque dont seule l'empreinte est stockée.
import { prisma } from "../db.js";
import { fabriquerSecret, empreinte, DUREES } from "./secrets.js";

const NOM_COOKIE = "session";

/** Ouvre une session et renvoie le secret à déposer dans le cookie. */
export async function ouvrirSession(utilisateurId) {
  const secret = fabriquerSecret();
  await prisma.session.create({
    data: {
      utilisateurId,
      jetonHache: empreinte(secret),
      expireLe: new Date(Date.now() + DUREES.session),
    },
  });
  return secret;
}

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
  return session.utilisateur;
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

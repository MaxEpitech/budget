// Invitations à rejoindre un foyer.
//
// Même mécanique que les jetons de confirmation : un secret aléatoire, stocké
// haché, à usage unique, avec une date d'expiration. La table est distincte
// parce qu'une invitation vise une adresse qui n'a peut-être pas encore de
// compte, là où les jetons visent un utilisateur existant.
import { prisma } from "../db.js";
import { fabriquerSecret, empreinte } from "./secrets.js";

// Sept jours : le temps de voir passer l'email, sans qu'un lien oublié dans une
// boîte reste indéfiniment une porte ouverte sur un budget.
export const DUREE_INVITATION = 7 * 24 * 60 * 60 * 1000;

/**
 * Émet une invitation et renvoie le lien EN CLAIR, seule fois où il existe.
 * Une invitation déjà en attente pour la même adresse et le même foyer est
 * remplacée : sinon deux liens vivraient en parallèle, et révoquer le premier
 * ne fermerait rien.
 */
export async function inviter({ foyerId, email, role, membreId }) {
  await prisma.invitation.deleteMany({ where: { foyerId, email, utiliseLe: null } });

  const secret = fabriquerSecret();
  const invitation = await prisma.invitation.create({
    data: {
      foyerId,
      email,
      role,
      membreId: membreId ?? null,
      jetonHache: empreinte(secret),
      expireLe: new Date(Date.now() + DUREE_INVITATION),
    },
  });
  return { invitation, secret };
}

/** Lit une invitation sans la consommer : de quoi présenter l'écran d'accueil. */
export async function lireInvitation(secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  const invitation = await prisma.invitation.findUnique({
    where: { jetonHache: empreinte(secret) },
    include: { foyer: { select: { id: true } }, membre: { select: { id: true, nom: true } } },
  });
  if (!invitation || invitation.utiliseLe || invitation.expireLe <= new Date()) return null;
  return invitation;
}

/**
 * Consomme l'invitation. Comme pour les autres jetons, la condition « pas encore
 * utilisée » fait partie de la mise à jour : deux acceptations simultanées ne
 * peuvent pas créer deux comptes.
 */
export async function consommerInvitation(secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  const jetonHache = empreinte(secret);

  const { count } = await prisma.invitation.updateMany({
    where: { jetonHache, utiliseLe: null, expireLe: { gt: new Date() } },
    data: { utiliseLe: new Date() },
  });
  if (count === 0) return null;

  return prisma.invitation.findUnique({ where: { jetonHache } });
}

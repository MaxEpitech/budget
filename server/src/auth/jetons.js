// Jetons à usage unique envoyés par email : validation d'adresse et
// réinitialisation de mot de passe.
import { prisma } from "../db.js";
import { fabriquerSecret, empreinte, DUREES } from "./secrets.js";

/**
 * Émet un jeton pour un utilisateur et renvoie sa valeur EN CLAIR, la seule
 * fois où elle existe : seule l'empreinte est conservée en base.
 * Les jetons du même type encore en attente sont invalidés au passage, pour
 * qu'un renvoi de mail rende le lien précédent inopérant.
 */
export async function emettreJeton(utilisateurId, type) {
  await prisma.jeton.updateMany({
    where: { utilisateurId, type, utiliseLe: null },
    data: { utiliseLe: new Date() },
  });

  const secret = fabriquerSecret();
  await prisma.jeton.create({
    data: {
      utilisateurId,
      type,
      jetonHache: empreinte(secret),
      expireLe: new Date(Date.now() + DUREES[type]),
    },
  });
  return secret;
}

/**
 * Consomme un jeton : renvoie l'identifiant de l'utilisateur, ou null si le
 * jeton est inconnu, périmé, déjà utilisé, ou d'un autre type.
 *
 * La consommation est atomique — le filtre `utiliseLe: null` fait partie de la
 * mise à jour — donc deux clics simultanés sur le même lien n'ouvrent pas deux
 * fois le droit.
 */
export async function consommerJeton(secret, type) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  const jetonHache = empreinte(secret);

  const { count } = await prisma.jeton.updateMany({
    where: { jetonHache, type, utiliseLe: null, expireLe: { gt: new Date() } },
    data: { utiliseLe: new Date() },
  });
  if (count === 0) return null;

  const jeton = await prisma.jeton.findUnique({ where: { jetonHache } });
  return jeton?.utilisateurId ?? null;
}

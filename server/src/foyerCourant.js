// Détermine le foyer auquel s'applique une requête.
//
// C'est la couture du module d'authentification : dès qu'une session valide est
// présente, le foyer vient de l'utilisateur connecté. Le repli mono-foyer
// ci-dessous est transitoire — il disparaîtra quand `exigerAuth` sera monté sur
// les routes métier, à la dernière étape du module.
import { prisma } from "./db.js";

export async function foyerCourant(req) {
  // Session valide : le foyer est celui du compte connecté.
  if (req?.foyerId) return req.foyerId;

  // Repli transitoire : l'unique foyer en base, tant qu'aucun compte n'existe.
  const foyer = await prisma.foyer.findFirst({ orderBy: { id: "asc" } });
  if (foyer) return foyer.id;

  // Première utilisation sur une base vide : on crée le foyer à la volée.
  const cree = await prisma.foyer.create({ data: {} });
  return cree.id;
}

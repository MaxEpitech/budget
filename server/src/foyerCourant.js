// Détermine le foyer auquel s'applique une requête.
//
// C'est le point de bascule du module d'authentification. Aujourd'hui
// l'application est encore mono-foyer et sert l'unique enregistrement en base ;
// à l'étape suivante, cette fonction lira le foyer de l'utilisateur connecté
// (via sa session) et aucun routeur n'aura besoin d'être retouché.
import { prisma } from "./db.js";

export async function foyerCourant(_req) {
  const foyer = await prisma.foyer.findFirst({ orderBy: { id: "asc" } });
  if (foyer) return foyer.id;
  // Première utilisation sur une base vide : on crée le foyer à la volée.
  const cree = await prisma.foyer.create({ data: {} });
  return cree.id;
}

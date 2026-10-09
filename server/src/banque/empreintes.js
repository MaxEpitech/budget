// Ce qu'un foyer a déjà importé, d'où que ce soit.
//
// Une opération de relevé importée devient une ligne du flux, ou un mouvement
// interne : un mouvement d'épargne, un versement de projet, un paiement de
// crédit. Son empreinte peut donc se trouver dans quatre tables, et c'est dans
// les quatre qu'il faut la chercher — sinon un virement vers le Livret A,
// importé une première fois comme mouvement, reviendrait comme dépense à la
// réimportation du même relevé.
import { prisma } from "../db.js";

/**
 * @param {number} foyerId
 * @param {string[]} cles empreintes des opérations candidates
 * @returns {Promise<Set<string>>} celles qui sont déjà là
 */
export async function empreintesConnues(foyerId, cles) {
  if (cles.length === 0) return new Set();
  const parmi = { importCle: { in: cles } };
  const choisir = { select: { importCle: true } };
  const trouvees = await Promise.all([
    prisma.transaction.findMany({ where: { foyerId, ...parmi }, ...choisir }),
    prisma.mouvementPlacement.findMany({ where: { placement: { foyerId }, ...parmi }, ...choisir }),
    prisma.versement.findMany({ where: { projet: { foyerId }, ...parmi }, ...choisir }),
    prisma.paiementCredit.findMany({ where: { credit: { foyerId }, ...parmi }, ...choisir }),
  ]);
  return new Set(trouvees.flat().map((t) => t.importCle));
}

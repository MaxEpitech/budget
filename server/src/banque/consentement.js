// Retrait du consentement bancaire quand une liaison n'a plus lieu d'être :
// compte supprimé, compte qui change de foyer, identifiants du foyer remplacés.
//
// Effacer nos identifiants de liaison ne retire pas le consentement donné à la
// banque : sans ce geste il resterait ouvert jusqu'à son terme, relié à plus
// rien. On le retire donc explicitement.
import { prisma } from "../db.js";
import { supprimerRequisition } from "./gocardless.js";
import { identifiantsDuFoyer } from "./identifiants.js";
import { journal } from "../journal.js";

/** Les colonnes d'une liaison remise à zéro. */
export const LIAISON_VIDE = {
  agregationActive: false,
  goCardlessRequisitionId: null,
  goCardlessAccountId: null,
  agregationSynthese: null,
  agregationSynchroLe: null,
};

/**
 * Retire un consentement, sans jamais faire échouer l'opération en cours.
 *
 * Une banque injoignable ne doit pas empêcher quelqu'un de supprimer son
 * compte : l'échec est journalisé, et le consentement expirera de lui-même.
 *
 * @param identifiants ceux du foyer SOUS LESQUELS le consentement a été ouvert
 */
export async function revoquerConsentement(identifiants, requisitionId) {
  if (!requisitionId || !identifiants) return;
  try {
    await supprimerRequisition(identifiants, requisitionId);
  } catch (e) {
    journal.alerte("consentement bancaire non retiré", { detail: e?.message });
  }
}

/** Retire le consentement d'un compte, avec les identifiants de son foyer actuel. */
export async function revoquerPourCompte(utilisateur) {
  if (!utilisateur?.goCardlessRequisitionId) return;
  await revoquerConsentement(await identifiantsDuFoyer(utilisateur.foyerId), utilisateur.goCardlessRequisitionId);
}

/**
 * Défait toutes les liaisons d'un foyer.
 *
 * À appeler AVANT de changer ou d'effacer ses identifiants : une liaison
 * ouverte sous un compte GoCardless est inutilisable depuis un autre, et la
 * garder afficherait une banque « reliée » qui ne répondrait plus jamais.
 */
export async function defaireLiaisonsDuFoyer(foyerId) {
  const identifiants = await identifiantsDuFoyer(foyerId);
  const relies = await prisma.utilisateur.findMany({
    where: { foyerId, goCardlessRequisitionId: { not: null } },
    select: { goCardlessRequisitionId: true },
  });
  await Promise.all(relies.map((u) => revoquerConsentement(identifiants, u.goCardlessRequisitionId)));
  await prisma.utilisateur.updateMany({ where: { foyerId }, data: LIAISON_VIDE });
}

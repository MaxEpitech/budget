// Retrait du consentement bancaire quand un compte disparaît.
//
// Supprimer le compte efface nos identifiants, mais pas le consentement donné à
// la banque : sans ce geste il resterait ouvert jusqu'à son terme, relié à plus
// rien. On le retire donc explicitement.
import { agregationConfiguree, supprimerRequisition } from "./gocardless.js";
import { journal } from "../journal.js";

/**
 * Retire un consentement, sans jamais faire échouer l'opération en cours.
 *
 * Une banque injoignable ne doit pas empêcher quelqu'un de supprimer son
 * compte : l'échec est journalisé, et le consentement expirera de lui-même.
 */
export async function revoquerConsentement(requisitionId) {
  if (!requisitionId || !agregationConfiguree()) return;
  try {
    await supprimerRequisition(requisitionId);
  } catch (e) {
    journal.alerte("consentement bancaire non retiré", { detail: e?.message });
  }
}

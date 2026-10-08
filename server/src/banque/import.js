// D'un relevé lu aux lignes proposées pour le flux.
//
// Fonctions pures. Chaque opération reçoit une clé stable — son empreinte —
// qui permet de reconnaître celles déjà importées, y compris depuis un autre
// fichier couvrant en partie la même période.
import { createHash } from "node:crypto";
import { libelle as libelleDe, montantEnCentimes, estRevenuReconnu, normaliser } from "./analyse.js";
import { devinerCategorie, CATEGORIE_PAR_DEFAUT } from "./categories.js";

const LIBELLE_MAXIMUM = 200;

/**
 * Prépare les opérations d'un relevé pour l'aperçu d'import.
 *
 * La clé mêle date, montant, libellé et rang : le rang distingue deux
 * opérations strictement identiques le même jour — deux cafés au même prix —
 * que rien d'autre ne sépare.
 *
 * @returns montants en centimes ; `salaire` signale un crédit reconnu comme
 *   revenu d'activité, déjà compté dans les revenus des membres du foyer.
 */
export function preparerOperations(operations) {
  const rangs = new Map();
  const lignes = [];
  for (const o of operations) {
    const centimes = montantEnCentimes(o?.transactionAmount?.amount);
    if (centimes === null || centimes === 0 || !o.bookingDate) continue;

    const texte = String(o.remittanceInformationUnstructured ?? "").trim() || "Opération sans libellé";
    const identite = `${o.bookingDate}|${centimes}|${normaliser(libelleDe(o))}`;
    const rang = rangs.get(identite) ?? 0;
    rangs.set(identite, rang + 1);

    lignes.push({
      cle: createHash("sha256").update(`${identite}|${rang}`).digest("hex").slice(0, 32),
      date: o.bookingDate,
      type: centimes > 0 ? "revenu" : "depense",
      libelle: texte.slice(0, LIBELLE_MAXIMUM),
      montant: Math.abs(centimes),
      categorie: centimes > 0 ? CATEGORIE_PAR_DEFAUT : devinerCategorie(texte),
      salaire: estRevenuReconnu(o),
    });
  }
  // De la plus récente à la plus ancienne, comme le flux.
  return lignes.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

// Reconnaître, dans un relevé, les mouvements internes au foyer.
//
// Un virement vers le Livret A ou le prélèvement d'un prêt ne sont pas des
// dépenses : le budget compte déjà le versement prévu du support et
// l'échéance du crédit. Importés comme dépenses, ils pèseraient deux fois.
// L'aperçu les signale donc d'emblée, et l'utilisateur confirme ou corrige.
//
// Deux indices seulement, choisis pour se tromper rarement :
// - un prélèvement égal, à un euro près, à l'échéance d'un crédit en cours ce
//   mois-là — un montant au centime près ne doit rien au hasard ;
// - un libellé qui contient le nom d'un support ou d'un projet en mots entiers
//   (« VIR VERS LIVRET A ») — « PEA » ne doit pas reconnaître « PEAGE ».
//
// Fonctions pures.
import { normaliser } from "./analyse.js";
import { echeanceTotale } from "../finance.js";
import { ecartMois } from "../mois.js";

// Les mots d'un libellé, entourés d'espaces : chercher « livret a » en mots
// entiers revient à chercher « [espace]livret a[espace] ».
const enMots = (texte) => ` ${normaliser(texte).replace(/[^a-z0-9]+/g, " ").trim()} `;

const nomCherchable = (libelle) => {
  const mots = enMots(libelle);
  // Trop court, un nom reconnaîtrait n'importe quoi.
  return mots.trim().length >= 3 ? mots : null;
};

/**
 * L'échéance d'un crédit pour un mois donné, s'il court ce mois-là.
 * @param credit au format de l'API (montants en euros)
 */
function echeanceDuMois(credit, mois) {
  const k = ecartMois(credit.debut, mois);
  if (k < 0 || k >= credit.duree) return null;
  return echeanceTotale(credit.capital, credit.taux, credit.duree, credit.assuranceTaux ?? 0, credit.assuranceBase, k);
}

/**
 * Propose une affectation pour chaque ligne qui ressemble à un mouvement interne.
 *
 * @param lignes   lignes préparées pour l'aperçu (montants en centimes)
 * @param foyer    `{ placements, projets, credits }` au format de l'API (euros)
 * @returns les mêmes lignes ; celles reconnues portent `affectation: { nature, id }`
 */
export function suggererAffectations(lignes, { placements = [], projets = [], credits = [] }) {
  const supports = placements.map((p) => ({ id: p.id, nom: nomCherchable(p.libelle) })).filter((p) => p.nom);
  const enveloppes = projets.map((p) => ({ id: p.id, nom: nomCherchable(p.libelle) })).filter((p) => p.nom);

  return lignes.map((ligne) => {
    // Un salaire reconnu reste un salaire.
    if (ligne.salaire) return ligne;
    const mots = enMots(ligne.libelle);
    const euros = ligne.montant / 100;

    if (ligne.type === "depense") {
      const mois = ligne.date.slice(0, 7);
      const proches = credits
        .map((c) => ({ id: c.id, ecart: Math.abs((echeanceDuMois(c, mois) ?? Infinity) - euros) }))
        .filter((c) => c.ecart <= 1)
        .sort((a, b) => a.ecart - b.ecart);
      if (proches.length > 0) return { ...ligne, affectation: { nature: "credit", id: proches[0].id } };
    }

    // Vers un support comme depuis lui : un retrait de l'épargne est une entrée.
    const support = supports.find((s) => mots.includes(s.nom));
    if (support) return { ...ligne, affectation: { nature: "epargne", id: support.id } };

    if (ligne.type === "depense") {
      const projet = enveloppes.find((p) => mots.includes(p.nom));
      if (projet) return { ...ligne, affectation: { nature: "projet", id: projet.id } };
    }
    return ligne;
  });
}

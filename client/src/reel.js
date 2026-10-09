// Le reste à vivre réel : ce qui est réellement passé sur les comptes.
//
// Le reste à vivre prévu est un budget : il compte le salaire de référence tant
// que la paie n'est pas là, chaque ligne régulière, le versement prévu de
// chaque support et projet, l'échéance de chaque crédit. Le réel ne compte que
// ce qui a eu lieu, d'après ce qui a été enregistré :
// - les opérations datées du flux — relevés importés, saisies ponctuelles ;
// - les mouvements internes — virements vers l'épargne ou un projet, échéances
//   de crédit prélevées, retraits d'épargne.
//
// Les lignes régulières n'y entrent pas : ce sont des prévisions, elles ne
// disent pas si le prélèvement a eu lieu. Un loyer passé sur le compte y entre
// quand le relevé qui le porte est importé.
import { mouvementsInternesDuMois } from "./interne.js";

/**
 * @param etat l'état du mois servi par l'API (transactions déjà filtrées sur le mois)
 * @returns entrées et sorties réelles, et ce qu'il en reste ; `operations`
 *   compte ce qui a été enregistré — à zéro, le réel ne dit encore rien
 */
export function reelDuMois(etat, mois) {
  const datees = etat.transactions.filter((t) => !t.recurrent && t.mois === mois);
  const somme = (liste) => liste.reduce((s, x) => s + x.montant, 0);
  const internes = mouvementsInternesDuMois(etat, mois);

  const entrees = somme(datees.filter((t) => t.type === "revenu"));
  const sorties = somme(datees.filter((t) => t.type === "depense"));
  // Ce qui part vers l'épargne, un projet ou un crédit quitte le compte courant ;
  // un retrait d'épargne y revient.
  const versInterne = somme(internes.filter((m) => m.sortie));
  const depuisInterne = somme(internes.filter((m) => !m.sortie));

  return {
    entrees,
    sorties,
    versInterne,
    depuisInterne,
    reste: entrees - sorties - versInterne + depuisInterne,
    operations: datees.length + internes.length,
  };
}

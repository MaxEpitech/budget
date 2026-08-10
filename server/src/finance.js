// Formules financières du budget — extraites du prototype (budget-foyer.jsx),
// comportement à préserver à l'identique.
//
// Toutes les fonctions sont pures et indifférentes à l'unité : appelées en
// centimes elles rendent des centimes, en euros des euros. Elles renvoient des
// flottants ; l'arrondi éventuel se fait à la frontière de l'API.

/**
 * Mensualité d'un crédit amortissable classique.
 * M = C × r / (1 − (1+r)^−n) avec r = taux/100/12 ; cas r = 0 → C / n.
 */
export function mensualite(capital, tauxAnnuel, dureeMois) {
  if (!capital || !dureeMois) return 0;
  const r = tauxAnnuel / 100 / 12;
  if (r === 0) return capital / dureeMois;
  return (capital * r) / (1 - Math.pow(1 + r, -dureeMois));
}

/**
 * Capital restant dû après k échéances payées.
 * C(1+r)^k − M((1+r)^k − 1)/r, borné à [0, C].
 */
export function capitalRestant(capital, tauxAnnuel, dureeMois, k) {
  if (k <= 0) return capital;
  if (k >= dureeMois) return 0;
  const r = tauxAnnuel / 100 / 12;
  const M = mensualite(capital, tauxAnnuel, dureeMois);
  if (r === 0) return Math.max(0, capital - M * k);
  const f = Math.pow(1 + r, k);
  return Math.max(0, capital * f - M * ((f - 1) / r));
}

/**
 * Projection d'épargne sur n mois : valeur actuelle + versements mensuels capitalisés.
 * V(1+r)^n + P((1+r)^n − 1)/r ; cas r = 0 → V + P×n.
 */
export function projeter(valeur, versement, rendement, mois) {
  const r = rendement / 100 / 12;
  if (r === 0) return valeur + versement * mois;
  const f = Math.pow(1 + r, mois);
  return valeur * f + versement * ((f - 1) / r);
}

/**
 * Quote-part d'un membre dans les charges communes :
 * au prorata de son revenu, ou 1/nb membres si repartition = "moitie".
 * Si le total des revenus est nul en mode prorata, la part est 0.
 */
export function quotePart(revenu, totalRevenus, nbMembres, repartition) {
  if (repartition === "moitie") return 1 / nbMembres;
  return totalRevenus ? revenu / totalRevenus : 0;
}

/**
 * Reste à vivre du foyer :
 * revenus − dépenses − mensualités crédits − versements projets − versements placements.
 */
export function resteAVivre({ revenus, depenses, mensualitesCredits, versementsProjets, versementsPlacements }) {
  return revenus - depenses - mensualitesCredits - versementsProjets - versementsPlacements;
}

/**
 * Versement mensuel requis pour atteindre l'objectif d'un projet à l'échéance :
 * (objectif − épargné) / mois restants. Le nombre de mois est borné à 1 minimum
 * (échéance passée ou courante) et le restant à 0 (objectif déjà atteint).
 */
export function versementRequis(objectif, epargne, moisRestants) {
  const restant = Math.max(0, objectif - epargne);
  return restant / Math.max(1, moisRestants);
}

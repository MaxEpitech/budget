// Formules financières utilisées côté client (amortissement affiché,
// projection d'épargne, calculs du dashboard).
// Copie de server/src/finance.js, qui fait foi — les tests unitaires vivent là-bas.

// Mensualité d'un crédit amortissable classique
export function mensualite(capital, tauxAnnuel, dureeMois) {
  if (!capital || !dureeMois) return 0;
  const r = tauxAnnuel / 100 / 12;
  if (r === 0) return capital / dureeMois;
  return (capital * r) / (1 - Math.pow(1 + r, -dureeMois));
}

// Capital restant dû après k échéances payées
export function capitalRestant(capital, tauxAnnuel, dureeMois, k) {
  if (k <= 0) return capital;
  if (k >= dureeMois) return 0;
  const r = tauxAnnuel / 100 / 12;
  const M = mensualite(capital, tauxAnnuel, dureeMois);
  if (r === 0) return Math.max(0, capital - M * k);
  const f = Math.pow(1 + r, k);
  return Math.max(0, capital * f - M * ((f - 1) / r));
}

// Projection épargne : valeur + versements mensuels capitalisés
export function projeter(valeur, versement, rendement, mois) {
  const r = rendement / 100 / 12;
  if (r === 0) return valeur + versement * mois;
  const f = Math.pow(1 + r, mois);
  return valeur * f + versement * ((f - 1) / r);
}

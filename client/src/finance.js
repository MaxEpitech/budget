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

// Ce que le crédit coûte en tout : la somme des mensualités moins le capital
export function coutTotal(capital, tauxAnnuel, dureeMois) {
  if (!capital || !dureeMois) return 0;
  return mensualite(capital, tauxAnnuel, dureeMois) * dureeMois - capital;
}

// Intérêts déjà payés après k échéances : versé en tout moins capital remboursé
export function interetsPayes(capital, tauxAnnuel, dureeMois, k) {
  const echeances = Math.max(0, Math.min(k, dureeMois));
  if (!echeances) return 0;
  const verse = mensualite(capital, tauxAnnuel, dureeMois) * echeances;
  const rembourse = capital - capitalRestant(capital, tauxAnnuel, dureeMois, echeances);
  return Math.max(0, verse - rembourse);
}

// Projection épargne : valeur + versements mensuels capitalisés
export function projeter(valeur, versement, rendement, mois) {
  const r = rendement / 100 / 12;
  if (r === 0) return valeur + versement * mois;
  const f = Math.pow(1 + r, mois);
  return valeur * f + versement * ((f - 1) / r);
}

// Support plafonné (livret réglementé) : les versements s'arrêtent au plafond,
// les intérêts continuent de courir et peuvent le dépasser.
function simulerPlafonne(valeur, versement, rendement, mois, plafond) {
  const r = rendement / 100 / 12;
  let v = valeur;
  let verse = valeur;
  for (let i = 0; i < mois; i++) {
    const apresInterets = v * (1 + r);
    const depot = Math.max(0, Math.min(versement, plafond - apresInterets));
    verse += depot;
    v = apresInterets + depot;
  }
  return { valeur: v, verse };
}

// Sans plafond, strictement identique à projeter().
export function projeterPlafonne(valeur, versement, rendement, mois, plafond) {
  if (plafond == null) return projeter(valeur, versement, rendement, mois);
  return simulerPlafonne(valeur, versement, rendement, mois, plafond).valeur;
}

// Total réellement placé : valeur de départ + versements effectués.
export function verseAvecPlafond(valeur, versement, rendement, mois, plafond) {
  if (plafond == null) return valeur + versement * mois;
  return simulerPlafonne(valeur, versement, rendement, mois, plafond).verse;
}

// Dans combien de mois le plafond sera-t-il atteint ? 0 s'il l'est déjà,
// null s'il ne le sera jamais. Itératif comme la simulation, pour ne pas
// diverger d'elle au centime près.
const HORIZON_PLAFOND = 12 * 60;

export function moisAvantPlafond(valeur, versement, rendement, plafond) {
  if (plafond == null) return null;
  if (valeur >= plafond) return 0;
  const r = rendement / 100 / 12;
  if (versement <= 0 && r <= 0) return null;
  let v = valeur;
  for (let i = 1; i <= HORIZON_PLAFOND; i++) {
    const apresInterets = v * (1 + r);
    v = apresInterets + Math.max(0, Math.min(versement, plafond - apresInterets));
    if (v >= plafond) return i;
  }
  return null;
}

// Nombre de mois entre deux clés « YYYY-MM ».
const ecartMois = (de, vers) => {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = vers.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
};

/** Nombre de mois entre deux échéances, selon le rythme. */
export const PAS_PERIODICITE = { mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12 };

/**
 * Une ligne récurrente tombe-t-elle sur ce mois ?
 *
 * Trois conditions, dans cet ordre : la ligne a commencé, elle n'est pas
 * terminée, et le mois est bien une de ses échéances. Le début sert d'ancrage —
 * un trimestriel commencé en février tombe en février, mai, août, novembre.
 * Sans début, la ligne vaut depuis toujours, et seul le mensuel a alors un sens.
 *
 * Le montant n'est jamais lissé : une assurance annuelle de 240 € pèse 240 € sur
 * le mois où elle est prélevée. Lisser reviendrait à afficher un reste à vivre
 * que personne n'a jamais eu sur son compte.
 */
export function echeanceCeMois({ debut, fin, periodicite = "mensuel" }, mois) {
  // Avant le début, ou après la fin — celle-ci étant incluse.
  if (debut && ecartMois(debut, mois) < 0) return false;
  if (fin && ecartMois(fin, mois) > 0) return false;

  const pas = PAS_PERIODICITE[periodicite] ?? 1;
  if (pas === 1) return true;
  // Sans ancrage, un rythme non mensuel n'a pas de sens : on retombe alors sur
  // le comportement le moins surprenant, celui d'une ligne qui tombe chaque mois.
  if (!debut) return true;
  return ecartMois(debut, mois) % pas === 0;
}

/**
 * Les lignes actives d'un mois : les ponctuelles de ce mois, et les récurrentes
 * dont c'est une échéance. Idempotent sur une liste déjà filtrée.
 */
export const lignesDuMois = (transactions, mois) =>
  transactions.filter((t) => (t.recurrent ? echeanceCeMois(t, mois) : t.mois === mois));

/**
 * Les totaux d'un mois, à partir de l'ensemble des données du foyer.
 *
 * Une seule définition, partagée par le mois affiché et par l'historique : ce
 * sont les mêmes chiffres, et les voir diverger d'un écran à l'autre serait le
 * plus sûr moyen de perdre confiance dans les deux.
 *
 * Les montants sont dans l'unité qu'on lui donne — euros à la frontière de
 * l'API, comme partout côté client.
 */
export function totauxDuMois({ membres = [], transactions = [], credits = [], projets = [], placements = [] }, mois) {
  const actifs = lignesDuMois(transactions, mois);

  const salaires = membres.reduce((s, m) => s + m.revenu, 0);
  const autresRevenus = actifs.filter((t) => t.type === "revenu").reduce((s, t) => s + t.montant, 0);
  const depenses = actifs.filter((t) => t.type === "depense").reduce((s, t) => s + t.montant, 0);

  // Un crédit soldé ne pèse plus : sa dernière échéance est passée.
  const mensualites = credits.reduce((s, c) => {
    const k = Math.max(0, ecartMois(c.debut, mois));
    return k >= c.duree ? s : s + mensualite(c.capital, c.taux, c.duree);
  }, 0);

  const versementsProjets = projets.reduce((s, p) => s + p.versement, 0);
  const versementsPlacements = placements.reduce((s, p) => s + p.versement, 0);
  const revenus = salaires + autresRevenus;

  return {
    mois,
    salaires,
    revenus,
    depenses,
    credits: mensualites,
    projets: versementsProjets,
    placements: versementsPlacements,
    reste: resteAVivre({
      revenus,
      depenses,
      mensualitesCredits: mensualites,
      versementsProjets,
      versementsPlacements,
    }),
  };
}


/**
 * Reste à vivre du foyer :
 * revenus − dépenses − mensualités crédits − versements projets − versements placements.
 */
// Part des charges communes qui revient à une personne.
export function quotePart(revenu, totalRevenus, nbMembres, repartition) {
  if (repartition === "moitie") return 1 / nbMembres;
  return totalRevenus ? revenu / totalRevenus : 0;
}

// Versement mensuel nécessaire pour tenir l'objectif d'un projet.
export function versementRequis(objectif, epargne, moisRestants) {
  const restant = Math.max(0, objectif - epargne);
  return restant / Math.max(1, moisRestants);
}

export function resteAVivre({ revenus, depenses, mensualitesCredits, versementsProjets, versementsPlacements }) {
  return revenus - depenses - mensualitesCredits - versementsProjets - versementsPlacements;
}

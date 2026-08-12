// Formules financières du budget — extraites du prototype d'origine (retiré du
// dépôt, consultable dans l'historique Git : budget-foyer.jsx).
// Comportement à préserver à l'identique.
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
 * Ce que le crédit coûte en tout : la somme des mensualités moins le capital
 * emprunté. C'est le seul chiffre qui répond à « combien me coûte cet
 * emprunt » — la mensualité, elle, ne dit que ce qu'il pèse chaque mois.
 */
export function coutTotal(capital, tauxAnnuel, dureeMois) {
  if (!capital || !dureeMois) return 0;
  return mensualite(capital, tauxAnnuel, dureeMois) * dureeMois - capital;
}

/**
 * Intérêts déjà payés après k échéances.
 *
 * Versé en tout moins capital effectivement remboursé. Le calcul passe par le
 * capital restant plutôt que par une somme échéance par échéance : les deux
 * donnent le même résultat, mais celui-ci ne dérive pas sur 300 mois.
 */
export function interetsPayes(capital, tauxAnnuel, dureeMois, k) {
  const echeances = Math.max(0, Math.min(k, dureeMois));
  if (!echeances) return 0;
  const verse = mensualite(capital, tauxAnnuel, dureeMois) * echeances;
  const rembourse = capital - capitalRestant(capital, tauxAnnuel, dureeMois, echeances);
  return Math.max(0, verse - rembourse);
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
 * Simulation mois par mois d'un support plafonné (livret réglementé…).
 * Règle retenue, celle des livrets : les versements s'arrêtent au plafond,
 * mais les intérêts continuent de courir et peuvent le dépasser.
 * Renvoie la valeur atteinte et le total réellement placé.
 */
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

/**
 * Projection d'épargne tenant compte d'un plafond de versements.
 * Sans plafond (null/undefined), strictement identique à projeter().
 */
export function projeterPlafonne(valeur, versement, rendement, mois, plafond) {
  if (plafond == null) return projeter(valeur, versement, rendement, mois);
  return simulerPlafonne(valeur, versement, rendement, mois, plafond).valeur;
}

/**
 * Total réellement placé au bout de n mois (valeur de départ + versements
 * effectués), les versements étant interrompus au plafond.
 */
export function verseAvecPlafond(valeur, versement, rendement, mois, plafond) {
  if (plafond == null) return valeur + versement * mois;
  return simulerPlafonne(valeur, versement, rendement, mois, plafond).verse;
}

/**
 * Dans combien de mois le plafond sera-t-il atteint ?
 *
 * Renvoie 0 s'il l'est déjà, null s'il ne le sera jamais (pas de plafond, ou
 * rien qui fasse monter la valeur). Prévenir après coup ne servirait à rien :
 * les versements versés au-delà du plafond sont refusés par la banque, et
 * c'est précisément ce qu'on veut voir venir.
 *
 * Le calcul est itératif comme la simulation : une formule fermée existerait,
 * mais elle divergerait de simulerPlafonne au centime près, et deux vérités
 * pour un même plafond seraient pires qu'une boucle.
 */
const HORIZON_PLAFOND = 12 * 60; // soixante ans : au-delà, l'échéance n'informe plus

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

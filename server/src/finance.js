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
 * Cotisation d'assurance emprunteur pour une échéance donnée.
 *
 * Deux bases, toutes deux courantes, et l'écart entre elles atteint le double
 * sur vingt-cinq ans :
 *   « initial » — le taux porte sur le capital emprunté, la cotisation ne bouge
 *                 pas de toute la durée ;
 *   « restant » — il porte sur le capital restant dû, la cotisation décroît.
 *
 * L'assiette est passée par l'appelant plutôt que recalculée ici : c'est lui
 * qui sait à quelle échéance il se trouve.
 */
export function cotisationAssurance(capitalInitial, capitalRestantDu, tauxAssurance, base = "initial") {
  if (!tauxAssurance) return 0;
  const assiette = base === "restant" ? capitalRestantDu : capitalInitial;
  return Math.max(0, assiette) * (tauxAssurance / 100 / 12);
}

/**
 * Assurance payée sur les k premières échéances, et sur toute la durée quand
 * k vaut la durée. À base constante c'est une multiplication ; à base
 * dégressive il faut sommer, le capital restant dû n'ayant pas de moyenne
 * simple.
 */
export function assurancePayee(capital, tauxAnnuel, dureeMois, tauxAssurance, base, k) {
  if (!tauxAssurance) return 0;
  const echeances = Math.max(0, Math.min(k, dureeMois));
  const mensuel = tauxAssurance / 100 / 12;
  if (base !== "restant") return capital * mensuel * echeances;
  let total = 0;
  for (let i = 0; i < echeances; i++) {
    total += capitalRestant(capital, tauxAnnuel, dureeMois, i) * mensuel;
  }
  return total;
}

/**
 * Ce qui est réellement prélevé chaque mois : la mensualité et son assurance.
 * C'est ce montant, et non la seule mensualité, que les banques rapportent aux
 * revenus pour juger d'un endettement.
 */
export function echeanceTotale(capital, tauxAnnuel, dureeMois, tauxAssurance, base, k = 0) {
  const M = mensualite(capital, tauxAnnuel, dureeMois);
  const restant = capitalRestant(capital, tauxAnnuel, dureeMois, k);
  return M + cotisationAssurance(capital, restant, tauxAssurance, base);
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
 * Amortissement simulé d'un solde à mensualité fixe : combien d'échéances
 * jusqu'à extinction, et quels intérêts en tout.
 *
 * Simulé et non résolu par une formule fermée, pour deux raisons : la dernière
 * échéance est partielle — une formule donnerait un nombre de mois fractionnaire
 * qu'il faudrait arrondir, et l'arrondi se paie en euros — et c'est le même
 * moteur qui sert au scénario « sans rien faire » et au scénario « après
 * versement », de sorte que la comparaison ne peut pas être biaisée.
 *
 * Renvoie null si la mensualité ne couvre pas les intérêts : le solde ne
 * descendrait jamais, et annoncer une durée serait mentir.
 */
const MAX_ECHEANCES = 12000; // mille ans : garde-fou, pas une limite métier

function amortir(solde, r, M) {
  if (!(M > 0)) return null;
  if (r > 0 && M <= solde * r) return null;
  let interets = 0;
  let echeances = 0;
  while (solde > 1e-9 && echeances < MAX_ECHEANCES) {
    const interet = solde * r;
    interets += interet;
    solde -= Math.min(solde, M - interet);
    echeances++;
  }
  return { echeances, interets };
}

/**
 * Indemnité de remboursement anticipé d'un prêt immobilier.
 *
 * Plafond légal (code de la consommation) : un semestre d'intérêts sur le
 * capital remboursé, sans pouvoir dépasser 3 % du capital restant dû avant le
 * remboursement. C'est un maximum — le contrat peut prévoir moins, et certaines
 * situations en dispensent. On calcule donc le pire cas, pas le cas réel.
 */
export function indemniteAnticipee(versement, capitalRestantDu, tauxAnnuel) {
  const r = tauxAnnuel / 100 / 12;
  const semestre = Math.max(0, versement) * r * 6;
  const plafond = Math.max(0, capitalRestantDu) * 0.03;
  return Math.max(0, Math.min(semestre, plafond));
}

/**
 * Remboursement anticipé partiel : ce qu'un versement exceptionnel change.
 *
 * Une banque propose deux issues, et elles ne se valent pas :
 *  — raccourcir la durée en gardant la mensualité, ce qui supprime les
 *    dernières échéances, donc les intérêts les plus tardifs ;
 *  — baisser la mensualité en gardant la durée, ce qui soulage le budget
 *    mensuel mais laisse courir le prêt aussi longtemps.
 *
 * La première économise toujours davantage. Les deux sont rendues, parce que le
 * choix dépend de ce qu'on cherche, et qu'afficher la seule plus rentable
 * masquerait la question.
 *
 * Renvoie null si le versement ne veut rien dire ici : négatif, nul, ou
 * supérieur à ce qui reste dû — dans ce dernier cas c'est un solde, pas un
 * remboursement partiel.
 */
export function rembourserParAnticipation({ capital, tauxAnnuel, dureeMois, echeancesPayees = 0, versement }) {
  const r = tauxAnnuel / 100 / 12;
  const M = mensualite(capital, tauxAnnuel, dureeMois);
  const restantAvant = capitalRestant(capital, tauxAnnuel, dureeMois, echeancesPayees);
  const echeancesRestantes = Math.max(0, dureeMois - Math.max(0, echeancesPayees));

  if (!(versement > 0) || versement >= restantAvant || echeancesRestantes <= 0) return null;

  const sansRien = amortir(restantAvant, r, M);
  if (!sansRien) return null;

  const restantApres = restantAvant - versement;
  const surDuree = amortir(restantApres, r, M);
  const nouvelleMensualite = mensualite(restantApres, tauxAnnuel, echeancesRestantes);
  const interetsSurMensualite = nouvelleMensualite * echeancesRestantes - restantApres;

  return {
    restantAvant,
    restantApres,
    echeancesRestantes,
    mensualiteActuelle: M,
    interetsSansRien: sansRien.interets,
    indemnite: indemniteAnticipee(versement, restantAvant, tauxAnnuel),
    surDuree: surDuree && {
      echeances: surDuree.echeances,
      moisGagnes: sansRien.echeances - surDuree.echeances,
      interets: surDuree.interets,
      economie: sansRien.interets - surDuree.interets,
    },
    surMensualite: {
      mensualite: nouvelleMensualite,
      baisse: M - nouvelleMensualite,
      interets: interetsSurMensualite,
      economie: sansRien.interets - interetsSurMensualite,
    },
  };
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

  // Un crédit soldé ne pèse plus : sa dernière échéance est passée. L'assurance
  // fait partie du prélèvement — l'omettre annoncerait un reste à vivre que
  // personne n'a jamais eu sur son compte.
  const mensualites = credits.reduce((s, c) => {
    const k = Math.max(0, ecartMois(c.debut, mois));
    if (k >= c.duree) return s;
    return s + echeanceTotale(c.capital, c.taux, c.duree, c.assuranceTaux ?? 0, c.assuranceBase, k);
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
 * Ce que chacun doit au foyer, et ce qu'il lui reste.
 *
 * Une charge nominative ne se partage pas. Une dépense « pour untel » pesait
 * déjà sur lui seul ; un crédit ou un support d'épargne qui lui appartient fait
 * désormais de même. Sans cela, un prêt étudiant contracté par une personne se
 * retrouvait réparti au prorata des revenus, et le reste à vivre de l'autre s'en
 * trouvait amputé d'une dette qui ne la concernait pas.
 *
 * Les projets restent communs : ils portent déjà, versement par versement, le
 * nom de qui a mis au pot.
 *
 * Cette fonction vit ici et non dans une route parce que le serveur et le client
 * la calculent tous les deux — le premier pour servir /etat, le second pour
 * répondre à la frappe sans aller-retour. Deux définitions auraient divergé, et
 * l'ont déjà fait par le passé.
 */
export function repartirParMembre(
  { membres = [], transactions = [], credits = [], projets = [], placements = [], repartition = "prorata" },
  mois
) {
  const actifs = lignesDuMois(transactions, mois);
  const salaires = membres.reduce((s, m) => s + m.revenu, 0);
  const appartientA = (x, cible) => (x.pour ?? "foyer") === cible;

  // Un crédit soldé ne pèse plus, et l'assurance fait partie du prélèvement.
  const echeanceDe = (c) => {
    const k = Math.max(0, ecartMois(c.debut, mois));
    return k >= c.duree ? 0 : echeanceTotale(c.capital, c.taux, c.duree, c.assuranceTaux ?? 0, c.assuranceBase, k);
  };

  const creditsDe = (cible) => credits.filter((c) => appartientA(c, cible)).reduce((s, c) => s + echeanceDe(c), 0);
  const placementsDe = (cible) => placements.filter((p) => appartientA(p, cible)).reduce((s, p) => s + p.versement, 0);
  const depensesDe = (cible) =>
    actifs.filter((t) => t.type === "depense" && t.pour === cible).reduce((s, t) => s + t.montant, 0);

  const chargesFoyer =
    depensesDe("foyer") +
    creditsDe("foyer") +
    projets.reduce((s, p) => s + p.versement, 0) +
    placementsDe("foyer");

  return membres.map((m) => {
    const part = quotePart(m.revenu, salaires, membres.length, repartition);
    const perso = depensesDe(m.id) + creditsDe(m.id) + placementsDe(m.id);
    const bonus = actifs
      .filter((t) => t.type === "revenu" && t.pour === m.id)
      .reduce((s, t) => s + t.montant, 0);
    const du = chargesFoyer * part;
    return { ...m, part, perso, bonus, du, reste: m.revenu + bonus - du - perso };
  });
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

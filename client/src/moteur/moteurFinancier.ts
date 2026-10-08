// Moteur de calcul de la capacité d'emprunt — fonctions pures, sans React.
//
// Trois calculs s'enchaînent, chacun nourrissant le suivant :
//   A. le crédit à la consommation tel qu'il sera au mois cible, remboursements
//      anticipés compris ;
//   B. l'endettement du foyer vu par la future banque (règle des 35 % du HCSF) ;
//   C. ce que la mensualité encore disponible permet d'emprunter, puis d'acheter.
//
// Le hook `useFinanceEngine` n'est qu'une mémoïsation de `calculerFinance` : la
// logique vit ici pour pouvoir être testée sans navigateur.
//
// Toutes les fonctions sont indifférentes à l'unité monétaire — euros à l'entrée,
// euros à la sortie. Les taux sont des pourcentages annuels (3.9 pour 3,9 %).
// Aucun arrondi n'est fait ici : il appartient à l'affichage.
import { mensualite } from "../finance.js";

/* ─── Entrées ─────────────────────────────────────────────────────────────── */

export interface BudgetInput {
  foyer: {
    /** Revenu net mensuel de l'emprunteur principal. */
    emprunteurPrincipalNet: number;
    /** Revenu net mensuel du co-emprunteur ; absent pour un profil solo. */
    coEmprunteurNet?: number;
    /** Courses, abonnements, factures… hors mensualités de crédit. */
    chargesCourantesFixes: number;
  };
  immobilierActuel: {
    /** Un crédit immobilier court-il encore, et courra-t-il après le projet ? */
    aUnCreditEnCours: boolean;
    mensualiteActuelle: number;
    seraMisEnLocation: boolean;
    loyerBrutEstime?: number;
    /** En %, typiquement 30 : la banque ne retient alors que 70 % du loyer. */
    decoteLocativeBanque: number;
  };
  creditConsommation: {
    aUnCreditConso: boolean;
    capitalEmprunte: number;
    /** TAEG annuel, en %. */
    taeg: number;
    dureeInitialeMois: number;
    strategieAnticipation: {
      /** Versé une fois par an : primes, bonus. */
      injectionsAnnuellesFixes: number;
      /** Effort d'épargne mensuel, injecté en une fois à chaque date anniversaire. */
      epargneMensuelleDediee: number;
    };
    /** Durée de la phase de préparation : le « mois cible » (ex. 24). */
    horizonSimulationMois: number;
    /** Durée restante maximale sous laquelle la banque ignore le crédit (ex. 12). */
    seuilNeutralisationMois: number;
  };
  projetImmobilier: {
    apportTotalDisponible: number;
    /** Taux nominal annuel du futur prêt, en %. */
    tauxInteretEstime: number;
    /** Taux annuel de l'assurance emprunteur, en % du capital initial. */
    tauxAssuranceEstime: number;
    /** Notaire, garantie, dossier… en % du prix du bien (ex. 8). */
    fraisAnnexesEstimesPourcent: number;
  };
}

/** Réglages du moteur. Tous ont une valeur par défaut. */
export interface OptionsMoteur {
  /** Part maximale des revenus consacrée aux crédits, en %. HCSF : 35. */
  tauxEndettementMax?: number;
  /** Les deux durées de prêt comparées, en mois. Défaut : 240 et 300. */
  dureesPretMois?: readonly [number, number];
}

/* ─── Sorties ─────────────────────────────────────────────────────────────── */

export interface ConsoAuMoisCible {
  mensualiteInitiale: number;
  capitalRestantDu: number;
  /** Mensualités encore dues après le mois cible ; la dernière peut être partielle. */
  moisRestants: number;
  /** Vrai quand la future banque ne compte plus ce crédit dans les charges. */
  neutraliseParLaBanque: boolean;
}

export interface AnalyseEndettement {
  revenusRetenusBanque: number;
  mensualiteMaxImmo: number;
  /** En % des revenus retenus. */
  tauxEndettementAvantProjet: number;
  /** En % des revenus retenus. */
  tauxEndettementApresProjet: number;
}

export interface EnveloppeAchat {
  capitalEmpruntable: number;
  prixBienMax: number;
}

export interface BudgetQuotidien {
  totalEntreesReelles: number;
  totalSortiesReelles: number;
  resteAVivreReelFoyer: number;
}

export interface ResultatFinance {
  consoAuMoisCible: ConsoAuMoisCible;
  analyseEndettement: AnalyseEndettement;
  enveloppesAchat: { sur20Ans: EnveloppeAchat; sur25Ans: EnveloppeAchat };
  budgetQuotidienApresProjet: BudgetQuotidien;
}

/* ─── Aides ───────────────────────────────────────────────────────────────── */

export const TAUX_ENDETTEMENT_HCSF = 35;
export const DUREES_PRET_PAR_DEFAUT = [240, 300] as const;

// Un champ en cours de saisie donne volontiers NaN ou un négatif : le moteur
// calcule alors comme s'il valait zéro plutôt que de propager des NaN partout.
const positif = (n: unknown): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
const entier = (n: unknown): number => Math.floor(positif(n));

// Absorbe le bruit des flottants avant un arrondi supérieur : sans lui, 36 mois
// calculés par logarithme donneraient parfois 37.
const EPSILON = 1e-9;

/**
 * Nombre de mensualités nécessaires pour solder un capital à mensualité fixe.
 *
 * n = −ln(1 − C·r / M) / ln(1 + r), et C / M à taux nul. La dernière échéance
 * peut être partielle : le résultat est arrondi au mois supérieur.
 *
 * @returns `Infinity` si la mensualité ne couvre pas les intérêts.
 */
export function dureeRestante(capital: number, tauxAnnuel: number, mensualiteFixe: number): number {
  if (capital <= EPSILON) return 0;
  if (mensualiteFixe <= 0) return Infinity;
  const r = tauxAnnuel / 100 / 12;
  if (r === 0) return Math.ceil(capital / mensualiteFixe - EPSILON);
  const part = (capital * r) / mensualiteFixe;
  if (part >= 1) return Infinity;
  return Math.ceil(-Math.log(1 - part) / Math.log(1 + r) - EPSILON);
}

/* ─── A. Crédit à la consommation ─────────────────────────────────────────── */

/**
 * Simule le crédit à la consommation mois par mois jusqu'au mois cible.
 *
 * Chaque mois : intérêts sur le capital restant dû, le reste de la mensualité
 * amortit le capital. Tous les douze mois, les versements anticipés s'ajoutent
 * — `injectionsAnnuellesFixes + epargneMensuelleDediee × 12` — et réduisent le
 * capital immédiatement. La mensualité ne bouge jamais : c'est la durée qui
 * raccourcit, recalculée par logarithme.
 *
 * @param seuilNeutralisationMois durée restante sous laquelle (incluse) la
 *   banque ne compte plus le crédit.
 */
export function simulerCreditConso(credit: BudgetInput["creditConsommation"]): ConsoAuMoisCible {
  const capital = positif(credit?.capitalEmprunte);
  const duree = entier(credit?.dureeInitialeMois);
  if (!credit?.aUnCreditConso || capital === 0 || duree === 0) {
    return { mensualiteInitiale: 0, capitalRestantDu: 0, moisRestants: 0, neutraliseParLaBanque: true };
  }

  const taeg = positif(credit.taeg);
  const r = taeg / 100 / 12;
  const mensualiteInitiale = mensualite(capital, taeg, duree);
  const anticipationAnnuelle =
    positif(credit.strategieAnticipation?.injectionsAnnuellesFixes) +
    positif(credit.strategieAnticipation?.epargneMensuelleDediee) * 12;
  const horizon = entier(credit.horizonSimulationMois);

  let restant = capital;
  for (let mois = 1; mois <= horizon && restant > EPSILON; mois++) {
    const interets = restant * r;
    restant -= Math.min(mensualiteInitiale - interets, restant);
    if (mois % 12 === 0) restant -= Math.min(anticipationAnnuelle, restant);
  }
  if (restant <= EPSILON) restant = 0;

  const moisRestants = dureeRestante(restant, taeg, mensualiteInitiale);
  return {
    mensualiteInitiale,
    capitalRestantDu: restant,
    moisRestants,
    neutraliseParLaBanque: moisRestants <= entier(credit.seuilNeutralisationMois),
  };
}

/* ─── B. Endettement ──────────────────────────────────────────────────────── */

/**
 * Loyer retenu par la banque : le loyer brut diminué de sa décote.
 * Avec une décote de 30 %, un loyer de 1 000 € compte pour 700 €.
 */
export function loyerRetenuBanque(immobilier: BudgetInput["immobilierActuel"]): number {
  if (!immobilier?.seraMisEnLocation) return 0;
  const decote = Math.min(100, positif(immobilier.decoteLocativeBanque));
  return positif(immobilier.loyerBrutEstime) * (1 - decote / 100);
}

/* ─── C. Capacité d'achat ─────────────────────────────────────────────────── */

/**
 * Capital maximal qu'une mensualité permet d'emprunter, assurance comprise.
 *
 * La mensualité couvre l'échéance du prêt et la prime d'assurance, celle-ci
 * étant calculée sur le capital initial (cas le plus courant) :
 *   M = K × [ r / (1 − (1+r)^−n) + a ]   d'où   K = M / [ r / (1 − (1+r)^−n) + a ]
 * avec r le taux mensuel du prêt et a le taux mensuel de l'assurance.
 */
export function capitalEmpruntable(
  mensualiteMax: number,
  tauxInteret: number,
  tauxAssurance: number,
  dureeMois: number,
): number {
  const n = entier(dureeMois);
  if (mensualiteMax <= 0 || n === 0) return 0;
  const r = positif(tauxInteret) / 100 / 12;
  const a = positif(tauxAssurance) / 100 / 12;
  const coutMensuelParEuro = (r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n))) + a;
  return mensualiteMax / coutMensuelParEuro;
}

/**
 * Prix maximal du bien : l'emprunt et l'apport financent le prix ET les frais
 * annexes, exprimés en pourcentage du prix.
 *   capital + apport = prix × (1 + frais / 100)
 */
export function prixBienMax(capital: number, apport: number, fraisPourcent: number): number {
  return (positif(capital) + positif(apport)) / (1 + positif(fraisPourcent) / 100);
}

/* ─── Assemblage ──────────────────────────────────────────────────────────── */

/**
 * Calcule l'ensemble du résultat à partir des données du foyer.
 *
 * Hypothèses, à connaître pour lire les chiffres :
 * — le crédit immobilier en cours reste une charge tant que `aUnCreditEnCours`
 *   est vrai, que le bien soit loué ou non. S'il sera soldé par une vente,
 *   passer `aUnCreditEnCours` à faux ;
 * — le « budget quotidien après projet » suppose que le foyer emprunte la
 *   mensualité maximale autorisée, et compte le loyer BRUT et la mensualité
 *   conso RÉELLE : ce que la banque neutralise sur le papier continue de sortir
 *   du compte.
 */
export function calculerFinance(entree: BudgetInput, options: OptionsMoteur = {}): ResultatFinance {
  const tauxMax = options.tauxEndettementMax ?? TAUX_ENDETTEMENT_HCSF;
  const [dureeCourte, dureeLongue] = options.dureesPretMois ?? DUREES_PRET_PAR_DEFAUT;
  const { foyer, immobilierActuel, creditConsommation, projetImmobilier } = entree;

  // A — le crédit conso au mois cible.
  const consoAuMoisCible = simulerCreditConso(creditConsommation);

  // B — ce que la banque retient.
  const salaires = positif(foyer?.emprunteurPrincipalNet) + positif(foyer?.coEmprunteurNet);
  const revenusRetenusBanque = salaires + loyerRetenuBanque(immobilierActuel);
  const capaciteDeCharge = (revenusRetenusBanque * tauxMax) / 100;

  const mensualiteImmoActuelle = immobilierActuel?.aUnCreditEnCours ? positif(immobilierActuel.mensualiteActuelle) : 0;
  const consoEncoreDue = consoAuMoisCible.capitalRestantDu > 0 ? consoAuMoisCible.mensualiteInitiale : 0;
  const consoRetenue = consoAuMoisCible.neutraliseParLaBanque ? 0 : consoEncoreDue;
  const chargesRetenues = mensualiteImmoActuelle + consoRetenue;

  const mensualiteMaxImmo = Math.max(0, capaciteDeCharge - chargesRetenues);
  const enPourcent = (montant: number) => (revenusRetenusBanque > 0 ? (montant / revenusRetenusBanque) * 100 : 0);

  // C — ce que cette mensualité permet d'acheter.
  const enveloppe = (dureeMois: number): EnveloppeAchat => {
    const capital = capitalEmpruntable(
      mensualiteMaxImmo,
      projetImmobilier?.tauxInteretEstime,
      projetImmobilier?.tauxAssuranceEstime,
      dureeMois,
    );
    return {
      capitalEmpruntable: capital,
      prixBienMax: prixBienMax(capital, projetImmobilier?.apportTotalDisponible, projetImmobilier?.fraisAnnexesEstimesPourcent),
    };
  };

  // Le quotidien, en argent réel.
  const loyerBrut = immobilierActuel?.seraMisEnLocation ? positif(immobilierActuel.loyerBrutEstime) : 0;
  const totalEntreesReelles = salaires + loyerBrut;
  const totalSortiesReelles =
    positif(foyer?.chargesCourantesFixes) + mensualiteImmoActuelle + consoEncoreDue + mensualiteMaxImmo;

  return {
    consoAuMoisCible,
    analyseEndettement: {
      revenusRetenusBanque,
      mensualiteMaxImmo,
      tauxEndettementAvantProjet: enPourcent(chargesRetenues),
      tauxEndettementApresProjet: enPourcent(chargesRetenues + mensualiteMaxImmo),
    },
    enveloppesAchat: { sur20Ans: enveloppe(dureeCourte), sur25Ans: enveloppe(dureeLongue) },
    budgetQuotidienApresProjet: {
      totalEntreesReelles,
      totalSortiesReelles,
      resteAVivreReelFoyer: totalEntreesReelles - totalSortiesReelles,
    },
  };
}

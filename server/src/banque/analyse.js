// Analyse des opérations bancaires : de quoi préremplir le simulateur.
//
// Fonctions pures, sans réseau ni base. Les montants sont comptés en CENTIMES
// entiers d'un bout à l'autre, comme partout côté serveur : additionner des
// « 12.34 » en flottant finit toujours par afficher un centime de trop.
//
// L'analyse est volontairement simple, et se présente comme telle : elle donne
// un ordre de grandeur à corriger, pas une comptabilité.

/** Mots dont la présence dans un libellé désigne un revenu d'activité. */
export const MOTS_CLES_REVENUS = ["salaire", "virement recu", "paye", "paie"];

/** Fenêtre d'analyse, en jours. */
export const JOURS_ANALYSES = 90;

// Nombre de mois distincts où une dépense doit apparaître pour être dite
// récurrente. Deux suffisent sur 90 jours : en exiger trois écarterait tout ce
// qui a été souscrit ou prélevé en décalé dans la période.
const MOIS_MINIMUM = 2;

/** Minuscules, sans accents, espaces resserrés : « Virement REÇU » → « virement recu ». */
export const normaliser = (texte) =>
  String(texte ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Convertit un montant GoCardless (« -12.34 ») en centimes entiers.
 * Renvoie null pour ce qui n'est pas un nombre : la ligne sera ignorée.
 */
export function montantEnCentimes(montant) {
  const m = /^\s*([+-]?)(\d+)(?:[.,](\d{1,2})\d*)?\s*$/.exec(String(montant ?? ""));
  if (!m) return null;
  const centimes = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0") || 0);
  return m[1] === "-" ? -centimes : centimes;
}

// Tout ce qui, dans une opération, peut porter un libellé — les banques ne
// s'accordent pas sur le champ à remplir.
export function libelle(operation) {
  return normaliser(
    [
      operation.remittanceInformationUnstructured,
      ...(Array.isArray(operation.remittanceInformationUnstructuredArray)
        ? operation.remittanceInformationUnstructuredArray
        : []),
      operation.additionalInformation,
      operation.creditorName,
      operation.debtorName,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/**
 * Clé de regroupement d'une dépense : le bénéficiaire quand la banque le donne,
 * sinon le libellé débarrassé de ses chiffres — dates, numéros de mandat et de
 * facture changent à chaque prélèvement et empêcheraient tout rapprochement.
 */
function cleRecurrence(operation) {
  const beneficiaire = normaliser(operation.creditorName);
  if (beneficiaire) return beneficiaire;
  return libelle(operation).replace(/[0-9]+/g, " ").replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Cette opération est-elle un revenu d'activité ? Un crédit dont le libellé
 * contient un des mots-clés — la même règle que dans l'analyse.
 */
export function estRevenuReconnu(operation, motsCles = MOTS_CLES_REVENUS) {
  const centimes = montantEnCentimes(operation?.transactionAmount?.amount);
  if (centimes === null || centimes <= 0) return false;
  const texte = libelle(operation);
  return motsCles.map(normaliser).some((cle) => cle && texte.includes(cle));
}

const moisDe = (operation) => String(operation.bookingDate ?? operation.valueDate ?? "").slice(0, 7);

/**
 * Tire des opérations un revenu et des charges mensuels.
 *
 * — Revenus : somme des opérations positives dont le libellé contient un des
 *   mots-clés, ramenée au mois.
 * — Charges courantes : somme des dépenses récurrentes — même bénéficiaire
 *   retrouvé sur au moins deux mois distincts — ramenée au mois. Les
 *   mensualités de crédit prélevées sur le compte en font donc partie.
 *
 * @param operations opérations comptabilisées, au format GoCardless
 * @param options.jours        longueur de la fenêtre analysée (défaut : 90)
 * @param options.motsCles     mots-clés désignant un revenu
 * @returns montants en centimes, et quelques effectifs pour juger du résultat
 */
export function analyserOperations(operations, { jours = JOURS_ANALYSES, motsCles = MOTS_CLES_REVENUS } = {}) {
  const cles = motsCles.map(normaliser).filter(Boolean);
  const nbMois = Math.max(1, Math.round(jours / 30));

  let revenusTotal = 0;
  let nbRevenus = 0;
  let nbOperations = 0;
  const depenses = new Map(); // clé → { total, mois: Set }

  for (const operation of Array.isArray(operations) ? operations : []) {
    const centimes = montantEnCentimes(operation?.transactionAmount?.amount);
    if (centimes === null || centimes === 0) continue;
    nbOperations += 1;

    if (centimes > 0) {
      const texte = libelle(operation);
      if (cles.some((cle) => texte.includes(cle))) {
        revenusTotal += centimes;
        nbRevenus += 1;
      }
      continue;
    }

    const cle = cleRecurrence(operation);
    if (!cle) continue;
    const groupe = depenses.get(cle) ?? { total: 0, mois: new Set() };
    groupe.total += -centimes;
    groupe.mois.add(moisDe(operation));
    depenses.set(cle, groupe);
  }

  const recurrentes = [...depenses.values()].filter((g) => g.mois.size >= MOIS_MINIMUM);
  const chargesTotal = recurrentes.reduce((s, g) => s + g.total, 0);

  return {
    revenusMensuels: Math.round(revenusTotal / nbMois),
    chargesCourantesMensuelles: Math.round(chargesTotal / nbMois),
    nbOperations,
    nbRevenus,
    nbChargesRecurrentes: recurrentes.length,
  };
}

// Du plus fiable au moins fiable pour dire « ce qu'il y a sur le compte ».
const PREFERENCE_SOLDES = ["closingBooked", "interimBooked", "expected", "interimAvailable"];

/** Le solde le plus parlant parmi ceux que publie la banque, en centimes ; null si aucun. */
export function soldePrincipal(soldes) {
  const liste = Array.isArray(soldes) ? soldes : [];
  const choisi =
    PREFERENCE_SOLDES.map((type) => liste.find((s) => s?.balanceType === type)).find(Boolean) ?? liste[0];
  return choisi ? montantEnCentimes(choisi.balanceAmount?.amount) : null;
}

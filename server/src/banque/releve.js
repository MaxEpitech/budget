// Lecture d'un relevé bancaire téléchargé depuis l'espace client d'une banque.
//
// Quatre formats : OFX (« Money »), QIF (« Quicken »), CSV et classeur Excel
// (.xlsx). Les deux premiers sont normalisés ; le CSV ne l'est pas du tout —
// chaque banque a ses colonnes, son séparateur, son écriture des montants —
// d'où la part de devinette ici. Un classeur n'est qu'un tableau de plus : une
// fois ses cellules lues (classeur.js), ses colonnes se reconnaissent comme
// celles d'un CSV.
//
// Fonctions pures : un fichier en entrée, des opérations en sortie, sous la
// forme commune qu'attend l'analyse (celle des prestataires bancaires). Rien
// n'est lu ni écrit ailleurs.
import { normaliser } from "./analyse.js";
import { lireClasseur, estArchive, ClasseurIllisible } from "./classeur.js";

/** Le relevé est illisible, et pourquoi : le message est fait pour l'écran. */
export class ErreurReleve extends Error {
  constructor(message) {
    super(message);
    this.name = "ErreurReleve";
  }
}

/* ─── Montants et dates ────────────────────────────────────────────────── */

/**
 * Lit un montant tel qu'une banque l'écrit, et le rend sous la forme « -1234.56 ».
 *
 * « 1 234,56 », « -1.234,56 », « 1,234.56 », « +12,00 € », « (45,10) » : le
 * dernier séparateur suivi d'un ou deux chiffres est la virgule décimale, tous
 * les autres ne font que grouper les milliers. Renvoie null si ce n'est pas un
 * montant.
 */
export function lireMontant(brut) {
  let texte = String(brut ?? "").replace(/[\s  ]/g, "").replace(/(€|EUR)/gi, "");
  if (!texte) return null;

  let negatif = false;
  // Notation comptable : un montant entre parenthèses est négatif.
  if (/^\(.*\)$/.test(texte)) {
    negatif = true;
    texte = texte.slice(1, -1);
  }
  // Le signe précède le montant, ou le suit (« 45,10- ») selon les banques.
  const signe = /^[+-]/.exec(texte)?.[0] ?? /[+-]$/.exec(texte)?.[0];
  if (signe === "-") negatif = !negatif;
  texte = texte.replace(/^[+-]|[+-]$/g, "");
  if (!/^\d[\d.,']*$/.test(texte)) return null;

  const decimales = /[.,](\d{1,2})$/.exec(texte);
  const entiere = (decimales ? texte.slice(0, decimales.index) : texte).replace(/[.,']/g, "");
  if (!/^\d+$/.test(entiere)) return null;
  const centimes = decimales ? decimales[1].padEnd(2, "0") : "00";
  const nul = /^0+$/.test(entiere) && centimes === "00";
  return `${negatif && !nul ? "-" : ""}${entiere.replace(/^0+(?=\d)/, "")}.${centimes}`;
}

const deuxChiffres = (n) => String(n).padStart(2, "0");

// Une date n'est retenue que si elle existe : « 31/02 » n'en est pas une.
function composer(annee, mois, jour) {
  const [a, m, j] = [Number(annee), Number(mois), Number(jour)];
  const date = new Date(Date.UTC(a, m - 1, j));
  if (date.getUTCFullYear() !== a || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== j) return null;
  return `${a}-${deuxChiffres(m)}-${deuxChiffres(j)}`;
}

// Année sur deux chiffres : un relevé parle du passé proche.
const siecle = (aa) => (Number(aa) > 70 ? 1900 : 2000) + Number(aa);

/**
 * Lit une date et la rend au format AAAA-MM-JJ.
 * Jour en premier, à la française, pour les écritures ambiguës (03/04/2026).
 */
export function lireDate(brut) {
  const texte = String(brut ?? "").trim();
  let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte))) return composer(m[1], m[2], m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(texte))) return composer(m[1], m[2], m[3]);
  if ((m = /^(\d{1,2})[/.\-' ](\d{1,2})[/.\-' ](\d{4})\b/.exec(texte))) return composer(m[3], m[2], m[1]);
  if ((m = /^(\d{1,2})[/.\-' ](\d{1,2})[/.\-' ](\d{2})\b/.exec(texte))) return composer(siecle(m[3]), m[2], m[1]);
  return null;
}

const operation = (date, montant, libelle) => ({
  bookingDate: date,
  transactionAmount: { amount: montant, currency: "EUR" },
  remittanceInformationUnstructured: String(libelle ?? "").replace(/\s+/g, " ").trim(),
});

/* ─── OFX ──────────────────────────────────────────────────────────────── */

// OFX 1 est du SGML : les balises d'une valeur ne sont pas refermées. La valeur
// court donc jusqu'à la balise suivante, ou la fin de ligne.
const baliseOfx = (bloc, nom) => new RegExp(`<${nom}>([^<\\r\\n]*)`, "i").exec(bloc)?.[1]?.trim() ?? "";

function lireOfx(texte) {
  const operations = [];
  let ignorees = 0;
  for (const [, bloc] of texte.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi)) {
    const date = lireDate(baliseOfx(bloc, "DTPOSTED") || baliseOfx(bloc, "DTUSER"));
    const montant = lireMontant(baliseOfx(bloc, "TRNAMT"));
    if (!date || !montant) {
      ignorees += 1;
      continue;
    }
    operations.push(operation(date, montant, [baliseOfx(bloc, "NAME"), baliseOfx(bloc, "MEMO")].filter(Boolean).join(" ")));
  }
  const solde = /<LEDGERBAL>[\s\S]*?<BALAMT>([^<\r\n]*)/i.exec(texte)?.[1];
  return { format: "OFX", operations, ignorees, solde: solde ? lireMontant(solde) : null };
}

/* ─── QIF ──────────────────────────────────────────────────────────────── */

function lireQif(texte) {
  const operations = [];
  let ignorees = 0;
  // Chaque opération est une suite de lignes « lettre + valeur », close par « ^ ».
  for (const bloc of texte.split(/^\^\s*$/m)) {
    const champs = {};
    for (const ligne of bloc.split(/\r?\n/)) {
      const propre = ligne.trim();
      if (!propre || propre.startsWith("!")) continue;
      champs[propre[0]] ??= propre.slice(1).trim();
    }
    if (Object.keys(champs).length === 0) continue;
    const date = lireDate(champs.D);
    const montant = lireMontant(champs.T ?? champs.U);
    if (!date || !montant) {
      ignorees += 1;
      continue;
    }
    operations.push(operation(date, montant, [champs.P, champs.M].filter(Boolean).join(" ")));
  }
  return { format: "QIF", operations, ignorees, solde: null };
}

/* ─── CSV ──────────────────────────────────────────────────────────────── */

/** Découpe un texte CSV en lignes de cellules, guillemets et retours à la ligne internes compris. */
export function decouperCsv(texte, separateur) {
  const lignes = [];
  let ligne = [];
  let cellule = "";
  let entreGuillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (entreGuillemets) {
      if (c === '"' && texte[i + 1] === '"') {
        cellule += '"';
        i += 1;
      } else if (c === '"') entreGuillemets = false;
      else cellule += c;
    } else if (c === '"' && cellule.trim() === "") entreGuillemets = true;
    else if (c === separateur) {
      ligne.push(cellule.trim());
      cellule = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texte[i + 1] === "\n") i += 1;
      ligne.push(cellule.trim());
      if (ligne.some((x) => x !== "")) lignes.push(ligne);
      ligne = [];
      cellule = "";
    } else cellule += c;
  }
  ligne.push(cellule.trim());
  if (ligne.some((x) => x !== "")) lignes.push(ligne);
  return lignes;
}

// Le séparateur est celui qui découpe le plus régulièrement les premières
// lignes. Le point-virgule passe avant la virgule à égalité : en France la
// virgule est d'abord la marque des décimales.
function devinerSeparateur(texte) {
  const debut = texte.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  let meilleur = { separateur: ";", score: 0 };
  for (const separateur of [";", "\t", ",", "|"]) {
    const largeurs = debut.map((l) => l.split(separateur).length);
    const frequente = [...new Set(largeurs)].map((n) => [n, largeurs.filter((x) => x === n).length]).sort((a, b) => b[1] - a[1])[0];
    const score = frequente && frequente[0] > 1 ? frequente[1] * (frequente[0] - 1) : 0;
    if (score > meilleur.score) meilleur = { separateur, score };
  }
  return meilleur.separateur;
}

// Ce que les banques écrivent en tête de colonne, une fois accents et casse
// retirés. L'ordre compte : le premier motif trouvé l'emporte.
const ENTETES = {
  date: [/^date( de)? (l )?(operation|comptabilisation|comptable|transaction)/, /^date$/, /^date/, /^jour/],
  libelle: [/^libelle( de l )?( ?operation)?$/, /^libelle/, /^(description|designation|intitule|detail|communication|nature|motif|reference|label|name)/],
  montant: [/^montant( de l operation)?( \(?(eur|euros?)\)?)?$/, /^montant/, /^(amount|somme|valeur)$/],
  debit: [/^debit/, /^(montant )?(au )?debit/, /^(sortie|depense)s?/],
  credit: [/^credit/, /^(montant )?(au )?credit/, /^(entree|recette)s?/],
};

const cle = (titre) => normaliser(titre).replace(/[^a-z0-9()]+/g, " ").trim();

function reperer(entetes, motifs, exclues = []) {
  for (const motif of motifs) {
    const rang = entetes.findIndex((e, i) => !exclues.includes(i) && motif.test(e));
    if (rang >= 0) return rang;
  }
  return -1;
}

function colonnesParEntetes(lignes) {
  for (let l = 0; l < Math.min(lignes.length, 30); l++) {
    const entetes = lignes[l].map(cle);
    const date = reperer(entetes, ENTETES.date);
    if (date < 0) continue;
    const debit = reperer(entetes, ENTETES.debit);
    const credit = reperer(entetes, ENTETES.credit, [debit]);
    const montant = reperer(entetes, ENTETES.montant, [debit, credit]);
    if (montant < 0 && (debit < 0 || credit < 0)) continue;
    // Tous les libellés sont gardés : certaines banques en donnent deux, un
    // court et un détaillé, et le mot « salaire » peut n'être que dans l'un.
    const libelles = entetes.map((e, i) => (ENTETES.libelle.some((m) => m.test(e)) && ![date, debit, credit, montant].includes(i) ? i : -1)).filter((i) => i >= 0);
    return { premiere: l + 1, date, montant, debit, credit, libelles };
  }
  return null;
}

// Sans ligne d'en-tête reconnaissable, on regarde le contenu : la colonne des
// dates est celle où presque tout est une date, de même pour les montants, et
// le libellé est le texte le plus long.
function colonnesParContenu(lignes) {
  const largeur = Math.max(...lignes.map((l) => l.length));
  const part = (rang, test) => lignes.filter((l) => test(l[rang])).length / lignes.length;
  const rangs = [...Array(largeur).keys()];
  const date = rangs.find((r) => part(r, lireDate) > 0.8);
  if (date === undefined) return null;
  const montant = rangs.filter((r) => r !== date && part(r, (v) => v && lireMontant(v) !== null && !lireDate(v)) > 0.8).at(-1);
  if (montant === undefined) return null;
  const longueur = (r) => lignes.reduce((s, l) => s + (l[r]?.length ?? 0), 0);
  const libelle = rangs.filter((r) => r !== date && r !== montant && part(r, (v) => v && lireMontant(v) === null) > 0.5).sort((a, b) => longueur(b) - longueur(a))[0];
  return { premiere: 0, date, montant, debit: -1, credit: -1, libelles: libelle === undefined ? [] : [libelle] };
}

/** Lit un tableau de cellules en texte, d'où qu'il vienne : CSV ou onglet de classeur. */
function lireTableau(lignes, format) {
  if (lignes.length === 0) return { format, operations: [], ignorees: 0, solde: null };
  const colonnes = colonnesParEntetes(lignes) ?? colonnesParContenu(lignes);
  if (!colonnes) {
    throw new ErreurReleve(
      "Colonnes non reconnues : le fichier doit comporter une date, un libellé et un montant (ou des colonnes débit et crédit).",
    );
  }

  const operations = [];
  let ignorees = 0;
  for (const ligne of lignes.slice(colonnes.premiere)) {
    const date = lireDate(ligne[colonnes.date]);
    let montant = colonnes.montant >= 0 ? lireMontant(ligne[colonnes.montant]) : null;
    if (colonnes.debit >= 0 && colonnes.credit >= 0 && (!montant || montant === "0.00")) {
      // Deux colonnes : un débit est une sortie, quel que soit le signe écrit.
      const debit = lireMontant(ligne[colonnes.debit]);
      const credit = lireMontant(ligne[colonnes.credit]);
      if (debit && debit !== "0.00") montant = `-${debit.replace("-", "")}`;
      else if (credit && credit !== "0.00") montant = credit.replace("-", "");
    }
    // Lignes de total, de solde, pied de page : sans date ou sans montant.
    if (!date || !montant) {
      ignorees += 1;
      continue;
    }
    operations.push(operation(date, montant, colonnes.libelles.map((r) => ligne[r]).filter(Boolean).join(" ")));
  }
  return { format, operations, ignorees, solde: null };
}

const lireCsv = (texte) => lireTableau(decouperCsv(texte, devinerSeparateur(texte)), "CSV");

/* ─── Classeur Excel ───────────────────────────────────────────────────── */

function lireXlsx(octets) {
  let feuilles;
  try {
    feuilles = lireClasseur(octets);
  } catch (e) {
    if (e instanceof ClasseurIllisible) throw new ErreurReleve(e.message);
    throw e;
  }
  // Un classeur peut avoir plusieurs onglets — une page de garde, un
  // récapitulatif : on retient le premier qui ressemble à un relevé.
  let vide = null;
  let erreur = null;
  for (const feuille of feuilles) {
    try {
      const lu = lireTableau(feuille.lignes, "XLSX");
      if (lu.operations.length > 0) return lu;
      vide ??= lu;
    } catch (e) {
      if (!(e instanceof ErreurReleve)) throw e;
      erreur ??= e;
    }
  }
  if (vide) return vide;
  throw erreur;
}

/* ─── Entrée ───────────────────────────────────────────────────────────── */

// Au-delà, ce n'est plus un relevé de compte courant — et l'analyse n'a de
// toute façon besoin que des trois derniers mois.
const OPERATIONS_MAXIMUM = 20_000;

// Un ancien classeur .xls, ou un .xlsx protégé par mot de passe : tous deux
// sont des conteneurs OLE, que l'on reconnaît à leurs huit premiers octets.
const SIGNATURE_OLE = "d0cf11e0a1b11ae1";

// Le texte d'un fichier arrivé en octets : UTF-8 s'il en est, sinon l'encodage
// historique des banques françaises.
function decoder(octets) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder("windows-1252").decode(octets);
  }
}

/**
 * Lit un relevé, quel qu'en soit le format.
 *
 * @param fichier le contenu du fichier : du texte déjà décodé, ou ses octets —
 *   un classeur, binaire, n'a pas de texte
 * @returns {{ format: "OFX" | "QIF" | "CSV" | "XLSX", operations: object[], ignorees: number, solde: string | null }}
 * @throws {ErreurReleve} si rien d'exploitable n'en sort
 */
export function lireReleve(fichier) {
  let lu;
  if (fichier instanceof Uint8Array) {
    const octets = Buffer.from(fichier.buffer, fichier.byteOffset, fichier.byteLength);
    if (octets.length === 0) throw new ErreurReleve("Le fichier est vide.");
    if (octets.subarray(0, 8).toString("hex") === SIGNATURE_OLE) {
      throw new ErreurReleve(
        "Ancien format Excel (.xls), ou classeur protégé par un mot de passe : ouvrez-le dans Excel et enregistrez-le au format .xlsx, sans mot de passe.",
      );
    }
    lu = estArchive(octets) ? lireXlsx(octets) : lireTexte(decoder(octets));
  } else {
    lu = lireTexte(fichier);
  }

  if (lu.operations.length === 0) throw new ErreurReleve("Aucune opération lisible dans ce fichier.");
  if (lu.operations.length > OPERATIONS_MAXIMUM) throw new ErreurReleve("Ce fichier contient trop d'opérations : exportez une période plus courte.");
  return lu;
}

function lireTexte(texte) {
  // Marque d'ordre des octets que certaines banques laissent en tête de fichier.
  const contenu = String(texte ?? "").replace(/^\ufeff/, "");
  if (!contenu.trim()) throw new ErreurReleve("Le fichier est vide.");
  if (contenu.startsWith("%PDF")) throw new ErreurReleve("Un relevé PDF ne se lit pas : téléchargez-le au format CSV, Excel (.xlsx), OFX ou QIF depuis votre espace bancaire.");
  // Un classeur décodé comme du texte est perdu : il doit arriver en octets.
  if (/^PK\u0003\u0004/.test(contenu)) throw new ErreurReleve("Ce classeur Excel n'a pas été transmis tel quel : rechargez la page, puis réessayez.");

  return /<OFX>|OFXHEADER/i.test(contenu) ? lireOfx(contenu)
    : /^!Type:/im.test(contenu) ? lireQif(contenu)
    : lireCsv(contenu);
}

/**
 * Ne garde que la fin du relevé : les `jours` derniers jours avant sa dernière
 * opération. La fenêtre part du relevé, pas d'aujourd'hui — un export du mois
 * dernier reste parfaitement exploitable.
 *
 * @returns {{ operations: object[], du: string, au: string, jours: number }}
 */
export function fenetreRecente(operations, jours) {
  const dates = operations.map((o) => o.bookingDate).sort();
  const au = dates.at(-1);
  const seuil = new Date(new Date(`${au}T00:00:00Z`).getTime() - (jours - 1) * 86400000).toISOString().slice(0, 10);
  const gardees = operations.filter((o) => o.bookingDate >= seuil);
  const du = gardees.map((o) => o.bookingDate).sort()[0];
  const couverts = Math.round((new Date(`${au}T00:00:00Z`) - new Date(`${du}T00:00:00Z`)) / 86400000) + 1;
  return { operations: gardees, du, au, jours: couverts };
}

// Lecture d'un classeur Excel (.xlsx), sans dépendance.
//
// Un .xlsx est une archive ZIP de fichiers XML : la liste des onglets, les
// textes partagés entre cellules, les styles — ce sont eux qui disent qu'un
// nombre est une date — et une feuille par onglet. On n'en lit que ce qu'il
// faut pour en tirer, onglet par onglet, un tableau de cellules en texte. La
// reconnaissance des colonnes est ensuite celle du CSV : il n'en existe qu'une.
//
// Pourquoi pas une bibliothèque : la référence n'est plus publiée sur npm dans
// une version corrigée, et lire un relevé ne demande ni formules, ni mise en
// forme, ni écriture. Quelques fonctions qu'on maîtrise valent mieux qu'une
// dépendance qu'on ne peut plus mettre à jour.
//
// Fonctions pures : des octets en entrée, des tableaux en sortie.
import { inflateRawSync } from "node:zlib";

/** Le classeur ne peut pas être lu, et pourquoi : le message est fait pour l'écran. */
export class ClasseurIllisible extends Error {
  constructor(message) {
    super(message);
    this.name = "ClasseurIllisible";
  }
}

// Un fichier de 3 Mo peut se déplier en gigaoctets (« bombe ZIP ») : chaque
// fichier interne, et l'ensemble, sont bornés bien au-delà de ce qu'occupe le
// plus long des relevés.
const DEPLIE_PAR_FICHIER = 40_000_000;
const DEPLIE_AU_TOTAL = 80_000_000;
// Au-delà, des cellules isolées très loin à droite ou très bas fabriqueraient
// des tableaux démesurés pour rien : un relevé tient en quelques colonnes.
const COLONNES_MAXIMUM = 64;
const LIGNES_MAXIMUM = 50_000;

const ABIME = "Ce classeur est endommagé ou incomplet : ouvrez-le dans Excel, enregistrez-le de nouveau, puis réessayez.";
const TROP_GROS = "Ce classeur est trop volumineux : exportez une période plus courte.";

/* ─── Archive ZIP ──────────────────────────────────────────────────────── */

const SIGNATURE_FIN = 0x06054b50;
const SIGNATURE_CENTRALE = 0x02014b50;
const SIGNATURE_LOCALE = 0x04034b50;

/**
 * Le répertoire de l'archive : nom de chaque fichier interne, et où le trouver.
 * Il est rangé à la fin, et la fin elle-même se cherche à rebours — un
 * commentaire de 64 Ko au plus peut la suivre.
 */
function repertoire(octets) {
  const plancher = Math.max(0, octets.length - 22 - 0xffff);
  let fin = -1;
  for (let i = octets.length - 22; i >= plancher; i--) {
    if (octets.readUInt32LE(i) === SIGNATURE_FIN) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw new ClasseurIllisible(ABIME);

  const nombre = octets.readUInt16LE(fin + 10);
  let position = octets.readUInt32LE(fin + 16);
  const fichiers = new Map();
  for (let n = 0; n < nombre; n++) {
    if (position + 46 > octets.length || octets.readUInt32LE(position) !== SIGNATURE_CENTRALE) throw new ClasseurIllisible(ABIME);
    const longueurNom = octets.readUInt16LE(position + 28);
    const nom = octets.toString("utf8", position + 46, position + 46 + longueurNom);
    fichiers.set(nom, {
      drapeaux: octets.readUInt16LE(position + 8),
      methode: octets.readUInt16LE(position + 10),
      taille: octets.readUInt32LE(position + 20),
      locale: octets.readUInt32LE(position + 42),
    });
    position += 46 + longueurNom + octets.readUInt16LE(position + 30) + octets.readUInt16LE(position + 32);
  }
  return fichiers;
}

/** Ouvre une archive : rend une fonction qui lit un fichier interne en texte, ou null s'il n'existe pas. */
function ouvrirArchive(octets) {
  const fichiers = repertoire(octets);
  let deplie = 0;

  return (nom) => {
    const f = fichiers.get(nom);
    if (!f) return null;
    // Bit 0 : contenu chiffré. Excel ne chiffre pas ainsi (un classeur protégé
    // n'est plus un ZIP), mais d'autres outils le font.
    if (f.drapeaux & 1) throw new ClasseurIllisible("Ce classeur est protégé par un mot de passe : enregistrez-en une copie sans mot de passe.");
    if (f.locale + 30 > octets.length || octets.readUInt32LE(f.locale) !== SIGNATURE_LOCALE) throw new ClasseurIllisible(ABIME);
    const debut = f.locale + 30 + octets.readUInt16LE(f.locale + 26) + octets.readUInt16LE(f.locale + 28);
    const donnees = octets.subarray(debut, debut + f.taille);
    if (donnees.length < f.taille) throw new ClasseurIllisible(ABIME);

    let contenu;
    if (f.methode === 0) contenu = donnees;
    else if (f.methode === 8) {
      try {
        contenu = inflateRawSync(donnees, { maxOutputLength: DEPLIE_PAR_FICHIER });
      } catch (e) {
        throw new ClasseurIllisible(e.code === "ERR_BUFFER_TOO_LARGE" ? TROP_GROS : ABIME);
      }
    } else throw new ClasseurIllisible(ABIME);

    deplie += contenu.length;
    if (contenu.length > DEPLIE_PAR_FICHIER || deplie > DEPLIE_AU_TOTAL) throw new ClasseurIllisible(TROP_GROS);
    return contenu.toString("utf8");
  };
}

/* ─── XML ──────────────────────────────────────────────────────────────────
   Des expressions régulières plutôt qu'un analyseur : les fichiers d'un
   classeur sont produits par des machines, toujours de la même forme. Les
   balises peuvent porter un préfixe d'espace de noms (« x:c » chez certains
   générateurs) : il est toléré partout. */

const ENTITES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function caractere(code) {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
}

/** Texte d'un nœud XML : entités décodées, et « _x000D_ », l'échappement propre aux classeurs. */
function texteXml(brut) {
  return brut
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (tout, hexa, decimal, nom) =>
      hexa ? caractere(parseInt(hexa, 16)) : decimal ? caractere(Number(decimal)) : (ENTITES[nom] ?? tout))
    .replace(/_x([0-9a-f]{4})_/gi, (_, hexa) => caractere(parseInt(hexa, 16)));
}

/** Les éléments `nom` d'un fragment : leurs attributs, et leur contenu (vide s'ils sont autofermants). */
function* elements(xml, nom) {
  const motif = new RegExp(`<(?:\\w+:)?${nom}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/(?:\\w+:)?${nom}>)`, "g");
  for (const [, attributs, contenu] of xml.matchAll(motif)) yield { attributs: lireAttributs(attributs), contenu: contenu ?? "" };
}

// Le préfixe des attributs tombe aussi : « r:id » devient « id ».
function lireAttributs(texte) {
  const attributs = {};
  for (const [, nom, double, simple] of texte.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributs[nom.split(":").pop()] = texteXml(double ?? simple);
  }
  return attributs;
}

/** Le texte d'une cellule riche : tous ses morceaux bout à bout, sans la transcription phonétique. */
function texteRiche(xml) {
  const sansPhonetique = xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "");
  return [...elements(sansPhonetique, "t")].map((t) => texteXml(t.contenu)).join("");
}

/* ─── Relations entre fichiers internes ────────────────────────────────── */

// « xl/workbook.xml » et « worksheets/sheet1.xml » donnent « xl/worksheets/sheet1.xml ».
function resoudre(depuis, cible) {
  if (cible.startsWith("/")) return cible.slice(1);
  const morceaux = depuis.split("/").slice(0, -1);
  for (const m of cible.split("/")) {
    if (m === "..") morceaux.pop();
    else if (m !== ".") morceaux.push(m);
  }
  return morceaux.join("/");
}

/** Les relations déclarées par un fichier interne, dans son « _rels » voisin. */
function relations(lire, chemin) {
  const dossier = chemin.split("/").slice(0, -1).join("/");
  const nom = chemin.split("/").pop();
  const xml = lire(`${dossier ? `${dossier}/` : ""}_rels/${nom}.rels`) ?? "";
  return [...elements(xml, "Relationship")].map(({ attributs }) => ({
    id: attributs.Id,
    type: attributs.Type ?? "",
    cible: resoudre(chemin, attributs.Target ?? ""),
  }));
}

/* ─── Nombres et dates ─────────────────────────────────────────────────── */

// Formats de date prédéfinis d'Excel, désignés par leur seul numéro.
const DATES_PREDEFINIES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

// Un format personnalisé est une date s'il contient jour, mois ou année, une
// fois retirés le texte entre guillemets, les caractères échappés et les
// crochets (couleur, langue, condition) : « #,##0.00 "€" » n'en est pas une.
const estFormatDate = (code) => /[dmy]/i.test(code.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, ""));

/** Pour chaque style de cellule, par son rang : est-ce une date ? */
function stylesDate(xml) {
  if (!xml) return [];
  const personnalises = new Map([...elements(xml, "numFmt")].map(({ attributs }) => [Number(attributs.numFmtId), attributs.formatCode ?? ""]));
  const cellXfs = /<(?:\w+:)?cellXfs\b[^>]*>([\s\S]*?)<\/(?:\w+:)?cellXfs>/.exec(xml)?.[1] ?? "";
  return [...elements(cellXfs, "xf")].map(({ attributs }) => {
    const id = Number(attributs.numFmtId ?? 0);
    return DATES_PREDEFINIES.has(id) || (personnalises.has(id) && estFormatDate(personnalises.get(id)));
  });
}

/**
 * Un numéro de série Excel en date AAAA-MM-JJ. Le calendrier part du
 * 30 décembre 1899, ou du 1er janvier 1904 pour les classeurs venus d'un ancien
 * Mac. L'heure, en partie décimale, est sans objet pour un relevé.
 */
function dateDeSerie(serie, base1904) {
  const jours = Math.floor(serie);
  if (!Number.isFinite(jours) || jours < 1 || jours > 2_958_465) return null;
  const origine = base1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(origine + jours * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Un nombre tel que l'écrirait la banque, arrondi au centime. Un classeur garde
 * des flottants : un total calculé y vaut parfois 0.30000000000000004, que la
 * lecture des montants prendrait pour un entier immense.
 */
function texteNombre(valeur) {
  const n = Number(valeur);
  if (!Number.isFinite(n)) return valeur;
  const arrondi = Math.round(n * 100) / 100;
  return Number.isInteger(arrondi) ? String(arrondi) : arrondi.toFixed(2);
}

/* ─── Feuilles ─────────────────────────────────────────────────────────── */

// « B12 » est la deuxième colonne ; « AA » la vingt-septième.
function rangColonne(reference) {
  const lettres = /^([A-Z]+)/i.exec(reference ?? "")?.[1];
  if (!lettres) return null;
  return [...lettres.toUpperCase()].reduce((rang, l) => rang * 26 + (l.charCodeAt(0) - 64), 0) - 1;
}

function valeurCellule({ attributs, contenu }, textes, dates, base1904) {
  const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(contenu)?.[1];
  switch (attributs.t) {
    case "s": return textes[Number(v)] ?? "";
    case "inlineStr": return texteRiche(/<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(contenu)?.[1] ?? "");
    case "str":
    case "d": return texteXml(v ?? "");
    case "b": return v === "1" ? "VRAI" : "FAUX";
    case "e": return "";
    default: {
      if (v === undefined || v === "") return "";
      if (dates[Number(attributs.s ?? 0)]) return dateDeSerie(Number(v), base1904) ?? texteNombre(v);
      return texteNombre(v);
    }
  }
}

/** Les lignes d'une feuille, cellules en texte, à leur colonne ; les lignes vides tombent. */
function lignesFeuille(xml, textes, dates, base1904) {
  const donnees = /<(?:\w+:)?sheetData\b[^>]*>([\s\S]*?)<\/(?:\w+:)?sheetData>/.exec(xml)?.[1] ?? "";
  const lignes = [];
  for (const rangee of elements(donnees, "row")) {
    const ligne = [];
    let suivante = 0;
    for (const cellule of elements(rangee.contenu, "c")) {
      // Les cellules vides ne sont pas écrites : c'est leur référence qui dit
      // dans quelle colonne tombe la suivante.
      const colonne = rangColonne(cellule.attributs.r) ?? suivante;
      suivante = colonne + 1;
      if (colonne >= COLONNES_MAXIMUM) continue;
      ligne[colonne] = String(valeurCellule(cellule, textes, dates, base1904)).replace(/\s+/g, " ").trim();
    }
    const complete = Array.from(ligne, (x) => x ?? "");
    if (complete.some((x) => x !== "")) lignes.push(complete);
    if (lignes.length > LIGNES_MAXIMUM) throw new ClasseurIllisible(TROP_GROS);
  }
  return lignes;
}

/* ─── Entrée ───────────────────────────────────────────────────────────── */

/** Les octets sont-ils ceux d'une archive ZIP (un .xlsx) ? */
export const estArchive = (octets) => octets.length >= 4 && octets.readUInt32LE(0) === SIGNATURE_LOCALE;

/**
 * Lit un classeur .xlsx.
 *
 * @param {Buffer} octets le fichier tel quel
 * @returns {{ nom: string, lignes: string[][] }[]} ses onglets visibles, dans l'ordre
 * @throws {ClasseurIllisible} si ce n'est pas un classeur lisible
 */
export function lireClasseur(octets) {
  const lire = ouvrirArchive(octets);

  // Le classeur principal est désigné par la relation « officeDocument » de
  // l'archive ; presque toujours xl/workbook.xml.
  const principal = relations(lire, "").find((r) => r.type.endsWith("/officeDocument"))?.cible ?? "xl/workbook.xml";
  const classeur = lire(principal);
  if (classeur === null) {
    if (/opendocument\.spreadsheet/.test(lire("mimetype") ?? "")) {
      throw new ClasseurIllisible("Classeur OpenDocument (.ods) : enregistrez-le au format Excel (.xlsx) ou CSV, puis réessayez.");
    }
    throw new ClasseurIllisible("Ce fichier compressé n'est pas un classeur Excel : téléchargez le relevé au format CSV, Excel (.xlsx), OFX ou QIF.");
  }

  const liens = relations(lire, principal);
  const parType = (fin) => liens.find((r) => r.type.endsWith(fin))?.cible;
  const textes = [...elements(lire(parType("/sharedStrings") ?? "xl/sharedStrings.xml") ?? "", "si")].map((si) => texteRiche(si.contenu));
  const dates = stylesDate(lire(parType("/styles") ?? "xl/styles.xml"));
  const base1904 = [...elements(classeur, "workbookPr")].some(({ attributs }) => ["1", "true"].includes(attributs.date1904));

  const feuilles = [];
  for (const { attributs } of elements(classeur, "sheet")) {
    // Un onglet masqué n'est pas celui qu'on a voulu exporter.
    if (attributs.state === "hidden" || attributs.state === "veryHidden") continue;
    const chemin = liens.find((r) => r.id === attributs.id)?.cible;
    const xml = chemin ? lire(chemin) : null;
    if (xml !== null) feuilles.push({ nom: attributs.name ?? "", lignes: lignesFeuille(xml, textes, dates, base1904) });
  }
  if (feuilles.length === 0) throw new ClasseurIllisible("Ce classeur ne contient aucune feuille lisible.");
  return feuilles;
}

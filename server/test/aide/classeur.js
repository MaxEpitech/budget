// Fabrique de classeurs .xlsx pour les tests.
//
// Le strict nécessaire de ce qu'écrit Excel, construit en mémoire : aucun
// fichier binaire versionné, et chaque test montre ce que contient le classeur
// qu'il fait lire.
import { deflateRawSync, crc32 } from "node:zlib";

/** Une archive ZIP à partir de { chemin: contenu }. */
export function archiveZip(fichiers, { compresser = true } = {}) {
  const morceaux = [];
  const repertoire = [];
  let decalage = 0;
  const entrees = Object.entries(fichiers);
  for (const [chemin, contenu] of entrees) {
    const brut = Buffer.isBuffer(contenu) ? contenu : Buffer.from(contenu, "utf8");
    const donnees = compresser ? deflateRawSync(brut) : brut;
    const nom = Buffer.from(chemin, "utf8");
    const methode = compresser ? 8 : 0;

    const locale = Buffer.alloc(30);
    locale.writeUInt32LE(0x04034b50, 0);
    locale.writeUInt16LE(20, 4);
    locale.writeUInt16LE(0x0800, 6); // noms en UTF-8
    locale.writeUInt16LE(methode, 8);
    locale.writeUInt32LE(crc32(brut), 14);
    locale.writeUInt32LE(donnees.length, 18);
    locale.writeUInt32LE(brut.length, 22);
    locale.writeUInt16LE(nom.length, 26);

    const centrale = Buffer.alloc(46);
    centrale.writeUInt32LE(0x02014b50, 0);
    centrale.writeUInt16LE(20, 4);
    centrale.writeUInt16LE(20, 6);
    centrale.writeUInt16LE(0x0800, 8);
    centrale.writeUInt16LE(methode, 10);
    centrale.writeUInt32LE(crc32(brut), 16);
    centrale.writeUInt32LE(donnees.length, 20);
    centrale.writeUInt32LE(brut.length, 24);
    centrale.writeUInt16LE(nom.length, 28);
    centrale.writeUInt32LE(decalage, 42);

    morceaux.push(locale, nom, donnees);
    repertoire.push(centrale, nom);
    decalage += 30 + nom.length + donnees.length;
  }
  const central = Buffer.concat(repertoire);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(entrees.length, 8);
  fin.writeUInt16LE(entrees.length, 10);
  fin.writeUInt32LE(central.length, 12);
  fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...morceaux, central, fin]);
}

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PAQUET = "http://schemas.openxmlformats.org/package/2006/relationships";

const echapper = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 0 → « A », 26 → « AA ».
function lettres(rang) {
  let s = "";
  for (let n = rang + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/**
 * Un classeur .xlsx, en octets.
 *
 * @param feuilles `[{ nom, lignes, masquee? }]`. Chaque cellule est :
 *   - une chaîne : texte partagé, comme l'écrit Excel ;
 *   - `{ texte }` : texte écrit dans la cellule même (« inlineStr ») ;
 *   - un nombre ;
 *   - `{ date: "AAAA-MM-JJ" }` : numéro de série au style de date ;
 *   - null : cellule absente, comme Excel omet les cellules vides.
 * @param options.date1904    calendrier des anciens classeurs Mac
 * @param options.prefixe     préfixe d'espace de noms des balises (« x » chez certains générateurs)
 * @param options.formatDate  format de date personnalisé ; par défaut, le format prédéfini n° 14
 */
export function classeurXlsx(feuilles, { date1904 = false, prefixe = "", formatDate = null } = {}) {
  const p = prefixe ? `${prefixe}:` : "";
  const xmlns = prefixe ? `xmlns:${prefixe}="${NS}"` : `xmlns="${NS}"`;
  const textes = [];
  const rangTexte = (t) => {
    if (!textes.includes(t)) textes.push(t);
    return textes.indexOf(t);
  };
  const origine = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const serie = (iso) => (Date.parse(`${iso}T00:00:00Z`) - origine) / 86_400_000;

  const cellule = (valeur, ligne, colonne) => {
    const r = `${lettres(colonne)}${ligne + 1}`;
    if (valeur === null || valeur === undefined) return "";
    if (typeof valeur === "string") return `<${p}c r="${r}" t="s"><${p}v>${rangTexte(valeur)}</${p}v></${p}c>`;
    if (typeof valeur === "number") return `<${p}c r="${r}"><${p}v>${valeur}</${p}v></${p}c>`;
    if (valeur.texte !== undefined) return `<${p}c r="${r}" t="inlineStr"><${p}is><${p}t>${echapper(valeur.texte)}</${p}t></${p}is></${p}c>`;
    return `<${p}c r="${r}" s="1"><${p}v>${serie(valeur.date)}</${p}v></${p}c>`;
  };

  const fichiers = {
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PAQUET}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${NS}" xmlns:r="${NS_REL}">${date1904 ? '<workbookPr date1904="1"/>' : "<workbookPr/>"}<sheets>${feuilles
      .map((f, i) => `<sheet name="${echapper(f.nom)}" sheetId="${i + 1}"${f.masquee ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`)
      .join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${NS_PAQUET}">${feuilles
      .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join("")}<Relationship Id="rIdS" Type="${NS_REL}/styles" Target="styles.xml"/><Relationship Id="rIdT" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
    "xl/styles.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="${NS}">${formatDate ? `<numFmts count="1"><numFmt numFmtId="164" formatCode="${echapper(formatDate)}"/></numFmts>` : ""}<cellXfs count="2"><xf numFmtId="0" fontId="0"/><xf numFmtId="${formatDate ? 164 : 14}" fontId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
  };

  feuilles.forEach((f, i) => {
    const lignes = f.lignes
      .map((cellules, l) => `<${p}row r="${l + 1}">${cellules.map((v, c) => cellule(v, l, c)).join("")}</${p}row>`)
      .join("");
    fichiers[`xl/worksheets/sheet${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${p}worksheet ${xmlns}><${p}sheetData>${lignes}</${p}sheetData></${p}worksheet>`;
  });
  // Écrit après les feuilles : c'est en les parcourant que les textes se rassemblent.
  fichiers["xl/sharedStrings.xml"] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${p}sst ${xmlns} count="${textes.length}" uniqueCount="${textes.length}">${textes.map((t) => `<${p}si><${p}t>${echapper(t)}</${p}t></${p}si>`).join("")}</${p}sst>`;

  return archiveZip(fichiers);
}

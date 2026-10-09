// Lecture des relevés bancaires — tests unitaires, puis parcours d'import.
//
// Les exemples reprennent les écritures que l'on rencontre réellement dans les
// exports des banques françaises : séparateurs, montants et dates varient d'un
// établissement à l'autre, et c'est précisément ce qui casse un import.
import assert from "node:assert/strict";
import { test, before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";
import { lireReleve, lireMontant, lireDate, decouperCsv, fenetreRecente, ErreurReleve } from "../src/banque/releve.js";
import { preparerOperations } from "../src/banque/import.js";
import { devinerCategorie } from "../src/banque/categories.js";
import { classeurXlsx, archiveZip } from "./aide/classeur.js";

const montants = (lu) => lu.operations.map((o) => o.transactionAmount.amount);

/* ─── Montants et dates ─── */

test("les montants se lisent quelle que soit l'écriture de la banque", () => {
  const cas = {
    "1 234,56": "1234.56", "-1.234,56": "-1234.56", "1,234.56": "1234.56", "+12,00 €": "12.00",
    "(45,10)": "-45.10", "45,10-": "-45.10", "12": "12.00", "12,5": "12.50", "1.234": "1234.00",
    "1 234,56": "1234.56", "0,00": "0.00", "-0,00": "0.00", "-39.99": "-39.99", "007,50": "7.50",
  };
  for (const [ecrit, attendu] of Object.entries(cas)) assert.equal(lireMontant(ecrit), attendu, ecrit);
  for (const v of ["", "abc", "12,34,56x", null, undefined, "--5", "1 2 x"]) assert.equal(lireMontant(v), null, String(v));
});

test("les dates se lisent jour en premier, et une date impossible est refusée", () => {
  const cas = {
    "03/04/2026": "2026-04-03", "2026-04-03": "2026-04-03", "20260403120000[0:GMT]": "2026-04-03",
    "3.4.26": "2026-04-03", "03-04-2026 10:22": "2026-04-03", "31/12/99": "1999-12-31",
  };
  for (const [ecrit, attendu] of Object.entries(cas)) assert.equal(lireDate(ecrit), attendu, ecrit);
  for (const v of ["31/02/2026", "2026-13-01", "x", "", null]) assert.equal(lireDate(v), null, String(v));
});

/* ─── CSV ─── */

test("CSV à point-virgule, une colonne montant, lignes d'en-tête parasites", () => {
  const lu = lireReleve([
    "Compte courant n° 000123;;;",
    "Solde au 30/09/2026;1 520,37;;",
    "",
    "Date opération;Date valeur;Libellé;Montant",
    "28/09/2026;28/09/2026;VIR SEPA SALAIRE SEPTEMBRE;2 450,00",
    "05/09/2026;05/09/2026;\"PRLV SEPA FOURNISSEUR; INTERNET\";-39,99",
    "02/09/2026;02/09/2026;CB CARREFOUR MARKET;-62,40",
    "Total;;;2 347,61",
  ].join("\r\n"));
  assert.equal(lu.format, "CSV");
  assert.deepEqual(montants(lu), ["2450.00", "-39.99", "-62.40"]);
  assert.equal(lu.operations[1].remittanceInformationUnstructured, "PRLV SEPA FOURNISSEUR; INTERNET", "un séparateur entre guillemets fait partie du texte");
  assert.equal(lu.operations[0].bookingDate, "2026-09-28");
  assert.equal(lu.ignorees, 1, "la ligne de total n'a pas de date");
});

test("CSV à colonnes débit et crédit : le débit est une sortie, quel que soit son signe", () => {
  const lu = lireReleve([
    "Date,Libelle simplifie,Libelle operation,Debit,Credit",
    "2026-09-28,SALAIRE,VIR SEPA ACME SAS,,2450.00",
    "2026-09-05,INTERNET,PRLV FOURNISSEUR,39.99,",
    "2026-09-02,LOYER,VIR AGENCE DU PARC,-900.00,",
  ].join("\n"));
  assert.deepEqual(montants(lu), ["2450.00", "-39.99", "-900.00"]);
  assert.equal(lu.operations[0].remittanceInformationUnstructured, "SALAIRE VIR SEPA ACME SAS", "les deux libellés sont gardés");
});

test("CSV à tabulations, avec marque d'ordre des octets et accents dans les en-têtes", () => {
  const lu = lireReleve("﻿Date de comptabilisation\tDétail de l'écriture\tMontant de l'opération\n01/09/2026\tCB BOULANGERIE\t-4,20\n");
  assert.deepEqual(montants(lu), ["-4.20"]);
});

test("CSV sans en-tête : les colonnes se reconnaissent à leur contenu", () => {
  const lu = lireReleve("28/09/2026;VIR SALAIRE ACME;2450,00;EUR\n05/09/2026;PRLV INTERNET;-39,99;EUR\n02/09/2026;CB CARREFOUR;-62,40;EUR\n");
  assert.deepEqual(montants(lu), ["2450.00", "-39.99", "-62.40"]);
  assert.equal(lu.operations[2].remittanceInformationUnstructured, "CB CARREFOUR");
});

test("le découpage CSV tient compte des guillemets doublés et des retours à la ligne internes", () => {
  assert.deepEqual(decouperCsv('a;"dit ""bonjour""";c\n"ligne 1\nligne 2";x;y\n', ";"), [
    ["a", 'dit "bonjour"', "c"],
    ["ligne 1\nligne 2", "x", "y"],
  ]);
});

/* ─── OFX et QIF ─── */

test("OFX sans balises fermantes, tel que les banques l'exportent", () => {
  const lu = lireReleve(`OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260928
<TRNAMT>+2450.00
<NAME>VIR SEPA ACME SAS
<MEMO>SALAIRE SEPTEMBRE
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260905120000
<TRNAMT>-39,99
<NAME>PRLV FOURNISSEUR INTERNET
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>1520.37<DTASOF>20260930</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`);
  assert.equal(lu.format, "OFX");
  assert.deepEqual(montants(lu), ["2450.00", "-39.99"]);
  assert.equal(lu.operations[0].remittanceInformationUnstructured, "VIR SEPA ACME SAS SALAIRE SEPTEMBRE");
  assert.equal(lu.operations[1].bookingDate, "2026-09-05");
  assert.equal(lu.solde, "1520.37");
});

test("QIF : une opération par bloc, close par un accent circonflexe", () => {
  const lu = lireReleve("!Type:Bank\nD28/09/2026\nT2 450,00\nPVIR ACME SAS\nMSALAIRE SEPTEMBRE\n^\nD05/09/2026\nT-39,99\nPPRLV INTERNET\n^\n");
  assert.equal(lu.format, "QIF");
  assert.deepEqual(montants(lu), ["2450.00", "-39.99"]);
  assert.equal(lu.operations[0].remittanceInformationUnstructured, "VIR ACME SAS SALAIRE SEPTEMBRE");
});

/* ─── Classeur Excel ─── */

test("classeur : textes partagés, dates au format prédéfini, montants en nombres, lignes parasites", () => {
  const lu = lireReleve(classeurXlsx([{
    nom: "Relevé",
    lignes: [
      ["Compte courant n° 000123"],
      [],
      ["Date opération", "Libellé", "Montant"],
      [{ date: "2026-09-28" }, "VIR SEPA SALAIRE SEPTEMBRE", 2450],
      [{ date: "2026-09-05" }, "PRLV SEPA FOURNISSEUR & CIE <INTERNET>", -39.99],
      [{ date: "2026-09-02" }, "CB CARREFOUR MARKET", -62.4],
      [null, "Total", 2347.61],
    ],
  }]));
  assert.equal(lu.format, "XLSX");
  assert.deepEqual(montants(lu), ["2450.00", "-39.99", "-62.40"]);
  assert.deepEqual(lu.operations.map((o) => o.bookingDate), ["2026-09-28", "2026-09-05", "2026-09-02"]);
  assert.equal(lu.operations[1].remittanceInformationUnstructured, "PRLV SEPA FOURNISSEUR & CIE <INTERNET>", "les entités XML sont décodées");
  assert.equal(lu.ignorees, 1, "la ligne de total, sans date, est écartée");
});

test("classeur : débit et crédit, format de date personnalisé, textes en ligne, cellules vides omises, balises préfixées", () => {
  const lu = lireReleve(classeurXlsx([{
    nom: "Opérations",
    lignes: [
      ["Date", "Libellé", "Débit", "Crédit"],
      [{ date: "2026-09-28" }, { texte: "VIR SALAIRE" }, null, 2450],
      [{ date: "2026-09-02" }, { texte: "VIR LOYER" }, 900, null],
      // Une banque qui écrit le débit en négatif : c'est la colonne qui fait le sens.
      [{ date: "2026-09-01" }, { texte: "CB BOULANGERIE" }, -4.2, null],
    ],
  }], { prefixe: "x", formatDate: '[$-40C]d mmmm yyyy;@' }));
  assert.deepEqual(montants(lu), ["2450.00", "-900.00", "-4.20"]);
  assert.deepEqual(lu.operations.map((o) => o.bookingDate), ["2026-09-28", "2026-09-02", "2026-09-01"]);
  assert.equal(lu.operations[0].remittanceInformationUnstructured, "VIR SALAIRE");
});

test("classeur : le premier onglet qui ressemble à un relevé est retenu, un onglet masqué est ignoré", () => {
  const lu = lireReleve(classeurXlsx([
    { nom: "Garde", lignes: [["Relevé de compte"], ["Édité le", { date: "2026-10-01" }]] },
    { nom: "Brouillon", masquee: true, lignes: [["Date", "Libellé", "Montant"], [{ date: "2026-09-01" }, "NE DOIT PAS ÊTRE LU", -1]] },
    { nom: "Opérations", lignes: [["Date", "Libellé", "Montant"], [{ date: "2026-09-02" }, "VIR LOYER", -900]] },
  ]));
  assert.deepEqual(montants(lu), ["-900.00"]);
});

test("classeur : calendrier des anciens Mac, et flottants arrondis au centime", () => {
  const lu = lireReleve(classeurXlsx([{
    nom: "Feuil1",
    lignes: [["Date", "Libellé", "Montant"], [{ date: "2026-09-02" }, "REMBOURSEMENT", 0.1 + 0.2], [{ date: "2026-09-03" }, "FRAIS", -12.004]],
  }], { date1904: true }));
  assert.deepEqual(lu.operations.map((o) => o.bookingDate), ["2026-09-02", "2026-09-03"]);
  assert.deepEqual(montants(lu), ["0.30", "-12.00"], "0.30000000000000004 n'est pas un entier immense");
});

test("un relevé texte arrivé en octets est décodé, Windows-1252 compris", () => {
  const texte = "Date;Libellé;Montant\r\n02/09/2026;VIR LOYER;-900,00\r\n";
  const lu = lireReleve(Buffer.from(texte, "latin1"));
  assert.equal(lu.format, "CSV");
  assert.deepEqual(montants(lu), ["-900.00"]);
});

test("un classeur illisible est refusé avec un message qui dit quoi faire", () => {
  const ole = Buffer.from("d0cf11e0a1b11ae1" + "00".repeat(504), "hex");
  assert.throws(() => lireReleve(ole), /\.xls\b.*mot de passe/);
  assert.throws(() => lireReleve(Buffer.alloc(0)), /vide/);
  assert.throws(() => lireReleve(archiveZip({ "notes.txt": "bonjour" })), /pas un classeur Excel/);
  assert.throws(
    () => lireReleve(archiveZip({ mimetype: "application/vnd.oasis.opendocument.spreadsheet", "content.xml": "<office:document-content/>" })),
    /OpenDocument/,
  );
  assert.throws(() => lireReleve(classeurXlsx([{ nom: "A", lignes: [["Date", "Libellé", "Montant"]] }]).subarray(0, 200)), /endommagé/);
  assert.throws(() => lireReleve(classeurXlsx([{ nom: "A", lignes: [["Bonjour"], ["rien à voir"]] }])), /Colonnes non reconnues/);
  assert.throws(() => lireReleve(classeurXlsx([{ nom: "A", lignes: [["Date", "Libellé", "Montant"]] }])), /Aucune opération/);
});

test("un classeur qui se déplie démesurément est refusé sans être déplié", () => {
  // Quelques dizaines de Ko compressés, plus de 40 Mo une fois dépliés.
  const bombe = archiveZip({
    "_rels/.rels": '<Relationships><Relationship Id="r" Type="x/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": Buffer.alloc(41_000_000, 0x20),
  });
  assert.ok(bombe.length < 200_000);
  assert.throws(() => lireReleve(bombe), /trop volumineux/);
});

/* ─── Refus ─── */

test("un fichier illisible est refusé avec un message qui dit quoi faire", () => {
  assert.throws(() => lireReleve(""), ErreurReleve);
  assert.throws(() => lireReleve("%PDF-1.7 ..."), /PDF/);
  assert.throws(() => lireReleve("PK\u0003\u0004 ..."), /Excel/);
  assert.throws(() => lireReleve("Bonjour,\nceci n'est pas un relevé.\n"), /Colonnes non reconnues|Aucune opération/);
  assert.throws(() => lireReleve("Date;Libellé;Montant\n"), /Aucune opération/);
});

/* ─── Fenêtre et préparation ─── */

test("la fenêtre récente part de la fin du relevé, pas d'aujourd'hui", () => {
  const op = (date) => ({ bookingDate: date, transactionAmount: { amount: "-1.00" } });
  const f = fenetreRecente([op("2025-01-15"), op("2025-03-10"), op("2025-04-30"), op("2025-02-01")], 90);
  assert.equal(f.au, "2025-04-30");
  assert.deepEqual(f.operations.map((o) => o.bookingDate).sort(), ["2025-02-01", "2025-03-10", "2025-04-30"]);
  assert.equal(f.du, "2025-02-01");
  assert.equal(f.jours, 89);
});

test("chaque opération reçoit une clé stable, deux identiques le même jour restent distinctes", () => {
  const cafe = { bookingDate: "2026-09-10", transactionAmount: { amount: "-2.50" }, remittanceInformationUnstructured: "CB CAFE DU COIN" };
  const lignes = preparerOperations([cafe, { ...cafe }, { ...cafe, bookingDate: "2026-09-11" }]);
  assert.equal(new Set(lignes.map((l) => l.cle)).size, 3);
  assert.ok(lignes.every((l) => /^[0-9a-f]{32}$/.test(l.cle)));
  // Rejouer le même relevé donne les mêmes clés : c'est ce qui évite les doublons.
  assert.deepEqual(preparerOperations([cafe, { ...cafe }]).map((l) => l.cle).sort(), lignes.filter((l) => l.date === "2026-09-10").map((l) => l.cle).sort());
  // La casse et les espaces du libellé ne changent pas l'identité.
  const autre = preparerOperations([{ ...cafe, remittanceInformationUnstructured: "cb  café du coin" }]);
  assert.ok(lignes.some((l) => l.cle === autre[0].cle));
});

test("le titulaire du compte entre dans la clé, sauf pour le compte commun", () => {
  const abonnement = { bookingDate: "2026-09-05", transactionAmount: { amount: "-13.49" }, remittanceInformationUnstructured: "PRLV NETFLIX" };
  const [commun] = preparerOperations([abonnement]);
  const [camille] = preparerOperations([abonnement], "membre-camille");
  const [sacha] = preparerOperations([abonnement], "membre-sacha");
  assert.equal(new Set([commun.cle, camille.cle, sacha.cle]).size, 3, "le même abonnement sur deux comptes, ce sont deux dépenses");
  assert.equal(preparerOperations([abonnement], "foyer")[0].cle, commun.cle, "les imports déjà faits pour le foyer restent reconnus");
  assert.equal(preparerOperations([abonnement], "membre-camille")[0].cle, camille.cle);
});

test("les lignes préparées portent type, montant positif, catégorie et repère de salaire", () => {
  const lignes = preparerOperations([
    { bookingDate: "2026-09-28", transactionAmount: { amount: "2450.00" }, remittanceInformationUnstructured: "VIR SALAIRE ACME" },
    { bookingDate: "2026-09-12", transactionAmount: { amount: "86.40" }, remittanceInformationUnstructured: "REMBOURSEMENT" },
    { bookingDate: "2026-09-02", transactionAmount: { amount: "-62.40" }, remittanceInformationUnstructured: "CB CARREFOUR MARKET" },
    { bookingDate: "2026-09-01", transactionAmount: { amount: "0.00" }, remittanceInformationUnstructured: "AVIS" },
  ]);
  assert.deepEqual(lignes.map((l) => [l.date, l.type, l.montant, l.categorie, l.salaire]), [
    ["2026-09-28", "revenu", 245000, "Autre", true],
    ["2026-09-12", "revenu", 8640, "Autre", false],
    ["2026-09-02", "depense", 6240, "Courses", false],
  ]);
});

test("la catégorie se devine au libellé, la règle la plus précise d'abord", () => {
  const cas = {
    "PRLV TOTALENERGIES ELECTRICITE": "Énergie", "CB TOTAL ACCESS A6": "Transport", "CB CARREFOUR CITY": "Courses",
    "PRLV MAIF ASSURANCE AUTO": "Assurances", "VIR LOYER AGENCE": "Logement", "PRLV NETFLIX.COM": "Abonnements",
    "DGFIP IMPOT REVENU": "Impôts", "CB PHARMACIE DU CENTRE": "Santé", "CANTINE SCOLAIRE": "Enfants",
    "CB CINEMA LE REX": "Loisirs", "CB RELAXATION SPA": "Autre", "VIREMENT A JEAN": "Autre",
  };
  for (const [libelle, attendu] of Object.entries(cas)) assert.equal(devinerCategorie(libelle), attendu, libelle);
});

/* ─── Parcours d'import ─── */

let serveur = null;
let rendreLaParole = null;

before(async () => {
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
  if (rendreLaParole) rendreLaParole();
});

const RELEVE = [
  "Date;Libellé;Montant",
  "28/09/2026;VIR SEPA SALAIRE SEPTEMBRE;2 450,00",
  "02/09/2026;VIR LOYER AGENCE DU PARC;-900,00",
  "17/09/2026;CB CARREFOUR MARKET;-62,40",
  "28/08/2026;VIR SEPA SALAIRE AOUT;2 450,00",
  "02/08/2026;VIR LOYER AGENCE DU PARC;-900,00",
  "28/07/2026;VIR SEPA SALAIRE JUILLET;2 450,00",
  "02/07/2026;VIR LOYER AGENCE DU PARC;-900,00",
].join("\n");

const aImporter = (apercu) =>
  apercu.operations.filter((o) => !o.salaire && !o.dejaImportee).map(({ cle, date, type, libelle, montant, categorie }) => ({ cle, date, type, libelle, montant, categorie }));

testIntegration("un relevé donne une estimation et un aperçu, sans rien enregistrer", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const r = await client.appel("/banque/releve", "POST", { nom: "releve.csv", contenu: RELEVE });
    assert.equal(r.code, 200);
    assert.deepEqual([r.corps.source, r.corps.format, r.corps.nom], ["releve", "CSV", "releve.csv"]);
    assert.deepEqual(r.corps.foyer, { emprunteurPrincipalNet: 2450, chargesCourantesFixes: 900 });
    assert.deepEqual(r.corps.periode, { du: "2026-07-02", au: "2026-09-28", jours: 89 });
    assert.equal(r.corps.operations.length, 7);
    assert.deepEqual(r.corps.avertissements, []);
    const loyer = r.corps.operations.find((o) => o.date === "2026-09-02");
    assert.deepEqual([loyer.type, loyer.montant, loyer.categorie, loyer.salaire, loyer.dejaImportee], ["depense", 900, "Logement", false, false]);
    assert.equal(r.corps.operations.filter((o) => o.salaire).length, 3);
    assert.equal(await contexte.prisma.transaction.count({ where: { foyerId: contexte.foyer.id } }), 0, "l'aperçu n'écrit rien");
  });
});

testIntegration("les opérations validées entrent dans le flux, à leur mois, sans doublon au second import", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const apercu = (await client.appel("/banque/releve", "POST", { contenu: RELEVE })).corps;

    const importe = await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) });
    assert.equal(importe.code, 201);
    assert.deepEqual([importe.corps.ajoutees, importe.corps.dejaPresentes], [4, 0]);

    const septembre = (await client.appel("/etat?mois=2026-09")).corps.transactions;
    assert.deepEqual(
      septembre.map((t) => [t.libelle, t.type, t.montant, t.categorie, t.pour, t.recurrent, t.mois]).sort(),
      [
        ["CB CARREFOUR MARKET", "depense", 62.4, "Courses", "foyer", false, "2026-09"],
        ["VIR LOYER AGENCE DU PARC", "depense", 900, "Logement", "foyer", false, "2026-09"],
      ],
    );
    assert.equal(new Date(septembre.find((t) => t.montant === 62.4).date).toISOString().slice(0, 10), "2026-09-17");
    assert.equal((await client.appel("/etat?mois=2026-07")).corps.transactions.length, 1);

    // Second passage : l'aperçu les reconnaît, et l'import ne double rien.
    const second = (await client.appel("/banque/releve", "POST", { contenu: RELEVE })).corps;
    assert.equal(second.operations.filter((o) => o.dejaImportee).length, 4);
    const rejoue = await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) });
    assert.deepEqual([rejoue.corps.ajoutees, rejoue.corps.dejaPresentes], [0, 4]);
    assert.equal(await contexte.prisma.transaction.count({ where: { foyerId: contexte.foyer.id } }), 4);

    // Un relevé qui chevauche le premier n'ajoute que ce qui est nouveau.
    const suivant = RELEVE + "\n03/10/2026;CB LIDL;-41,15\n";
    const chevauche = (await client.appel("/banque/releve", "POST", { contenu: suivant })).corps;
    const ajout = await client.appel("/transactions/import", "POST", { operations: aImporter(chevauche) });
    assert.deepEqual([ajout.corps.ajoutees, ajout.corps.dejaPresentes], [1, 0]);
  });
});

testIntegration("un import s'annule d'un geste, sans toucher aux lignes saisies à la main", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/transactions", "POST", { type: "depense", libelle: "Saisie à la main", montant: 10, categorie: "Autre", recurrent: false, mois: "2026-09" });
    const apercu = (await client.appel("/banque/releve", "POST", { contenu: RELEVE })).corps;
    const { lot } = (await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) })).corps;

    const annule = await client.appel(`/transactions/import/${lot}`, "DELETE");
    assert.deepEqual(annule.corps, { retirees: 4 });
    const restantes = await contexte.prisma.transaction.findMany({ where: { foyerId: contexte.foyer.id } });
    assert.deepEqual(restantes.map((t) => t.libelle), ["Saisie à la main"]);
    assert.equal((await client.appel(`/transactions/import/${lot}`, "DELETE")).code, 404);
    // Annulé, le relevé peut être réimporté.
    assert.equal((await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) })).corps.ajoutees, 4);
  });
});

testIntegration("les imports d'un foyer ne se voient ni ne s'annulent depuis un autre", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const sonClient = await clientConnecte(serveur.base, voisin);
      const sonApercu = (await sonClient.appel("/banque/releve", "POST", { contenu: RELEVE })).corps;
      const { lot } = (await sonClient.appel("/transactions/import", "POST", { operations: aImporter(sonApercu) })).corps;

      const client = await clientConnecte(serveur.base, mien);
      const apercu = (await client.appel("/banque/releve", "POST", { contenu: RELEVE })).corps;
      assert.equal(apercu.operations.filter((o) => o.dejaImportee).length, 0, "ses imports ne marquent pas les miens");
      assert.equal((await client.appel(`/transactions/import/${lot}`, "DELETE")).code, 404);
      // Les mêmes clés coexistent dans deux foyers.
      assert.equal((await client.appel("/transactions/import", "POST", { operations: aImporter(apercu) })).corps.ajoutees, 4);
      assert.equal(await voisin.prisma.transaction.count({ where: { foyerId: voisin.foyer.id } }), 4);
      // Et une ligne ne s'attribue pas à un membre d'un autre foyer.
      const membre = await voisin.prisma.membre.create({ data: { nom: "Voisin", revenuMensuel: 0, foyerId: voisin.foyer.id } });
      assert.equal((await client.appel("/transactions/import", "POST", { pour: membre.id, operations: aImporter(apercu) })).code, 400);
    });
  });
});

testIntegration("un classeur Excel donne le même aperçu que le relevé CSV équivalent", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    // RELEVE, ligne pour ligne, tel qu'un tableur l'enregistrerait.
    const lignes = RELEVE.split("\n").map((ligne, i) => {
      if (i === 0) return ligne.split(";");
      const [date, libelle, montant] = ligne.split(";");
      const [j, m, a] = date.split("/");
      return [{ date: `${a}-${m}-${j}` }, libelle, Number(montant.replace(/\s/g, "").replace(",", "."))];
    });
    const contenu = classeurXlsx([{ nom: "Relevé", lignes }]).toString("base64");

    const csv = await client.appel("/banque/releve", "POST", { nom: "releve.csv", contenu: RELEVE });
    const xlsx = await client.appel("/banque/releve", "POST", { nom: "releve.xlsx", contenu, encodage: "base64" });
    assert.equal(xlsx.code, 200);
    assert.equal(xlsx.corps.format, "XLSX");
    assert.deepEqual(xlsx.corps.foyer, csv.corps.foyer);
    assert.deepEqual(xlsx.corps.periode, csv.corps.periode);
    assert.deepEqual(xlsx.corps.operations, csv.corps.operations, "même empreinte : réimporter l'un après l'autre n'ajoute rien");

    // Un classeur envoyé comme du texte a été abîmé en route : on le dit.
    const abime = await client.appel("/banque/releve", "POST", { contenu: "PK\u0003\u0004 abîmé" });
    assert.equal(abime.code, 400);
    assert.match(abime.corps.erreur, /Excel/);
    assert.equal((await client.appel("/banque/releve", "POST", { contenu, encodage: "binaire" })).code, 400);
  });
});

testIntegration("fichiers refusés : illisible, trop court, trop gros, entrées mal formées", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);

    const pdf = await client.appel("/banque/releve", "POST", { contenu: "%PDF-1.7" });
    assert.equal(pdf.code, 400);
    assert.equal(pdf.corps.motif, "releve-illisible");
    assert.match(pdf.corps.erreur, /PDF/);
    assert.equal((await client.appel("/banque/releve", "POST", { contenu: "" })).code, 400);

    // Un seul mois : lu, mais l'estimation des charges est signalée comme impossible.
    const court = await client.appel("/banque/releve", "POST", { contenu: "Date;Libellé;Montant\n02/09/2026;LOYER;-900,00\n17/09/2026;CB LIDL;-40,00\n" });
    assert.equal(court.code, 200);
    assert.equal(court.corps.avertissements.length, 2);
    assert.equal(court.corps.foyer.chargesCourantesFixes, 0);

    // Un relevé de plusieurs centaines de ko passe (la limite par défaut est de 100 ko).
    const lignes = Array.from({ length: 6000 }, (_, i) => `${String((i % 28) + 1).padStart(2, "0")}/09/2026;CB COMMERCE NUMERO ${i} ${"X".repeat(40)};-${(i % 90) + 1},00`);
    const gros = await client.appel("/banque/releve", "POST", { contenu: ["Date;Libellé;Montant", ...lignes].join("\n") });
    assert.equal(gros.code, 200);
    assert.equal(gros.corps.operations.length, 6000);
    assert.equal((await client.appel("/banque/releve", "POST", { contenu: "x".repeat(4_500_000) })).code, 413);

    for (const operations of [
      [],
      [{ cle: "pas-une-cle", date: "2026-09-02", type: "depense", libelle: "X", montant: 1, categorie: "Autre" }],
      [{ cle: "a".repeat(32), date: "02/09/2026", type: "depense", libelle: "X", montant: 1, categorie: "Autre" }],
      [{ cle: "a".repeat(32), date: "2026-09-02", type: "depense", libelle: "X", montant: -1, categorie: "Autre" }],
    ]) {
      assert.equal((await client.appel("/transactions/import", "POST", { operations })).code, 400);
    }
  });
});

testIntegration("comptes séparés : la même opération chez deux personnes donne deux lignes, chacune à son nom", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    const camille = (await client.appel("/membres", "POST", { nom: "Camille", revenu: 2450 })).corps;
    const sacha = (await client.appel("/membres", "POST", { nom: "Sacha", revenu: 1980 })).corps;
    const releve = "Date;Libellé;Montant\n05/09/2026;PRLV NETFLIX;-13,49\n17/09/2026;CB CARREFOUR MARKET;-62,40\n";

    const importer = async (pour) => {
      const apercu = (await client.appel("/banque/releve", "POST", { contenu: releve, pour })).corps;
      assert.equal(apercu.pour, pour);
      return { apercu, resultat: (await client.appel("/transactions/import", "POST", { pour, operations: aImporter(apercu) })).corps };
    };

    assert.equal((await importer(camille.id)).resultat.ajoutees, 2);
    // Le relevé de Sacha contient les mêmes écritures : rien n'y est « déjà importé ».
    const deSacha = await importer(sacha.id);
    assert.equal(deSacha.apercu.operations.filter((o) => o.dejaImportee).length, 0);
    assert.equal(deSacha.resultat.ajoutees, 2);
    // Réimporter celui de Camille, en revanche, ne double rien.
    const rejoue = await importer(camille.id);
    assert.equal(rejoue.apercu.operations.filter((o) => o.dejaImportee).length, 2);
    assert.deepEqual(rejoue.apercu.operations.filter((o) => !o.dejaImportee), []);

    const etat = (await client.appel("/etat?mois=2026-09")).corps;
    assert.deepEqual(
      etat.transactions.map((t) => [t.libelle, t.pour]).sort(),
      [["CB CARREFOUR MARKET", camille.id], ["CB CARREFOUR MARKET", sacha.id], ["PRLV NETFLIX", camille.id], ["PRLV NETFLIX", sacha.id]].sort(),
    );
    // Des dépenses personnelles : elles pèsent sur le reste de chacun, pas sur les charges communes.
    assert.deepEqual(etat.parMembre.map((m) => [m.nom, m.perso]).sort(), [["Camille", 75.89], ["Sacha", 75.89]]);

    // Un titulaire qui n'est pas du foyer est refusé dès la lecture.
    assert.equal((await client.appel("/banque/releve", "POST", { contenu: releve, pour: "membre-inconnu" })).code, 400);
  });
});

// Restauration d'un export produit par `npm run sauvegarder`.
//
//   npm run restaurer -- sauvegardes/budget-2026-08-11-091033.json --essai
//   npm run restaurer -- sauvegardes/budget-2026-08-11-091033.json
//
// Une sauvegarde jamais restaurée n'est pas une sauvegarde : c'est une
// hypothèse. Le mode `--essai` permet de la vérifier pour de bon, sans risque :
// tout est rejoué dans une transaction qui est ensuite annulée. La base ressort
// exactement dans l'état où elle était, mais on sait que la restauration marche.
//
// Sans `--essai`, le script refuse d'écrire dans une base qui contient déjà des
// données : restaurer par-dessus mélangerait deux états.
import "../src/env.js";
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// npm exécute le script depuis server/, alors que les sauvegardes vivent à la
// racine du dépôt : un chemin tapé tel qu'on le lit ne résoudrait pas.
const RACINE = fileURLToPath(new URL("../../", import.meta.url));
const trouver = (chemin) =>
  existsSync(chemin) ? chemin : path.join(RACINE, chemin);

const prisma = new PrismaClient();
const ANNULATION = "annulation volontaire de l'essai";

// Ordre imposé par les dépendances : un enfant ne peut pas précéder son parent.
const TABLES = [
  "foyers", "utilisateurs", "membres", "credits", "projets", "placements", "budgets",
  "transactions", "versements", "mouvementsPlacement", "paiementsCredit",
];

const compter = (contenu) =>
  TABLES.map((t) => `${(contenu[t] ?? []).length} ${t}`).join(" · ");

async function contenuActuel(client) {
  const [foyers, utilisateurs, membres, transactions, credits, projets, versements, placements, budgets, mouvementsPlacement, paiementsCredit] =
    await Promise.all([
      client.foyer.count(), client.utilisateur.count(), client.membre.count(), client.transaction.count(),
      client.credit.count(), client.projet.count(), client.versement.count(), client.placement.count(),
      client.budget.count(), client.mouvementPlacement.count(), client.paiementCredit.count(),
    ]);
  return { foyers, utilisateurs, membres, transactions, credits, projets, versements, placements, budgets, mouvementsPlacement, paiementsCredit };
}

const total = (c) => Object.values(c).reduce((s, n) => s + n, 0);

/** Réécrit la base à l'image de l'export. Le client peut être une transaction. */
async function restaurer(client, contenu) {
  // Vider dans l'ordre inverse des dépendances.
  await client.paiementCredit.deleteMany();
  await client.mouvementPlacement.deleteMany();
  await client.budget.deleteMany();
  await client.versement.deleteMany();
  await client.transaction.deleteMany();
  await client.projet.deleteMany();
  await client.credit.deleteMany();
  await client.placement.deleteMany();
  await client.membre.deleteMany();
  await client.utilisateur.deleteMany();
  await client.foyer.deleteMany();

  // Les identifiants d'origine sont conservés : les liens entre tables en
  // dépendent, et un export doit pouvoir être rejoué à l'identique.
  for (const nom of TABLES) {
    const lignes = contenu[nom] ?? [];
    if (lignes.length === 0) continue;
    const modele = {
      foyers: client.foyer, utilisateurs: client.utilisateur, membres: client.membre,
      credits: client.credit, projets: client.projet, placements: client.placement, budgets: client.budget,
      transactions: client.transaction, versements: client.versement,
      mouvementsPlacement: client.mouvementPlacement, paiementsCredit: client.paiementCredit,
    }[nom];
    await modele.createMany({ data: lignes });
  }

  // Foyer.id est auto-incrémenté : sans ce recalage, la séquence redistribuerait
  // un identifiant déjà pris et la prochaine inscription échouerait.
  const foyers = contenu.foyers ?? [];
  if (foyers.length > 0) {
    const maximum = Math.max(...foyers.map((f) => f.id));
    await client.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"Foyer"', 'id'), ${maximum})`,
    );
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const essai = arguments_.includes("--essai");
  const fichier = arguments_.find((a) => !a.startsWith("--"));

  if (!fichier) {
    console.error("Usage : npm run restaurer -- <fichier.json> [--essai]");
    process.exitCode = 1;
    return;
  }

  let contenu;
  try {
    contenu = JSON.parse(readFileSync(trouver(fichier), "utf8"));
  } catch (e) {
    console.error(`Sauvegarde illisible (${fichier}) : ${e.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Sauvegarde du ${contenu.exporteLe ?? "?"}`);
  console.log(`  contient : ${compter(contenu)}`);

  const avant = await contenuActuel(prisma);
  console.log(`  base actuelle : ${total(avant)} enregistrement(s)`);

  if (!essai && total(avant) > 0 && process.env.FORCE_RESTAURATION !== "1") {
    console.error(
      "\nRestauration interrompue : la base contient déjà des données.\n" +
        "Elles seraient toutes remplacées. Essayez d'abord avec --essai, qui rejoue\n" +
        "la restauration puis annule tout, ou relancez avec FORCE_RESTAURATION=1.",
    );
    process.exitCode = 1;
    return;
  }

  if (!essai) {
    await restaurer(prisma, contenu);
    const apres = await contenuActuel(prisma);
    console.log(`\nRestauration terminée : ${total(apres)} enregistrement(s) en base.`);
    return;
  }

  // Essai : on restaure réellement, on vérifie, puis on annule tout.
  console.log("\nEssai — la restauration va être rejouée puis annulée.");
  try {
    await prisma.$transaction(
      async (tx) => {
        await restaurer(tx, contenu);
        const apres = await contenuActuel(tx);

        let ecarts = 0;
        for (const nom of TABLES) {
          const attendu = (contenu[nom] ?? []).length;
          if (apres[nom] !== attendu) {
            console.error(`  ✗ ${nom} : ${apres[nom]} en base, ${attendu} dans la sauvegarde`);
            ecarts += 1;
          }
        }
        if (ecarts === 0) console.log(`  ✓ tout est revenu : ${compter(contenu)}`);
        else throw new Error(`${ecarts} table(s) ne correspondent pas`);

        throw new Error(ANNULATION);
      },
      { timeout: 120000, maxWait: 20000 },
    );
  } catch (e) {
    if (e.message !== ANNULATION) {
      console.error(`\nEssai en échec : ${e.message}`);
      process.exitCode = 1;
      return;
    }
  }

  const apres = await contenuActuel(prisma);
  console.log(`\nBase inchangée : ${total(apres)} enregistrement(s), comme avant l'essai.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

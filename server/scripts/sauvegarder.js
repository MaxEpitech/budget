// Export complet de la base au format JSON, à lancer avant toute migration.
// Les fichiers atterrissent dans sauvegardes/ (ignoré par Git) à la racine du repo.
//
//   npm run sauvegarder
//
// Les montants restent en centimes, tels qu'ils sont stockés : la sauvegarde est
// une image fidèle de la base, pas une vue applicative.
import "../src/env.js";
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const prisma = new PrismaClient();

// Horodatage local, lisible et triable : 2026-08-11-143052
const horodatage = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

async function main() {
  // Toutes les tables qui portent des données du foyer. Sessions, jetons et
  // compteurs de cadence n'en sont pas : ils ne se restaurent pas, ils se refont.
  const [foyers, utilisateurs, membres, transactions, credits, projets, versements, placements, budgets, mouvementsPlacement, paiementsCredit] = await Promise.all([
    prisma.foyer.findMany(),
    // La table Utilisateur n'existe pas avant le module d'authentification.
    prisma.utilisateur?.findMany().catch(() => null) ?? null,
    prisma.membre.findMany(),
    prisma.transaction.findMany(),
    prisma.credit.findMany(),
    prisma.projet.findMany(),
    prisma.versement.findMany(),
    prisma.placement.findMany(),
    prisma.budget.findMany(),
    prisma.mouvementPlacement.findMany(),
    prisma.paiementCredit.findMany(),
  ]);

  const contenu = {
    exporteLe: new Date().toISOString(),
    foyers,
    ...(utilisateurs ? { utilisateurs } : {}),
    membres,
    transactions,
    credits,
    projets,
    versements,
    placements,
    budgets,
    mouvementsPlacement,
    paiementsCredit,
  };

  const dossier = fileURLToPath(new URL("../../sauvegardes", import.meta.url));
  mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, `budget-${horodatage()}.json`);
  writeFileSync(fichier, JSON.stringify(contenu, null, 2), "utf8");

  const compte = (n, t) => `${t.length} ${n}${t.length > 1 ? "s" : ""}`;
  console.log(`Sauvegarde écrite : ${fichier}`);
  console.log(
    "  " +
      [
        compte("foyer", foyers),
        compte("membre", membres),
        compte("transaction", transactions),
        compte("crédit", credits),
        compte("projet", projets),
        compte("versement", versements),
        compte("placement", placements),
        compte("enveloppe", budgets),
        compte("mouvement d'épargne", mouvementsPlacement),
        compte("paiement de crédit", paiementsCredit),
      ].join(" · ")
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

// Jeu de démonstration — reprend ETAT_DEMO du prototype (budget-foyer.jsx),
// montants convertis en centimes. Relancer le seed remet la base dans cet état.
//
// ATTENTION : ce script EFFACE tout le contenu de la base avant de la remplir.
// Il refuse donc de s'exécuter si elle contient déjà des données ; pour passer
// outre volontairement : FORCE_SEED=1 npx prisma db seed
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

// Le .env vit à la racine du repo ; l'URL doit être chargée avant d'instancier le client.
config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const prisma = new PrismaClient();

// Mois courant décalé de `delta` mois, au format YYYY-MM.
const moisCle = (delta = 0) => {
  const d = new Date();
  const x = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
};

// Refuse d'écraser une base déjà remplie, sauf demande explicite.
async function verifierBaseVide() {
  if (process.env.FORCE_SEED === "1") return;
  const [membres, transactions, credits, projets, placements, utilisateurs] = await Promise.all([
    prisma.membre.count(),
    prisma.transaction.count(),
    prisma.credit.count(),
    prisma.projet.count(),
    prisma.placement.count(),
    prisma.utilisateur.count(),
  ]);
  const total = membres + transactions + credits + projets + placements + utilisateurs;
  if (total === 0) return;
  console.error(
    `Seed interrompu : la base contient déjà des données (${membres} membre(s), ` +
      `${transactions} transaction(s), ${credits} crédit(s), ${projets} projet(s), ` +
      `${placements} placement(s), ${utilisateurs} utilisateur(s)).\n` +
      "Ce script les effacerait toutes. Sauvegardez d'abord (npm run sauvegarder),\n" +
      "puis relancez avec FORCE_SEED=1 si c'est bien ce que vous voulez."
  );
  process.exitCode = 1;
  return "interrompu";
}

async function main() {
  if (await verifierBaseVide()) return;

  // On repart d'une base propre : le seed est un état de référence, pas un ajout.
  await prisma.versement.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.projet.deleteMany();
  await prisma.credit.deleteMany();
  await prisma.placement.deleteMany();
  await prisma.membre.deleteMany();
  await prisma.utilisateur.deleteMany();
  await prisma.foyer.deleteMany();

  // Le foyer de démonstration : tout le jeu d'exemple lui est rattaché.
  const foyer = await prisma.foyer.create({ data: { repartition: "prorata" } });
  const foyerId = foyer.id;

  const alex = await prisma.membre.create({ data: { nom: "Alex", revenuMensuel: 245000, foyerId } });
  const camille = await prisma.membre.create({ data: { nom: "Camille", revenuMensuel: 198000, foyerId } });

  // Ordre inversé par rapport à ETAT_DEMO : l'API sert les transactions de la
  // plus récente à la plus ancienne (le prototype ajoute en tête de liste),
  // l'affichage initial reste donc celui du prototype.
  await prisma.transaction.createMany({
    data: [
      { type: "revenu", libelle: "Freelance", montant: 30000, categorie: "Autre", recurrent: false, mois: moisCle(0), membreId: alex.id, foyerId },
      { type: "depense", libelle: "Essence", montant: 14000, categorie: "Transport", recurrent: true, foyerId },
      { type: "depense", libelle: "Salle de sport", montant: 3200, categorie: "Loisirs", recurrent: true, membreId: camille.id, foyerId },
      { type: "depense", libelle: "Forfait mobile", montant: 1500, categorie: "Abonnements", recurrent: true, membreId: alex.id, foyerId },
      { type: "depense", libelle: "Assurance habitation", montant: 2800, categorie: "Assurances", recurrent: true, foyerId },
      { type: "depense", libelle: "Électricité", montant: 9500, categorie: "Énergie", recurrent: true, foyerId },
      { type: "depense", libelle: "Courses", montant: 52000, categorie: "Courses", recurrent: true, foyerId },
      { type: "depense", libelle: "Loyer", montant: 98000, categorie: "Logement", recurrent: true, foyerId },
    ],
  });

  await prisma.credit.createMany({
    data: [
      { libelle: "Voiture", capital: 1400000, taux: 3.9, dureeMois: 60, moisDebut: moisCle(-18), foyerId },
      { libelle: "Prêt travaux", capital: 900000, taux: 2.4, dureeMois: 48, moisDebut: moisCle(-6), foyerId },
    ],
  });

  // L'épargne déjà constituée dans le prototype devient un versement initial :
  // le total épargné d'un projet est la somme de ses versements.
  await prisma.projet.create({
    data: {
      libelle: "Voyage Japon",
      objectif: 600000,
      echeance: moisCle(14),
      versementMensuel: 25000,
      foyerId,
      versements: { create: [{ montant: 185000 }] },
    },
  });
  await prisma.projet.create({
    data: {
      libelle: "Travaux cuisine",
      objectif: 1200000,
      echeance: moisCle(20),
      versementMensuel: 30000,
      foyerId,
      versements: { create: [{ montant: 320000 }] },
    },
  });

  await prisma.placement.createMany({
    data: [
      // Le Livret A est plafonné à 22 950 € de versements ; le PEA ne l'est pas ici.
      { libelle: "Livret A", valeur: 840000, versementMensuel: 15000, rendement: 2.4, plafond: 2295000, foyerId },
      { libelle: "PEA", valeur: 520000, versementMensuel: 20000, rendement: 5.5, foyerId },
    ],
  });

  console.log("Seed terminé : jeu de démonstration en base.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

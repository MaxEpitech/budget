// Jeu de démonstration — reprend ETAT_DEMO du prototype (budget-foyer.jsx),
// montants convertis en centimes. Relancer le seed remet la base dans cet état.
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

async function main() {
  // On repart d'une base propre : le seed est un état de référence, pas un ajout.
  await prisma.versement.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.projet.deleteMany();
  await prisma.credit.deleteMany();
  await prisma.placement.deleteMany();
  await prisma.membre.deleteMany();
  await prisma.foyer.deleteMany();

  await prisma.foyer.create({ data: { id: 1, repartition: "prorata" } });

  const alex = await prisma.membre.create({ data: { nom: "Alex", revenuMensuel: 245000 } });
  const camille = await prisma.membre.create({ data: { nom: "Camille", revenuMensuel: 198000 } });

  // Ordre inversé par rapport à ETAT_DEMO : l'API sert les transactions de la
  // plus récente à la plus ancienne (le prototype ajoute en tête de liste),
  // l'affichage initial reste donc celui du prototype.
  await prisma.transaction.createMany({
    data: [
      { type: "revenu", libelle: "Freelance", montant: 30000, categorie: "Autre", recurrent: false, mois: moisCle(0), membreId: alex.id },
      { type: "depense", libelle: "Essence", montant: 14000, categorie: "Transport", recurrent: true },
      { type: "depense", libelle: "Salle de sport", montant: 3200, categorie: "Loisirs", recurrent: true, membreId: camille.id },
      { type: "depense", libelle: "Forfait mobile", montant: 1500, categorie: "Abonnements", recurrent: true, membreId: alex.id },
      { type: "depense", libelle: "Assurance habitation", montant: 2800, categorie: "Assurances", recurrent: true },
      { type: "depense", libelle: "Électricité", montant: 9500, categorie: "Énergie", recurrent: true },
      { type: "depense", libelle: "Courses", montant: 52000, categorie: "Courses", recurrent: true },
      { type: "depense", libelle: "Loyer", montant: 98000, categorie: "Logement", recurrent: true },
    ],
  });

  await prisma.credit.createMany({
    data: [
      { libelle: "Voiture", capital: 1400000, taux: 3.9, dureeMois: 60, moisDebut: moisCle(-18) },
      { libelle: "Prêt travaux", capital: 900000, taux: 2.4, dureeMois: 48, moisDebut: moisCle(-6) },
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
      versements: { create: [{ montant: 185000 }] },
    },
  });
  await prisma.projet.create({
    data: {
      libelle: "Travaux cuisine",
      objectif: 1200000,
      echeance: moisCle(20),
      versementMensuel: 30000,
      versements: { create: [{ montant: 320000 }] },
    },
  });

  await prisma.placement.createMany({
    data: [
      // Le Livret A est plafonné à 22 950 € de versements ; le PEA ne l'est pas ici.
      { libelle: "Livret A", valeur: 840000, versementMensuel: 15000, rendement: 2.4, plafond: 2295000 },
      { libelle: "PEA", valeur: 520000, versementMensuel: 20000, rendement: 5.5 },
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

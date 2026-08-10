-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Repartition" AS ENUM ('prorata', 'moitie');

-- CreateEnum
CREATE TYPE "TypeTransaction" AS ENUM ('revenu', 'depense');

-- CreateTable
CREATE TABLE "Foyer" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "repartition" "Repartition" NOT NULL DEFAULT 'prorata',

    CONSTRAINT "Foyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membre" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "revenuMensuel" INTEGER NOT NULL,

    CONSTRAINT "Membre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "type" "TypeTransaction" NOT NULL,
    "libelle" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "categorie" TEXT NOT NULL,
    "recurrent" BOOLEAN NOT NULL DEFAULT false,
    "mois" TEXT,
    "membreId" TEXT,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Credit" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "capital" INTEGER NOT NULL,
    "taux" DOUBLE PRECISION NOT NULL,
    "dureeMois" INTEGER NOT NULL,
    "moisDebut" TEXT NOT NULL,

    CONSTRAINT "Credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Projet" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "objectif" INTEGER NOT NULL,
    "echeance" TEXT NOT NULL,
    "versementMensuel" INTEGER NOT NULL,

    CONSTRAINT "Projet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Versement" (
    "id" TEXT NOT NULL,
    "projetId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Versement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Placement" (
    "id" TEXT NOT NULL,
    "libelle" TEXT NOT NULL,
    "valeur" INTEGER NOT NULL,
    "versementMensuel" INTEGER NOT NULL,
    "rendement" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Placement_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Versement" ADD CONSTRAINT "Versement_projetId_fkey" FOREIGN KEY ("projetId") REFERENCES "Projet"("id") ON DELETE CASCADE ON UPDATE CASCADE;


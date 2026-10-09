-- Mouvements internes : une opération du flux peut alimenter l'épargne, un
-- projet ou un crédit au lieu d'être une dépense.
--
-- Versements de projet et mouvements d'épargne reçoivent le libellé lu sur le
-- relevé et les repères d'import (empreinte, lot) qu'ont déjà les lignes du
-- flux : une réimportation n'ajoute rien en double, et un import s'annule d'un
-- geste. Les crédits gagnent un registre des échéances réellement prélevées.
--
-- Uniquement des ajouts : des colonnes facultatives et une table neuve.

-- AlterTable
ALTER TABLE "Versement" ADD COLUMN     "importCle" TEXT,
ADD COLUMN     "importLot" TEXT,
ADD COLUMN     "libelle" TEXT;
-- AlterTable
ALTER TABLE "MouvementPlacement" ADD COLUMN     "importCle" TEXT,
ADD COLUMN     "importLot" TEXT,
ADD COLUMN     "libelle" TEXT;
-- CreateTable
CREATE TABLE "PaiementCredit" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "libelle" TEXT,
    "membreId" TEXT,
    "importCle" TEXT,
    "importLot" TEXT,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaiementCredit_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "PaiementCredit_creditId_idx" ON "PaiementCredit"("creditId");
-- CreateIndex
CREATE UNIQUE INDEX "PaiementCredit_creditId_importCle_key" ON "PaiementCredit"("creditId", "importCle");
-- CreateIndex
CREATE UNIQUE INDEX "Versement_projetId_importCle_key" ON "Versement"("projetId", "importCle");
-- CreateIndex
CREATE UNIQUE INDEX "MouvementPlacement_placementId_importCle_key" ON "MouvementPlacement"("placementId", "importCle");
-- AddForeignKey
ALTER TABLE "PaiementCredit" ADD CONSTRAINT "PaiementCredit_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "Credit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "PaiementCredit" ADD CONSTRAINT "PaiementCredit_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

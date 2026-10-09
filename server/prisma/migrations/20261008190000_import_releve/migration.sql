-- Import de relevés bancaires dans le flux.
--
-- `importCle` est l'empreinte d'une opération importée ; son unicité par foyer
-- empêche les doublons quand un relevé est réimporté, même par deux requêtes
-- simultanées. `importLot` réunit les lignes d'un même import, pour l'annuler.
-- Les lignes saisies à la main gardent ces colonnes vides : Postgres n'applique
-- pas l'unicité aux valeurs nulles, elles ne sont donc pas concernées.

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "importCle" TEXT,
ADD COLUMN     "importLot" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_foyerId_importCle_key" ON "Transaction"("foyerId", "importCle");

-- AlterTable
ALTER TABLE "Versement" ADD COLUMN     "membreId" TEXT;

-- AddForeignKey
ALTER TABLE "Versement" ADD CONSTRAINT "Versement_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

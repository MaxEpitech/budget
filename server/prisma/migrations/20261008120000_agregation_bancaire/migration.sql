-- Agrégation bancaire facultative (GoCardless).
--
-- Les colonnes sont portées par le compte : chacun relie sa propre banque.
-- Aucun secret ni aucune opération bancaire n'est stocké — seulement les
-- identifiants de la liaison et les totaux de la dernière synchronisation,
-- gardés pour ne pas réinterroger la banque à chaque affichage.
--
-- Toutes sont facultatives ou ont une valeur par défaut : les comptes existants
-- restent en saisie manuelle, sans rien avoir à faire.

-- AlterTable
ALTER TABLE "Utilisateur" ADD COLUMN     "agregationActive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agregationSynchroLe" TIMESTAMP(3),
ADD COLUMN     "agregationSynthese" TEXT,
ADD COLUMN     "goCardlessAccountId" TEXT,
ADD COLUMN     "goCardlessRequisitionId" TEXT;

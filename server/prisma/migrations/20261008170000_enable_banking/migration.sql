-- Enable Banking, second prestataire bancaire possible pour un foyer.
--
-- Côté foyer : l'identifiant de son application et sa clé privée, celle-ci
-- chiffrée comme la clé GoCardless. Côté compte : les repères de sa liaison —
-- la valeur d'état d'une demande en cours, puis la session et le compte reliés.
-- Tout est facultatif : rien ne change pour les foyers existants.

-- AlterTable
ALTER TABLE "Foyer" ADD COLUMN     "enableBankingAppId" TEXT,
ADD COLUMN     "enableBankingClePriveeChiffre" TEXT;

-- AlterTable
ALTER TABLE "Utilisateur" ADD COLUMN     "enableBankingAccountId" TEXT,
ADD COLUMN     "enableBankingEtat" TEXT,
ADD COLUMN     "enableBankingSessionId" TEXT;

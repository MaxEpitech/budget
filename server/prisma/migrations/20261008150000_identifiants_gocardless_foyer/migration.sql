-- Identifiants GoCardless par foyer, saisis depuis l'interface.
--
-- La clé est stockée chiffrée (AES-256-GCM) avec une clé qui ne vit pas en
-- base : une copie de celle-ci ne suffit pas à la relire. Les deux colonnes
-- sont facultatives — un foyer sans identifiants reste en saisie manuelle, ou
-- se sert de ceux de l'installation s'il y en a.

-- AlterTable
ALTER TABLE "Foyer" ADD COLUMN     "goCardlessSecretId" TEXT,
ADD COLUMN     "goCardlessSecretKeyChiffre" TEXT;

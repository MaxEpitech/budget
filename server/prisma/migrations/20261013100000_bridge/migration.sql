-- Bridge, troisième prestataire bancaire possible pour un foyer.
--
-- Côté foyer : le Client ID de son application et son Client secret, celui-ci
-- chiffré comme les autres secrets. Côté compte : l'utilisateur Bridge propre à
-- ce compte, la valeur d'état d'une demande en cours, puis le compte relié.
-- Tout est facultatif : rien ne change pour les foyers existants.

-- AlterTable
ALTER TABLE "Foyer" ADD COLUMN     "bridgeClientId" TEXT,
ADD COLUMN     "bridgeClientSecretChiffre" TEXT;

-- AlterTable
ALTER TABLE "Utilisateur" ADD COLUMN     "bridgeAccountId" TEXT,
ADD COLUMN     "bridgeEtat" TEXT,
ADD COLUMN     "bridgeUserUuid" TEXT;

-- Récurrences datées et périodiques.
--
-- Sans début ni fin, une ligne récurrente valait pour l'éternité dans les deux
-- sens : résilier un abonnement l'effaçait aussi des mois passés, et changer
-- son prix réécrivait l'histoire. Le rythme, lui, était forcément mensuel — une
-- assurance annuelle devait être divisée par douze, ce qui faussait le reste à
-- vivre de chaque mois.
--
-- Purement additive : les lignes existantes deviennent mensuelles, sans début
-- ni fin, c'est-à-dire exactement ce qu'elles étaient déjà.

-- CreateEnum
CREATE TYPE "Periodicite" AS ENUM ('mensuel', 'trimestriel', 'semestriel', 'annuel');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "debut" TEXT,
ADD COLUMN     "fin" TEXT,
ADD COLUMN     "periodicite" "Periodicite" NOT NULL DEFAULT 'mensuel';


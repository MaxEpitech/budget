-- Dates réelles, horodatages, et sessions reconnaissables.
--
-- Générée telle quelle, cette migration échouerait : « modifieLe » est NOT NULL
-- sans valeur par défaut, et les tables contiennent déjà des lignes. Chaque
-- colonne est donc posée en trois temps — nullable, remplie, puis rendue
-- obligatoire — comme pour le cloisonnement par foyer.
--
-- La reprise des données est le point qui demandait du soin : les lignes
-- ponctuelles existantes reçoivent une date au premier jour de leur mois, seul
-- choix honnête quand le jour exact n'a jamais été saisi.

-- ── Sessions : de quoi reconnaître ses appareils ──
ALTER TABLE "Session" ADD COLUMN "appareil" TEXT;
ALTER TABLE "Session" ADD COLUMN "derniereActivite" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── Horodatages sur les tables métier ──
-- « modifieLe » reprend « creeLe » : sans historique, prétendre connaître une
-- date de modification antérieure serait inventer.
ALTER TABLE "Membre" ADD COLUMN "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Membre" ADD COLUMN "modifieLe" TIMESTAMP(3);
UPDATE "Membre" SET "modifieLe" = "creeLe" WHERE "modifieLe" IS NULL;
ALTER TABLE "Membre" ALTER COLUMN "modifieLe" SET NOT NULL;

ALTER TABLE "Credit" ADD COLUMN "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Credit" ADD COLUMN "modifieLe" TIMESTAMP(3);
UPDATE "Credit" SET "modifieLe" = "creeLe" WHERE "modifieLe" IS NULL;
ALTER TABLE "Credit" ALTER COLUMN "modifieLe" SET NOT NULL;

ALTER TABLE "Projet" ADD COLUMN "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Projet" ADD COLUMN "modifieLe" TIMESTAMP(3);
UPDATE "Projet" SET "modifieLe" = "creeLe" WHERE "modifieLe" IS NULL;
ALTER TABLE "Projet" ALTER COLUMN "modifieLe" SET NOT NULL;

ALTER TABLE "Placement" ADD COLUMN "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Placement" ADD COLUMN "modifieLe" TIMESTAMP(3);
UPDATE "Placement" SET "modifieLe" = "creeLe" WHERE "modifieLe" IS NULL;
ALTER TABLE "Placement" ALTER COLUMN "modifieLe" SET NOT NULL;

-- Le versement portait déjà sa date ; sa création remonte donc à ce moment-là.
ALTER TABLE "Versement" ADD COLUMN "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Versement" SET "creeLe" = "date";

-- ── Transactions : date réelle, et horodatages ──
ALTER TABLE "Transaction" ADD COLUMN "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Transaction" ADD COLUMN "modifieLe" TIMESTAMP(3);
ALTER TABLE "Transaction" ADD COLUMN "date" TIMESTAMP(3);

UPDATE "Transaction" SET "modifieLe" = "creeLe" WHERE "modifieLe" IS NULL;
ALTER TABLE "Transaction" ALTER COLUMN "modifieLe" SET NOT NULL;

-- Les lignes ponctuelles reçoivent le premier jour de leur mois. Les lignes
-- récurrentes n'ont pas de date : elles reviennent tous les mois, elles
-- n'arrivent pas un jour précis.
UPDATE "Transaction"
SET "date" = TO_TIMESTAMP("mois" || '-01', 'YYYY-MM-DD')
WHERE "mois" IS NOT NULL AND "date" IS NULL;

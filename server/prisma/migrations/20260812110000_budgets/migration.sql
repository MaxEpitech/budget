-- Budgets par catégorie.
--
-- Une enveloppe mensuelle par catégorie, comparée aux dépenses réellement
-- tombées sur le mois. L'unicité par foyer et catégorie est portée par la base :
-- deux budgets concurrents sur « Courses » ne voudraient rien dire, et une règle
-- tenue seulement en code finit toujours par être contournée.

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "foyerId" INTEGER NOT NULL,
    "categorie" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modifieLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_foyerId_idx" ON "Budget"("foyerId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_foyerId_categorie_key" ON "Budget"("foyerId", "categorie");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


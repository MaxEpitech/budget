-- CreateTable
CREATE TABLE "LimiteCadence" (
    "cle" TEXT NOT NULL,
    "compteur" INTEGER NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LimiteCadence_pkey" PRIMARY KEY ("cle")
);

-- CreateIndex
CREATE INDEX "LimiteCadence_expireLe_idx" ON "LimiteCadence"("expireLe");

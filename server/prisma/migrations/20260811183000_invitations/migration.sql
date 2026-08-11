-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "foyerId" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "role" "RoleFoyer" NOT NULL DEFAULT 'membre',
    "membreId" TEXT,
    "jetonHache" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "utiliseLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_jetonHache_key" ON "Invitation"("jetonHache");

-- CreateIndex
CREATE INDEX "Invitation_foyerId_idx" ON "Invitation"("foyerId");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_membreId_fkey" FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;


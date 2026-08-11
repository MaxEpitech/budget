-- Cloisonnement par foyer + tables d'authentification.
--
-- Migration écrite à la main : générée telle quelle, elle échouerait sur les
-- tables déjà remplies. Chaque colonne foyerId est donc posée en trois temps —
-- ajoutée nullable, remplie avec le foyer existant, puis rendue obligatoire —
-- afin qu'aucune ligne déjà en base ne soit perdue.

-- ── 1. Garantir qu'un foyer existe pour accueillir les données déjà en base ──
INSERT INTO "Foyer" ("id", "repartition")
SELECT 1, 'prorata'::"Repartition"
WHERE NOT EXISTS (SELECT 1 FROM "Foyer");

-- ── 2. Foyer.id devient auto-incrémenté, la séquence reprend après l'existant ──
CREATE SEQUENCE foyer_id_seq;
ALTER TABLE "Foyer" ALTER COLUMN "id" SET DEFAULT nextval('foyer_id_seq');
ALTER SEQUENCE foyer_id_seq OWNED BY "Foyer"."id";
SELECT setval('foyer_id_seq', (SELECT MAX("id") FROM "Foyer"));

-- ── 3. Rattachement des tables métier au foyer existant ──
-- Membre
ALTER TABLE "Membre" ADD COLUMN "foyerId" INTEGER;
UPDATE "Membre" SET "foyerId" = (SELECT MIN("id") FROM "Foyer") WHERE "foyerId" IS NULL;
ALTER TABLE "Membre" ALTER COLUMN "foyerId" SET NOT NULL;

-- Transaction
ALTER TABLE "Transaction" ADD COLUMN "foyerId" INTEGER;
UPDATE "Transaction" SET "foyerId" = (SELECT MIN("id") FROM "Foyer") WHERE "foyerId" IS NULL;
ALTER TABLE "Transaction" ALTER COLUMN "foyerId" SET NOT NULL;

-- Credit
ALTER TABLE "Credit" ADD COLUMN "foyerId" INTEGER;
UPDATE "Credit" SET "foyerId" = (SELECT MIN("id") FROM "Foyer") WHERE "foyerId" IS NULL;
ALTER TABLE "Credit" ALTER COLUMN "foyerId" SET NOT NULL;

-- Projet
ALTER TABLE "Projet" ADD COLUMN "foyerId" INTEGER;
UPDATE "Projet" SET "foyerId" = (SELECT MIN("id") FROM "Foyer") WHERE "foyerId" IS NULL;
ALTER TABLE "Projet" ALTER COLUMN "foyerId" SET NOT NULL;

-- Placement
ALTER TABLE "Placement" ADD COLUMN "foyerId" INTEGER;
UPDATE "Placement" SET "foyerId" = (SELECT MIN("id") FROM "Foyer") WHERE "foyerId" IS NULL;
ALTER TABLE "Placement" ALTER COLUMN "foyerId" SET NOT NULL;

-- ── 4. Tables d'authentification ──
CREATE TYPE "TypeJeton" AS ENUM ('validation', 'reinitialisation');

CREATE TABLE "Utilisateur" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "motDePasseHash" TEXT NOT NULL,
    "emailValideLe" TIMESTAMP(3),
    "foyerId" INTEGER NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Utilisateur_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Jeton" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "type" "TypeJeton" NOT NULL,
    "jetonHache" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "utiliseLe" TIMESTAMP(3),
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Jeton_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "utilisateurId" TEXT NOT NULL,
    "jetonHache" TEXT NOT NULL,
    "expireLe" TIMESTAMP(3) NOT NULL,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- ── 5. Index ──
CREATE UNIQUE INDEX "Utilisateur_email_key" ON "Utilisateur"("email");
CREATE UNIQUE INDEX "Utilisateur_foyerId_key" ON "Utilisateur"("foyerId");
CREATE UNIQUE INDEX "Jeton_jetonHache_key" ON "Jeton"("jetonHache");
CREATE INDEX "Jeton_utilisateurId_idx" ON "Jeton"("utilisateurId");
CREATE UNIQUE INDEX "Session_jetonHache_key" ON "Session"("jetonHache");
CREATE INDEX "Session_utilisateurId_idx" ON "Session"("utilisateurId");
CREATE INDEX "Membre_foyerId_idx" ON "Membre"("foyerId");
CREATE INDEX "Transaction_foyerId_idx" ON "Transaction"("foyerId");
CREATE INDEX "Credit_foyerId_idx" ON "Credit"("foyerId");
CREATE INDEX "Projet_foyerId_idx" ON "Projet"("foyerId");
CREATE INDEX "Placement_foyerId_idx" ON "Placement"("foyerId");

-- ── 6. Clés étrangères ──
ALTER TABLE "Utilisateur" ADD CONSTRAINT "Utilisateur_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Jeton" ADD CONSTRAINT "Jeton_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Credit" ADD CONSTRAINT "Credit_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Projet" ADD CONSTRAINT "Projet_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Placement" ADD CONSTRAINT "Placement_foyerId_fkey" FOREIGN KEY ("foyerId") REFERENCES "Foyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

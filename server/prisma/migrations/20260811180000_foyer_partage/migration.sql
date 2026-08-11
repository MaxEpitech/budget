-- Ouverture du foyer à plusieurs comptes.
--
-- L'application est bâtie autour de deux revenus, d'une quote-part et d'un
-- « qui paie quoi », mais une contrainte d'unicité n'autorisait qu'une seule
-- personne à s'y connecter. La lever est le cœur de cette migration.
--
-- Purement additive : aucune donnée n'est déplacée ni supprimée. Les comptes
-- existants deviennent propriétaires de leur foyer, ce qu'ils étaient déjà de
-- fait, et le lien vers un membre du budget reste facultatif.

-- CreateEnum
CREATE TYPE "RoleFoyer" AS ENUM ('proprietaire', 'membre');

-- DropIndex
DROP INDEX "Utilisateur_foyerId_key";

-- AlterTable
ALTER TABLE "Membre" ADD COLUMN     "utilisateurId" TEXT;

-- AlterTable
ALTER TABLE "Utilisateur" ADD COLUMN     "role" "RoleFoyer" NOT NULL DEFAULT 'proprietaire';

-- CreateIndex
CREATE UNIQUE INDEX "Membre_utilisateurId_key" ON "Membre"("utilisateurId");

-- CreateIndex
CREATE INDEX "Utilisateur_foyerId_idx" ON "Utilisateur"("foyerId");

-- AddForeignKey
ALTER TABLE "Membre" ADD CONSTRAINT "Membre_utilisateurId_fkey" FOREIGN KEY ("utilisateurId") REFERENCES "Utilisateur"("id") ON DELETE SET NULL ON UPDATE CASCADE;


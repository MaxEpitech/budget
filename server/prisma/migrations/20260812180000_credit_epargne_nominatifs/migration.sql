-- À qui appartient un crédit, à qui appartient un support d'épargne.
--
-- Les dépenses savaient déjà le dire : « pour le foyer » ou « pour untel ».
-- Les crédits et les placements, non — ils étaient tous communs. Un prêt
-- étudiant contracté par une seule personne se retrouvait donc partagé au
-- prorata des revenus, et le reste à vivre de chacun s'en trouvait faussé.
--
-- NULL vaut « le foyer », comme pour les transactions : les lignes existantes
-- gardent exactement le comportement qu'elles avaient.
--
-- ON DELETE SET NULL et non CASCADE : supprimer une personne du foyer ne doit
-- pas emporter son crédit, qui reste dû. Il redevient simplement commun.

ALTER TABLE "Credit" ADD COLUMN "membreId" TEXT;
ALTER TABLE "Placement" ADD COLUMN "membreId" TEXT;

CREATE INDEX "Credit_membreId_idx" ON "Credit"("membreId");
CREATE INDEX "Placement_membreId_idx" ON "Placement"("membreId");

ALTER TABLE "Credit" ADD CONSTRAINT "Credit_membreId_fkey"
    FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Placement" ADD CONSTRAINT "Placement_membreId_fkey"
    FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

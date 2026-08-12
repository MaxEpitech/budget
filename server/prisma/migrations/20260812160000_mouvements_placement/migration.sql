-- Mouvements d'un support d'épargne.
--
-- Jusqu'ici la valeur d'un placement s'écrasait : la nouvelle remplaçait
-- l'ancienne, et rien ne restait de ce qui s'était passé entre les deux. Le
-- budget affichait pourtant « Épargne 150 € » tous les mois — une intention que
-- rien ne vérifiait. Un foyer pouvait croire épargner depuis six mois sans
-- qu'un euro ait bougé.
--
-- La table enregistre les actes délibérés : ce qu'on verse, ce qu'on retire.
-- Pas les intérêts, qui ne sont l'acte de personne et se lisent dans l'écart
-- entre la valeur du support et la somme des mouvements.
--
-- « valeurApres » fige ce que valait le support juste après le mouvement.
-- Recalculer cette valeur plus tard serait impossible : la valeur bouge aussi
-- sans mouvement, quand la banque verse ses intérêts.
--
-- Pas de foyerId ici : le cloisonnement passe par le placement, comme celui des
-- versements passe par le projet. Une colonne de plus serait une seconde vérité
-- à tenir d'accord avec la première.

CREATE TABLE "MouvementPlacement" (
    "id" TEXT NOT NULL,
    "placementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "montant" INTEGER NOT NULL,
    "valeurApres" INTEGER NOT NULL,
    "membreId" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementPlacement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MouvementPlacement_placementId_idx" ON "MouvementPlacement"("placementId");

ALTER TABLE "MouvementPlacement" ADD CONSTRAINT "MouvementPlacement_placementId_fkey"
    FOREIGN KEY ("placementId") REFERENCES "Placement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MouvementPlacement" ADD CONSTRAINT "MouvementPlacement_membreId_fkey"
    FOREIGN KEY ("membreId") REFERENCES "Membre"("id") ON DELETE SET NULL ON UPDATE CASCADE;

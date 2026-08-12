-- Assurance emprunteur.
--
-- Une mensualité de crédit sans son assurance n'est pas ce qui est prélevé, et
-- le taux d'endettement qui en découle n'est pas celui que calcule une banque :
-- elle compte l'assurance. Deux colonnes suffisent à la décrire.
--
-- « assuranceBase » dit sur quoi porte le taux :
--   'initial' — sur le capital emprunté, cotisation constante sur toute la
--               durée. C'est le cas le plus répandu en prêt immobilier.
--   'restant' — sur le capital restant dû, cotisation décroissante.
-- Les deux existent, et l'écart entre elles atteint le double sur 25 ans :
-- choisir l'une par défaut sans permettre l'autre aurait faussé le calcul pour
-- la moitié des emprunteurs.
--
-- Un taux à zéro reproduit exactement le comportement d'avant cette migration :
-- aucun crédit existant ne change de valeur.

ALTER TABLE "Credit" ADD COLUMN "assuranceTaux" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Credit" ADD COLUMN "assuranceBase" TEXT NOT NULL DEFAULT 'initial';

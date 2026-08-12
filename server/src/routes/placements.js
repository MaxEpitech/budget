import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider, modifierDansFoyer, supprimerDansFoyer } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { PlacementSchema, PlacementPartielSchema, MouvementSchema } from "../schemas.js";
import { placementVersApi, placementVersDb, mouvementVersApi, enCentimes } from "../conversion.js";

const routeur = Router();

// Toujours servir les mouvements avec le support : leur somme dit ce qui a
// réellement été mis de côté, là où la valeur comprend aussi les intérêts.
const avecMouvements = { mouvements: { orderBy: { date: "desc" } } };

routeur.get("/", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const placements = await prisma.placement.findMany({ where: { foyerId }, include: avecMouvements, orderBy: { id: "asc" } });
  res.json(placements.map(placementVersApi));
}));

routeur.post("/", valider(PlacementSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const placement = await prisma.placement.create({ data: { ...placementVersDb(req.donnees), foyerId }, include: avecMouvements });
  res.status(201).json(placementVersApi(placement));
}));

routeur.put("/:id", valider(PlacementPartielSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const modifie = await modifierDansFoyer(res, "Placement", prisma.placement, req.params.id, foyerId, placementVersDb(req.donnees));
  if (!modifie) return;
  const placement = await prisma.placement.findUnique({ where: { id: modifie.id }, include: avecMouvements });
  res.json(placementVersApi(placement));
}));

routeur.delete("/:id", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  // Les mouvements suivent (CASCADE en base).
  if (await supprimerDansFoyer(res, "Placement", prisma.placement, req.params.id, foyerId)) res.status(204).end();
}));

/**
 * Verser sur un support, ou en retirer.
 *
 * Le mouvement et la valeur du support bougent ensemble, dans une transaction :
 * un mouvement enregistré sans que la valeur suive laisserait l'historique
 * raconter autre chose que le solde.
 *
 * Un versement qui ferait passer au-dessus du plafond est refusé plutôt que
 * rogné : la banque le refuserait aussi, et tronquer en silence donnerait un
 * historique qui ne correspond à aucune opération réelle.
 */
routeur.post("/:id/mouvements", valider(MouvementSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const placement = await prisma.placement.findFirst({ where: { id: req.params.id, foyerId } });
  if (!placement) return res.status(404).json({ erreur: "Placement introuvable" });

  // `pour` doit désigner "foyer" ou un membre du foyer courant.
  const { pour, type } = req.donnees;
  if (pour !== "foyer" && !(await prisma.membre.findFirst({ where: { id: pour, foyerId } }))) {
    return res.status(400).json({ erreur: "pour : membre inconnu" });
  }

  const montant = enCentimes(req.donnees.montant);
  const signe = type === "retrait" ? -1 : 1;
  const valeurApres = placement.valeur + signe * montant;

  if (valeurApres < 0) {
    return res.status(400).json({ erreur: "Ce retrait dépasse la valeur du support." });
  }
  if (type === "versement" && placement.plafond != null && valeurApres > placement.plafond) {
    return res.status(400).json({ erreur: "Ce versement dépasserait le plafond du support." });
  }

  const [mouvement] = await prisma.$transaction([
    prisma.mouvementPlacement.create({
      data: {
        placementId: placement.id,
        type,
        montant,
        valeurApres,
        membreId: pour === "foyer" ? null : pour,
      },
    }),
    prisma.placement.update({ where: { id: placement.id }, data: { valeur: valeurApres } }),
  ]);
  res.status(201).json(mouvementVersApi(mouvement));
}));

/**
 * Retirer un mouvement de l'historique.
 *
 * Son effet est retiré de la valeur en même temps : un mouvement qui n'a jamais
 * eu lieu n'a jamais rien déposé. Si la valeur a été corrigée depuis, elle reste
 * modifiable à la main — c'est le comportement le moins surprenant des deux.
 *
 * Le filtre porte sur le placement ET le foyer : un identifiant venu d'ailleurs
 * se comporte exactement comme un identifiant inexistant.
 */
routeur.delete("/:id/mouvements/:mouvementId", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const mouvement = await prisma.mouvementPlacement.findFirst({
    where: { id: req.params.mouvementId, placementId: req.params.id, placement: { foyerId } },
    include: { placement: true },
  });
  if (!mouvement) return res.status(404).json({ erreur: "Mouvement introuvable" });

  const signe = mouvement.type === "retrait" ? 1 : -1;
  const valeur = Math.max(0, mouvement.placement.valeur + signe * mouvement.montant);

  await prisma.$transaction([
    prisma.mouvementPlacement.delete({ where: { id: mouvement.id } }),
    prisma.placement.update({ where: { id: mouvement.placementId }, data: { valeur } }),
  ]);
  res.status(204).end();
}));

export default routeur;

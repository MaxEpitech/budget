import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { FoyerSchema } from "../schemas.js";

const routeur = Router();

// Mode de répartition des charges communes du foyer courant.
routeur.put("/", valider(FoyerSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const foyer = await prisma.foyer.update({
    where: { id: foyerId },
    data: { repartition: req.donnees.repartition },
  });
  res.json({ repartition: foyer.repartition });
}));

export default routeur;

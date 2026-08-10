import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { FoyerSchema } from "../schemas.js";

const routeur = Router();

// Mode de répartition des charges communes — enregistrement unique (id = 1).
routeur.put("/", valider(FoyerSchema), attraper(async (req, res) => {
  const foyer = await prisma.foyer.upsert({
    where: { id: 1 },
    update: { repartition: req.donnees.repartition },
    create: { id: 1, repartition: req.donnees.repartition },
  });
  res.json({ repartition: foyer.repartition });
}));

export default routeur;

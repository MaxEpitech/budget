// Schémas de validation des entrées (Zod v4), messages en français
// directement affichables côté UI.
import { z } from "zod";

export const MoisSchema = z
  .string("mois : format YYYY-MM attendu")
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "mois : format YYYY-MM attendu");

const chaine = (champ) => z.string(`${champ} : texte requis`).trim().min(1, `${champ} requis`);
const nombre = (champ) => z.number(`${champ} : nombre requis`);
const montantPositif = (champ) => nombre(champ).positive(`${champ} : doit être supérieur à 0`);
const positifOuNul = (champ) => nombre(champ).min(0, `${champ} : doit être positif ou nul`);

export const MembreSchema = z.object({
  nom: chaine("nom"),
  revenu: positifOuNul("revenu"),
});
export const MembrePartielSchema = MembreSchema.partial();

export const TransactionSchema = z
  .object({
    type: z.enum(["revenu", "depense"], "type : « revenu » ou « depense » attendu"),
    libelle: chaine("libellé"),
    montant: montantPositif("montant"),
    categorie: chaine("catégorie"),
    pour: chaine("pour").default("foyer"),
    recurrent: z.boolean("recurrent : booléen attendu").default(false),
    mois: MoisSchema.nullish(),
  })
  .superRefine((d, ctx) => {
    if (!d.recurrent && !d.mois) {
      ctx.addIssue({ code: "custom", path: ["mois"], message: "mois requis pour une ligne ponctuelle (format YYYY-MM)" });
    }
  });

export const CreditSchema = z.object({
  libelle: chaine("libellé"),
  capital: montantPositif("capital"),
  taux: positifOuNul("taux"),
  duree: nombre("durée").int("durée : nombre entier de mois attendu").positive("durée : doit être supérieure à 0"),
  debut: MoisSchema,
});

export const ProjetSchema = z.object({
  libelle: chaine("libellé"),
  objectif: montantPositif("objectif"),
  echeance: MoisSchema,
  versement: positifOuNul("versement"),
});
export const ProjetPartielSchema = ProjetSchema.partial();

export const VersementSchema = z.object({
  montant: montantPositif("montant"),
});

export const PlacementSchema = z.object({
  libelle: chaine("libellé"),
  valeur: positifOuNul("valeur"),
  versement: positifOuNul("versement"),
  rendement: nombre("rendement"),
});
export const PlacementPartielSchema = PlacementSchema.partial();

export const FoyerSchema = z.object({
  repartition: z.enum(["prorata", "moitie"], "repartition : « prorata » ou « moitie » attendu"),
});

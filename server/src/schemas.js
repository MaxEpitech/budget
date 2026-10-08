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
    // Jour réel de l'opération. Facultatif : le premier du mois fait foi à défaut.
    date: z.iso.datetime({ offset: true }).or(z.iso.date()).nullish(),
    // Rythme d'une ligne récurrente, et sa période de validité.
    periodicite: z.enum(["mensuel", "trimestriel", "semestriel", "annuel"], "périodicité inconnue").default("mensuel"),
    debut: MoisSchema.nullish(),
    fin: MoisSchema.nullish(),
  })
  .superRefine((d, ctx) => {
    if (!d.recurrent && !d.mois) {
      ctx.addIssue({ code: "custom", path: ["mois"], message: "mois requis pour une ligne ponctuelle (format YYYY-MM)" });
    }
    // Un rythme non mensuel a besoin d'un ancrage : sans mois de départ, on ne
    // saurait pas quand tombe la première échéance.
    if (d.recurrent && d.periodicite !== "mensuel" && !d.debut) {
      ctx.addIssue({ code: "custom", path: ["debut"], message: "premier prélèvement requis pour un rythme autre que mensuel" });
    }
    if (d.recurrent && d.debut && d.fin && d.fin < d.debut) {
      ctx.addIssue({ code: "custom", path: ["fin"], message: "la fin ne peut pas précéder le début" });
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
  // Qui a mis au pot : "foyer" par défaut, ou l'id d'un membre.
  pour: chaine("pour").default("foyer"),
});

export const PlacementSchema = z.object({
  libelle: chaine("libellé"),
  valeur: positifOuNul("valeur"),
  versement: positifOuNul("versement"),
  rendement: nombre("rendement"),
  // Plafond de versements ; null ou absent = pas de plafond.
  plafond: montantPositif("plafond").nullish(),
});
export const PlacementPartielSchema = PlacementSchema.partial();

export const FoyerSchema = z.object({
  repartition: z.enum(["prorata", "moitie"], "repartition : « prorata » ou « moitie » attendu"),
});

export const BudgetSchema = z.object({
  categorie: chaine("catégorie"),
  // Un budget nul n'a pas de sens : pour ne plus rien s'autoriser, on supprime
  // l'enveloppe plutôt que de la mettre à zéro.
  montant: montantPositif("montant"),
});

/* ─── Relevé bancaire importé ─── */

// Le contenu du fichier, déjà décodé en texte par le navigateur.
export const ReleveSchema = z.object({
  nom: z.string().trim().max(200).optional(),
  contenu: z.string("fichier requis").min(1, "Le fichier est vide.").max(3_000_000, "Fichier trop volumineux : exportez une période plus courte."),
});

// Les opérations retenues dans l'aperçu, renvoyées pour entrer dans le flux.
export const ImportTransactionsSchema = z.object({
  pour: chaine("pour").default("foyer"),
  operations: z
    .array(
      z.object({
        cle: z.string("clé requise").regex(/^[0-9a-f]{32}$/, "clé d'opération invalide"),
        date: z.iso.date("date : format AAAA-MM-JJ attendu"),
        type: z.enum(["revenu", "depense"], "type : « revenu » ou « depense » attendu"),
        libelle: chaine("libellé").max(200, "libellé trop long"),
        montant: montantPositif("montant"),
        categorie: chaine("catégorie").max(60, "catégorie trop longue"),
      }),
      "opérations requises",
    )
    .min(1, "Aucune opération à importer.")
    .max(2000, "Trop d'opérations d'un coup : importez une période plus courte."),
});

/* ─── Agrégation bancaire ─── */

export const InitierAgregationSchema = z.object({
  // Identifiant de banque tel que le prestataire le donne : « BNP_PARIBAS_BNPAFRPP »
  // chez GoCardless, « FR:BNP Paribas » chez Enable Banking.
  institutionId: chaine("banque").max(200, "banque : identifiant trop long"),
});

// Ce que la banque ajoute à l'adresse de retour (Enable Banking). Tout est
// facultatif : GoCardless ne renvoie rien d'utile, on l'interroge directement.
export const RetourBanqueSchema = z.object({
  code: z.string().max(2000).optional(),
  state: z.string().max(500).optional(),
  error: z.string().max(200).optional(),
});

// Identifiants GoCardless d'un foyer, tels que le portail les délivre.
const secret = (champ) =>
  z.string(`${champ} requis`).trim().min(8, `${champ} : valeur trop courte`).max(300, `${champ} : valeur trop longue`);

// Un jeu d'identifiants par prestataire. Sans `fournisseur`, c'est GoCardless :
// la forme d'origine de cette route reste acceptée.
export const IdentifiantsAgregationSchema = z.preprocess(
  (d) => (d && typeof d === "object" && d.fournisseur === undefined ? { ...d, fournisseur: "gocardless" } : d),
  z.discriminatedUnion(
    "fournisseur",
    [
      z.object({
        fournisseur: z.literal("gocardless"),
        secretId: secret("Secret ID"),
        secretKey: secret("Secret key"),
      }),
      z.object({
        fournisseur: z.literal("enablebanking"),
        appId: secret("identifiant d'application").max(100, "identifiant d'application : valeur trop longue"),
        // Fichier .pem entier ; une clé RSA de 4096 bits tient en 3 300 caractères.
        clePrivee: z.string("clé privée requise").trim().min(100, "clé privée : contenu trop court").max(10000, "clé privée : contenu trop long"),
      }),
    ],
    "prestataire : « gocardless » ou « enablebanking » attendu",
  ),
);

export const ActiverAgregationSchema = z.object({
  active: z.boolean("active : booléen attendu"),
});

const RoleValeur = z.enum(["proprietaire", "membre"], "rôle : « proprietaire » ou « membre » attendu");

export const RoleSchema = z.object({ role: RoleValeur });

/* ─── Authentification ─────────────────────────────────────────────────────
   L'adresse est normalisée dès la validation (espaces retirés, minuscules) :
   c'est la seule forme qui atteint la base, ce qui garantit qu'on ne peut pas
   créer deux comptes pour « Alex@… » et « alex@… ». */

export const EmailSchema = z
  .string("email : adresse requise")
  .trim()
  .toLowerCase()
  .pipe(z.email("email : adresse invalide"))
  .refine((v) => v.length <= 254, "email : adresse trop longue");

// Longueur plutôt que règles de composition : une phrase de passe vaut mieux
// qu'un « P@ssw0rd ». Le maximum protège du déni de service par hachage.
export const MotDePasseSchema = z
  .string("mot de passe requis")
  .min(12, "mot de passe : 12 caractères minimum")
  .max(200, "mot de passe : 200 caractères maximum");

export const InscriptionSchema = z.object({
  email: EmailSchema,
  motDePasse: MotDePasseSchema,
});

export const ConnexionSchema = z.object({
  email: EmailSchema,
  // Pas de contrainte de longueur ici : un mot de passe trop court est
  // simplement faux, l'annoncer autrement renseignerait sur la politique.
  motDePasse: z.string("mot de passe requis").max(200),
});

export const EmailSeulSchema = z.object({ email: EmailSchema });

export const InvitationSchema = z.object({
  email: EmailSchema,
  // Membre par défaut : on n'accorde pas les pleins pouvoirs sans le vouloir.
  role: RoleValeur.default("membre"),
  // Le membre du budget que la personne incarnera, si on le désigne d'avance.
  membreId: z.string().nullish(),
});

export const AccepterInvitationSchema = z.object({
  jeton: z.string("jeton requis").min(1, "jeton requis"),
  // Absent quand un compte existe déjà : on rattache alors le compte connecté.
  motDePasse: MotDePasseSchema.optional(),
});

export const JetonSchema = z.object({
  jeton: z.string("jeton requis").min(1, "jeton requis"),
});

// Le mot de passe est redemandé avant de supprimer le compte. Aucune contrainte
// de longueur : un mot de passe trop court est simplement faux.
export const SuppressionCompteSchema = z.object({
  motDePasse: z.string("mot de passe requis").max(200),
});

export const ReinitialisationSchema = z.object({
  jeton: z.string("jeton requis").min(1, "jeton requis"),
  motDePasse: MotDePasseSchema,
});

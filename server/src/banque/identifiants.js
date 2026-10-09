// D'où viennent les identifiants bancaires d'un foyer, et chez quel prestataire.
//
// Trois sources, dans cet ordre :
//   1. l'application Enable Banking du foyer, saisie dans l'interface ;
//   2. les identifiants GoCardless du foyer, saisis dans l'interface ;
//   3. à défaut, les identifiants GoCardless de l'installation (variables
//      GOCARDLESS_SECRET_ID et GOCARDLESS_SECRET_KEY), s'il y en a.
//
// Un foyer n'a qu'un prestataire à la fois : en enregistrer un efface l'autre.
// Aucune source : la synchronisation n'est pas proposée à ce foyer.
//
// Ce qui est secret — la clé GoCardless, la clé privée Enable Banking — est
// chiffré en base ; les identifiants publics qui les accompagnent ne le sont pas.
import { prisma } from "../db.js";
import { chiffrer, dechiffrer } from "./chiffrement.js";

const deLInstallation = () => {
  const secretId = process.env.GOCARDLESS_SECRET_ID || "";
  const secretKey = process.env.GOCARDLESS_SECRET_KEY || "";
  return secretId && secretKey ? { fournisseur: "gocardless", secretId, secretKey, source: "installation" } : null;
};

const AUCUN = {
  goCardlessSecretId: null,
  goCardlessSecretKeyChiffre: null,
  enableBankingAppId: null,
  enableBankingClePriveeChiffre: null,
};

/**
 * Identifiants à utiliser pour ce foyer, ou null.
 *
 * Un secret devenu illisible — clé de chiffrement changée depuis — est traité
 * comme absent : mieux vaut « non configuré » qu'un appel voué à l'échec.
 *
 * @returns {Promise<
 *   | { fournisseur: "enablebanking", appId: string, clePrivee: string, source: "foyer" }
 *   | { fournisseur: "gocardless", secretId: string, secretKey: string, source: "foyer" | "installation" }
 *   | null>}
 */
export async function identifiantsDuFoyer(foyerId) {
  const foyer = await prisma.foyer.findUnique({ where: { id: foyerId }, select: Object.fromEntries(Object.keys(AUCUN).map((c) => [c, true])) });

  if (foyer?.enableBankingAppId && foyer.enableBankingClePriveeChiffre) {
    const clePrivee = dechiffrer(foyer.enableBankingClePriveeChiffre);
    if (clePrivee) return { fournisseur: "enablebanking", appId: foyer.enableBankingAppId, clePrivee, source: "foyer" };
  }
  if (foyer?.goCardlessSecretId && foyer.goCardlessSecretKeyChiffre) {
    const secretKey = dechiffrer(foyer.goCardlessSecretKeyChiffre);
    if (secretKey) return { fournisseur: "gocardless", secretId: foyer.goCardlessSecretId, secretKey, source: "foyer" };
  }
  return deLInstallation();
}

/** Enregistre les identifiants d'un prestataire, et efface ceux de l'autre. */
export const enregistrerIdentifiants = (foyerId, d) =>
  prisma.foyer.update({
    where: { id: foyerId },
    data:
      d.fournisseur === "enablebanking"
        ? { ...AUCUN, enableBankingAppId: d.appId, enableBankingClePriveeChiffre: chiffrer(d.clePrivee) }
        : { ...AUCUN, goCardlessSecretId: d.secretId, goCardlessSecretKeyChiffre: chiffrer(d.secretKey) },
  });

export const effacerIdentifiants = (foyerId) => prisma.foyer.update({ where: { id: foyerId }, data: AUCUN });

/** L'identifiant public d'un jeu d'identifiants : celui qu'on peut montrer, masqué. */
export const identifiantPublic = (identifiants) => identifiants.appId ?? identifiants.secretId;

/** Ne laisse voir que la fin : assez pour reconnaître le sien, pas pour le réutiliser. */
export const masquer = (identifiant) => `••••${String(identifiant).slice(-4)}`;

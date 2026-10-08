// D'où viennent les identifiants GoCardless d'un foyer.
//
// Deux sources, dans cet ordre :
//   1. ceux que le propriétaire du foyer a saisis dans l'interface, chiffrés
//      en base — chaque foyer parle alors à GoCardless avec son propre compte ;
//   2. à défaut, ceux de l'installation (variables GOCARDLESS_SECRET_ID et
//      GOCARDLESS_SECRET_KEY), s'il y en a.
//
// Aucune des deux : la synchronisation n'est pas proposée à ce foyer.
import { prisma } from "../db.js";
import { chiffrer, dechiffrer } from "./chiffrement.js";

const deLInstallation = () => {
  const secretId = process.env.GOCARDLESS_SECRET_ID || "";
  const secretKey = process.env.GOCARDLESS_SECRET_KEY || "";
  return secretId && secretKey ? { secretId, secretKey, source: "installation" } : null;
};

/**
 * Identifiants à utiliser pour ce foyer, ou null.
 * @returns {Promise<{ secretId: string, secretKey: string, source: "foyer" | "installation" } | null>}
 */
export async function identifiantsDuFoyer(foyerId) {
  const foyer = await prisma.foyer.findUnique({
    where: { id: foyerId },
    select: { goCardlessSecretId: true, goCardlessSecretKeyChiffre: true },
  });
  if (foyer?.goCardlessSecretId && foyer.goCardlessSecretKeyChiffre) {
    const secretKey = dechiffrer(foyer.goCardlessSecretKeyChiffre);
    // Clé de chiffrement changée depuis l'enregistrement : illisibles, donc absents.
    if (secretKey) return { secretId: foyer.goCardlessSecretId, secretKey, source: "foyer" };
  }
  return deLInstallation();
}

export const enregistrerIdentifiants = (foyerId, { secretId, secretKey }) =>
  prisma.foyer.update({
    where: { id: foyerId },
    data: { goCardlessSecretId: secretId, goCardlessSecretKeyChiffre: chiffrer(secretKey) },
  });

export const effacerIdentifiants = (foyerId) =>
  prisma.foyer.update({
    where: { id: foyerId },
    data: { goCardlessSecretId: null, goCardlessSecretKeyChiffre: null },
  });

/** Ne laisse voir que la fin : assez pour reconnaître le sien, pas pour le réutiliser. */
export const masquer = (secretId) => `••••${String(secretId).slice(-4)}`;

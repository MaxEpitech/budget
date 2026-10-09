// Chiffrement des secrets confiés par les foyers (identifiants GoCardless).
//
// Contrairement aux mots de passe et aux jetons, ces secrets ne peuvent pas
// être réduits à une empreinte : il faut pouvoir les relire pour parler à
// GoCardless. Ils sont donc chiffrés (AES-256-GCM), avec une clé qui ne vit
// PAS dans la base — sans quoi une copie de celle-ci suffirait à tout lire.
//
// La clé vient de la variable CLE_CHIFFREMENT, posée une fois sur l'hébergeur.
// La changer rend illisibles les secrets déjà enregistrés : les foyers devront
// les ressaisir.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";
const LONGUEUR_MINIMALE = 32;

const cleBrute = () => String(process.env.CLE_CHIFFREMENT ?? "").trim();

/** Une clé de chiffrement utilisable est-elle configurée ? */
export const chiffrementDisponible = () => cleBrute().length >= LONGUEUR_MINIMALE;

// La variable est une phrase quelconque d'au moins 32 caractères ; SHA-256 la
// ramène aux 32 octets qu'attend AES-256, quel que soit son format.
const cle = () => {
  if (!chiffrementDisponible()) throw new Error("CLE_CHIFFREMENT absente ou trop courte");
  return createHash("sha256").update(cleBrute()).digest();
};

/** Chiffre un texte. Le résultat porte tout ce qu'il faut pour le relire, sauf la clé. */
export function chiffrer(clair) {
  const iv = randomBytes(12);
  const chiffreur = createCipheriv("aes-256-gcm", cle(), iv);
  const corps = Buffer.concat([chiffreur.update(String(clair), "utf8"), chiffreur.final()]);
  return [VERSION, iv.toString("base64url"), chiffreur.getAuthTag().toString("base64url"), corps.toString("base64url")].join(".");
}

/**
 * Relit un texte chiffré. Renvoie null s'il est illisible — clé changée,
 * valeur altérée, format inconnu — plutôt que de lever : pour l'appelant, un
 * secret illisible est un secret absent.
 */
export function dechiffrer(chiffre) {
  try {
    const [version, iv, sceau, corps] = String(chiffre ?? "").split(".");
    if (version !== VERSION || !iv || !sceau || !corps) return null;
    const dechiffreur = createDecipheriv("aes-256-gcm", cle(), Buffer.from(iv, "base64url"));
    dechiffreur.setAuthTag(Buffer.from(sceau, "base64url"));
    return Buffer.concat([dechiffreur.update(Buffer.from(corps, "base64url")), dechiffreur.final()]).toString("utf8");
  } catch {
    return null;
  }
}

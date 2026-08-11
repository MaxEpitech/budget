// Fabrication et empreinte des secrets envoyés au navigateur ou par email
// (jetons de validation, de réinitialisation, identifiants de session).
//
// SHA-256 suffit ici, contrairement aux mots de passe : ces valeurs sont tirées
// au hasard sur 256 bits, il n'y a rien à deviner par force brute. Seule
// l'empreinte est stockée, si bien qu'une copie de la base ne permet ni de se
// connecter, ni de valider une adresse.
import { createHash, randomBytes } from "node:crypto";

// 32 octets d'entropie → 43 caractères utilisables tels quels dans une URL.
export const fabriquerSecret = () => randomBytes(32).toString("base64url");

export const empreinte = (secret) => createHash("sha256").update(secret).digest("hex");

// Durées de vie, volontairement courtes pour la réinitialisation.
export const DUREES = {
  validation: 24 * 60 * 60 * 1000, // 24 h
  reinitialisation: 60 * 60 * 1000, // 1 h
  session: 30 * 24 * 60 * 60 * 1000, // 30 jours
};

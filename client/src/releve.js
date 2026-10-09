// Lecture d'un fichier de relevé choisi par l'utilisateur.
//
// Le navigateur ne fait que décoder le fichier en texte ; c'est le serveur qui
// le comprend, pour que la lecture des relevés n'existe qu'à un endroit.
import { api } from "./api.js";

/** Formats proposés dans le sélecteur de fichier. */
export const FORMATS_RELEVE = ".csv,.ofx,.qif,.txt,text/csv,application/x-ofx";

// Le serveur refuse au-delà de 3 Mo ; autant le dire avant d'envoyer.
const TAILLE_MAXIMUM = 3_000_000;

/**
 * Décode un fichier en texte.
 *
 * Beaucoup de banques françaises exportent encore en Windows-1252 : lu comme de
 * l'UTF-8, « Libellé » devient illisible et la colonne n'est plus reconnue. On
 * essaie donc l'UTF-8 strictement, et l'on se replie si le fichier n'en est pas.
 */
export async function decoderFichier(fichier) {
  const octets = await fichier.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder("windows-1252").decode(octets);
  }
}

/** Lit un fichier choisi : son nom et son contenu en texte, prêts à être analysés. */
export async function lireFichier(fichier) {
  if (fichier.size > TAILLE_MAXIMUM) throw new Error("Fichier trop volumineux : exportez une période plus courte.");
  return { nom: fichier.name, contenu: await decoderFichier(fichier) };
}

/**
 * Envoie un relevé au serveur et rend son estimation et son aperçu.
 * @param pour à qui est le compte : "foyer" (compte commun) ou l'id d'un membre
 */
export const analyserReleve = ({ nom, contenu }, pour = "foyer") => api.banqueReleve(nom, contenu, pour);

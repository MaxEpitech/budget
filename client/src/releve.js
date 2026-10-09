// Lecture d'un fichier de relevé choisi par l'utilisateur.
//
// Le navigateur ne fait que préparer le fichier pour le voyage ; c'est le
// serveur qui le comprend, pour que la lecture des relevés n'existe qu'à un
// endroit.
import { api } from "./api.js";

/** Formats proposés dans le sélecteur de fichier. */
export const FORMATS_RELEVE = [
  ".csv", ".xlsx", ".xls", ".ofx", ".qif", ".txt",
  "text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "application/x-ofx",
].join(",");

// Le serveur refuse au-delà de 3 Mo ; autant le dire avant d'envoyer.
const TAILLE_MAXIMUM = 3_000_000;

/**
 * Décode un fichier en texte.
 *
 * Beaucoup de banques françaises exportent encore en Windows-1252 : lu comme de
 * l'UTF-8, « Libellé » devient illisible et la colonne n'est plus reconnue. On
 * essaie donc l'UTF-8 strictement, et l'on se replie si le fichier n'en est pas.
 */
function decoder(octets) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(octets);
  } catch {
    return new TextDecoder("windows-1252").decode(octets);
  }
}

// Un classeur .xlsx est une archive ZIP ; un ancien .xls, un conteneur OLE. Le
// serveur reconnaît les deux — et explique pourquoi il refuse le second.
const SIGNATURES_BINAIRES = [[0x50, 0x4b, 0x03, 0x04], [0xd0, 0xcf, 0x11, 0xe0]];
const estBinaire = (octets) => SIGNATURES_BINAIRES.some((s) => s.every((o, i) => octets[i] === o));

function enBase64(octets) {
  let binaire = "";
  // Par tranches : passer des millions d'octets d'un coup à fromCharCode
  // dépasserait le nombre d'arguments qu'accepte une fonction.
  for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  return btoa(binaire);
}

/**
 * Lit un fichier choisi : son nom et son contenu, prêts à être analysés.
 *
 * Un classeur part tel quel, en base64 : décodé comme du texte, il serait
 * détruit. Tout le reste part en texte, décodé ici.
 */
export async function lireFichier(fichier) {
  if (fichier.size > TAILLE_MAXIMUM) throw new Error("Fichier trop volumineux : exportez une période plus courte.");
  const octets = new Uint8Array(await fichier.arrayBuffer());
  return estBinaire(octets)
    ? { nom: fichier.name, contenu: enBase64(octets), encodage: "base64" }
    : { nom: fichier.name, contenu: decoder(octets), encodage: "texte" };
}

/**
 * Envoie un relevé au serveur et rend son estimation et son aperçu.
 * @param pour à qui est le compte : "foyer" (compte commun) ou l'id d'un membre
 */
export const analyserReleve = ({ nom, contenu, encodage }, pour = "foyer") => api.banqueReleve(nom, contenu, pour, encodage);

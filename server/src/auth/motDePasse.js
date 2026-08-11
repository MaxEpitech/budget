// Hachage des mots de passe avec scrypt (module crypto de Node).
//
// scrypt plutôt qu'argon2 : aucune dépendance native à compiler, ce qui compte
// sous Windows. Les paramètres sont enregistrés dans l'empreinte elle-même, si
// bien qu'on pourra les durcir plus tard sans invalider les comptes existants :
// une empreinte se relit toujours avec les paramètres qui l'ont produite.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

// N=2^15, r=8, p=2 → environ 32 Mio de mémoire par calcul (profil OWASP).
const PARAMS = { N: 2 ** 15, r: 8, p: 2 };
const LONGUEUR_CLE = 64;
const LONGUEUR_SEL = 16;
// Node refuse le calcul si maxmem est inférieur à 128 × N × r ; on laisse de la marge.
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2;

/**
 * Empreinte d'un mot de passe, au format `scrypt$N$r$p$sel$cle` (base64url).
 * Deux appels sur le même mot de passe donnent deux empreintes différentes :
 * le sel est tiré au hasard à chaque fois.
 */
export async function hacherMotDePasse(motDePasse) {
  const sel = randomBytes(LONGUEUR_SEL);
  const cle = await scryptAsync(motDePasse.normalize("NFKC"), sel, LONGUEUR_CLE, { ...PARAMS, maxmem: MAXMEM });
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, sel.toString("base64url"), cle.toString("base64url")].join("$");
}

/**
 * Vérifie un mot de passe contre son empreinte, en temps constant.
 * Renvoie false plutôt que de lever si l'empreinte est illisible.
 */
export async function verifierMotDePasse(motDePasse, empreinte) {
  if (typeof empreinte !== "string") return false;
  const [algo, n, r, p, selB64, cleB64] = empreinte.split("$");
  if (algo !== "scrypt" || !selB64 || !cleB64) return false;

  const attendue = Buffer.from(cleB64, "base64url");
  const params = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) return false;

  try {
    const calculee = await scryptAsync(
      motDePasse.normalize("NFKC"),
      Buffer.from(selB64, "base64url"),
      attendue.length,
      { ...params, maxmem: 128 * params.N * params.r * 2 }
    );
    return timingSafeEqual(calculee, attendue);
  } catch {
    return false;
  }
}

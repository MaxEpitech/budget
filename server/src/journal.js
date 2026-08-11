// Journalisation structurée.
//
// Une ligne par événement, en JSON sur la sortie standard : les hébergeurs la
// collectent telle quelle, et l'on peut ensuite filtrer sur un champ plutôt que
// de fouiller du texte. En développement, la même ligne reste lisible à l'œil.
//
// ─── Ce qui ne doit JAMAIS être journalisé ────────────────────────────────
// Mot de passe, empreinte, jeton, cookie, contenu d'email. C'est par les
// journaux que ces valeurs fuitent le plus souvent : ils sont conservés
// longtemps, copiés vers des outils tiers, et lus par plus de monde que la base.
// D'où le filtre ci-dessous, appliqué à tout ce qui est enregistré.
import { randomUUID } from "node:crypto";

const CHAMPS_SENSIBLES = /mot ?de ?passe|password|hash|jeton|token|cookie|secret|authorization/i;

const PROFONDEUR_MAXIMALE = 4;

/**
 * Remplace la valeur des champs sensibles, à n'importe quelle profondeur.
 *
 * Au-delà d'une certaine profondeur, la branche est remplacée par un repère
 * plutôt que rendue telle quelle : sans cela, une structure qui se référence
 * elle-même ferait échouer la sérialisation — et la journalisation planterait
 * la requête qu'elle était censée seulement raconter.
 */
export function expurger(valeur, profondeur = 0) {
  if (valeur === null || typeof valeur !== "object") return valeur;
  if (profondeur > PROFONDEUR_MAXIMALE) return "[trop profond]";
  if (Array.isArray(valeur)) return valeur.map((v) => expurger(v, profondeur + 1));
  const propre = {};
  for (const [cle, v] of Object.entries(valeur)) {
    propre[cle] = CHAMPS_SENSIBLES.test(cle) ? "[masqué]" : expurger(v, profondeur + 1);
  }
  return propre;
}

const ecrire = (niveau, message, details) => {
  const ligne = { horodatage: new Date().toISOString(), niveau, message, ...expurger(details ?? {}) };
  const sortie = niveau === "erreur" ? console.error : console.log;
  sortie(JSON.stringify(ligne));
};

export const journal = {
  info: (message, details) => ecrire("info", message, details),
  alerte: (message, details) => ecrire("alerte", message, details),
  erreur: (message, details) => ecrire("erreur", message, details),
};

/**
 * Attache un identifiant à chaque requête et journalise son issue.
 *
 * L'identifiant permet de relier entre elles les lignes d'une même requête —
 * indispensable quand plusieurs s'entremêlent. L'hébergeur en fournit souvent
 * un ; on le reprend plutôt que d'en inventer un second.
 */
export const journaliserRequetes = (req, res, suite) => {
  req.identifiant = req.headers["x-vercel-id"] ?? req.headers["x-request-id"] ?? randomUUID();
  res.setHeader("X-Request-Id", req.identifiant);
  const debut = Date.now();

  res.on("finish", () => {
    // Le chemin est journalisé sans sa chaîne de requête : elle peut porter des
    // jetons, et n'apprend rien d'utile ici.
    journal.info("requete", {
      identifiant: req.identifiant,
      methode: req.method,
      chemin: req.path,
      statut: res.statusCode,
      dureeMs: Date.now() - debut,
      utilisateur: req.utilisateur?.id,
    });
  });

  suite();
};

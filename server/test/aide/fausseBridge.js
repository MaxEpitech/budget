// Faux serveur Bridge (API v3, version 2025-01-15), pour éprouver le parcours sans réseau.
//
// Il contrôle ce que le vrai service contrôle et que le client doit respecter :
// les identifiants d'application sur chaque requête, l'en-tête Bridge-Version,
// et le jeton d'utilisateur (Bearer) pour tout ce qui touche aux données — avec,
// comme chez Bridge, des comptes qui n'appartiennent qu'à l'utilisateur du jeton.
//
// Les tests y « lient » des connexions bancaires (`lier`) comme le ferait le
// passage de l'utilisateur chez sa banque, puis relisent `etat` pour vérifier
// ce que le client a envoyé.
import http from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";

export const VERSION_ATTENDUE = "2025-01-15";

export async function demarrerFausseBridge({ clientId = "client-id-essai", clientSecret = "client-secret-essai" } = {}) {
  const etat = {
    clientId,
    clientSecret,
    // Banques de l'agrégation, dans le désordre : le client doit les trier.
    banques: [
      { id: 12, name: "Zêta Banque" },
      { id: 7, name: "Alpha Banque" },
    ],
    // Taille maximale d'une page de résultats, quel que soit `limit` : sert à forcer la pagination.
    taillePage: 500,
    utilisateurs: new Map(), // uuid → { uuid, external_user_id }
    utilisateursSupprimes: [],
    jetons: new Map(), // access_token → uuid
    connexions: [], // { itemId, userUuid, comptes, transactions }
    sessions: [], // corps reçus par /connect-sessions
    // Pannes simulées : { statut, code } sur toute route de données.
    panne: null,
    appels: [], // "METHODE /chemin"
    requetes: [], // { methode, chemin, params, entetes, corps }
  };

  const serveur = http.createServer(async (req, res) => {
    let brut = "";
    for await (const morceau of req) brut += morceau;
    const corps = brut ? JSON.parse(brut) : null;
    const url = new URL(req.url, "http://faux");
    const chemin = url.pathname;
    etat.appels.push(`${req.method} ${chemin}`);
    etat.requetes.push({ methode: req.method, chemin, params: Object.fromEntries(url.searchParams), entetes: { ...req.headers }, corps });

    const repondre = (code, donnees) => {
      if (code === 204) {
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(donnees));
    };
    const erreur = (code, codeMetier, message) => repondre(code, { errors: [{ code: codeMetier, message }] });

    // Identifiants de l'application et version : exigés partout.
    if (req.headers["client-id"] !== etat.clientId || req.headers["client-secret"] !== etat.clientSecret) {
      return erreur(401, "client.authentication.unauthorized", "Invalid client credentials");
    }
    if (req.headers["bridge-version"] !== VERSION_ATTENDUE) {
      return erreur(400, "request.invalid_version", `Bridge-Version ${VERSION_ATTENDUE} requise`);
    }

    if (chemin === "/v3/providers" && req.method === "GET") {
      return repondre(200, { resources: etat.banques, pagination: { next_uri: null } });
    }

    if (chemin === "/v3/aggregation/users" && req.method === "POST") {
      const utilisateur = { uuid: randomUUID(), external_user_id: corps?.external_user_id ?? null };
      etat.utilisateurs.set(utilisateur.uuid, utilisateur);
      return repondre(201, utilisateur);
    }

    const supprime = /^\/v3\/aggregation\/users\/([^/]+)$/.exec(chemin);
    if (supprime && req.method === "DELETE") {
      if (!etat.utilisateurs.has(supprime[1])) return erreur(404, "user.not_found", "User not found");
      etat.utilisateurs.delete(supprime[1]);
      etat.utilisateursSupprimes.push(supprime[1]);
      etat.connexions = etat.connexions.filter((c) => c.userUuid !== supprime[1]);
      return repondre(204);
    }

    if (chemin === "/v3/aggregation/authorization/token" && req.method === "POST") {
      const utilisateur = etat.utilisateurs.get(corps?.user_uuid);
      if (!utilisateur) return erreur(404, "user.not_found", "User not found");
      const jeton = `jeton-${randomUUID()}`;
      etat.jetons.set(jeton, utilisateur.uuid);
      return repondre(200, {
        access_token: jeton,
        expires_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
        user: { id: utilisateur.uuid, uuid: utilisateur.uuid, external_user_id: utilisateur.external_user_id },
      });
    }

    // Ci-dessous, tout exige le jeton d'un utilisateur.
    const porteur = etat.jetons.get(String(req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!porteur) return erreur(401, "user.authentication.unauthorized", "Invalid or missing user token");

    if (chemin === "/v3/aggregation/connect-sessions" && req.method === "POST") {
      etat.sessions.push({ ...corps, utilisateur: porteur });
      return repondre(201, { id: `session-${etat.sessions.length}`, url: "https://connect.bridge.invalid/session" });
    }

    if (etat.panne) return erreur(etat.panne.statut, etat.panne.code ?? "simulated.failure", "Panne simulée");

    /** Une page d'une liste, avec `next_uri` relatif vers la suivante. */
    const paginer = (liste) => {
      const taille = Math.min(Number(url.searchParams.get("limit")) || 500, etat.taillePage);
      const debut = Number(url.searchParams.get("offset") ?? 0);
      const suite = new URLSearchParams(url.searchParams);
      suite.set("offset", String(debut + taille));
      return {
        resources: liste.slice(debut, debut + taille),
        pagination: { next_uri: debut + taille < liste.length ? `${chemin}?${suite}` : null },
      };
    };
    const comptesDe = (uuid) => etat.connexions.filter((c) => c.userUuid === uuid).flatMap((c) => c.comptes.map((k) => ({ ...k, item_id: c.itemId })));

    if (chemin === "/v3/aggregation/accounts" && req.method === "GET") {
      const itemId = url.searchParams.get("item_id");
      return repondre(200, paginer(comptesDe(porteur).filter((c) => itemId === null || String(c.item_id) === itemId)));
    }

    const compte = /^\/v3\/aggregation\/accounts\/([^/]+)$/.exec(chemin);
    if (compte && req.method === "GET") {
      const trouve = comptesDe(porteur).find((c) => String(c.id) === compte[1]);
      return trouve ? repondre(200, trouve) : erreur(404, "account.not_found", "Account not found");
    }

    if (chemin === "/v3/aggregation/transactions" && req.method === "GET") {
      const idCompte = url.searchParams.get("account_id");
      const du = url.searchParams.get("min_date");
      const au = url.searchParams.get("max_date");
      // Un compte qui n'est pas celui de l'utilisateur du jeton n'a, pour lui, aucune opération.
      if (!comptesDe(porteur).some((c) => String(c.id) === idCompte)) return repondre(200, { resources: [], pagination: { next_uri: null } });
      const operations = etat.connexions
        .filter((c) => c.userUuid === porteur)
        .flatMap((c) => c.transactions)
        .filter((t) => String(t.account_id) === idCompte)
        .filter((t) => {
          const date = t.booking_date ?? t.date;
          return (!du || date >= du) && (!au || date <= au);
        });
      return repondre(200, paginer(operations));
    }

    erreur(404, "not_found", "Not found");
  });

  serveur.listen(0);
  await once(serveur, "listening");

  return {
    etat,
    base: `http://127.0.0.1:${serveur.address().port}`,
    compter: (fragment) => etat.appels.filter((a) => a.includes(fragment)).length,
    /** Appels reçus dont « METHODE /chemin » contient le fragment. */
    requetes: (fragment) => etat.requetes.filter((r) => `${r.methode} ${r.chemin}`.includes(fragment)),
    /** L'utilisateur Bridge créé en dernier, encore existant ; undefined s'il n'y en a plus. */
    dernierUtilisateur: () => [...etat.utilisateurs.keys()].at(-1),
    /**
     * Relie une connexion bancaire (« item ») à un utilisateur, avec ses comptes
     * et opérations — ce que fait le passage de la personne chez sa banque.
     * Les opérations sont rattachées au compte indiqué (`compte`, sinon le premier).
     */
    lier(userUuid, { itemId = 4242, comptes, operations = [] }) {
      const liste = comptes ?? [];
      etat.connexions.push({
        itemId,
        userUuid,
        comptes: liste,
        transactions: operations.map((t) => ({ account_id: t.account_id ?? liste[0]?.id, currency_code: "EUR", ...t })),
      });
    },
    async arreter() {
      serveur.close();
      await once(serveur, "close");
    },
  };
}

/** Un compte tel que Bridge le décrit. */
export const compte = (id, type = "checking", extra = {}) => ({
  id,
  name: `Compte ${id}`,
  type,
  currency_code: "EUR",
  data_access: "enabled",
  accounting_balance: 2210.55,
  balance: 2200.55,
  instant_balance: 2100.55,
  ...extra,
});

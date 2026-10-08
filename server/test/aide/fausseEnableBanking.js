// Faux serveur Enable Banking, pour éprouver le parcours sans réseau.
//
// Il vérifie réellement la signature des jetons avec la clé publique de
// l'application : un jeton mal construit ou signé par une autre clé est refusé,
// comme le ferait le vrai service.
import http from "node:http";
import { once } from "node:events";
import { createVerify, generateKeyPairSync } from "node:crypto";

/** Une application d'essai : son identifiant et sa paire de clés. */
export function fabriquerApplication(appId = "11111111-2222-3333-4444-55555555abcd") {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return { appId, clePrivee: privateKey, clePublique: publicKey };
}

function jetonValide(jeton, applications) {
  const [entete, corps, signature] = String(jeton ?? "").split(".");
  if (!entete || !corps || !signature) return null;
  try {
    const e = JSON.parse(Buffer.from(entete, "base64url").toString());
    const c = JSON.parse(Buffer.from(corps, "base64url").toString());
    const application = applications.find((a) => a.appId === e.kid);
    const maintenant = Math.floor(Date.now() / 1000);
    const conforme =
      application && e.typ === "JWT" && e.alg === "RS256" &&
      c.iss === "enablebanking.com" && c.aud === "api.enablebanking.com" &&
      c.iat <= maintenant + 5 && c.exp > maintenant && c.exp - c.iat <= 86400;
    if (!conforme) return null;
    const juste = createVerify("RSA-SHA256").update(`${entete}.${corps}`).verify(application.clePublique, Buffer.from(signature, "base64url"));
    return juste ? application : null;
  } catch {
    return null;
  }
}

export async function demarrerFausseEnableBanking(applications) {
  const etat = {
    redirections: [],
    active: true,
    // Comptes rendus à la création de session ; vide = mode restreint sans compte lié.
    comptes: [{ uid: "uid-principal" }, { uid: "uid-secondaire" }],
    // Pages d'opérations, servies l'une après l'autre via continuation_key.
    pages: [[]],
    soldes: [{ balance_type: "CLBD", balance_amount: { amount: "2210.55", currency: "EUR" } }],
    panneComptes: null, // { statut, error }
    appels: [],
    requetes: [],
    derniereAutorisation: null,
    sessionsSupprimees: [],
    codeAttendu: "code-de-la-banque",
  };

  const serveur = http.createServer(async (req, res) => {
    let brut = "";
    for await (const morceau of req) brut += morceau;
    const corps = brut ? JSON.parse(brut) : null;
    const url = new URL(req.url, "http://faux");
    etat.appels.push(`${req.method} ${url.pathname}`);
    etat.requetes.push({ methode: req.method, chemin: url.pathname, params: Object.fromEntries(url.searchParams) });

    const repondre = (code, donnees) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(donnees));
    };

    const application = jetonValide(String(req.headers.authorization ?? "").replace(/^Bearer /, ""), applications);
    if (!application) return repondre(401, { code: 401, message: "Unauthorized", error: "UNAUTHORIZED" });

    if (url.pathname === "/application") {
      return repondre(200, { name: "Budget", kid: application.appId, environment: "PRODUCTION", redirect_urls: etat.redirections, active: etat.active });
    }
    if (url.pathname === "/aspsps") {
      return repondre(200, { aspsps: [
        { name: "Zêta Banque", country: url.searchParams.get("country") },
        { name: "Alpha: Banque", country: url.searchParams.get("country") },
      ] });
    }
    if (url.pathname === "/auth" && req.method === "POST") {
      etat.derniereAutorisation = corps;
      return repondre(200, { url: "https://banque.invalid/autorisation", authorization_id: "auth-1" });
    }
    if (url.pathname === "/sessions" && req.method === "POST") {
      if (corps?.code !== etat.codeAttendu) return repondre(400, { code: 400, message: "Wrong code", error: "WRONG_AUTHORIZATION_CODE" });
      return repondre(200, { session_id: "session-1", accounts: etat.comptes });
    }
    const session = /^\/sessions\/([^/]+)$/.exec(url.pathname);
    if (session && req.method === "DELETE") {
      etat.sessionsSupprimees.push(session[1]);
      return repondre(200, { message: "OK" });
    }
    const compte = /^\/accounts\/([^/]+)\/(balances|transactions)$/.exec(url.pathname);
    if (compte) {
      if (etat.panneComptes) return repondre(etat.panneComptes.statut, { code: etat.panneComptes.statut, message: "Panne simulée", error: etat.panneComptes.error });
      if (compte[2] === "balances") return repondre(200, { balances: etat.soldes });
      const rang = Number(url.searchParams.get("continuation_key") ?? 0);
      return repondre(200, {
        transactions: etat.pages[rang] ?? [],
        continuation_key: rang + 1 < etat.pages.length ? String(rang + 1) : null,
      });
    }
    repondre(404, { code: 404, message: "Not found" });
  });

  serveur.listen(0);
  await once(serveur, "listening");

  return {
    etat,
    base: `http://127.0.0.1:${serveur.address().port}`,
    compter: (fragment) => etat.appels.filter((a) => a.includes(fragment)).length,
    async arreter() {
      serveur.close();
      await once(serveur, "close");
    },
  };
}

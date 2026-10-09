// Faux serveur GoCardless, pour éprouver le parcours bancaire sans réseau.
//
// Il répond comme l'API réelle sur les seules routes dont l'application se
// sert, et tient le compte des appels reçus : c'est ce qui permet de vérifier
// qu'une synthèse récente n'interroge pas la banque une seconde fois.
import http from "node:http";
import { once } from "node:events";

export async function demarrerFausseBanque() {
  const etat = {
    statutRequisition: "CR",
    comptes: ["compte-principal", "compte-secondaire"],
    operations: [],
    soldes: [{ balanceType: "closingBooked", balanceAmount: { amount: "1520.37", currency: "EUR" } }],
    // Code HTTP à renvoyer sur les routes de compte, pour simuler une panne.
    panneComptes: null,
    appels: [],
    identifiantsValides: [["id-essai", "cle-essai"], ["id-du-foyer-1234", "cle-secrete-du-foyer"]],
    // Sous quel compte GoCardless chaque appel authentifié est arrivé.
    comptesUtilises: [],
    requisitionsSupprimees: [],
    derniereRequisition: null,
  };

  const serveur = http.createServer(async (req, res) => {
    let brut = "";
    for await (const morceau of req) brut += morceau;
    const corps = brut ? JSON.parse(brut) : null;
    const chemin = req.url.split("?")[0];
    etat.appels.push(`${req.method} ${chemin}`);

    const repondre = (code, donnees) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(donnees));
    };

    if (chemin === "/token/new/") {
      // Deux comptes GoCardless distincts : celui de l'installation, et celui
      // qu'un foyer saisit dans l'interface.
      const valide = etat.identifiantsValides.some(([id, cle]) => corps?.secret_id === id && corps?.secret_key === cle);
      if (!valide) return repondre(401, { summary: "Authentication failed" });
      return repondre(200, { access: `jeton-${corps.secret_id}`, access_expires: 86400 });
    }
    const jetonRecu = String(req.headers.authorization ?? "").replace("Bearer jeton-", "");
    if (!etat.identifiantsValides.some(([id]) => id === jetonRecu)) return repondre(401, { summary: "Invalid token" });
    etat.comptesUtilises.push(jetonRecu);

    if (chemin === "/institutions/") {
      return repondre(200, [
        { id: "ZETA_BANK", name: "Zêta Banque" },
        { id: "ALPHA_BANK", name: "Alpha Banque" },
      ]);
    }
    if (chemin === "/requisitions/" && req.method === "POST") {
      etat.derniereRequisition = corps;
      return repondre(201, { id: `req-${etat.appels.length}`, link: "https://banque.invalid/consentement", status: "CR" });
    }
    const requisition = /^\/requisitions\/([^/]+)\/$/.exec(chemin);
    if (requisition && req.method === "GET") {
      return repondre(200, { id: requisition[1], status: etat.statutRequisition, accounts: etat.statutRequisition === "LN" ? etat.comptes : [] });
    }
    if (requisition && req.method === "DELETE") {
      etat.requisitionsSupprimees.push(requisition[1]);
      return repondre(200, { summary: "Requisition deleted" });
    }
    const compte = /^\/accounts\/([^/]+)\/(balances|transactions)\/$/.exec(chemin);
    if (compte) {
      if (etat.panneComptes) return repondre(etat.panneComptes, { summary: "Panne simulée" });
      return compte[2] === "balances"
        ? repondre(200, { balances: etat.soldes })
        : repondre(200, { transactions: { booked: etat.operations, pending: [] } });
    }
    repondre(404, { summary: "Not found" });
  });

  serveur.listen(0);
  await once(serveur, "listening");

  return {
    etat,
    base: `http://127.0.0.1:${serveur.address().port}`,
    /** Nombre d'appels reçus dont le chemin contient ce fragment. */
    compter: (fragment) => etat.appels.filter((a) => a.includes(fragment)).length,
    async arreter() {
      serveur.close();
      await once(serveur, "close");
    },
  };
}

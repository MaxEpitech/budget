// Identifiants GoCardless du foyer : de quoi proposer la synchronisation
// bancaire sans toucher à l'hébergement.
//
// La clé n'est jamais relue depuis le serveur : une fois enregistrée, l'écran
// n'en connaît plus que l'existence. Pour la changer, on la ressaisit.
import { useState, useEffect } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Carte from "./Carte.jsx";
import BoutonConfirme from "./BoutonConfirme.jsx";

export default function ReglagesBanque() {
  const [config, setConfig] = useState(null); // null : pas encore connu
  const [f, setF] = useState({ secretId: "", secretKey: "" });
  const [edition, setEdition] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null); // { ton: "ok" | "alerte", texte }

  useEffect(() => {
    let vivant = true;
    api.banqueConfiguration().then(
      (c) => vivant && setConfig(c),
      (err) => vivant && setMessage({ ton: "alerte", texte: err.message }),
    );
    return () => { vivant = false; };
  }, []);

  const agir = async (action, reussite) => {
    setOccupe(true);
    setMessage(null);
    try {
      setConfig(await action());
      setF({ secretId: "", secretKey: "" });
      setEdition(false);
      setMessage({ ton: "ok", texte: reussite });
    } catch (err) {
      setMessage({ ton: "alerte", texte: err.message });
    } finally {
      setOccupe(false);
    }
  };

  const enregistrer = () => {
    if (!f.secretId.trim() || !f.secretKey.trim()) return;
    agir(
      () => api.banqueConfigurer(f.secretId.trim(), f.secretKey.trim()),
      "Identifiants vérifiés auprès de GoCardless et enregistrés. La synchronisation se règle dans l'onglet Emprunt.",
    );
  };

  if (!config) {
    return message ? (
      <Carte titre="Synchronisation bancaire"><div className="corps"><div className="avis alerte" role="alert" style={{ marginTop: 0 }}>{message.texte}</div></div></Carte>
    ) : null;
  }

  const duFoyer = config.source === "foyer";
  const formulaire = config.peutModifier && config.enregistrementPossible && (edition || !duFoyer);

  return (
    <Carte
      titre="Synchronisation bancaire"
      note={
        duFoyer ? `Identifiants GoCardless du foyer enregistrés (${config.secretId})`
        : config.source === "installation" ? "Assurée par les identifiants GoCardless de l'installation"
        : "Non configurée — les revenus et charges se saisissent à la main"
      }
    >
      <div className="corps">
        <div className="carte-note">
          Pour lire revenus et charges sur un compte bancaire, le foyer a besoin de ses propres identifiants
          GoCardless Bank Account Data : un « Secret ID » et une « Secret key », à créer dans le portail
          GoCardless, rubrique User secrets. Ils servent à tous les comptes du foyer.
        </div>

        {message && <div className={`avis ${message.ton}`} role={message.ton === "alerte" ? "alert" : "status"}>{message.texte}</div>}

        {!config.peutModifier && (
          <div className="carte-note" style={{ marginTop: 10 }}>Seul un propriétaire du foyer peut modifier ce réglage.</div>
        )}
        {config.peutModifier && !config.enregistrementPossible && (
          <div className="avis alerte">
            Enregistrement impossible pour l'instant : la clé de chiffrement n'est pas configurée sur le serveur
            (variable CLE_CHIFFREMENT). Elle protège les identifiants une fois en base.
          </div>
        )}

        {formulaire && (
          <div className="forme" style={{ marginTop: 14 }}>
            <Champ
              libelle="Secret ID" valeur={f.secretId} onChange={(v) => setF({ ...f, secretId: v })} largeur={280}
              onEntree={enregistrer} attributs={{ autoComplete: "off", spellCheck: false }}
            />
            <Champ
              libelle="Secret key" type="password" valeur={f.secretKey} onChange={(v) => setF({ ...f, secretKey: v })} largeur={280}
              onEntree={enregistrer} attributs={{ autoComplete: "new-password" }}
            />
            <button className="btn" onClick={enregistrer} disabled={occupe || !f.secretId.trim() || !f.secretKey.trim()}>
              {occupe ? "Vérification…" : "Vérifier et enregistrer"}
            </button>
            {edition && <button className="btn fant" onClick={() => setEdition(false)} disabled={occupe}>Annuler</button>}
            <div className="carte-note" style={{ flexBasis: "100%" }}>
              Les identifiants sont essayés auprès de GoCardless avant d'être gardés. La clé est chiffrée en
              base et ne sera plus jamais affichée.
              {duFoyer && " Les remplacer défait les banques déjà reliées par les comptes du foyer : il faudra les relier de nouveau."}
            </div>
          </div>
        )}

        {config.peutModifier && duFoyer && !edition && (
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
            {config.enregistrementPossible && (
              <button className="btn fant mini" onClick={() => { setEdition(true); setMessage(null); }} disabled={occupe}>Remplacer</button>
            )}
            {/* Retirer les identifiants défait aussi les banques reliées : le
                geste demande donc confirmation sur place. */}
            <BoutonConfirme
              libelle="Retirer les identifiants"
              confirmation="Retirer, et dissocier les banques du foyer"
              disabled={occupe}
              onConfirme={() => agir(api.banqueDeconfigurer, "Identifiants retirés. Les banques reliées par les comptes du foyer ont été dissociées.")}
            />
          </div>
        )}
      </div>
    </Carte>
  );
}

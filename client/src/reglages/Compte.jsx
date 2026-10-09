// Réglages › Mon compte — la personne connectée : son identité, sa sécurité,
// l'apparence de l'application sur cet appareil.
import { useState } from "react";
import { api } from "../api.js";
import Carte from "../composants/Carte.jsx";
import Icone from "../composants/Icone.jsx";
import Segments from "../composants/Segments.jsx";
import Sessions from "./Sessions.jsx";
import { THEMES, lireTheme, choisirTheme } from "../theme.js";

/**
 * Changer de mot de passe passe par le même lien que l'oubli : il prouve qu'on
 * tient encore l'adresse du compte, ce qu'une session restée ouverte sur un
 * poste partagé ne prouve pas.
 */
function MotDePasse({ email }) {
  const [etat, setEtat] = useState(null); // null | "envoi" | { ton, texte }

  const envoyer = async () => {
    setEtat("envoi");
    try {
      await api.motDePasseOublie(email);
      // La réponse du serveur est volontairement vague — elle ne doit pas dire
      // à un inconnu si l'adresse existe. Ici on sait à qui l'on parle.
      setEtat({ ton: "ok", texte: `Lien envoyé à ${email}. Pensez à regarder les indésirables.` });
    } catch (e) {
      setEtat({ ton: "alerte", texte: e.message });
    }
  };

  return (
    <Carte titre="Mot de passe" note="Changer de mot de passe referme aussi toutes les autres connexions">
      <div className="corps">
        <div className="forme" style={{ alignItems: "center" }}>
          <button className="btn fant" onClick={envoyer} disabled={etat === "envoi"}>
            <Icone nom="lettre" /> {etat === "envoi" ? "Envoi…" : "Recevoir un lien de changement"}
          </button>
          <span className="carte-note">Le lien, valable une heure, arrive à {email}.</span>
        </div>
        {etat && etat !== "envoi" && <div className={`avis ${etat.ton}`} role="status">{etat.texte}</div>}
      </div>
    </Carte>
  );
}

export default function Compte({ compte, onDeconnexion }) {
  const [theme, setTheme] = useState(lireTheme);
  const email = compte?.email ?? "";

  return (
    <>
      <Carte titre="Profil">
        <div className="corps profil">
          <span className="compte-pastille tres-grande" aria-hidden="true">{email.slice(0, 1) || "?"}</span>
          <div style={{ minWidth: 0, flex: "1 1 200px" }}>
            <div className="ligne-lib" style={{ wordBreak: "break-all" }}>{email}</div>
            <div className="ligne-meta" style={{ marginTop: 4 }}>
              {compte?.emailValide ? (
                <span className="etiq perso" style={{ "--teinte": "var(--caisse)" }}>Adresse confirmée</span>
              ) : (
                <span className="etiq perso" style={{ "--teinte": "var(--ocre)" }}>Adresse non confirmée</span>
              )}
            </div>
          </div>
          <button className="btn fant" onClick={onDeconnexion}>
            <Icone nom="sortie" /> Se déconnecter
          </button>
        </div>
      </Carte>

      <MotDePasse email={email} />

      <Sessions />

      <Carte titre="Apparence" note="Propre à cet appareil">
        <div className="corps">
          <Segments
            libelle="Thème" valeur={theme} options={THEMES}
            onChange={(v) => { setTheme(v); choisirTheme(v); }}
          />
          <div className="carte-note" style={{ marginTop: 10 }}>
            « Système » suit le réglage clair ou sombre de votre appareil.
          </div>
        </div>
      </Carte>
    </>
  );
}

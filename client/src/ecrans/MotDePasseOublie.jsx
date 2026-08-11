import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Cadre, { Colonne, Lien } from "./Cadre.jsx";

export default function MotDePasseOublie({ allerVers }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const soumettre = async () => {
    if (occupe || !email.trim()) return;
    setOccupe(true);
    setErreur(null);
    try {
      setMessage((await api.motDePasseOublie(email)).message);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Cadre
      titre="Mot de passe oublié"
      note="Nous vous envoyons un lien pour en choisir un nouveau"
      erreur={erreur}
      message={message}
      liens={allerVers}
      bas={<Lien onClick={() => allerVers("connexion")}>Retour à la connexion</Lien>}
    >
      {!message && (
        <Colonne>
          <Champ
            libelle="Adresse email" type="email" valeur={email} onChange={setEmail} largeur="100%"
            placeholder="vous@exemple.fr" onEntree={soumettre}
            attributs={{ autoComplete: "email", autoFocus: true }}
          />
          <button className="btn" style={{ width: "100%" }} onClick={soumettre} disabled={occupe}>
            {occupe ? "Envoi…" : "Envoyer le lien"}
          </button>
        </Colonne>
      )}
      {message && (
        <div className="carte-note">Le lien est valable 1 heure et ne fonctionne qu'une fois.</div>
      )}
    </Cadre>
  );
}

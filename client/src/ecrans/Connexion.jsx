import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Cadre, { Colonne, Lien } from "./Cadre.jsx";

export default function Connexion({ onConnecte, allerVers }) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState(null);
  const [message, setMessage] = useState(null);
  const [occupe, setOccupe] = useState(false);
  // Une adresse non confirmée mérite un bouton de renvoi plutôt qu'une impasse.
  const [aConfirmer, setAConfirmer] = useState(false);

  const soumettre = async () => {
    if (occupe || !email.trim() || !motDePasse) return;
    setOccupe(true);
    setErreur(null);
    setMessage(null);
    setAConfirmer(false);
    try {
      onConnecte(await api.connexion(email, motDePasse));
    } catch (e) {
      setErreur(e.message);
      setAConfirmer(e.motif === "email_non_valide");
    } finally {
      setOccupe(false);
    }
  };

  const renvoyer = async () => {
    setOccupe(true);
    try {
      const r = await api.renvoyerValidation(email);
      setErreur(null);
      setAConfirmer(false);
      setMessage(r.message);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Cadre
      titre="Connexion"
      note="Retrouvez le budget de votre foyer"
      erreur={erreur}
      message={message}
      liens={allerVers}
      bas={<Lien onClick={() => allerVers("inscription")}>Pas encore de compte ? En créer un</Lien>}
    >
      <Colonne>
        <Champ
          libelle="Adresse email" type="email" valeur={email} onChange={setEmail} largeur="100%"
          placeholder="vous@exemple.fr" onEntree={soumettre}
          attributs={{ autoComplete: "email", autoFocus: true }}
        />
        <Champ
          libelle="Mot de passe" type="password" valeur={motDePasse} onChange={setMotDePasse} largeur="100%"
          onEntree={soumettre} attributs={{ autoComplete: "current-password" }}
        />
        <button className="btn" style={{ width: "100%" }} onClick={soumettre} disabled={occupe}>
          {occupe ? "Connexion…" : "Se connecter"}
        </button>
        {aConfirmer && (
          <button className="btn fant" style={{ width: "100%" }} onClick={renvoyer} disabled={occupe}>
            Renvoyer l'email de confirmation
          </button>
        )}
      </Colonne>
      <div style={{ textAlign: "center", marginTop: 6 }}>
        <Lien onClick={() => allerVers("mot-de-passe-oublie")}>Mot de passe oublié ?</Lien>
      </div>
    </Cadre>
  );
}

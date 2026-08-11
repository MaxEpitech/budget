import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Cadre, { Colonne, Lien } from "./Cadre.jsx";

const LONGUEUR_MINIMALE = 12;

export default function Inscription({ allerVers, onEmailEnvoye }) {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  // Contrôle local avant l'appel : le serveur revalide de toute façon, mais
  // autant ne pas faire faire l'aller-retour pour un mot de passe trop court.
  const tropCourt = motDePasse.length > 0 && motDePasse.length < LONGUEUR_MINIMALE;

  const soumettre = async () => {
    if (occupe || !email.trim() || motDePasse.length < LONGUEUR_MINIMALE) return;
    setOccupe(true);
    setErreur(null);
    try {
      await api.inscription(email, motDePasse);
      onEmailEnvoye(email);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Cadre
      titre="Créer un compte"
      note="Un compte, un foyer, un budget"
      erreur={erreur}
      bas={<Lien onClick={() => allerVers("connexion")}>Déjà un compte ? Se connecter</Lien>}
    >
      <Colonne>
        <Champ
          libelle="Adresse email" type="email" valeur={email} onChange={setEmail} largeur="100%"
          placeholder="vous@exemple.fr" onEntree={soumettre}
          attributs={{ autoComplete: "email", autoFocus: true }}
        />
        <Champ
          libelle={`Mot de passe (${LONGUEUR_MINIMALE} caractères minimum)`} type="password"
          valeur={motDePasse} onChange={setMotDePasse} largeur="100%" onEntree={soumettre}
          attributs={{ autoComplete: "new-password" }}
        />
        <div className="carte-note" style={{ marginTop: -4 }}>
          {tropCourt
            ? `Encore ${LONGUEUR_MINIMALE - motDePasse.length} caractère${LONGUEUR_MINIMALE - motDePasse.length > 1 ? "s" : ""}.`
            : "Une phrase entière vaut mieux qu'un mot compliqué : elle est plus longue et plus facile à retenir."}
        </div>
        <button
          className="btn" style={{ width: "100%" }} onClick={soumettre}
          disabled={occupe || motDePasse.length < LONGUEUR_MINIMALE}
        >
          {occupe ? "Création…" : "Créer mon compte"}
        </button>
      </Colonne>
    </Cadre>
  );
}

import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Cadre, { Colonne, Lien } from "./Cadre.jsx";

const LONGUEUR_MINIMALE = 12;

/** Écran atteint depuis le lien de réinitialisation (/reinitialiser?jeton=…). */
export default function NouveauMotDePasse({ jeton, onConnecte, allerVers }) {
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const tropCourt = motDePasse.length > 0 && motDePasse.length < LONGUEUR_MINIMALE;

  const soumettre = async () => {
    if (occupe || motDePasse.length < LONGUEUR_MINIMALE) return;
    setOccupe(true);
    setErreur(null);
    try {
      onConnecte(await api.reinitialiser(jeton, motDePasse));
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Cadre
      titre="Nouveau mot de passe"
      erreur={erreur}
      bas={<Lien onClick={() => allerVers("mot-de-passe-oublie")}>Demander un nouveau lien</Lien>}
    >
      <Colonne>
        <Champ
          libelle={`Nouveau mot de passe (${LONGUEUR_MINIMALE} caractères minimum)`} type="password"
          valeur={motDePasse} onChange={setMotDePasse} largeur="100%" onEntree={soumettre}
          attributs={{ autoComplete: "new-password", autoFocus: true }}
        />
        <div className="carte-note" style={{ marginTop: -4 }}>
          {tropCourt
            ? `Encore ${LONGUEUR_MINIMALE - motDePasse.length} caractère${LONGUEUR_MINIMALE - motDePasse.length > 1 ? "s" : ""}.`
            : "Les sessions ouvertes sur vos autres appareils seront fermées."}
        </div>
        <button
          className="btn" style={{ width: "100%" }} onClick={soumettre}
          disabled={occupe || motDePasse.length < LONGUEUR_MINIMALE}
        >
          {occupe ? "Enregistrement…" : "Enregistrer et se connecter"}
        </button>
      </Colonne>
    </Cadre>
  );
}

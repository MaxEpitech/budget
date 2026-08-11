import { useState, useEffect, useRef } from "react";
import { api } from "../api.js";
import Cadre, { Lien } from "./Cadre.jsx";

/**
 * Écran atteint depuis le lien reçu par email (/valider?jeton=…).
 * La confirmation est envoyée en POST au chargement : le lien lui-même reste
 * une simple visite de page, que les clients mail peuvent précharger sans le
 * consommer.
 */
export default function Validation({ jeton, onConnecte, allerVers }) {
  const [erreur, setErreur] = useState(null);
  const lance = useRef(false);

  useEffect(() => {
    // React exécute deux fois les effets en mode strict ; le jeton étant à usage
    // unique, un second envoi échouerait et afficherait une erreur à tort.
    if (lance.current) return;
    lance.current = true;
    api.validerEmail(jeton).then(onConnecte, (e) => setErreur(e.message));
  }, [jeton, onConnecte]);

  if (!erreur) {
    return (
      <Cadre titre="Confirmation de votre adresse">
        <p style={{ margin: 0 }}>Un instant, nous confirmons votre adresse…</p>
      </Cadre>
    );
  }

  return (
    <Cadre
      titre="Confirmation impossible"
      erreur={erreur}
      bas={<Lien onClick={() => allerVers("connexion")}>Retour à la connexion</Lien>}
    >
      <p style={{ margin: 0 }}>
        Ce lien a peut-être déjà servi, ou dépassé ses 24 heures. Connectez-vous avec vos identifiants :
        un nouvel envoi vous sera proposé.
      </p>
    </Cadre>
  );
}

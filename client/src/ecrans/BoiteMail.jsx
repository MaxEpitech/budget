import { useState } from "react";
import { api } from "../api.js";
import Cadre, { Lien } from "./Cadre.jsx";

/** Écran d'attente après l'inscription : le compte existe, l'adresse reste à confirmer. */
export default function BoiteMail({ email, allerVers }) {
  const [message, setMessage] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const renvoyer = async () => {
    setOccupe(true);
    setErreur(null);
    try {
      setMessage((await api.renvoyerValidation(email)).message);
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Cadre
      titre="Vérifiez votre boîte mail"
      erreur={erreur}
      message={message}
      bas={<Lien onClick={() => allerVers("connexion")}>Retour à la connexion</Lien>}
    >
      <p style={{ margin: 0 }}>
        Un email vient d'être envoyé à <strong>{email}</strong>. Ouvrez le lien qu'il contient pour confirmer
        votre adresse — c'est ce qui débloque la connexion.
      </p>
      <div className="carte-note" style={{ marginTop: 12 }}>
        Le lien est valable 24 heures. Rien reçu au bout de quelques minutes ? Regardez les indésirables,
        puis demandez un nouvel envoi.
      </div>
      <button className="btn fant" style={{ width: "100%", marginTop: 14 }} onClick={renvoyer} disabled={occupe}>
        {occupe ? "Envoi…" : "Renvoyer l'email"}
      </button>
    </Cadre>
  );
}

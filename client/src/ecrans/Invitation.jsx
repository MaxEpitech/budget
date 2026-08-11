import { useState, useEffect } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Cadre, { Colonne, Lien } from "./Cadre.jsx";

const LONGUEUR_MINIMALE = 12;

/**
 * Écran atteint depuis un lien d'invitation (/invitation?jeton=…).
 *
 * L'invitation est d'abord lue sans être consommée : il faut savoir s'il faut
 * demander un mot de passe ou une connexion avant de brûler le lien.
 */
export default function Invitation({ jeton, onConnecte, allerVers }) {
  const [apercu, setApercu] = useState(undefined); // undefined : en cours
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let vivant = true;
    api.lireInvitation(jeton).then(
      (r) => vivant && setApercu(r),
      (e) => vivant && (setApercu(null), setErreur(e.message)),
    );
    return () => { vivant = false; };
  }, [jeton]);

  const accepter = async () => {
    if (occupe) return;
    setOccupe(true);
    setErreur(null);
    try {
      onConnecte(await api.accepterInvitation(jeton, motDePasse || undefined));
    } catch (e) {
      setErreur(e.message);
      setOccupe(false);
    }
  };

  if (apercu === undefined) {
    return (
      <Cadre titre="Invitation">
        <p style={{ margin: 0 }}>Un instant…</p>
      </Cadre>
    );
  }

  if (!apercu) {
    return (
      <Cadre
        titre="Invitation invalide"
        erreur={erreur}
        bas={<Lien onClick={() => allerVers("connexion")}>Aller à la connexion</Lien>}
      >
        <p style={{ margin: 0 }}>
          Ce lien a peut-être déjà servi, été révoqué, ou dépassé ses sept jours. Demandez à la
          personne qui vous a invité de vous en envoyer un nouveau.
        </p>
      </Cadre>
    );
  }

  const tropCourt = motDePasse.length > 0 && motDePasse.length < LONGUEUR_MINIMALE;

  return (
    <Cadre
      titre="Rejoindre un budget"
      note={apercu.email}
      erreur={erreur}
      liens={allerVers}
      bas={<Lien onClick={() => allerVers("connexion")}>Aller à la connexion</Lien>}
    >
      <p style={{ margin: "0 0 14px" }}>
        Vous êtes invité à partager la gestion d'un budget
        {apercu.membre ? <> en tant que <strong>{apercu.membre.nom}</strong></> : null}. Vous y
        verrez les mêmes chiffres, et pourrez les modifier.
      </p>

      {apercu.compteExistant ? (
        <>
          <div className="carte-note">
            Un compte existe déjà pour cette adresse. Connectez-vous avec, puis rouvrez ce lien —
            votre compte rejoindra alors le foyer.
          </div>
          <button className="btn" style={{ width: "100%", marginTop: 14 }} onClick={() => allerVers("connexion")}>
            Se connecter
          </button>
        </>
      ) : (
        <Colonne>
          <Champ
            libelle={`Choisissez un mot de passe (${LONGUEUR_MINIMALE} caractères minimum)`}
            type="password" valeur={motDePasse} onChange={setMotDePasse} largeur="100%"
            onEntree={accepter} attributs={{ autoComplete: "new-password", autoFocus: true }}
          />
          <div className="carte-note" style={{ marginTop: -4 }}>
            {tropCourt
              ? `Encore ${LONGUEUR_MINIMALE - motDePasse.length} caractère${LONGUEUR_MINIMALE - motDePasse.length > 1 ? "s" : ""}.`
              : "Une phrase entière vaut mieux qu'un mot compliqué."}
          </div>
          <button
            className="btn" style={{ width: "100%" }} onClick={accepter}
            disabled={occupe || motDePasse.length < LONGUEUR_MINIMALE}
          >
            {occupe ? "Création…" : "Rejoindre le foyer"}
          </button>
        </Colonne>
      )}
    </Cadre>
  );
}

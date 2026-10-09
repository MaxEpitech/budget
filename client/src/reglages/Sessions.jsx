import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import Carte from "../composants/Carte.jsx";
import Icone from "../composants/Icone.jsx";
import { ilYA } from "../utiles.js";

/**
 * Les connexions ouvertes de son compte, et de quoi les fermer.
 *
 * C'est le seul moyen de repérer une connexion qu'on n'a pas ouverte — et de la
 * refermer sans changer de mot de passe. D'autant plus utile qu'un foyer partagé
 * multiplie les accès.
 */
export default function Sessions() {
  const [sessions, setSessions] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      setSessions(await api.sessions());
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const fermer = async (id) => {
    setOccupe(true);
    setErreur(null);
    try {
      await api.fermerSession(id);
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <Carte
      titre="Connexions ouvertes"
      note="Une connexion que vous ne reconnaissez pas ? Fermez-la, puis changez de mot de passe."
    >
      {erreur && <div className="corps"><div className="avis alerte" role="alert" style={{ marginTop: 0 }}>{erreur}</div></div>}
      {!sessions && !erreur && <div className="vide">Chargement…</div>}
      {sessions?.map((s) => (
        <div className="ligne" key={s.id}>
          <span className="ligne-avatar" aria-hidden="true"><Icone nom="appareil" taille={16} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="ligne-lib">
              {s.appareil ?? "Appareil inconnu"}{" "}
              {s.actuelle && <span className="etiq perso" style={{ "--teinte": "var(--accent)" }}>cet appareil</span>}
            </div>
            <div className="ligne-meta">Active {ilYA(s.derniereActivite)} · ouverte {ilYA(s.creeLe)}</div>
          </div>
          {!s.actuelle && (
            <button className="btn fant mini pousse" onClick={() => fermer(s.id)} disabled={occupe}>
              Fermer
            </button>
          )}
        </div>
      ))}
    </Carte>
  );
}

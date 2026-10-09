import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
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

  if (!sessions) return null;

  return (
    <div className="corps" style={{ borderTop: "1px solid var(--filet-fin)" }}>
      <div className="stat-lib">Connexions ouvertes</div>
      {erreur && <div className="avis alerte" role="alert">{erreur}</div>}
      <div style={{ marginTop: 8 }}>
        {sessions.map((s) => (
          <div key={s.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 0", flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14 }}>
                {s.appareil ?? "Appareil inconnu"}{" "}
                {s.actuelle && <span className="etiq">cet appareil</span>}
              </div>
              <div className="ligne-meta">Active {ilYA(s.derniereActivite)} · ouverte {ilYA(s.creeLe)}</div>
            </div>
            {!s.actuelle && (
              <button className="btn fant mini" onClick={() => fermer(s.id)} disabled={occupe}>
                Fermer
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="carte-note" style={{ marginTop: 8 }}>
        Une connexion que vous ne reconnaissez pas ? Fermez-la, puis changez de mot de passe — cela
        referme aussi toutes les autres.
      </div>
    </div>
  );
}

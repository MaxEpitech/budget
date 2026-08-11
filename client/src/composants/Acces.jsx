import { useState, useEffect, useCallback } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Carte from "./Carte.jsx";
import BoutonConfirme from "./BoutonConfirme.jsx";

/**
 * Qui a accès au foyer : les comptes, et les invitations en attente.
 *
 * Cette carte se charge elle-même plutôt que d'attendre son contenu de l'état
 * du mois : les accès n'ont rien à voir avec le budget affiché, et les
 * recharger à chaque changement de mois n'aurait pas de sens.
 */
export default function Acces({ membres }) {
  const [acces, setAcces] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [occupe, setOccupe] = useState(false);
  const [invitation, setInvitation] = useState({ email: "", role: "membre", membreId: "" });

  const charger = useCallback(async () => {
    try {
      setAcces(await api.acces());
      setErreur(null);
    } catch (e) {
      setErreur(e.message);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  const agir = async (action) => {
    setOccupe(true);
    setErreur(null);
    try {
      await action();
      await charger();
    } catch (e) {
      setErreur(e.message);
    } finally {
      setOccupe(false);
    }
  };

  const envoyer = () => {
    if (!invitation.email.trim()) return;
    agir(async () => {
      await api.inviter(invitation.email, invitation.role, invitation.membreId || null);
      setInvitation({ email: "", role: "membre", membreId: "" });
    });
  };

  if (!acces) {
    return (
      <Carte titre="Qui a accès">
        <div className="corps">{erreur ? <div className="avis alerte">{erreur}</div> : "Chargement…"}</div>
      </Carte>
    );
  }

  const jeSuisProprietaire = acces.comptes.find((c) => c.id === acces.moi)?.role === "proprietaire";
  // Un membre déjà incarné par un compte ne peut pas être proposé deux fois.
  const membresLibres = membres.filter((m) => !acces.comptes.some((c) => c.membreId === m.id));
  const nomDuMembre = (id) => membres.find((m) => m.id === id)?.nom;

  return (
    <Carte titre="Qui a accès" note="Les comptes qui peuvent consulter et modifier ce budget">
      {erreur && <div className="corps"><div className="avis alerte" style={{ marginTop: 0 }}>{erreur}</div></div>}

      {acces.comptes.map((c) => (
        <div className="ligne" key={c.id}>
          <div style={{ minWidth: 0 }}>
            <div className="ligne-lib">
              {c.email} {c.id === acces.moi && <span className="etiq">vous</span>}
            </div>
            <div className="ligne-meta">
              {c.role === "proprietaire" ? "Propriétaire" : "Membre"}
              {c.membreId && ` · ${nomDuMembre(c.membreId) ?? "membre du budget"}`}
              {!c.emailValide && " · adresse non confirmée"}
            </div>
          </div>
          {jeSuisProprietaire && (
            <div className="pousse forme" style={{ justifyContent: "flex-end" }}>
              <Champ
                libelle="Rôle" valeur={c.role} largeur={130} disabled={occupe}
                onChange={(v) => agir(() => api.changerRole(c.id, v))}
                options={[{ v: "proprietaire", l: "Propriétaire" }, { v: "membre", l: "Membre" }]}
              />
              {c.id !== acces.moi && (
                <BoutonConfirme
                  libelle="Retirer" confirmation="Retirer l'accès" disabled={occupe}
                  onConfirme={() => agir(() => api.retirerAcces(c.id))}
                />
              )}
            </div>
          )}
        </div>
      ))}

      {acces.invitations.map((i) => (
        <div className="ligne" key={i.id}>
          <div style={{ minWidth: 0 }}>
            <div className="ligne-lib">{i.email}</div>
            <div className="ligne-meta">
              Invitation en attente · {i.role === "proprietaire" ? "Propriétaire" : "Membre"}
              {i.membreId && ` · ${nomDuMembre(i.membreId) ?? "membre du budget"}`}
            </div>
          </div>
          {jeSuisProprietaire && (
            <button className="suppr pousse" style={{ opacity: 1 }} disabled={occupe}
              onClick={() => agir(() => api.revoquerInvitation(i.id))} aria-label={`Révoquer l'invitation de ${i.email}`}>×</button>
          )}
        </div>
      ))}

      {jeSuisProprietaire && (
        <div className="corps">
          <div className="forme">
            <Champ
              libelle="Inviter une adresse" type="email" valeur={invitation.email} largeur={220}
              placeholder="conjoint@exemple.fr" onEntree={envoyer}
              onChange={(v) => setInvitation({ ...invitation, email: v })}
            />
            <Champ
              libelle="Rôle" valeur={invitation.role} largeur={130}
              onChange={(v) => setInvitation({ ...invitation, role: v })}
              options={[{ v: "membre", l: "Membre" }, { v: "proprietaire", l: "Propriétaire" }]}
            />
            {membresLibres.length > 0 && (
              <Champ
                libelle="Qui est-ce ?" valeur={invitation.membreId} largeur={150}
                onChange={(v) => setInvitation({ ...invitation, membreId: v })}
                options={[{ v: "", l: "Personne du budget" }, ...membresLibres.map((m) => ({ v: m.id, l: m.nom }))]}
              />
            )}
            <button className="btn" onClick={envoyer} disabled={occupe || !invitation.email.trim()}>
              {occupe ? "Envoi…" : "Inviter"}
            </button>
          </div>
          <div className="carte-note" style={{ marginTop: 10 }}>
            La personne recevra un lien valable sept jours. Le désigner comme quelqu'un du budget
            relie son compte à ce membre — utile pour savoir qui est qui.
          </div>
        </div>
      )}
    </Carte>
  );
}

// Projets — logique du prototype ; seules les écritures passent par l'API.
// « Verser » enregistre désormais un mouvement dans l'historique : l'épargne
// d'un projet est la somme de ses versements, plus un total écrasé.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import Icone from "../composants/Icone.jsx";
import EtatVide from "../composants/EtatVide.jsx";
import Dialogue from "../composants/Dialogue.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import { euro, euroPrecis, num, libelleMois, libelleDate, moisCle, decalerMois, ecartMois, teinteMembre, verseCeMois } from "../utiles.js";

export default function Projets({ etat, mois, executer, modifier, supprimer }) {
  const [f, setF] = useState({ libelle: "", objectif: "", echeance: decalerMois(mois, 12), versement: "" });
  const [historique, setHistorique] = useState(null);
  const [ajout, setAjout] = useState(false);
  // Qui met au pot, choisi projet par projet ; « foyer » par défaut.
  const [contributeurs, setContributeurs] = useState({});
  const contributeurDe = (id) => contributeurs[id] ?? "foyer";
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : etat.membres.find((m) => m.id === cle)?.nom || "—");
  const teinteDe = (cle) => teinteMembre(etat.membres, cle);

  const valide = f.libelle.trim() && num(f.objectif) > 0;
  const ajouter = () => {
    if (!valide) return;
    executer(() =>
      api.creerProjet({
        libelle: f.libelle.trim(),
        objectif: num(f.objectif),
        echeance: f.echeance,
        versement: num(f.versement),
      })
    );
    setF({ libelle: "", objectif: "", echeance: decalerMois(mois, 12), versement: "" });
    setAjout(false);
  };

  // Même effet que le prototype : le versement est plafonné à ce qui manque.
  const verser = (p) => {
    const montant = Math.min(p.versement, Math.max(0, p.objectif - p.epargne));
    if (montant <= 0) return;
    executer(() => api.verser(p.id, montant, contributeurDe(p.id)));
  };

  const boutonAjout = (
    <button className="btn" onClick={() => setAjout(true)}>
      <Icone nom="plus" /> Nouveau projet
    </button>
  );
  const totalEpargne = etat.projets.reduce((s, p) => s + p.epargne, 0);
  const totalObjectif = etat.projets.reduce((s, p) => s + p.objectif, 0);

  return (
    <>
      <EnTetePage
        titre="Projets"
        description={
          etat.projets.length
            ? `${euro(totalEpargne)} mis de côté sur ${euro(totalObjectif)} visés`
            : "Un objectif, une date, un versement mensuel"
        }
        actions={boutonAjout}
      />

      {etat.projets.length === 0 && (
        <Carte>
          <EtatVide
            icone="projets"
            titre="Aucun projet"
            texte="Créez une enveloppe pour un voyage, des travaux, un achat : l'application vous dit combien verser chaque mois pour être prêt à temps."
            action={boutonAjout}
          />
        </Carte>
      )}

      <div className="grille">
        {etat.projets.map((p) => {
          const restant = Math.max(0, p.objectif - p.epargne);
          const moisRestants = Math.max(1, ecartMois(mois, p.echeance));
          const requis = restant / moisRestants;
          const suffisant = p.versement >= requis - 0.5;
          const pct = (p.epargne / Math.max(1, p.objectif)) * 100;
          // Le budget compte ce versement tous les mois ; encore faut-il
          // qu'il ait eu lieu. Sur un mois passé le constat reste vrai, mais
          // n'appelle plus d'action : on ne verse qu'aujourd'hui, et
          // antidater un versement mentirait sur la date du mouvement.
          const manquant = p.versement > 0 && !verseCeMois(p.versements, mois) && restant > 0;
          const aRelancer = manquant && mois === moisCle();
          return (
            <div key={p.id} className="carte projet">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div className="ligne-lib">{p.libelle}</div>
                <button className="suppr" onClick={() => supprimer("projets", p.id, p.libelle)} aria-label={`Supprimer ${p.libelle}`}><Icone nom="corbeille" taille={16} /></button>
              </div>
              <div className="chiffre" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
                {euro(p.epargne)} <span style={{ color: "var(--doux)", fontSize: 14, fontWeight: 400 }}>/ {euro(p.objectif)}</span>
              </div>
              <Jauge pct={pct} couleur="var(--ocre)" />
              <div className="carte-note" style={{ marginTop: 7 }}>
                Échéance {libelleMois(p.echeance)} · {moisRestants} mois · il manque {euro(restant)}
              </div>
              <div className={`avis ${suffisant ? "ok" : "alerte"}`}>
                {suffisant
                  ? `À ${euro(p.versement)}/mois, l'objectif est tenu.`
                  : `Il faudrait ${euro(requis)}/mois (soit ${euro(requis - p.versement)} de plus).`}
              </div>
              {manquant && (
                <div className="avis alerte">
                  Rien versé en {libelleMois(mois).toLowerCase()}.
                </div>
              )}
              <div className="grille-form">
                <Champ libelle="Versement /mois" valeur={String(p.versement)} onChange={(v) => modifier("projets", p.id, { versement: num(v) })} largeur="100%" attributs={{ inputMode: "decimal" }} />
                <Champ libelle="Échéance" valeur={p.echeance} onChange={(v) => v && modifier("projets", p.id, { echeance: v })} largeur="100%" type="month" />
                <Champ classe="plein" libelle="Qui met au pot" valeur={contributeurDe(p.id)} onChange={(v) => setContributeurs({ ...contributeurs, [p.id]: v })} largeur="100%"
                  options={[{ v: "foyer", l: "Foyer" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                <button className={`btn mini ${aRelancer ? "" : "fant"}`} onClick={() => verser(p)}>
                  Verser {euro(p.versement)}
                </button>
                {!suffisant && (
                  <button className="btn fant mini" onClick={() => modifier("projets", p.id, { versement: Math.ceil(requis) })}>
                    Caler sur l'objectif
                  </button>
                )}
                {p.versements.length > 0 && (
                  <button className="btn fant mini" onClick={() => setHistorique(historique === p.id ? null : p.id)}>
                    {historique === p.id ? "Masquer" : `Historique (${p.versements.length})`}
                  </button>
                )}
              </div>
              {historique === p.id && <Historique projet={p} nomDe={nomDe} teinteDe={teinteDe} executer={executer} />}
            </div>
          );
        })}
      </div>

      <Dialogue
        ouvert={ajout}
        onFermer={() => setAjout(false)}
        titre="Nouveau projet"
        note="L'application calcule le versement mensuel qu'il faut pour être prêt à temps"
        pied={
          <>
            <button className="btn fant" onClick={() => setAjout(false)}>Annuler</button>
            <button className="btn" onClick={ajouter} disabled={!valide}>Créer le projet</button>
          </>
        }
      >
        <div className="grille-form">
          <Champ classe="plein" libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%" placeholder="Ex. Voyage Japon" onEntree={ajouter} />
          <Champ libelle="Objectif (€)" valeur={f.objectif} onChange={(v) => setF({ ...f, objectif: v })} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Pour quand" valeur={f.echeance} onChange={(v) => setF({ ...f, echeance: v })} largeur="100%" type="month" />
          <Champ classe="plein" libelle="Versement prévu /mois (€)" valeur={f.versement} onChange={(v) => setF({ ...f, versement: v })} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
        </div>
        {num(f.objectif) > 0 && f.echeance && (
          <div className="avis ok">
            Pour y arriver, il faut verser {euro(num(f.objectif) / Math.max(1, ecartMois(mois, f.echeance)))} par mois
            pendant {Math.max(1, ecartMois(mois, f.echeance))} mois.
          </div>
        )}
      </Dialogue>
    </>
  );
}

// Mouvements de l'enveloppe, du plus récent au plus ancien (ordre servi par l'API),
// avec qui a mis au pot et le cumul par contributeur.
function Historique({ projet, nomDe, teinteDe, executer }) {
  const versements = projet.versements;
  const total = versements.reduce((s, v) => s + v.montant, 0);

  // Cumul par contributeur, dans l'ordre d'apparition dans l'historique.
  const parContributeur = [];
  for (const v of versements) {
    const trouve = parContributeur.find((c) => c.pour === v.pour);
    if (trouve) trouve.montant += v.montant;
    else parContributeur.push({ pour: v.pour, montant: v.montant });
  }

  return (
    <div style={{ marginTop: 10, paddingTop: 9, borderTop: "1px solid var(--trait)" }}>
      {versements.map((v) => (
        <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "3px 0" }}>
          <span className="ligne-meta">
            <span className="etiq perso" style={{ "--teinte": teinteDe(v.pour) }}>{nomDe(v.pour)}</span> · {libelleDate(v.date)}
            {v.libelle && <> · {v.libelle}</>}
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span className="chiffre" style={{ fontSize: 13, fontWeight: 600, color: "var(--caisse)" }}>+{euroPrecis(v.montant)}</span>
            {/* L'épargne du projet étant la somme des versements, la retirer
                corrige le total sans qu'aucun recalcul soit nécessaire. */}
            <button className="suppr" onClick={() => executer(() => api.supprimerVersement(projet.id, v.id))}
              aria-label={`Supprimer le versement du ${libelleDate(v.date)}`}><Icone nom="corbeille" taille={16} /></button>
          </span>
        </div>
      ))}
      <div style={{ marginTop: 4, paddingTop: 6, borderTop: "1px solid var(--filet-fin)" }}>
        {parContributeur.length > 1 &&
          parContributeur.map((c) => (
            <div key={c.pour} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "2px 0" }}>
              <span className="ligne-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span className="pastille" style={{ background: teinteDe(c.pour) }} />
                {nomDe(c.pour)}
              </span>
              <span className="chiffre" style={{ fontSize: 13 }}>{euroPrecis(c.montant)}</span>
            </div>
          ))}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingTop: parContributeur.length > 1 ? 4 : 0 }}>
          <span className="ligne-meta">{versements.length} versement{versements.length > 1 ? "s" : ""}</span>
          <span className="chiffre" style={{ fontSize: 13, fontWeight: 600 }}>{euroPrecis(total)}</span>
        </div>
      </div>
    </div>
  );
}

// Onglet Projets — logique du prototype ; seules les écritures passent par l'API.
// « Verser » enregistre désormais un mouvement dans l'historique : l'épargne
// d'un projet est la somme de ses versements, plus un total écrasé.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import { euro, euroPrecis, num, libelleMois, libelleDate, decalerMois, ecartMois, teinteMembre } from "../utiles.js";

export default function Projets({ etat, mois, executer, modifier, supprimer }) {
  const [f, setF] = useState({ libelle: "", objectif: "", echeance: decalerMois(mois, 12), versement: "" });
  const [historique, setHistorique] = useState(null);
  // Qui met au pot, choisi projet par projet ; « foyer » par défaut.
  const [contributeurs, setContributeurs] = useState({});
  const contributeurDe = (id) => contributeurs[id] ?? "foyer";
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : etat.membres.find((m) => m.id === cle)?.nom || "—");
  const teinteDe = (cle) => teinteMembre(etat.membres, cle);

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.objectif) <= 0) return;
    executer(() =>
      api.creerProjet({
        libelle: f.libelle.trim(),
        objectif: num(f.objectif),
        echeance: f.echeance,
        versement: num(f.versement),
      })
    );
    setF({ libelle: "", objectif: "", echeance: decalerMois(mois, 12), versement: "" });
  };

  // Même effet que le prototype : le versement est plafonné à ce qui manque.
  const verser = (p) => {
    const montant = Math.min(p.versement, Math.max(0, p.objectif - p.epargne));
    if (montant <= 0) return;
    executer(() => api.verser(p.id, montant, contributeurDe(p.id)));
  };

  return (
    <>
      <Carte titre="Enveloppes projet" note="Un objectif, une date, un versement mensuel">
        <div className="corps">
          <div className="grille">
            {etat.projets.map((p) => {
              const restant = Math.max(0, p.objectif - p.epargne);
              const moisRestants = Math.max(1, ecartMois(mois, p.echeance));
              const requis = restant / moisRestants;
              const suffisant = p.versement >= requis - 0.5;
              const pct = (p.epargne / Math.max(1, p.objectif)) * 100;
              return (
                <div key={p.id} className="projet">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div className="ligne-lib">{p.libelle}</div>
                    <button className="suppr" style={{ opacity: 1 }} onClick={() => supprimer("projets", p.id, p.libelle)} aria-label={`Supprimer ${p.libelle}`}>×</button>
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
                  <div className="forme" style={{ marginTop: 10 }}>
                    <Champ libelle="Versement /mois" valeur={String(p.versement)} onChange={(v) => modifier("projets", p.id, { versement: num(v) })} largeur={110} />
                    <Champ libelle="Échéance" valeur={p.echeance} onChange={(v) => v && modifier("projets", p.id, { echeance: v })} largeur={130} type="month" />
                    <Champ libelle="Qui met" valeur={contributeurDe(p.id)} onChange={(v) => setContributeurs({ ...contributeurs, [p.id]: v })} largeur={120}
                      options={[{ v: "foyer", l: "Foyer" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="btn mini" onClick={() => verser(p)}>
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
                  {historique === p.id && <Historique versements={p.versements} nomDe={nomDe} teinteDe={teinteDe} />}
                </div>
              );
            })}
          </div>
          {etat.projets.length === 0 && <div className="vide">Aucun projet. Créez une enveloppe pour un voyage, des travaux, un achat.</div>}
        </div>
      </Carte>

      <Carte titre="Nouveau projet">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur={180} placeholder="Ex. Voyage Japon" onEntree={ajouter} />
            <Champ libelle="Objectif" valeur={f.objectif} onChange={(v) => setF({ ...f, objectif: v })} largeur={110} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Pour quand" valeur={f.echeance} onChange={(v) => setF({ ...f, echeance: v })} largeur={130} type="month" />
            <Champ libelle="Versement /mois" valeur={f.versement} onChange={(v) => setF({ ...f, versement: v })} largeur={120} placeholder="0" onEntree={ajouter} />
            <button className="btn" onClick={ajouter}>Créer</button>
          </div>
        </div>
      </Carte>
    </>
  );
}

// Mouvements de l'enveloppe, du plus récent au plus ancien (ordre servi par l'API),
// avec qui a mis au pot et le cumul par contributeur.
function Historique({ versements, nomDe, teinteDe }) {
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
        <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "3px 0" }}>
          <span className="ligne-meta">
            <span className="etiq perso" style={{ "--teinte": teinteDe(v.pour) }}>{nomDe(v.pour)}</span> · {libelleDate(v.date)}
          </span>
          <span className="chiffre" style={{ fontSize: 13, fontWeight: 600, color: "var(--caisse)" }}>+{euroPrecis(v.montant)}</span>
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

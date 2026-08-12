// Onglet Flux — logique du prototype ; seules les écritures passent par l'API.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import { euro, num, libelleMois, CATEGORIES } from "../utiles.js";

const RYTHMES = [
  { cle: "mensuel", nom: "Tous les mois" },
  { cle: "trimestriel", nom: "Tous les 3 mois" },
  { cle: "semestriel", nom: "Tous les 6 mois" },
  { cle: "annuel", nom: "Tous les ans" },
];

/** « Tous les 3 mois · depuis mars 2026 · jusqu'à juin 2027 » */
function decrireRythme(t) {
  const rythme = RYTHMES.find((r) => r.cle === t.periodicite)?.nom ?? "Tous les mois";
  const morceaux = [rythme.toLowerCase()];
  if (t.debut) morceaux.push(`depuis ${libelleMois(t.debut).toLowerCase()}`);
  if (t.fin) morceaux.push(`jusqu'à ${libelleMois(t.fin).toLowerCase()}`);
  return morceaux.join(" · ");
}

export default function Flux({ etat, calc, mois, executer, supprimer }) {
  const [f, setF] = useState({
    libelle: "", montant: "", categorie: "Courses", pour: "foyer", type: "depense",
    recurrent: true, periodicite: "mensuel", debut: "", fin: "",
  });

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.montant) <= 0) return;
    executer(() =>
      api.creerTransaction({
        type: f.type,
        libelle: f.libelle.trim(),
        montant: num(f.montant),
        categorie: f.categorie,
        pour: f.pour,
        recurrent: f.recurrent,
        mois: f.recurrent ? null : mois,
        periodicite: f.periodicite,
        // Un rythme non mensuel a besoin d'un ancrage ; à défaut, le mois affiché.
        debut: f.recurrent ? (f.debut || (f.periodicite !== "mensuel" ? mois : null)) : null,
        fin: f.recurrent ? (f.fin || null) : null,
      })
    );
    setF({ ...f, libelle: "", montant: "" });
  };

  const retirer = (t) => supprimer("transactions", t.id, t.libelle);
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : etat.membres.find((m) => m.id === cle)?.nom || "—");

  const recurrents = calc.actifs.filter((t) => t.recurrent);
  const ponctuels = calc.actifs.filter((t) => !t.recurrent);

  return (
    <>
      <Carte titre="Ajouter une ligne">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Type" valeur={f.type} onChange={(v) => setF({ ...f, type: v })} largeur={110}
              options={[{ v: "depense", l: "Dépense" }, { v: "revenu", l: "Revenu" }]} />
            <Champ libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur={180} placeholder="Ex. Internet" onEntree={ajouter} />
            <Champ libelle="Montant" valeur={f.montant} onChange={(v) => setF({ ...f, montant: v })} largeur={100} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Catégorie" valeur={f.categorie} onChange={(v) => setF({ ...f, categorie: v })} largeur={140} options={CATEGORIES} />
            <Champ libelle="Pour qui" valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur={120}
              options={[{ v: "foyer", l: "Foyer" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
            <label className="bascule">
              <input type="checkbox" checked={f.recurrent} onChange={(e) => setF({ ...f, recurrent: e.target.checked })} />
              Revient régulièrement
            </label>
            {f.recurrent && (
              <>
                <Champ libelle="Rythme" valeur={f.periodicite} onChange={(v) => setF({ ...f, periodicite: v })} largeur={130}
                  options={RYTHMES.map((r) => ({ v: r.cle, l: r.nom }))} />
                <Champ libelle={f.periodicite === "mensuel" ? "Depuis (facultatif)" : "1er prélèvement"}
                  valeur={f.debut} onChange={(v) => setF({ ...f, debut: v })} largeur={130} type="month" />
                <Champ libelle="Jusqu'à (facultatif)" valeur={f.fin} onChange={(v) => setF({ ...f, fin: v })} largeur={130} type="month" />
              </>
            )}
            <button className="btn" onClick={ajouter}>Ajouter</button>
          </div>
          {f.recurrent && (
            <div className="carte-note" style={{ marginTop: 8 }}>
              Le montant est celui d'une échéance : une assurance annuelle de 240 € pèse 240 € sur
              le mois où elle est prélevée, pas 20 € tous les mois.
            </div>
          )}
        </div>
      </Carte>

      <Carte titre="Lignes régulières" note={`${recurrents.length} échéance${recurrents.length > 1 ? "s" : ""} ce mois-ci`}>
        {recurrents.length === 0 && <div className="vide">Aucune ligne récurrente. Les charges fixes se saisissent une fois pour toutes.</div>}
        {recurrents.map((t) => (
          <div className="ligne" key={t.id}>
            <div>
              <div className="ligne-lib">{t.libelle}</div>
              <div className="ligne-meta">
                <span className={`etiq ${t.pour !== "foyer" ? "perso" : ""}`}>{nomDe(t.pour)}</span> · {t.categorie} · {decrireRythme(t)}
              </div>
            </div>
            <div className="pousse chiffre montant" style={{ color: t.type === "revenu" ? "var(--caisse)" : undefined }}>
              {t.type === "revenu" ? "+" : "−"}{euro(t.montant)}
            </div>
            <button className="suppr" onClick={() => retirer(t)} aria-label={`Supprimer ${t.libelle}`}>×</button>
          </div>
        ))}
      </Carte>

      <Carte titre={`Ce mois-ci · ${libelleMois(mois)}`} note="Lignes ponctuelles">
        {ponctuels.length === 0 && <div className="vide">Rien d'exceptionnel ce mois-ci.</div>}
        {ponctuels.map((t) => (
          <div className="ligne" key={t.id}>
            <div>
              <div className="ligne-lib">{t.libelle}</div>
              <div className="ligne-meta">
                <span className={`etiq ${t.pour !== "foyer" ? "perso" : ""}`}>{nomDe(t.pour)}</span> · {t.categorie}
              </div>
            </div>
            <div className="pousse chiffre montant" style={{ color: t.type === "revenu" ? "var(--caisse)" : undefined }}>
              {t.type === "revenu" ? "+" : "−"}{euro(t.montant)}
            </div>
            <button className="suppr" onClick={() => retirer(t)} aria-label={`Supprimer ${t.libelle}`}>×</button>
          </div>
        ))}
      </Carte>

      <Carte titre="Qui paie quoi" note={etat.repartition === "prorata" ? "Charges communes au prorata des revenus" : "Charges communes partagées à parts égales"}>
        {calc.parMembre.map((m) => (
          <div className="corps" key={m.id} style={{ borderBottom: "1px solid #EDF1F3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div className="ligne-lib">{m.nom}</div>
                <div className="ligne-meta">
                  Revenus {euro(m.revenu + m.bonus)} · quote-part {Math.round(m.part * 100)}% ({euro(m.du)}) · perso {euro(m.perso)}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="stat-lib">Il lui reste</div>
                <div className="stat-val chiffre" style={{ color: m.reste < 0 ? "var(--brique)" : "var(--caisse)" }}>{euro(m.reste)}</div>
              </div>
            </div>
            <Jauge pct={(m.du + m.perso) / Math.max(1, m.revenu + m.bonus) * 100} couleur="var(--ardoise)" />
          </div>
        ))}
      </Carte>
    </>
  );
}

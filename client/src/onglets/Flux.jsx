// Onglet Flux — logique du prototype ; seules les écritures passent par l'API.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import { euro, num, libelleMois, CATEGORIES } from "../utiles.js";

export default function Flux({ etat, calc, mois, executer }) {
  const [f, setF] = useState({ libelle: "", montant: "", categorie: "Courses", pour: "foyer", type: "depense", recurrent: true });

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
      })
    );
    setF({ ...f, libelle: "", montant: "" });
  };

  const retirer = (id) => executer(() => api.supprimerTransaction(id));
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
              Tous les mois
            </label>
            <button className="btn" onClick={ajouter}>Ajouter</button>
          </div>
        </div>
      </Carte>

      <Carte titre="Tous les mois" note={`${recurrents.length} ligne${recurrents.length > 1 ? "s" : ""} récurrente${recurrents.length > 1 ? "s" : ""}`}>
        {recurrents.length === 0 && <div className="vide">Aucune ligne récurrente. Les charges fixes se saisissent une fois pour toutes.</div>}
        {recurrents.map((t) => (
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
            <button className="suppr" onClick={() => retirer(t.id)} aria-label={`Supprimer ${t.libelle}`}>×</button>
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
            <button className="suppr" onClick={() => retirer(t.id)} aria-label={`Supprimer ${t.libelle}`}>×</button>
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

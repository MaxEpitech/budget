// Onglet Crédits — logique du prototype ; seules les écritures passent par l'API.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import { euro, euroPrecis, num, libelleMois, decalerMois } from "../utiles.js";
import { capitalRestant } from "../finance.js";

export default function Credits({ etat, calc, mois, executer, supprimer }) {
  const [f, setF] = useState({ libelle: "", capital: "", taux: "", duree: "", debut: mois });
  const [ouvert, setOuvert] = useState(null);

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.capital) <= 0 || num(f.duree) <= 0) return;
    executer(() =>
      api.creerCredit({
        libelle: f.libelle.trim(),
        capital: num(f.capital),
        taux: num(f.taux),
        duree: Math.round(num(f.duree)),
        debut: f.debut,
      })
    );
    setF({ libelle: "", capital: "", taux: "", duree: "", debut: mois });
  };

  const totalRestant = calc.creditsActifs.reduce((s, c) => s + c.restant, 0);

  return (
    <>
      <div className="duo">
        <Carte titre="Mensualités">
          <div className="corps">
            <div className="stat-lib">Total dû chaque mois</div>
            <div className="stat-val chiffre">{euro(calc.credits)}</div>
            <div className="carte-note" style={{ marginTop: 4 }}>
              {calc.revenus ? Math.round((calc.credits / calc.revenus) * 100) : 0}% des revenus du foyer
            </div>
            <Jauge pct={calc.revenus ? (calc.credits / calc.revenus) * 100 : 0} couleur="var(--brique)" />
            {calc.revenus && calc.credits / calc.revenus > 0.35 ? (
              <div className="avis alerte">Au-dessus de 35% des revenus — seuil d'endettement habituellement retenu par les banques.</div>
            ) : (
              <div className="avis ok">Sous le seuil d'endettement de 35% généralement retenu.</div>
            )}
          </div>
        </Carte>
        <Carte titre="Capital restant dû">
          <div className="corps">
            <div className="stat-lib">Tous crédits confondus</div>
            <div className="stat-val chiffre">{euro(totalRestant)}</div>
            <div className="carte-note" style={{ marginTop: 4 }}>
              Emprunté au total : {euro(etat.credits.reduce((s, c) => s + c.capital, 0))}
            </div>
            <Jauge pct={100 - (totalRestant / Math.max(1, etat.credits.reduce((s, c) => s + c.capital, 0))) * 100} couleur="var(--caisse)" />
          </div>
        </Carte>
      </div>

      <Carte titre="Crédits en cours">
        {calc.creditsActifs.length === 0 && <div className="vide">Aucun crédit enregistré.</div>}
        {calc.creditsActifs.map((c) => {
          const restants = Math.max(0, c.duree - c.k);
          const fin = decalerMois(c.debut, c.duree);
          return (
            <div key={c.id}>
              <div className="ligne">
                <div style={{ minWidth: 0 }}>
                  <div className="ligne-lib">
                    {c.libelle} {c.solde && <span className="etiq" style={{ background: "#E7F2EE", color: "var(--caisse)" }}>Soldé</span>}
                  </div>
                  <div className="ligne-meta">
                    {euro(c.capital)} sur {c.duree} mois à {c.taux}% · échéance {libelleMois(fin)}
                    {!c.solde && ` · ${restants} mensualité${restants > 1 ? "s" : ""} restante${restants > 1 ? "s" : ""}`}
                  </div>
                </div>
                <div className="pousse" style={{ textAlign: "right" }}>
                  <div className="chiffre montant">{c.solde ? "—" : euro(c.mensualite) + " /mois"}</div>
                  <div className="ligne-meta">reste {euro(c.restant)}</div>
                </div>
                <button className="btn fant mini" onClick={() => setOuvert(ouvert === c.id ? null : c.id)}>
                  {ouvert === c.id ? "Masquer" : "Détail"}
                </button>
                <button className="suppr" onClick={() => supprimer("credits", c.id, c.libelle)} aria-label={`Supprimer ${c.libelle}`}>×</button>
              </div>
              {ouvert === c.id && <Amortissement credit={c} mois={mois} />}
            </div>
          );
        })}
      </Carte>

      <Carte titre="Ajouter un crédit">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur={170} placeholder="Ex. Prêt auto" onEntree={ajouter} />
            <Champ libelle="Capital emprunté" valeur={f.capital} onChange={(v) => setF({ ...f, capital: v })} largeur={130} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Taux annuel %" valeur={f.taux} onChange={(v) => setF({ ...f, taux: v })} largeur={110} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Durée (mois)" valeur={f.duree} onChange={(v) => setF({ ...f, duree: v })} largeur={110} placeholder="0" onEntree={ajouter} />
            <Champ libelle="1re échéance" valeur={f.debut} onChange={(v) => setF({ ...f, debut: v })} largeur={130} type="month" />
            <button className="btn" onClick={ajouter}>Ajouter</button>
          </div>
        </div>
      </Carte>
    </>
  );
}

function Amortissement({ credit, mois }) {
  const lignes = [];
  const r = credit.taux / 100 / 12;
  const M = credit.mensualite;
  let solde = capitalRestant(credit.capital, credit.taux, credit.duree, credit.k);
  const n = Math.min(12, credit.duree - credit.k);
  for (let i = 0; i < n; i++) {
    const interets = solde * r;
    const part = Math.min(M - interets, solde);
    solde = Math.max(0, solde - part);
    lignes.push({ mois: decalerMois(mois, i), interets, part, solde });
  }
  if (lignes.length === 0) return <div className="vide">Crédit soldé — plus d'échéance à venir.</div>;
  return (
    <div className="corps" style={{ background: "#F7F9FA" }}>
      <table className="amort">
        <thead>
          <tr><th>Échéance</th><th>Intérêts</th><th>Capital</th><th>Restant dû</th></tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.mois}>
              <td>{libelleMois(l.mois)}</td>
              <td className="chiffre" style={{ color: "var(--brique)" }}>{euroPrecis(l.interets)}</td>
              <td className="chiffre">{euroPrecis(l.part)}</td>
              <td className="chiffre">{euro(l.solde)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="carte-note" style={{ marginTop: 8 }}>12 prochaines échéances.</div>
    </div>
  );
}

// Onglet Crédits — logique du prototype ; seules les écritures passent par l'API.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import { euro, euroPrecis, num, libelleMois, decalerMois } from "../utiles.js";
import { capitalRestant, coutTotal, interetsPayes, rembourserParAnticipation, assurancePayee } from "../finance.js";

export default function Credits({ etat, calc, mois, executer, supprimer }) {
  const [f, setF] = useState({ libelle: "", capital: "", taux: "", duree: "", debut: mois, assuranceTaux: "", assuranceBase: "initial" });
  const [ouvert, setOuvert] = useState(null);
  // Un seul panneau ouvert à la fois : « amortissement » ou « anticipation ».
  const [panneau, setPanneau] = useState(null);

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.capital) <= 0 || num(f.duree) <= 0) return;
    executer(() =>
      api.creerCredit({
        libelle: f.libelle.trim(),
        capital: num(f.capital),
        taux: num(f.taux),
        duree: Math.round(num(f.duree)),
        debut: f.debut,
        assuranceTaux: num(f.assuranceTaux),
        assuranceBase: f.assuranceBase,
      })
    );
    setF({ libelle: "", capital: "", taux: "", duree: "", debut: mois, assuranceTaux: "", assuranceBase: "initial" });
  };

  const totalRestant = calc.creditsActifs.reduce((s, c) => s + c.restant, 0);
  // Ce que les emprunts coûtent en tout, et ce qu'ils ont déjà coûté. La
  // mensualité ne dit que ce qu'un crédit pèse chaque mois ; elle ne dit
  // jamais son prix.
  const totalInterets = etat.credits.reduce((s, c) => s + coutTotal(c.capital, c.taux, c.duree), 0);
  const interetsVerses = calc.creditsActifs.reduce((s, c) => s + interetsPayes(c.capital, c.taux, c.duree, c.k), 0);
  // L'assurance est comptée à part : ce n'est pas le prix de l'argent prêté,
  // mais celui d'une garantie. Les additionner masquerait laquelle peut se
  // renégocier — et c'est presque toujours l'assurance.
  const totalAssurance = etat.credits.reduce((s, c) => s + assurancePayee(c.capital, c.taux, c.duree, c.assuranceTaux ?? 0, c.assuranceBase, c.duree), 0);
  const assuranceVersee = calc.creditsActifs.reduce((s, c) => s + assurancePayee(c.capital, c.taux, c.duree, c.assuranceTaux ?? 0, c.assuranceBase, c.k), 0);
  const capitalEmprunte = etat.credits.reduce((s, c) => s + c.capital, 0);

  return (
    <>
      <div className="duo">
        <Carte titre="Mensualités">
          <div className="corps">
            <div className="stat-lib">Prélevé chaque mois, assurance comprise</div>
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

      {etat.credits.length > 0 && (
        <Carte titre="Coût des emprunts" note="Intérêts et assurance : tout ce que le crédit ajoute au prix">
          <div className="corps duo">
            <div>
              <div className="stat-lib">Coût sur toute la durée</div>
              <div className="stat-val chiffre" style={{ color: "var(--brique)" }}>{euro(totalInterets + totalAssurance)}</div>
              <div className="carte-note" style={{ marginTop: 4 }}>
                {euro(totalInterets)} d'intérêts
                {totalAssurance > 0 && ` et ${euro(totalAssurance)} d'assurance`}. Soit{" "}
                {euro(totalInterets + totalAssurance + capitalEmprunte)} déboursés pour {euro(capitalEmprunte)} empruntés.
              </div>
            </div>
            <div>
              <div className="stat-lib">Déjà payé à ce jour</div>
              <div className="stat-val chiffre">{euro(interetsVerses + assuranceVersee)}</div>
              <Jauge
                pct={totalInterets + totalAssurance ? ((interetsVerses + assuranceVersee) / (totalInterets + totalAssurance)) * 100 : 0}
                couleur="var(--brique)"
              />
              <div className="carte-note" style={{ marginTop: 7 }}>
                Reste {euro(Math.max(0, totalInterets + totalAssurance - interetsVerses - assuranceVersee))} à verser.
              </div>
            </div>
          </div>
        </Carte>
      )}

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
                    {c.libelle} {c.solde && <span className="etiq" style={{ background: "var(--ok-fond)", color: "var(--caisse)" }}>Soldé</span>}
                  </div>
                  <div className="ligne-meta">
                    {euro(c.capital)} sur {c.duree} mois à {c.taux}% · échéance {libelleMois(fin)}
                    {!c.solde && ` · ${restants} mensualité${restants > 1 ? "s" : ""} restante${restants > 1 ? "s" : ""}`}
                    {` · ${euro(coutTotal(c.capital, c.taux, c.duree))} d'intérêts`}
                    {c.assuranceTaux > 0 &&
                      ` · assurance ${c.assuranceTaux}% sur le capital ${c.assuranceBase === "restant" ? "restant dû" : "initial"}`}
                  </div>
                </div>
                <div className="pousse" style={{ textAlign: "right" }}>
                  <div className="chiffre montant">{c.solde ? "—" : euro(c.echeance) + " /mois"}</div>
                  <div className="ligne-meta">
                    {c.assurance > 0 && !c.solde && `dont ${euro(c.assurance)} d'assurance · `}
                    reste {euro(c.restant)}
                  </div>
                </div>
                {!c.solde && (
                  <button
                    className="btn fant mini"
                    onClick={() => { const actif = ouvert === c.id && panneau === "anticipation"; setOuvert(actif ? null : c.id); setPanneau(actif ? null : "anticipation"); }}
                  >
                    {ouvert === c.id && panneau === "anticipation" ? "Masquer" : "Anticiper"}
                  </button>
                )}
                <button
                  className="btn fant mini"
                  onClick={() => { const actif = ouvert === c.id && panneau === "amortissement"; setOuvert(actif ? null : c.id); setPanneau(actif ? null : "amortissement"); }}
                >
                  {ouvert === c.id && panneau === "amortissement" ? "Masquer" : "Détail"}
                </button>
                <button className="suppr" onClick={() => supprimer("credits", c.id, c.libelle)} aria-label={`Supprimer ${c.libelle}`}>×</button>
              </div>
              {ouvert === c.id && panneau === "amortissement" && <Amortissement credit={c} mois={mois} />}
              {ouvert === c.id && panneau === "anticipation" && <Anticipation credit={c} />}
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
            <Champ libelle="Assurance %/an" valeur={f.assuranceTaux} onChange={(v) => setF({ ...f, assuranceTaux: v })} largeur={120} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Assurance sur" valeur={f.assuranceBase} onChange={(v) => setF({ ...f, assuranceBase: v })} largeur={185}
              options={[{ v: "initial", l: "Le capital initial" }, { v: "restant", l: "Le capital restant dû" }]} />
            <button className="btn" onClick={ajouter}>Ajouter</button>
          </div>
        </div>
      </Carte>
    </>
  );
}

/**
 * Simulateur de remboursement anticipé.
 *
 * Les deux issues sont montrées côte à côte, jamais la seule plus rentable :
 * raccourcir la durée économise davantage, mais baisser la mensualité soulage
 * le budget tous les mois. Le choix dépend de ce qu'on cherche, et n'afficher
 * que le gain maximal escamoterait la question.
 */
function Anticipation({ credit }) {
  const [saisie, setSaisie] = useState("");
  const versement = num(saisie);
  const restant = capitalRestant(credit.capital, credit.taux, credit.duree, credit.k);
  const simulation = rembourserParAnticipation({
    capital: credit.capital,
    tauxAnnuel: credit.taux,
    dureeMois: credit.duree,
    echeancesPayees: credit.k,
    versement,
  });

  return (
    <div className="corps" style={{ background: "var(--survol)" }}>
      <div className="forme">
        <Champ
          libelle="Versement exceptionnel" valeur={saisie} onChange={setSaisie}
          largeur={170} placeholder="0"
        />
        <div className="carte-note" style={{ alignSelf: "center" }}>
          Sur {euro(restant)} restant dû.
        </div>
      </div>

      {versement > 0 && !simulation && (
        <div className="avis alerte">
          {versement >= restant
            ? "Ce versement solde le crédit : il ne s'agit plus d'un remboursement partiel."
            : "Montant invalide."}
        </div>
      )}

      {simulation && (
        <>
          <div className="duo" style={{ marginTop: 14 }}>
            <div>
              <div className="stat-lib">Garder la mensualité, finir plus tôt</div>
              <div className="stat-val chiffre" style={{ color: "var(--caisse)" }}>
                {euro(simulation.surDuree.economie)}
              </div>
              <div className="carte-note" style={{ marginTop: 4 }}>
                d'intérêts économisés · {simulation.surDuree.moisGagnes} mensualité{simulation.surDuree.moisGagnes > 1 ? "s" : ""} en moins,
                soit {Math.floor(simulation.surDuree.moisGagnes / 12)} an{Math.floor(simulation.surDuree.moisGagnes / 12) > 1 ? "s" : ""}
                {simulation.surDuree.moisGagnes % 12 ? ` et ${simulation.surDuree.moisGagnes % 12} mois` : ""}.
                Mensualité inchangée à {euro(simulation.mensualiteActuelle)}.
              </div>
            </div>
            <div>
              <div className="stat-lib">Garder la durée, payer moins chaque mois</div>
              <div className="stat-val chiffre" style={{ color: "var(--caisse)" }}>
                {euro(simulation.surMensualite.economie)}
              </div>
              <div className="carte-note" style={{ marginTop: 4 }}>
                d'intérêts économisés · {euro(simulation.surMensualite.mensualite)} par mois au lieu de {euro(simulation.mensualiteActuelle)},
                soit {euro(simulation.surMensualite.baisse)} de moins.
                Terme inchangé.
              </div>
            </div>
          </div>

          <div className="avis ok" style={{ marginTop: 14 }}>
            Sans rien faire, il reste {euro(simulation.interetsSansRien)} d'intérêts à payer sur ce crédit.
          </div>

          <div className="carte-note" style={{ marginTop: 12 }}>
            <strong>Indemnité de remboursement anticipé : jusqu'à {euro(simulation.indemnite)}.</strong>{" "}
            C'est le maximum que la loi autorise pour un prêt immobilier — un semestre d'intérêts sur
            la somme remboursée, plafonné à 3 % du capital restant dû. Votre contrat peut prévoir
            moins, et certaines situations en dispensent. Vérifiez-le avant de décider.
          </div>
        </>
      )}
    </div>
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
    <div className="corps" style={{ background: "var(--survol)", overflowX: "auto" }}>
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

// Crédits — logique du prototype ; seules les écritures passent par l'API.
import { useState } from "react";
import { api } from "../api.js";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import Icone from "../composants/Icone.jsx";
import EtatVide from "../composants/EtatVide.jsx";
import Dialogue from "../composants/Dialogue.jsx";
import EnTetePage from "../composants/EnTetePage.jsx";
import { euro, euroPrecis, num, libelleMois, libelleDate, deMois, decalerMois, ecartMois, moisCle, teinteMembre } from "../utiles.js";
import { mensualite, capitalRestant, coutTotal, interetsPayes, rembourserParAnticipation, assurancePayee } from "../finance.js";

/**
 * La durée qu'il faut pour rembourser `capital` à `mensualite` par mois : on
 * connaît souvent la mensualité de son contrat mieux que sa durée exacte.
 * null si la mensualité ne couvre même pas les intérêts.
 */
function dureePourMensualite(capital, tauxAnnuel, mensualiteVoulue) {
  if (!(capital > 0) || !(mensualiteVoulue > 0)) return null;
  const r = tauxAnnuel / 100 / 12;
  if (mensualiteVoulue <= capital * r) return null;
  const n = r === 0 ? capital / mensualiteVoulue : -Math.log(1 - (r * capital) / mensualiteVoulue) / Math.log(1 + r);
  // Un contrat arrondit sa mensualité au centime : 257,20 € pour 257,2017 € de
  // calcul fait 60,0003 échéances, et c'est bien un crédit sur 60 mois.
  return Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Math.ceil(n);
}

const VIERGE = (mois) => ({ libelle: "", capital: "", taux: "", duree: "", debut: mois, assuranceTaux: "", assuranceBase: "initial", pour: "foyer" });

export default function Credits({ etat, calc, mois, executer, supprimer }) {
  const [f, setF] = useState(VIERGE(mois));
  const [ouvert, setOuvert] = useState(null);
  const [ajout, setAjout] = useState(false);
  // Le crédit en cours de modification ; null pour un nouveau crédit.
  const [edition, setEdition] = useState(null);
  // La mensualité tapée, tant qu'on la tape : elle fixe alors la durée.
  const [mensualiteSaisie, setMensualiteSaisie] = useState("");

  const nouveau = () => { setEdition(null); setF(VIERGE(mois)); setMensualiteSaisie(""); setAjout(true); };
  const modifierCredit = (c) => {
    setEdition(c.id);
    setF({
      libelle: c.libelle, capital: String(c.capital), taux: String(c.taux), duree: String(c.duree), debut: c.debut,
      assuranceTaux: c.assuranceTaux ? String(c.assuranceTaux) : "", assuranceBase: c.assuranceBase ?? "initial", pour: c.pour ?? "foyer",
    });
    setMensualiteSaisie("");
    setAjout(true);
  };
  const fermer = () => { setAjout(false); setEdition(null); };

  // Capital, taux ou durée changent : la mensualité affichée redevient celle du calcul.
  const majContrat = (champ) => (v) => { setMensualiteSaisie(""); setF({ ...f, [champ]: v }); };
  const mensualiteCalculee = mensualite(num(f.capital), num(f.taux), Math.round(num(f.duree)));
  const saisirMensualite = (v) => {
    setMensualiteSaisie(v);
    const n = dureePourMensualite(num(f.capital), num(f.taux), num(v));
    if (n) setF({ ...f, duree: String(n) });
  };
  const mensualiteImpossible = mensualiteSaisie !== "" && num(mensualiteSaisie) > 0 && !dureePourMensualite(num(f.capital), num(f.taux), num(mensualiteSaisie));
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : etat.membres.find((m) => m.id === cle)?.nom || "—");
  // Un seul panneau ouvert à la fois : « amortissement », « anticipation » ou « paiements ».
  const [panneau, setPanneau] = useState(null);

  const valide = f.libelle.trim() && num(f.capital) > 0 && num(f.duree) > 0;
  const ajouter = () => {
    if (!valide) return;
    const credit = {
        libelle: f.libelle.trim(),
        capital: num(f.capital),
        taux: num(f.taux),
        duree: Math.round(num(f.duree)),
        debut: f.debut,
        assuranceTaux: num(f.assuranceTaux),
        assuranceBase: f.assuranceBase,
        pour: f.pour,
    };
    executer(() => (edition ? api.modifierCredit(edition, credit) : api.creerCredit(credit)));
    setF(VIERGE(mois));
    fermer();
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

  const boutonAjout = (
    <button className="btn" onClick={nouveau}>
      <Icone nom="plus" /> Nouveau crédit
    </button>
  );

  return (
    <>
      <EnTetePage
        titre="Crédits"
        description="Ce que les emprunts pèsent chaque mois, ce qu'il reste à rembourser, et ce qu'ils coûtent vraiment"
        actions={boutonAjout}
      />

      {etat.credits.length === 0 ? (
        <Carte>
          <EtatVide
            icone="credits"
            titre="Aucun crédit enregistré"
            texte="Prêt immobilier, auto, travaux : saisissez le capital, le taux et la durée, et l'application calcule mensualités, capital restant dû et intérêts."
            action={boutonAjout}
          />
        </Carte>
      ) : (
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
        {calc.creditsActifs.map((c) => {
          const restants = Math.max(0, c.duree - c.k);
          const fin = decalerMois(c.debut, c.duree);
          // L'échéance du mois a-t-elle été vue sur le compte ? La question ne se
          // pose que pour un crédit dont on suit les prélèvements.
          const paiements = c.paiements ?? [];
          const vuCeMois = paiements.find((p) => moisCle(new Date(p.date)) === mois);
          const commence = ecartMois(c.debut, mois) >= 0;
          return (
            <div key={c.id}>
              <div className="ligne">
                <div style={{ minWidth: 0 }}>
                  <div className="ligne-lib">
                    {c.libelle}{" "}
                    <span className="etiq perso" style={{ "--teinte": teinteMembre(etat.membres, c.pour) }}>{nomDe(c.pour)}</span>
                    {c.solde && <span className="etiq" style={{ background: "var(--ok-fond)", color: "var(--caisse)" }}>Soldé</span>}
                  </div>
                  <div className="ligne-meta">
                    {euro(c.capital)} sur {c.duree} mois à {c.taux}% · échéance {libelleMois(fin)}
                    {!c.solde && ` · ${restants} mensualité${restants > 1 ? "s" : ""} restante${restants > 1 ? "s" : ""}`}
                    {` · ${euro(coutTotal(c.capital, c.taux, c.duree))} d'intérêts`}
                    {c.assuranceTaux > 0 &&
                      ` · assurance ${c.assuranceTaux}% sur le capital ${c.assuranceBase === "restant" ? "restant dû" : "initial"}`}
                  </div>
                  {paiements.length > 0 && !c.solde && commence && (
                    <div className="ligne-meta" style={{ marginTop: 4 }}>
                      {vuCeMois ? (
                        <span className="etiq perso" style={{ "--teinte": "var(--caisse)" }}>
                          Échéance {deMois(mois)} prélevée le {libelleDate(vuCeMois.date)}
                        </span>
                      ) : (
                        <span className="etiq perso" style={{ "--teinte": "var(--ocre)" }}>
                          Échéance {deMois(mois)} pas encore vue sur le compte
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {/* Le propriétaire se change après coup : les crédits saisis
                    avant cette possibilité étaient tous communs par défaut. */}
                <Champ libelle="Pour qui" valeur={c.pour} largeur={125}
                  onChange={(v) => executer(() => api.modifierCredit(c.id, {
                    libelle: c.libelle, capital: c.capital, taux: c.taux, duree: c.duree,
                    debut: c.debut, assuranceTaux: c.assuranceTaux, assuranceBase: c.assuranceBase, pour: v,
                  }))}
                  options={[{ v: "foyer", l: "Foyer" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
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
                {paiements.length > 0 && (
                  <button
                    className="btn fant mini"
                    onClick={() => { const actif = ouvert === c.id && panneau === "paiements"; setOuvert(actif ? null : c.id); setPanneau(actif ? null : "paiements"); }}
                  >
                    {ouvert === c.id && panneau === "paiements" ? "Masquer" : `Paiements (${paiements.length})`}
                  </button>
                )}
                <button className="suppr" onClick={() => modifierCredit(c)} aria-label={`Modifier ${c.libelle}`}><Icone nom="modifier" taille={16} /></button>
                <button className="suppr" onClick={() => supprimer("credits", c.id, c.libelle)} aria-label={`Supprimer ${c.libelle}`}><Icone nom="corbeille" taille={16} /></button>
              </div>
              {ouvert === c.id && panneau === "amortissement" && <Amortissement credit={c} mois={mois} />}
              {ouvert === c.id && panneau === "anticipation" && <Anticipation credit={c} />}
              {ouvert === c.id && panneau === "paiements" && <Paiements credit={c} membres={etat.membres} executer={executer} />}
            </div>
          );
        })}
      </Carte>

      </>
      )}

      <Dialogue
        ouvert={ajout}
        onFermer={fermer}
        titre={edition ? "Modifier le crédit" : "Nouveau crédit"}
        note={edition
          ? "Les échéances passées, les intérêts et le capital restant dû se recalculent d'après ces chiffres"
          : "Mensualité, intérêts et capital restant dû se calculent d'après ces chiffres"}
        pied={
          <>
            <button className="btn fant" onClick={fermer}>Annuler</button>
            <button className="btn" onClick={ajouter} disabled={!valide || mensualiteImpossible}>{edition ? "Enregistrer" : "Ajouter le crédit"}</button>
          </>
        }
      >
        <div className="grille-form">
          <Champ classe="plein" libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur="100%" placeholder="Ex. Prêt auto" onEntree={ajouter} />
          <Champ libelle="Capital emprunté (€)" valeur={f.capital} onChange={majContrat("capital")} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Taux annuel (%)" valeur={f.taux} onChange={majContrat("taux")} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Durée (mois)" valeur={f.duree} onChange={majContrat("duree")} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "numeric" }} />
          {/* Les deux se répondent : changer la durée recalcule la mensualité,
              taper la mensualité du contrat recalcule la durée. */}
          <Champ libelle="Mensualité hors assurance (€)" valeur={mensualiteSaisie !== "" ? mensualiteSaisie : mensualiteCalculee ? mensualiteCalculee.toFixed(2) : ""}
            onChange={saisirMensualite} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="1re échéance" valeur={f.debut} onChange={(v) => setF({ ...f, debut: v })} largeur="100%" type="month" />
          <Champ classe="plein" libelle="Pour qui" valeur={f.pour} onChange={(v) => setF({ ...f, pour: v })} largeur="100%"
            options={[{ v: "foyer", l: "Le foyer (crédit commun)" }, ...etat.membres.map((m) => ({ v: m.id, l: m.nom }))]} />
          <Champ libelle="Assurance (%/an)" valeur={f.assuranceTaux} onChange={(v) => setF({ ...f, assuranceTaux: v })} largeur="100%" placeholder="0" onEntree={ajouter} attributs={{ inputMode: "decimal" }} />
          <Champ libelle="Assurance calculée sur" valeur={f.assuranceBase} onChange={(v) => setF({ ...f, assuranceBase: v })} largeur="100%"
            options={[{ v: "initial", l: "Le capital initial" }, { v: "restant", l: "Le capital restant dû" }]} />
        </div>
        {mensualiteImpossible ? (
          <div className="avis alerte">Cette mensualité ne couvre pas les intérêts : le crédit ne serait jamais remboursé.</div>
        ) : mensualiteSaisie !== "" && mensualiteCalculee > 0 ? (
          <div className="avis ok">
            Durée recalculée : {Math.round(num(f.duree))} mois, soit une mensualité exacte de {euroPrecis(mensualiteCalculee)}
            {Math.abs(mensualiteCalculee - num(mensualiteSaisie)) >= 0.01 && " (la dernière échéance d'un contrat est souvent plus faible)"}.
          </div>
        ) : null}
      </Dialogue>
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

/**
 * Les échéances réellement prélevées, saisies depuis les opérations ou lues sur
 * un relevé. Elles ne changent rien au calcul du crédit — le contrat le fixe —
 * mais disent ce qui est passé sur le compte.
 */
function Paiements({ credit, membres, executer }) {
  const nomDe = (cle) => (cle === "foyer" ? "Foyer" : membres.find((m) => m.id === cle)?.nom || "—");
  return (
    <div className="corps" style={{ background: "var(--survol)" }}>
      {credit.paiements.map((p) => (
        <div key={p.id} className="ligne" style={{ paddingLeft: 0, paddingRight: 0 }}>
          <div style={{ minWidth: 0, flex: "1 1 auto" }}>
            <div style={{ fontSize: 14 }}>{p.libelle || `Échéance ${credit.libelle}`}</div>
            <div className="ligne-meta">
              <span className="etiq perso" style={{ "--teinte": teinteMembre(membres, p.pour) }}>{nomDe(p.pour)}</span>
              {" · "}{libelleDate(p.date)}{p.importe && " · importé d'un relevé"}
            </div>
          </div>
          <span className="pousse chiffre" style={{ fontWeight: 600 }}>{euroPrecis(p.montant)}</span>
          <button className="suppr" onClick={() => executer(() => api.supprimerPaiement(credit.id, p.id))}
            aria-label={`Supprimer le paiement du ${libelleDate(p.date)}`}><Icone nom="corbeille" taille={16} /></button>
        </div>
      ))}
      <div className="carte-note" style={{ marginTop: 10 }}>
        Pour enregistrer une échéance, ajoutez une opération « Interne » depuis l'écran Opérations, ou
        classez le prélèvement du relevé sur ce crédit.
      </div>
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

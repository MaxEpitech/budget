// Onglet Emprunt — capacité d'emprunt et projet immobilier.
//
// Tout ce que l'utilisateur renseigne ici vit dans UN seul état, `saisie` :
// les valeurs tapées à la main comme celles lues depuis la banque. Le moteur
// (`useFinanceEngine`) en dérive ses résultats dans le même rendu, sans appel
// réseau : chaque frappe met à jour tous les chiffres immédiatement.
//
// Rien de cet onglet n'est envoyé au serveur. La saisie est gardée dans le
// navigateur, ce qui lui permet de survivre à l'aller-retour chez la banque.
import { useState, useEffect, useMemo, useCallback } from "react";
import Champ from "../composants/Champ.jsx";
import Carte from "../composants/Carte.jsx";
import Jauge from "../composants/Jauge.jsx";
import SourceRevenus from "../composants/SourceRevenus.jsx";
import { useFinanceEngine } from "../moteur/useFinanceEngine.ts";
import { TAUX_ENDETTEMENT_HCSF } from "../moteur/moteurFinancier.ts";
import { euro, num } from "../utiles.js";

const VERSION = 1;
const cleStockage = (compte) => `budget:emprunt:v${VERSION}:${compte?.email ?? "anonyme"}`;

/**
 * Point de départ : ce que le budget sait déjà du foyer. Les valeurs par défaut
 * des taux et des seuils sont des hypothèses courantes, toutes modifiables.
 */
function saisieInitiale(etat, calc) {
  const [premier, second] = etat.membres;
  return {
    source: "manuel", // "manuel" | "banque"
    banque: null, // chiffres lus depuis la banque, quand elle est reliée
    foyer: {
      principal: premier ? String(premier.revenu) : "",
      co: second ? String(second.revenu) : "",
      charges: calc.depenses ? String(Math.round(calc.depenses)) : "",
    },
    immo: { credit: false, mensualite: "", location: false, loyer: "", decote: "30" },
    conso: { actif: false, capital: "", taeg: "", duree: "", injections: "", epargne: "", horizon: "24", seuil: "12" },
    projet: { apport: "", taux: "3.5", assurance: "0.3", frais: "8" },
  };
}

// Le stockage du navigateur peut manquer ou refuser (navigation privée) :
// l'onglet doit fonctionner sans lui, la saisie ne survit alors simplement pas.
function lireSaisie(compte) {
  try {
    const brut = window.localStorage.getItem(cleStockage(compte));
    return brut ? JSON.parse(brut) : null;
  } catch {
    return null;
  }
}

function ecrireSaisie(compte, saisie) {
  try {
    // Les chiffres de la banque ne sont pas recopiés dans le navigateur : ils
    // sont relus auprès du serveur à chaque ouverture.
    window.localStorage.setItem(cleStockage(compte), JSON.stringify({ ...saisie, banque: null }));
  } catch {
    // tant pis : rien d'autre n'en dépend
  }
}

/** Traduit la saisie (du texte) en entrée du moteur (des nombres). */
function versEntree(s) {
  const depuisBanque = s.source === "banque" && s.banque;
  return {
    foyer: {
      emprunteurPrincipalNet: depuisBanque ? s.banque.revenus : num(s.foyer.principal),
      coEmprunteurNet: num(s.foyer.co) > 0 ? num(s.foyer.co) : undefined,
      chargesCourantesFixes: depuisBanque ? s.banque.charges : num(s.foyer.charges),
    },
    immobilierActuel: {
      aUnCreditEnCours: s.immo.credit,
      mensualiteActuelle: num(s.immo.mensualite),
      seraMisEnLocation: s.immo.location,
      loyerBrutEstime: num(s.immo.loyer),
      decoteLocativeBanque: num(s.immo.decote),
    },
    creditConsommation: {
      aUnCreditConso: s.conso.actif,
      capitalEmprunte: num(s.conso.capital),
      taeg: num(s.conso.taeg),
      dureeInitialeMois: Math.round(num(s.conso.duree)),
      strategieAnticipation: {
        injectionsAnnuellesFixes: num(s.conso.injections),
        epargneMensuelleDediee: num(s.conso.epargne),
      },
      horizonSimulationMois: Math.round(num(s.conso.horizon)),
      seuilNeutralisationMois: Math.round(num(s.conso.seuil)),
    },
    projetImmobilier: {
      apportTotalDisponible: num(s.projet.apport),
      tauxInteretEstime: num(s.projet.taux),
      tauxAssuranceEstime: num(s.projet.assurance),
      fraisAnnexesEstimesPourcent: num(s.projet.frais),
    },
  };
}

const pourcent = (n) => `${(Math.round(n * 10) / 10).toLocaleString("fr-FR")} %`;
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export default function Emprunt({ etat, calc, compte, signaler }) {
  const [saisie, setSaisie] = useState(() => {
    const initiale = saisieInitiale(etat, calc);
    const gardee = lireSaisie(compte);
    // Fusion section par section : une saisie gardée par une version antérieure
    // de l'écran ne doit pas faire disparaître un champ ajouté depuis.
    if (!gardee) return initiale;
    return {
      ...initiale,
      source: gardee.source === "banque" ? "banque" : "manuel",
      foyer: { ...initiale.foyer, ...gardee.foyer },
      immo: { ...initiale.immo, ...gardee.immo },
      conso: { ...initiale.conso, ...gardee.conso },
      projet: { ...initiale.projet, ...gardee.projet },
    };
  });

  useEffect(() => ecrireSaisie(compte, saisie), [compte, saisie]);

  const fusionner = useCallback((fragment) => setSaisie((s) => ({ ...s, ...fragment })), []);
  const maj = (section, champ) => (v) => setSaisie((s) => ({ ...s, [section]: { ...s[section], [champ]: v } }));
  const cocher = (section, champ) => (e) => maj(section, champ)(e.target.checked);

  const entree = useMemo(() => versEntree(saisie), [saisie]);
  const { consoAuMoisCible: conso, analyseEndettement: dette, enveloppesAchat, budgetQuotidienApresProjet: quotidien } =
    useFinanceEngine(entree);

  // Reprendre un crédit déjà enregistré dans l'onglet Crédits, là où il en est
  // aujourd'hui : capital restant dû et mensualités restantes.
  const creditsRepris = calc.creditsActifs.filter((c) => !c.solde);
  const reprendreCredit = (id) => {
    const c = creditsRepris.find((x) => x.id === id);
    if (!c) return;
    setSaisie((s) => ({
      ...s,
      conso: { ...s.conso, actif: true, capital: String(Math.round(c.restant)), taeg: String(c.taux), duree: String(c.duree - c.k) },
    }));
  };

  const sansRevenus = dette.revenusRetenusBanque <= 0;
  const sature = !sansRevenus && dette.mensualiteMaxImmo <= 0;
  const f = saisie;

  return (
    <>
      {/* ── Résultats ── */}
      <Carte titre="Ce que vous pouvez acheter" note="Prix maximal du bien, frais annexes déduits, en empruntant la mensualité maximale">
        <div className="corps">
          <div className="duo">
            {[["Sur 20 ans", enveloppesAchat.sur20Ans], ["Sur 25 ans", enveloppesAchat.sur25Ans]].map(([titre, e]) => (
              <div key={titre}>
                <div className="stat-lib">{titre}</div>
                <div className="stat-val chiffre" style={{ color: "var(--indigo)" }}>{euro(e.prixBienMax)}</div>
                <div className="carte-note" style={{ marginTop: 4 }}>dont {euro(e.capitalEmpruntable)} empruntés</div>
              </div>
            ))}
          </div>
          {sansRevenus && <div className="avis alerte">Renseignez les revenus du foyer pour obtenir une estimation.</div>}
          {sature && (
            <div className="avis alerte">
              Vos crédits en cours atteignent déjà {pourcent(dette.tauxEndettementAvantProjet)} des revenus retenus :
              aucune mensualité supplémentaire ne tient sous le plafond de {TAUX_ENDETTEMENT_HCSF} %.
            </div>
          )}
          <div className="carte-note" style={{ marginTop: 10 }}>
            Estimation indicative, à taux et assurance constants. Seule une banque peut s'engager sur un financement.
          </div>
        </div>
      </Carte>

      <div className="duo">
        <Carte titre="Endettement vu par la banque">
          <div className="corps">
            <div className="stat-lib">Mensualité maximale pour le projet</div>
            <div className="stat-val chiffre">{euro(dette.mensualiteMaxImmo)}</div>
            <div className="carte-note" style={{ marginTop: 4 }}>
              {euro(dette.revenusRetenusBanque)} de revenus retenus · endettement {pourcent(dette.tauxEndettementAvantProjet)} avant
              projet, {pourcent(dette.tauxEndettementApresProjet)} après
            </div>
            <Jauge
              pct={(dette.tauxEndettementApresProjet / TAUX_ENDETTEMENT_HCSF) * 100}
              couleur={dette.tauxEndettementApresProjet > TAUX_ENDETTEMENT_HCSF ? "var(--brique)" : "var(--caisse)"}
            />
            {f.conso.actif && conso.mensualiteInitiale > 0 && (
              conso.neutraliseParLaBanque ? (
                <div className="avis ok">
                  Crédit conso neutralisé : {conso.capitalRestantDu > 0 ? `il lui reste ${pluriel(conso.moisRestants, "mensualité")}` : "il sera soldé"} au
                  mois cible, il ne pèse plus dans le calcul.
                </div>
              ) : (
                <div className="avis alerte">
                  Crédit conso encore compté : {pluriel(conso.moisRestants, "mensualité")} restante{conso.moisRestants > 1 ? "s" : ""} au
                  mois cible, au-dessus du seuil de {entree.creditConsommation.seuilNeutralisationMois} mois.
                </div>
              )
            )}
          </div>
        </Carte>

        <Carte titre="Budget quotidien après projet">
          <div className="corps">
            <div className="stat-lib">Reste à vivre réel du foyer</div>
            <div className="stat-val chiffre" style={{ color: quotidien.resteAVivreReelFoyer < 0 ? "var(--brique)" : "var(--caisse)" }}>
              {euro(quotidien.resteAVivreReelFoyer)}
            </div>
            <div className="carte-note" style={{ marginTop: 4 }}>
              {euro(quotidien.totalEntreesReelles)} d'entrées · {euro(quotidien.totalSortiesReelles)} de sorties chaque mois
            </div>
            <div className="carte-note" style={{ marginTop: 8 }}>
              En argent réel : loyer perçu en entier, et crédit conso payé tant qu'il court — même si la banque
              ne le compte plus.
            </div>
          </div>
        </Carte>
      </div>

      {/* ── Saisie ── */}
      <SourceRevenus saisie={saisie} onChange={fusionner} signaler={signaler} />

      <Carte titre="Bien immobilier actuel">
        <div className="corps">
          <div className="forme">
            <label className="bascule">
              <input type="checkbox" checked={f.immo.credit} onChange={cocher("immo", "credit")} />
              Un crédit immobilier court encore
            </label>
            {f.immo.credit && (
              <Champ libelle="Mensualité actuelle" valeur={f.immo.mensualite} onChange={maj("immo", "mensualite")} largeur={150} placeholder="0" />
            )}
          </div>
          <div className="forme" style={{ marginTop: 10 }}>
            <label className="bascule">
              <input type="checkbox" checked={f.immo.location} onChange={cocher("immo", "location")} />
              Le bien sera mis en location
            </label>
            {f.immo.location && (
              <>
                <Champ libelle="Loyer brut estimé /mois" valeur={f.immo.loyer} onChange={maj("immo", "loyer")} largeur={170} placeholder="0" />
                <Champ libelle="Décote banque %" valeur={f.immo.decote} onChange={maj("immo", "decote")} largeur={120} placeholder="30" />
              </>
            )}
          </div>
          {f.immo.credit && (
            <div className="carte-note" style={{ marginTop: 10 }}>
              Ce crédit reste compté dans vos charges. S'il doit être soldé par la vente du bien, décochez la case.
            </div>
          )}
        </div>
      </Carte>

      <Carte
        titre="Crédit à la consommation"
        note={f.conso.actif && conso.mensualiteInitiale > 0
          ? `${euro(conso.mensualiteInitiale)} /mois · ${euro(conso.capitalRestantDu)} restant dû au mois cible`
          : "Prêt auto, travaux… avec ses remboursements anticipés"}
      >
        <div className="corps">
          <div className="forme">
            <label className="bascule">
              <input type="checkbox" checked={f.conso.actif} onChange={cocher("conso", "actif")} />
              Un crédit à la consommation est en cours
            </label>
            {creditsRepris.length > 0 && (
              <Champ
                libelle="Reprendre un crédit enregistré" valeur="" onChange={reprendreCredit} largeur={240}
                options={[{ v: "", l: "Choisir…" }, ...creditsRepris.map((c) => ({ v: c.id, l: c.libelle }))]}
              />
            )}
          </div>
          {f.conso.actif && (
            <>
              <div className="forme" style={{ marginTop: 10 }}>
                <Champ libelle="Capital emprunté" valeur={f.conso.capital} onChange={maj("conso", "capital")} largeur={140} placeholder="0" />
                <Champ libelle="TAEG %" valeur={f.conso.taeg} onChange={maj("conso", "taeg")} largeur={90} placeholder="0" />
                <Champ libelle="Durée (mois)" valeur={f.conso.duree} onChange={maj("conso", "duree")} largeur={110} placeholder="0" />
              </div>
              <div className="forme" style={{ marginTop: 10 }}>
                <Champ libelle="Versement anticipé /an" valeur={f.conso.injections} onChange={maj("conso", "injections")} largeur={170} placeholder="0" />
                <Champ libelle="Épargne dédiée /mois" valeur={f.conso.epargne} onChange={maj("conso", "epargne")} largeur={160} placeholder="0" />
                <Champ libelle="Mois cible" valeur={f.conso.horizon} onChange={maj("conso", "horizon")} largeur={100} placeholder="24" />
                <Champ libelle="Seuil de neutralisation (mois)" valeur={f.conso.seuil} onChange={maj("conso", "seuil")} largeur={200} placeholder="12" />
              </div>
              <div className="carte-note" style={{ marginTop: 10 }}>
                Les versements anticipés et l'épargne dédiée sont injectés une fois par an. La mensualité ne change
                pas : c'est la durée qui raccourcit. Sous le seuil, une banque ne compte généralement plus le crédit.
              </div>
            </>
          )}
        </div>
      </Carte>

      <Carte titre="Projet immobilier">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Apport disponible" valeur={f.projet.apport} onChange={maj("projet", "apport")} largeur={150} placeholder="0" />
            <Champ libelle="Taux du prêt %" valeur={f.projet.taux} onChange={maj("projet", "taux")} largeur={120} placeholder="0" />
            <Champ libelle="Assurance %" valeur={f.projet.assurance} onChange={maj("projet", "assurance")} largeur={110} placeholder="0" />
            <Champ libelle="Frais annexes %" valeur={f.projet.frais} onChange={maj("projet", "frais")} largeur={130} placeholder="8" />
          </div>
          <div className="carte-note" style={{ marginTop: 10 }}>
            Les taux proposés sont des hypothèses de départ : remplacez-les par ceux qu'on vous annonce.
          </div>
        </div>
      </Carte>
    </>
  );
}

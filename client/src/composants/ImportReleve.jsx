// Import d'un relevé bancaire dans le flux.
//
// Deux temps, toujours : le fichier est d'abord lu et montré, puis seulement
// ajouté. Faire entrer d'un coup des dizaines de lignes dans un budget sans les
// avoir vues, c'est la meilleure façon de ne plus lui faire confiance.
import { useState, useRef, useMemo } from "react";
import { api } from "../api.js";
import Champ from "./Champ.jsx";
import Icone from "./Icone.jsx";
import { lireFichier, analyserReleve, FORMATS_RELEVE } from "../releve.js";
import { euroPrecis, libelleMois, CATEGORIES } from "../utiles.js";
import { destinationsInternes, versValeur, depuisValeur } from "../interne.js";

// Le serveur accepte 2 000 opérations par envoi.
const PAR_ENVOI = 2000;

const jourMois = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// Le nom d'un groupe de destinations, vu depuis le compte du relevé, et le mot
// qui précède chaque choix : liste fermée, « Voiture » seul ne dirait pas
// qu'il s'agit d'un crédit.
const GROUPES_INTERNES = {
  sortie: { Épargne: "Vers l'épargne", Projets: "Vers un projet", Crédits: "Échéance de crédit" },
  entree: { Épargne: "Depuis l'épargne" },
};
const PREFIXES = { Épargne: "Épargne", Projets: "Projet", Crédits: "Crédit" };

/**
 * @param etat           l'état du foyer : membres, supports, projets
 * @param creditsEnCours les crédits non soldés, seuls à pouvoir recevoir une échéance
 * @param executer       exécute une écriture puis recharge le mois affiché
 */
export default function ImportReleve({ etat, creditsEnCours, executer }) {
  const { membres } = etat;
  const [apercu, setApercu] = useState(null); // réponse du serveur
  const [lignes, setLignes] = useState([]); // opérations, avec `retenue` et la catégorie choisie
  // À qui est le compte du relevé. Choisi avant le fichier, modifiable ensuite :
  // il décide de l'attribution des lignes ET de ce qui compte comme doublon.
  const [pour, setPour] = useState("foyer");
  const [fichier, setFichier] = useState(null); // { nom, contenu } du relevé en cours d'aperçu
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null); // { ton, texte, lots? }
  const champFichier = useRef(null);

  const analyser = async (lu, titulaire) => {
    setOccupe(true);
    setMessage(null);
    try {
      const r = await analyserReleve(lu, titulaire);
      setFichier(lu);
      setApercu(r);
      // Par défaut, tout sauf ce qui ferait doublon : les lignes déjà importées,
      // et les salaires — déjà comptés dans les revenus des membres du foyer.
      // Une proposition du serveur n'est gardée que si la liste l'offre : un
      // crédit soldé, par exemple, ne se choisit plus.
      const offerte = (o) => groupesInternes[o.type].some((g) => g.options.some((x) => x.v === versValeur(o.affectation)));
      setLignes(r.operations.map((o) => ({
        ...o,
        affectation: o.affectation && offerte(o) ? o.affectation : null,
        retenue: !o.dejaImportee && !o.salaire,
      })));
    } catch (err) {
      setMessage({ ton: "alerte", texte: err.message });
    } finally {
      setOccupe(false);
    }
  };

  const choisir = async (e) => {
    const choisi = e.target.files?.[0];
    // Remis à vide pour que rechoisir le même fichier redéclenche la lecture.
    e.target.value = "";
    if (!choisi) return;
    try {
      await analyser(await lireFichier(choisi), pour);
    } catch (err) {
      setMessage({ ton: "alerte", texte: err.message });
    }
  };

  // Changer de titulaire pendant l'aperçu relit le relevé : ce qui est « déjà
  // dans le flux » dépend du compte dont il s'agit.
  const changerTitulaire = (v) => {
    setPour(v);
    if (fichier) analyser(fichier, v);
  };

  const titulaires = [{ v: "foyer", l: "Compte commun (foyer)" }, ...membres.map((m) => ({ v: m.id, l: `Compte de ${m.nom}` }))];
  const nomTitulaire = pour === "foyer" ? "le foyer" : membres.find((m) => m.id === pour)?.nom ?? "ce membre";

  const retenues = useMemo(() => lignes.filter((l) => l.retenue && !l.dejaImportee), [lignes]);
  const majLigne = (cle, patch) => setLignes((avant) => avant.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));

  // Une seule liste par ligne : sa catégorie de dépense, ou la destination d'un
  // mouvement interne. Le serveur propose déjà les évidentes — un prélèvement
  // égal à l'échéance d'un crédit, un virement qui nomme un support.
  const groupesInternes = useMemo(() => {
    const nommer = (sens) => (g) => ({
      groupe: GROUPES_INTERNES[sens][g.groupe],
      options: g.options.map((o) => ({ ...o, l: `${PREFIXES[g.groupe]} · ${o.l}` })),
    });
    return {
      depense: destinationsInternes(etat, creditsEnCours).map(nommer("sortie")),
      revenu: destinationsInternes(etat, creditsEnCours, { entree: true }).map(nommer("entree")),
    };
  }, [etat, creditsEnCours]);
  const classements = (l) => [
    { groupe: l.type === "revenu" ? "Revenu" : "Dépense", options: CATEGORIES.map((c) => ({ v: `categorie:${c}`, l: c })) },
    ...groupesInternes[l.type],
  ];
  const valeurClassement = (l) => (l.affectation ? versValeur(l.affectation) : `categorie:${l.categorie}`);
  const classer = (l, valeur) =>
    valeur.startsWith("categorie:")
      ? majLigne(l.cle, { categorie: valeur.slice("categorie:".length), affectation: null })
      : majLigne(l.cle, { affectation: depuisValeur(valeur) });
  const toutes = (retenue) => setLignes((avant) => avant.map((l) => (l.dejaImportee ? l : { ...l, retenue })));
  const fermer = () => {
    setApercu(null);
    setFichier(null);
    setLignes([]);
  };

  const importer = () => {
    setOccupe(true);
    executer(async () => {
      try {
        const envoi = retenues.map(({ cle, date, type, libelle, montant, categorie, affectation }) => ({
          cle, date, type, libelle, montant, categorie, ...(affectation ? { affectation } : {}),
        }));
        let ajoutees = 0;
        let internes = 0;
        const lots = [];
        for (let i = 0; i < envoi.length; i += PAR_ENVOI) {
          const r = await api.importerTransactions(pour, envoi.slice(i, i + PAR_ENVOI));
          ajoutees += r.ajoutees;
          internes += r.internes ?? 0;
          if (r.ajoutees > 0) lots.push(r.lot);
        }
        const mois = [...new Set(retenues.map((l) => l.date.slice(0, 7)))].sort();
        const etendue = mois.length === 1 ? `en ${libelleMois(mois[0]).toLowerCase()}` : `de ${libelleMois(mois[0]).toLowerCase()} à ${libelleMois(mois.at(-1)).toLowerCase()}`;
        const dontInternes = internes > 0 ? `, dont ${pluriel(internes, "mouvement")} interne${internes > 1 ? "s" : ""} versé${internes > 1 ? "s" : ""} à l'épargne, aux projets ou aux crédits` : "";
        setMessage({
          ton: "ok",
          texte: ajoutees > 0
            ? `${pluriel(ajoutees, "opération")} ajoutée${ajoutees > 1 ? "s" : ""} pour ${nomTitulaire}, ${etendue}${dontInternes}. Naviguez entre les mois pour les retrouver.`
            : "Ces opérations étaient déjà importées : rien n'a été ajouté.",
          lots,
        });
        fermer();
      } finally {
        setOccupe(false);
      }
    });
  };

  const annulerImport = (lots) => {
    setOccupe(true);
    executer(async () => {
      try {
        for (const lot of lots) await api.annulerImport(lot);
        setMessage({ ton: "ok", texte: "Import annulé : les opérations ajoutées ont été retirées, mouvements internes compris." });
      } finally {
        setOccupe(false);
      }
    });
  };

  const dejaLa = lignes.filter((l) => l.dejaImportee).length;
  const salaires = lignes.filter((l) => l.salaire && !l.dejaImportee).length;
  const reconnus = lignes.filter((l) => l.affectation && !l.dejaImportee).length;

  // Le titre et la fermeture viennent de la fenêtre qui l'accueille.
  return (
    <div className="import">
      <input ref={champFichier} type="file" accept={FORMATS_RELEVE} onChange={choisir} hidden />

      {message && (
        <div className="corps">
          <div className={`avis ${message.ton}`} role={message.ton === "alerte" ? "alert" : "status"} style={{ marginTop: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span>{message.texte}</span>
            {message.lots?.length > 0 && (
              <button className="btn fant mini" onClick={() => annulerImport(message.lots)} disabled={occupe}>Annuler cet import</button>
            )}
          </div>
        </div>
      )}

      {!apercu && (
        <div className="corps" style={message ? { paddingTop: 0 } : undefined}>
          {membres.length > 0 && (
            <div className="forme" style={{ marginBottom: 14 }}>
              <Champ libelle="Ce relevé est celui du" valeur={pour} onChange={changerTitulaire} largeur={260} options={titulaires} disabled={occupe} />
            </div>
          )}
          <button className="depot" onClick={() => champFichier.current?.click()} disabled={occupe}>
            <span className="etat-vide-icone"><Icone nom="importer" taille={22} /></span>
            <span className="ligne-lib">{occupe ? "Lecture du relevé…" : "Choisir un fichier"}</span>
            <span className="ligne-meta">CSV, Excel (.xlsx), OFX ou QIF — rien n'est ajouté avant votre validation</span>
          </button>
          <div className="carte-note" style={{ marginTop: 14 }}>
            Les opérations sont d'abord affichées : vous choisissez celles qui entrent dans le budget, et leur
            catégorie — ou, pour un virement vers l'épargne ou une échéance de prêt, le support ou le crédit
            qu'elles alimentent. Réimporter un relevé déjà traité n'ajoute rien en double.
            {membres.length > 1 && " Avec des comptes séparés, importez le relevé de chacun en indiquant à qui il appartient : ses dépenses lui seront attribuées."}
          </div>
        </div>
      )}

      {apercu && (
        <>
          <div className="corps" style={{ borderBottom: "1px solid var(--filet-fin)" }}>
            <div className="ligne-lib">{apercu.nom ?? "Relevé"} · {apercu.format}</div>
            <div className="carte-note" style={{ marginTop: 4 }}>
              {pluriel(lignes.length, "opération")} du {jourMois(lignes.at(-1).date)} au {jourMois(lignes[0].date)}
              {dejaLa > 0 && ` · ${dejaLa} déjà importée${dejaLa > 1 ? "s" : ""}`}
              {apercu.lignesIgnorees > 0 && ` · ${pluriel(apercu.lignesIgnorees, "ligne")} du fichier sans date ni montant, ignorée${apercu.lignesIgnorees > 1 ? "s" : ""}`}
            </div>
            {salaires > 0 && (
              <div className="carte-note" style={{ marginTop: 6 }}>
                {pluriel(salaires, "versement")} de salaire {salaires > 1 ? "sont décochés" : "est décoché"} : les salaires sont déjà comptés
                dans les revenus du foyer (Réglages › Foyer). Cochez-les seulement s'ils n'y figurent pas.
              </div>
            )}
            {reconnus > 0 && (
              <div className="carte-note" style={{ marginTop: 6 }}>
                {pluriel(reconnus, "mouvement")} interne{reconnus > 1 ? "s" : ""} reconnu{reconnus > 1 ? "s" : ""} — virement vers
                l'épargne, échéance de prêt : {reconnus > 1 ? "ils iront" : "il ira"} dans l'écran concerné, sans compter comme
                dépense{reconnus > 1 ? "s" : ""}. Vérifiez-les dans la liste.
              </div>
            )}
            <div className="carte-note" style={{ marginTop: 6 }}>
              Les lignes régulières déjà saisies dans le flux (loyer, abonnements…) ne sont pas reconnues ici :
              décochez les opérations qui les répéteraient. Un virement vers l'épargne ou un prélèvement de prêt
              se classe dans la liste de droite, comme mouvement interne.
            </div>
            <div className="forme" style={{ marginTop: 12 }}>
              <Champ libelle="Ce relevé est celui du" valeur={pour} onChange={changerTitulaire} largeur={240} options={titulaires} disabled={occupe} />
              <button className="btn fant mini" onClick={() => toutes(true)}>Tout cocher</button>
              <button className="btn fant mini" onClick={() => toutes(false)}>Tout décocher</button>
            </div>
          </div>

          <div style={{ maxHeight: 420, overflowY: "auto" }}>
            {lignes.map((l) => (
              <div className="ligne" key={l.cle} style={{ opacity: l.dejaImportee ? 0.5 : 1, gap: 10 }}>
                <input
                  type="checkbox" checked={l.retenue && !l.dejaImportee} disabled={l.dejaImportee}
                  onChange={(e) => majLigne(l.cle, { retenue: e.target.checked })}
                  aria-label={`Importer ${l.libelle}`} style={{ width: 16, height: 16, accentColor: "var(--accent)", flexShrink: 0 }}
                />
                <div style={{ minWidth: 0, flex: "1 1 180px" }}>
                  <div className="ligne-lib" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.libelle}>{l.libelle}</div>
                  <div className="ligne-meta">
                    {jourMois(l.date)}
                    {l.dejaImportee && <> · <span className="etiq">Déjà importée</span></>}
                    {l.salaire && !l.dejaImportee && <> · <span className="etiq">Salaire</span></>}
                    {l.affectation && !l.dejaImportee && <> · <span className="etiq perso" style={{ "--teinte": "var(--accent)" }}>Mouvement interne</span></>}
                  </div>
                </div>
                <select
                  className="saisie" value={valeurClassement(l)} disabled={l.dejaImportee} style={{ width: 190, height: 36, padding: "4px 8px" }}
                  onChange={(e) => classer(l, e.target.value)} aria-label={`Classement de ${l.libelle}`}
                >
                  {classements(l).map((g) => (
                    <optgroup key={g.groupe} label={g.groupe}>
                      {g.options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                    </optgroup>
                  ))}
                </select>
                {/* Un mouvement interne n'est ni gagné ni dépensé : sa flèche dit le sens, sans couleur. */}
                <div className="chiffre montant" style={{ width: 104, textAlign: "right", color: l.affectation ? "var(--texte-doux)" : l.type === "revenu" ? "var(--caisse)" : undefined }}>
                  {l.affectation ? (l.type === "revenu" ? "← " : "→ ") : l.type === "revenu" ? "+" : "−"}{euroPrecis(l.montant)}
                </div>
              </div>
            ))}
          </div>

          <div className="corps" style={{ borderTop: "1px solid var(--filet-fin)" }}>
            <div className="forme">
              <button className="btn" onClick={importer} disabled={occupe || retenues.length === 0}>
                {occupe ? "Import…" : `Ajouter ${pluriel(retenues.length, "opération")}`}
              </button>
              <button className="btn fant" onClick={fermer} disabled={occupe}>Annuler</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

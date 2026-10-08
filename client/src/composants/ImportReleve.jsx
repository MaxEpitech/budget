// Import d'un relevé bancaire dans le flux.
//
// Deux temps, toujours : le fichier est d'abord lu et montré, puis seulement
// ajouté. Faire entrer d'un coup des dizaines de lignes dans un budget sans les
// avoir vues, c'est la meilleure façon de ne plus lui faire confiance.
import { useState, useRef, useMemo } from "react";
import { api } from "../api.js";
import Carte from "./Carte.jsx";
import Champ from "./Champ.jsx";
import { analyserFichier, FORMATS_RELEVE } from "../releve.js";
import { euroPrecis, libelleMois, CATEGORIES } from "../utiles.js";

// Le serveur accepte 2 000 opérations par envoi.
const PAR_ENVOI = 2000;

const jourMois = (date) => new Date(`${date}T00:00:00`).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" });
const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

/**
 * @param membres   membres du foyer, pour attribuer les lignes
 * @param executer  exécute une écriture puis recharge le mois affiché
 */
export default function ImportReleve({ membres, executer }) {
  const [apercu, setApercu] = useState(null); // réponse du serveur
  const [lignes, setLignes] = useState([]); // opérations, avec `retenue` et la catégorie choisie
  const [pour, setPour] = useState("foyer");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState(null); // { ton, texte, lots? }
  const champFichier = useRef(null);

  const choisir = async (e) => {
    const fichier = e.target.files?.[0];
    // Remis à vide pour que rechoisir le même fichier redéclenche la lecture.
    e.target.value = "";
    if (!fichier) return;
    setOccupe(true);
    setMessage(null);
    try {
      const r = await analyserFichier(fichier);
      setApercu(r);
      // Par défaut, tout sauf ce qui ferait doublon : les lignes déjà importées,
      // et les salaires — déjà comptés dans les revenus des membres du foyer.
      setLignes(r.operations.map((o) => ({ ...o, retenue: !o.dejaImportee && !o.salaire })));
    } catch (err) {
      setMessage({ ton: "alerte", texte: err.message });
    } finally {
      setOccupe(false);
    }
  };

  const retenues = useMemo(() => lignes.filter((l) => l.retenue && !l.dejaImportee), [lignes]);
  const majLigne = (cle, patch) => setLignes((avant) => avant.map((l) => (l.cle === cle ? { ...l, ...patch } : l)));
  const toutes = (retenue) => setLignes((avant) => avant.map((l) => (l.dejaImportee ? l : { ...l, retenue })));
  const fermer = () => {
    setApercu(null);
    setLignes([]);
  };

  const importer = () => {
    setOccupe(true);
    executer(async () => {
      try {
        const envoi = retenues.map(({ cle, date, type, libelle, montant, categorie }) => ({ cle, date, type, libelle, montant, categorie }));
        let ajoutees = 0;
        const lots = [];
        for (let i = 0; i < envoi.length; i += PAR_ENVOI) {
          const r = await api.importerTransactions(pour, envoi.slice(i, i + PAR_ENVOI));
          ajoutees += r.ajoutees;
          if (r.ajoutees > 0) lots.push(r.lot);
        }
        const mois = [...new Set(retenues.map((l) => l.date.slice(0, 7)))].sort();
        const etendue = mois.length === 1 ? `en ${libelleMois(mois[0]).toLowerCase()}` : `de ${libelleMois(mois[0]).toLowerCase()} à ${libelleMois(mois.at(-1)).toLowerCase()}`;
        setMessage({
          ton: "ok",
          texte: ajoutees > 0
            ? `${pluriel(ajoutees, "opération")} ajoutée${ajoutees > 1 ? "s" : ""} au flux, ${etendue}. Naviguez entre les mois pour les retrouver.`
            : "Ces opérations étaient déjà dans le flux : rien n'a été ajouté.",
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
        setMessage({ ton: "ok", texte: "Import annulé : les opérations ajoutées ont été retirées du flux." });
      } finally {
        setOccupe(false);
      }
    });
  };

  const dejaLa = lignes.filter((l) => l.dejaImportee).length;
  const salaires = lignes.filter((l) => l.salaire && !l.dejaImportee).length;

  return (
    <Carte
      titre="Importer un relevé bancaire"
      note="Fichier CSV, OFX ou QIF téléchargé depuis votre espace bancaire"
      action={
        !apercu && (
          <button className="btn fant mini" onClick={() => champFichier.current?.click()} disabled={occupe}>
            {occupe ? "Lecture…" : "Choisir un fichier"}
          </button>
        )
      }
    >
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

      {!apercu && !message && (
        <div className="corps">
          <div className="carte-note">
            Les opérations sont d'abord affichées : vous choisissez celles qui entrent dans le flux, et leur
            catégorie. Réimporter un relevé déjà traité n'ajoute rien en double.
          </div>
        </div>
      )}

      {apercu && (
        <>
          <div className="corps" style={{ borderBottom: "1px solid var(--filet-fin)" }}>
            <div className="ligne-lib">{apercu.nom ?? "Relevé"} · {apercu.format}</div>
            <div className="carte-note" style={{ marginTop: 4 }}>
              {pluriel(lignes.length, "opération")} du {jourMois(lignes.at(-1).date)} au {jourMois(lignes[0].date)}
              {dejaLa > 0 && ` · ${dejaLa} déjà dans le flux`}
              {apercu.lignesIgnorees > 0 && ` · ${pluriel(apercu.lignesIgnorees, "ligne")} du fichier sans date ni montant, ignorée${apercu.lignesIgnorees > 1 ? "s" : ""}`}
            </div>
            {salaires > 0 && (
              <div className="carte-note" style={{ marginTop: 6 }}>
                {pluriel(salaires, "versement")} de salaire {salaires > 1 ? "sont décochés" : "est décoché"} : les salaires sont déjà comptés
                dans les revenus du foyer (onglet Foyer). Cochez-les seulement s'ils n'y figurent pas.
              </div>
            )}
            <div className="carte-note" style={{ marginTop: 6 }}>
              Les lignes régulières déjà saisies dans le flux (loyer, abonnements…) ne sont pas reconnues ici :
              décochez les opérations qui les répéteraient.
            </div>
            <div className="forme" style={{ marginTop: 12 }}>
              <Champ
                libelle="Attribuer à" valeur={pour} onChange={setPour} largeur={150}
                options={[{ v: "foyer", l: "Foyer" }, ...membres.map((m) => ({ v: m.id, l: m.nom }))]}
              />
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
                    {l.dejaImportee && <> · <span className="etiq">Déjà dans le flux</span></>}
                    {l.salaire && !l.dejaImportee && <> · <span className="etiq">Salaire</span></>}
                  </div>
                </div>
                <select
                  className="saisie" value={l.categorie} disabled={l.dejaImportee} style={{ width: 140, height: 36, padding: "4px 8px" }}
                  onChange={(e) => majLigne(l.cle, { categorie: e.target.value })} aria-label={`Catégorie de ${l.libelle}`}
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="chiffre montant" style={{ width: 96, textAlign: "right", color: l.type === "revenu" ? "var(--caisse)" : undefined }}>
                  {l.type === "revenu" ? "+" : "−"}{euroPrecis(l.montant)}
                </div>
              </div>
            ))}
          </div>

          <div className="corps" style={{ borderTop: "1px solid var(--filet-fin)" }}>
            <div className="forme">
              <button className="btn" onClick={importer} disabled={occupe || retenues.length === 0}>
                {occupe ? "Import…" : `Ajouter ${pluriel(retenues.length, "opération")} au flux`}
              </button>
              <button className="btn fant" onClick={fermer} disabled={occupe}>Annuler</button>
            </div>
          </div>
        </>
      )}
    </Carte>
  );
}

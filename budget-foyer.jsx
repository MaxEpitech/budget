import { useState, useEffect, useMemo, useRef } from "react";

/* ═══════════════════════════════════════════════════════════════
   COUCHE DE DONNÉES — le seul endroit à remplacer pour Postgres.
   Aujourd'hui : stockage navigateur (window.storage).
   Demain : fetch('/api/etat') GET + PUT vers Express/Neon.
   ═══════════════════════════════════════════════════════════════ */
const CLE = "budget:etat:v1";

const source = {
  async charger() {
    try {
      const r = await window.storage.get(CLE);
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null; // clé absente au premier lancement
    }
  },
  async sauver(etat) {
    try {
      await window.storage.set(CLE, JSON.stringify(etat));
      return true;
    } catch {
      return false;
    }
  },
};

/* ─── Utilitaires ─────────────────────────────────────────────── */
const euro = (n) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n || 0));

const euroPrecis = (n) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);

const uid = () => Math.random().toString(36).slice(2, 9);
const num = (v) => {
  const n = parseFloat(String(v).replace(",", ".").replace(/\s/g, ""));
  return isNaN(n) ? 0 : n;
};

const moisCle = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

const decalerMois = (cle, delta) => {
  const [a, m] = cle.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return moisCle(d);
};

const ecartMois = (de, vers) => {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = vers.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
};

const libelleMois = (cle) => {
  const [a, m] = cle.split("-").map(Number);
  const s = new Date(a, m - 1, 1).toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/* ─── Calculs financiers ──────────────────────────────────────── */
// Mensualité d'un crédit amortissable classique
function mensualite(capital, tauxAnnuel, dureeMois) {
  if (!capital || !dureeMois) return 0;
  const r = tauxAnnuel / 100 / 12;
  if (r === 0) return capital / dureeMois;
  return (capital * r) / (1 - Math.pow(1 + r, -dureeMois));
}

// Capital restant dû après k échéances payées
function capitalRestant(capital, tauxAnnuel, dureeMois, k) {
  if (k <= 0) return capital;
  if (k >= dureeMois) return 0;
  const r = tauxAnnuel / 100 / 12;
  const M = mensualite(capital, tauxAnnuel, dureeMois);
  if (r === 0) return Math.max(0, capital - M * k);
  const f = Math.pow(1 + r, k);
  return Math.max(0, capital * f - M * ((f - 1) / r));
}

// Projection épargne : valeur + versements mensuels capitalisés
function projeter(valeur, versement, rendement, mois) {
  const r = rendement / 100 / 12;
  if (r === 0) return valeur + versement * mois;
  const f = Math.pow(1 + r, mois);
  return valeur * f + versement * ((f - 1) / r);
}

/* ─── Jeu de démonstration (remplaçable dans l'onglet Foyer) ──── */
const ETAT_DEMO = {
  version: 1,
  membres: [
    { id: "m1", nom: "Alex", revenu: 2450 },
    { id: "m2", nom: "Camille", revenu: 1980 },
  ],
  repartition: "prorata",
  transactions: [
    { id: uid(), type: "depense", libelle: "Loyer", montant: 980, categorie: "Logement", pour: "foyer", recurrent: true, mois: null },
    { id: uid(), type: "depense", libelle: "Courses", montant: 520, categorie: "Courses", pour: "foyer", recurrent: true, mois: null },
    { id: uid(), type: "depense", libelle: "Électricité", montant: 95, categorie: "Énergie", pour: "foyer", recurrent: true, mois: null },
    { id: uid(), type: "depense", libelle: "Assurance habitation", montant: 28, categorie: "Assurances", pour: "foyer", recurrent: true, mois: null },
    { id: uid(), type: "depense", libelle: "Forfait mobile", montant: 15, categorie: "Abonnements", pour: "m1", recurrent: true, mois: null },
    { id: uid(), type: "depense", libelle: "Salle de sport", montant: 32, categorie: "Loisirs", pour: "m2", recurrent: true, mois: null },
    { id: uid(), type: "depense", libelle: "Essence", montant: 140, categorie: "Transport", pour: "foyer", recurrent: true, mois: null },
    { id: uid(), type: "revenu", libelle: "Freelance", montant: 300, categorie: "Autre", pour: "m1", recurrent: false, mois: moisCle() },
  ],
  credits: [
    { id: uid(), libelle: "Voiture", capital: 14000, taux: 3.9, duree: 60, debut: decalerMois(moisCle(), -18) },
    { id: uid(), libelle: "Prêt travaux", capital: 9000, taux: 2.4, duree: 48, debut: decalerMois(moisCle(), -6) },
  ],
  projets: [
    { id: uid(), libelle: "Voyage Japon", objectif: 6000, epargne: 1850, echeance: decalerMois(moisCle(), 14), versement: 250 },
    { id: uid(), libelle: "Travaux cuisine", objectif: 12000, epargne: 3200, echeance: decalerMois(moisCle(), 20), versement: 300 },
  ],
  placements: [
    { id: uid(), libelle: "Livret A", valeur: 8400, versement: 150, rendement: 2.4 },
    { id: uid(), libelle: "PEA", valeur: 5200, versement: 200, rendement: 5.5 },
  ],
};

const CATEGORIES = ["Logement", "Courses", "Transport", "Énergie", "Abonnements", "Santé", "Loisirs", "Enfants", "Assurances", "Impôts", "Autre"];

const POSTES = {
  depenses: { nom: "Dépenses", var: "--ardoise" },
  credits: { nom: "Crédits", var: "--brique" },
  projets: { nom: "Projets", var: "--ocre" },
  placements: { nom: "Épargne", var: "--indigo" },
  reste: { nom: "Reste à vivre", var: "--caisse" },
};

/* ═══════════════════════════════════════════════════════════════
   STYLES
   ═══════════════════════════════════════════════════════════════ */
const CSS = `
.bdg {
  --encre:#101A24; --ardoise:#46596B; --papier:#E7EBED; --craie:#FFFFFF;
  --trait:#D3DADE; --caisse:#1D7A5F; --brique:#A93B2E; --ocre:#C08422;
  --indigo:#3B4C8F; --doux:#7A8B98;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Roboto Mono", Menlo, monospace;
  --corps: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--papier); color: var(--encre); font-family: var(--corps);
  min-height:100%; font-size:15px; line-height:1.45; padding-bottom:48px;
}
.bdg *, .bdg *::before, .bdg *::after { box-sizing: border-box; }
.bdg button { font: inherit; cursor: pointer; border: none; background: none; color: inherit; }
.bdg input, .bdg select { font: inherit; color: inherit; }
.bdg :focus-visible { outline: 2px solid var(--indigo); outline-offset: 2px; }
.bdg .chiffre { font-family: var(--mono); font-variant-numeric: tabular-nums; letter-spacing:-0.02em; }

/* En-tête */
.bdg .entete { background: var(--encre); color: var(--craie); padding: 22px 24px 26px; }
.bdg .entete-haut { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.bdg .marque { font-size:11px; letter-spacing:0.18em; text-transform:uppercase; color:#8FA3B4; margin:0 0 6px; }
.bdg .mois-nav { display:flex; align-items:center; gap:4px; }
.bdg .mois-titre { font-size:23px; font-weight:600; letter-spacing:-0.02em; min-width:180px; }
.bdg .fleche { width:30px; height:30px; border-radius:50%; border:1px solid #2E4254; color:#B9C9D6; display:grid; place-items:center; }
.bdg .fleche:hover { background:#1B2A38; color:#fff; }
.bdg .solde { text-align:right; }
.bdg .solde-lib { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#8FA3B4; }
.bdg .solde-val { font-size:30px; font-weight:600; }
.bdg .solde-val.neg { color:#F08C7D; }

/* La bande — élément signature */
.bdg .bande { display:flex; height:34px; border-radius:5px; overflow:hidden; margin-top:20px; background:#1B2A38; }
.bdg .seg { position:relative; transition: width .7s cubic-bezier(.22,1,.36,1), filter .15s; min-width:2px; }
.bdg .seg:hover, .bdg .seg[data-actif="1"] { filter: brightness(1.22); }
.bdg .seg-pct { position:absolute; inset:0; display:grid; place-items:center; font-size:11px; font-weight:600; color:#fff; font-family:var(--mono); }
.bdg .legende { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
.bdg .puce { display:flex; align-items:center; gap:7px; padding:6px 11px 6px 8px; border-radius:4px; border:1px solid #2E4254; }
.bdg .puce[data-actif="1"] { background:#1B2A38; border-color:#3E5568; }
.bdg .pastille { width:9px; height:9px; border-radius:2px; flex:none; }
.bdg .puce-lib { font-size:12px; color:#B9C9D6; }
.bdg .puce-val { font-size:12px; font-weight:600; }

/* Onglets */
.bdg .onglets { display:flex; gap:2px; padding:0 16px; background:var(--encre); overflow-x:auto; }
.bdg .onglet { padding:11px 15px; font-size:13px; font-weight:500; color:#8FA3B4; border-radius:5px 5px 0 0; white-space:nowrap; }
.bdg .onglet:hover { color:#DCE6ED; }
.bdg .onglet[data-actif="1"] { background:var(--papier); color:var(--encre); font-weight:600; }

/* Contenu */
.bdg .zone { padding:22px 24px 0; max-width:960px; }
.bdg .carte { background:var(--craie); border:1px solid var(--trait); border-radius:7px; margin-bottom:16px; }
.bdg .carte-tete { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 16px; border-bottom:1px solid var(--trait); flex-wrap:wrap; }
.bdg .carte-titre { font-size:13px; font-weight:600; letter-spacing:0.04em; text-transform:uppercase; }
.bdg .carte-note { font-size:12px; color:var(--doux); }
.bdg .corps { padding:14px 16px; }

.bdg .ligne { display:flex; align-items:center; gap:12px; padding:10px 16px; border-bottom:1px solid #EDF1F3; }
.bdg .ligne:last-child { border-bottom:none; }
.bdg .ligne:hover .suppr { opacity:1; }
.bdg .ligne-lib { font-weight:500; }
.bdg .ligne-meta { font-size:12px; color:var(--doux); margin-top:1px; }
.bdg .pousse { margin-left:auto; }
.bdg .montant { font-weight:600; }
.bdg .montant.pos { color:var(--caisse); }
.bdg .suppr { opacity:0; color:var(--doux); font-size:17px; line-height:1; padding:2px 6px; border-radius:4px; transition:opacity .15s; }
.bdg .suppr:hover { color:var(--brique); background:#F6E9E7; }

.bdg .etiq { display:inline-block; font-size:11px; padding:2px 7px; border-radius:3px; background:#EDF1F3; color:var(--ardoise); }
.bdg .etiq.perso { background:#E8EDF7; color:var(--indigo); }

/* Formulaires */
.bdg .forme { display:flex; flex-wrap:wrap; gap:8px; align-items:flex-end; }
.bdg .champ { display:flex; flex-direction:column; gap:4px; }
.bdg .champ-lib { font-size:11px; letter-spacing:0.08em; text-transform:uppercase; color:var(--doux); }
.bdg input.saisie, .bdg select.saisie {
  border:1px solid var(--trait); border-radius:5px; padding:8px 10px; background:var(--craie);
  min-width:0; height:36px;
}
.bdg input.saisie:focus, .bdg select.saisie:focus { border-color:var(--indigo); outline:none; }
.bdg .btn { background:var(--encre); color:var(--craie); padding:9px 15px; border-radius:5px; font-size:13px; font-weight:600; height:36px; }
.bdg .btn:hover { background:#22364A; }
.bdg .btn.fant { background:none; color:var(--ardoise); border:1px solid var(--trait); }
.bdg .btn.fant:hover { background:#EDF1F3; color:var(--encre); }
.bdg .btn.mini { height:30px; padding:0 11px; font-size:12px; }
.bdg .bascule { display:flex; align-items:center; gap:7px; font-size:13px; color:var(--ardoise); height:36px; padding:0 4px; }

/* Jauges */
.bdg .jauge { height:7px; background:#EDF1F3; border-radius:4px; overflow:hidden; margin-top:9px; }
.bdg .jauge-fill { height:100%; border-radius:4px; transition:width .6s cubic-bezier(.22,1,.36,1); }

.bdg .grille { display:grid; grid-template-columns:repeat(auto-fill, minmax(270px,1fr)); gap:14px; }
.bdg .duo { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.bdg .stat-lib { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--doux); }
.bdg .stat-val { font-size:21px; font-weight:600; margin-top:2px; }
.bdg .avis { font-size:12px; padding:7px 11px; border-radius:5px; margin-top:10px; }
.bdg .avis.ok { background:#E7F2EE; color:var(--caisse); }
.bdg .avis.alerte { background:#F9EBE3; color:#9A5A18; }
.bdg .vide { padding:26px 16px; text-align:center; color:var(--doux); font-size:13px; }
.bdg table.amort { width:100%; border-collapse:collapse; font-size:13px; }
.bdg table.amort th { text-align:right; font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--doux); font-weight:500; padding:6px 8px; border-bottom:1px solid var(--trait); }
.bdg table.amort th:first-child, .bdg table.amort td:first-child { text-align:left; }
.bdg table.amort td { text-align:right; padding:6px 8px; border-bottom:1px solid #EDF1F3; }

@media (max-width: 620px) {
  .bdg .zone { padding:18px 14px 0; }
  .bdg .entete { padding:18px 14px 22px; }
  .bdg .duo { grid-template-columns:1fr; }
  .bdg .solde { text-align:left; }
  .bdg .seg-pct { font-size:10px; }
  .bdg .champ { flex:1 1 130px; }
}
@media (prefers-reduced-motion: reduce) {
  .bdg .seg, .bdg .jauge-fill { transition:none; }
}
`;

/* ═══════════════════════════════════════════════════════════════
   PETITS COMPOSANTS
   ═══════════════════════════════════════════════════════════════ */
function Champ({ libelle, valeur, onChange, largeur = 120, type = "text", options, placeholder, onEntree }) {
  const commun = {
    className: "saisie",
    style: { width: largeur },
    value: valeur,
    onChange: (e) => onChange(e.target.value),
    onKeyDown: (e) => e.key === "Enter" && onEntree && onEntree(),
  };
  return (
    <label className="champ">
      <span className="champ-lib">{libelle}</span>
      {options ? (
        <select {...commun}>
          {options.map((o) => (
            <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>
          ))}
        </select>
      ) : (
        <input {...commun} type={type} placeholder={placeholder} inputMode={type === "text" ? undefined : "decimal"} />
      )}
    </label>
  );
}

function Carte({ titre, note, action, children }) {
  return (
    <section className="carte">
      {(titre || action) && (
        <div className="carte-tete">
          <div>
            <div className="carte-titre">{titre}</div>
            {note && <div className="carte-note">{note}</div>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

function Jauge({ pct, couleur }) {
  return (
    <div className="jauge">
      <div className="jauge-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: couleur }} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   APPLICATION
   ═══════════════════════════════════════════════════════════════ */
export default function BudgetFoyer() {
  const [etat, setEtat] = useState(null);
  const [mois, setMois] = useState(moisCle());
  const [onglet, setOnglet] = useState("flux");
  const [posteActif, setPosteActif] = useState(null);
  const premierRendu = useRef(true);

  // Chargement initial
  useEffect(() => {
    let vivant = true;
    source.charger().then((e) => {
      if (vivant) setEtat(e && e.version === 1 ? e : ETAT_DEMO);
    });
    return () => { vivant = false; };
  }, []);

  // Sauvegarde différée
  useEffect(() => {
    if (!etat) return;
    if (premierRendu.current) { premierRendu.current = false; return; }
    const t = setTimeout(() => source.sauver(etat), 400);
    return () => clearTimeout(t);
  }, [etat]);

  const maj = (patch) => setEtat((e) => ({ ...e, ...patch }));

  /* ─── Calculs du mois ─── */
  const calc = useMemo(() => {
    if (!etat) return null;
    const actifs = etat.transactions.filter((t) => t.recurrent || t.mois === mois);
    const salaires = etat.membres.reduce((s, m) => s + m.revenu, 0);
    const autresRevenus = actifs.filter((t) => t.type === "revenu").reduce((s, t) => s + t.montant, 0);
    const revenus = salaires + autresRevenus;

    const depenses = actifs.filter((t) => t.type === "depense").reduce((s, t) => s + t.montant, 0);

    const creditsActifs = etat.credits
      .map((c) => {
        const k = Math.max(0, ecartMois(c.debut, mois));
        const M = mensualite(c.capital, c.taux, c.duree);
        return { ...c, k, mensualite: M, restant: capitalRestant(c.capital, c.taux, c.duree, k), solde: k >= c.duree };
      });
    const credits = creditsActifs.filter((c) => !c.solde).reduce((s, c) => s + c.mensualite, 0);

    const projets = etat.projets.reduce((s, p) => s + p.versement, 0);
    const placements = etat.placements.reduce((s, p) => s + p.versement, 0);
    const reste = revenus - depenses - credits - projets - placements;

    // Répartition par membre
    const communes = actifs.filter((t) => t.type === "depense" && t.pour === "foyer").reduce((s, t) => s + t.montant, 0);
    const chargesFoyer = communes + credits + projets + placements;
    const parMembre = etat.membres.map((m) => {
      const part = etat.repartition === "moitie" ? 1 / etat.membres.length : salaires ? m.revenu / salaires : 0;
      const perso = actifs.filter((t) => t.type === "depense" && t.pour === m.id).reduce((s, t) => s + t.montant, 0);
      const bonus = actifs.filter((t) => t.type === "revenu" && t.pour === m.id).reduce((s, t) => s + t.montant, 0);
      const du = chargesFoyer * part;
      return { ...m, part, perso, bonus, du, reste: m.revenu + bonus - du - perso };
    });

    const total = Math.max(revenus, depenses + credits + projets + placements);
    const parts = {
      depenses: { montant: depenses, pct: total ? (depenses / total) * 100 : 0 },
      credits: { montant: credits, pct: total ? (credits / total) * 100 : 0 },
      projets: { montant: projets, pct: total ? (projets / total) * 100 : 0 },
      placements: { montant: placements, pct: total ? (placements / total) * 100 : 0 },
      reste: { montant: Math.max(0, reste), pct: total ? (Math.max(0, reste) / total) * 100 : 0 },
    };

    return { actifs, revenus, salaires, depenses, credits, creditsActifs, projets, placements, reste, parts, parMembre };
  }, [etat, mois]);

  if (!etat || !calc) {
    return (
      <>
        <style>{CSS}</style>
        <div className="bdg">
          <div className="vide" style={{ paddingTop: 60 }}>Chargement du budget…</div>
        </div>
      </>
    );
  }

  const ONGLETS = [
    { id: "flux", nom: "Flux" },
    { id: "credits", nom: "Crédits" },
    { id: "projets", nom: "Projets" },
    { id: "epargne", nom: "Épargne" },
    { id: "foyer", nom: "Foyer" },
  ];

  const allerVers = (poste) => {
    setPosteActif(poste);
    const cible = { depenses: "flux", credits: "credits", projets: "projets", placements: "epargne", reste: "flux" }[poste];
    setOnglet(cible);
  };

  return (
    <>
      <style>{CSS}</style>
      <div className="bdg">
        {/* ── En-tête + bande ── */}
        <header className="entete">
          <div className="entete-haut">
            <div>
              <p className="marque">Budget du foyer</p>
              <div className="mois-nav">
                <button className="fleche" onClick={() => setMois(decalerMois(mois, -1))} aria-label="Mois précédent">‹</button>
                <span className="mois-titre chiffre">{libelleMois(mois)}</span>
                <button className="fleche" onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">›</button>
              </div>
            </div>
            <div className="solde">
              <div className="solde-lib">Reste à vivre</div>
              <div className={`solde-val chiffre ${calc.reste < 0 ? "neg" : ""}`}>{euro(calc.reste)}</div>
            </div>
          </div>

          <div className="bande" role="img" aria-label="Répartition des revenus du mois">
            {Object.entries(POSTES).map(([cle, poste]) => {
              const p = calc.parts[cle];
              if (p.pct <= 0) return null;
              return (
                <button
                  key={cle}
                  className="seg"
                  data-actif={posteActif === cle ? "1" : "0"}
                  style={{ width: `${p.pct}%`, background: `var(${poste.var})` }}
                  onClick={() => allerVers(cle)}
                  aria-label={`${poste.nom} : ${euro(p.montant)}`}
                >
                  {p.pct > 9 && <span className="seg-pct">{Math.round(p.pct)}%</span>}
                </button>
              );
            })}
          </div>

          <div className="legende">
            {Object.entries(POSTES).map(([cle, poste]) => (
              <button
                key={cle}
                className="puce"
                data-actif={posteActif === cle ? "1" : "0"}
                onClick={() => allerVers(cle)}
              >
                <span className="pastille" style={{ background: `var(${poste.var})` }} />
                <span className="puce-lib">{poste.nom}</span>
                <span className="puce-val chiffre">{euro(calc.parts[cle].montant)}</span>
              </button>
            ))}
          </div>
        </header>

        <nav className="onglets">
          {ONGLETS.map((o) => (
            <button key={o.id} className="onglet" data-actif={onglet === o.id ? "1" : "0"} onClick={() => setOnglet(o.id)}>
              {o.nom}
            </button>
          ))}
        </nav>

        <div className="zone">
          {onglet === "flux" && <OngletFlux etat={etat} maj={maj} calc={calc} mois={mois} />}
          {onglet === "credits" && <OngletCredits etat={etat} maj={maj} calc={calc} mois={mois} />}
          {onglet === "projets" && <OngletProjets etat={etat} maj={maj} mois={mois} />}
          {onglet === "epargne" && <OngletEpargne etat={etat} maj={maj} />}
          {onglet === "foyer" && <OngletFoyer etat={etat} maj={maj} setEtat={setEtat} calc={calc} />}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ONGLET FLUX
   ═══════════════════════════════════════════════════════════════ */
function OngletFlux({ etat, maj, calc, mois }) {
  const [f, setF] = useState({ libelle: "", montant: "", categorie: "Courses", pour: "foyer", type: "depense", recurrent: true });

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.montant) <= 0) return;
    maj({
      transactions: [
        { id: uid(), type: f.type, libelle: f.libelle.trim(), montant: num(f.montant), categorie: f.categorie, pour: f.pour, recurrent: f.recurrent, mois: f.recurrent ? null : mois },
        ...etat.transactions,
      ],
    });
    setF({ ...f, libelle: "", montant: "" });
  };

  const retirer = (id) => maj({ transactions: etat.transactions.filter((t) => t.id !== id) });
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

/* ═══════════════════════════════════════════════════════════════
   ONGLET CRÉDITS
   ═══════════════════════════════════════════════════════════════ */
function OngletCredits({ etat, maj, calc, mois }) {
  const [f, setF] = useState({ libelle: "", capital: "", taux: "", duree: "", debut: mois });
  const [ouvert, setOuvert] = useState(null);

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.capital) <= 0 || num(f.duree) <= 0) return;
    maj({ credits: [...etat.credits, { id: uid(), libelle: f.libelle.trim(), capital: num(f.capital), taux: num(f.taux), duree: Math.round(num(f.duree)), debut: f.debut }] });
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
                <button className="suppr" onClick={() => maj({ credits: etat.credits.filter((x) => x.id !== c.id) })} aria-label={`Supprimer ${c.libelle}`}>×</button>
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

/* ═══════════════════════════════════════════════════════════════
   ONGLET PROJETS
   ═══════════════════════════════════════════════════════════════ */
function OngletProjets({ etat, maj, mois }) {
  const [f, setF] = useState({ libelle: "", objectif: "", echeance: decalerMois(mois, 12), versement: "" });

  const ajouter = () => {
    if (!f.libelle.trim() || num(f.objectif) <= 0) return;
    maj({ projets: [...etat.projets, { id: uid(), libelle: f.libelle.trim(), objectif: num(f.objectif), epargne: 0, echeance: f.echeance, versement: num(f.versement) }] });
    setF({ libelle: "", objectif: "", echeance: decalerMois(mois, 12), versement: "" });
  };

  const modifier = (id, patch) => maj({ projets: etat.projets.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

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
                <div key={p.id} style={{ border: "1px solid var(--trait)", borderRadius: 6, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <div className="ligne-lib">{p.libelle}</div>
                    <button className="suppr" style={{ opacity: 1 }} onClick={() => maj({ projets: etat.projets.filter((x) => x.id !== p.id) })} aria-label={`Supprimer ${p.libelle}`}>×</button>
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
                    <Champ libelle="Versement /mois" valeur={String(p.versement)} onChange={(v) => modifier(p.id, { versement: num(v) })} largeur={110} />
                    <Champ libelle="Échéance" valeur={p.echeance} onChange={(v) => modifier(p.id, { echeance: v })} largeur={130} type="month" />
                  </div>
                  <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                    <button className="btn mini" onClick={() => modifier(p.id, { epargne: Math.min(p.objectif, p.epargne + p.versement) })}>
                      Verser {euro(p.versement)}
                    </button>
                    {!suffisant && (
                      <button className="btn fant mini" onClick={() => modifier(p.id, { versement: Math.ceil(requis) })}>
                        Caler sur l'objectif
                      </button>
                    )}
                  </div>
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

/* ═══════════════════════════════════════════════════════════════
   ONGLET ÉPARGNE
   ═══════════════════════════════════════════════════════════════ */
function OngletEpargne({ etat, maj }) {
  const [horizon, setHorizon] = useState(10);
  const [f, setF] = useState({ libelle: "", valeur: "", versement: "", rendement: "" });

  const ajouter = () => {
    if (!f.libelle.trim()) return;
    maj({ placements: [...etat.placements, { id: uid(), libelle: f.libelle.trim(), valeur: num(f.valeur), versement: num(f.versement), rendement: num(f.rendement) }] });
    setF({ libelle: "", valeur: "", versement: "", rendement: "" });
  };
  const modifier = (id, patch) => maj({ placements: etat.placements.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const valeurTotale = etat.placements.reduce((s, p) => s + p.valeur, 0);
  const versementTotal = etat.placements.reduce((s, p) => s + p.versement, 0);

  const courbe = useMemo(() => {
    const pts = [];
    for (let annee = 0; annee <= horizon; annee++) {
      const m = annee * 12;
      const valeur = etat.placements.reduce((s, p) => s + projeter(p.valeur, p.versement, p.rendement, m), 0);
      pts.push({ annee, valeur, verse: valeurTotale + versementTotal * m });
    }
    return pts;
  }, [etat.placements, horizon, valeurTotale, versementTotal]);

  const final = courbe[courbe.length - 1];

  return (
    <>
      <Carte
        titre="Projection"
        note={`Épargne du foyer sur ${horizon} ans`}
        action={
          <div style={{ display: "flex", gap: 4 }}>
            {[5, 10, 20].map((h) => (
              <button key={h} className={`btn mini ${horizon === h ? "" : "fant"}`} onClick={() => setHorizon(h)}>{h} ans</button>
            ))}
          </div>
        }
      >
        <div className="corps">
          <Courbe points={courbe} />
          <div className="duo" style={{ marginTop: 14 }}>
            <div>
              <div className="stat-lib">Valeur projetée</div>
              <div className="stat-val chiffre" style={{ color: "var(--indigo)" }}>{euro(final.valeur)}</div>
            </div>
            <div>
              <div className="stat-lib">Dont intérêts</div>
              <div className="stat-val chiffre" style={{ color: "var(--caisse)" }}>{euro(final.valeur - final.verse)}</div>
            </div>
          </div>
          <div className="carte-note" style={{ marginTop: 8 }}>
            Hypothèse : rendement constant, versements maintenus. Une projection n'est pas une garantie.
          </div>
        </div>
      </Carte>

      <Carte titre="Supports" note={`${euro(valeurTotale)} placés · ${euro(versementTotal)} versés chaque mois`}>
        {etat.placements.length === 0 && <div className="vide">Aucun support d'épargne enregistré.</div>}
        {etat.placements.map((p) => (
          <div className="ligne" key={p.id}>
            <div style={{ minWidth: 140 }}>
              <div className="ligne-lib">{p.libelle}</div>
              <div className="ligne-meta">{p.rendement}% par an · {euro(projeter(p.valeur, p.versement, p.rendement, horizon * 12))} dans {horizon} ans</div>
            </div>
            <div className="pousse forme" style={{ justifyContent: "flex-end" }}>
              <Champ libelle="Valeur" valeur={String(p.valeur)} onChange={(v) => modifier(p.id, { valeur: num(v) })} largeur={100} />
              <Champ libelle="/mois" valeur={String(p.versement)} onChange={(v) => modifier(p.id, { versement: num(v) })} largeur={85} />
              <Champ libelle="Rdt %" valeur={String(p.rendement)} onChange={(v) => modifier(p.id, { rendement: num(v) })} largeur={75} />
            </div>
            <button className="suppr" onClick={() => maj({ placements: etat.placements.filter((x) => x.id !== p.id) })} aria-label={`Supprimer ${p.libelle}`}>×</button>
          </div>
        ))}
      </Carte>

      <Carte titre="Ajouter un support">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Libellé" valeur={f.libelle} onChange={(v) => setF({ ...f, libelle: v })} largeur={170} placeholder="Ex. Assurance vie" onEntree={ajouter} />
            <Champ libelle="Valeur actuelle" valeur={f.valeur} onChange={(v) => setF({ ...f, valeur: v })} largeur={130} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Versement /mois" valeur={f.versement} onChange={(v) => setF({ ...f, versement: v })} largeur={130} placeholder="0" onEntree={ajouter} />
            <Champ libelle="Rendement %" valeur={f.rendement} onChange={(v) => setF({ ...f, rendement: v })} largeur={110} placeholder="0" onEntree={ajouter} />
            <button className="btn" onClick={ajouter}>Ajouter</button>
          </div>
        </div>
      </Carte>
    </>
  );
}

function Courbe({ points }) {
  const L = 620, H = 190, mg = { g: 8, d: 8, h: 12, b: 22 };
  const max = Math.max(...points.map((p) => p.valeur), 1);
  const x = (i) => mg.g + (i / Math.max(1, points.length - 1)) * (L - mg.g - mg.d);
  const y = (v) => mg.h + (1 - v / max) * (H - mg.h - mg.b);

  const traceur = (cle) => points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[cle]).toFixed(1)}`).join(" ");
  const aire = `${traceur("valeur")} L ${x(points.length - 1).toFixed(1)} ${y(0)} L ${x(0).toFixed(1)} ${y(0)} Z`;

  return (
    <svg viewBox={`0 0 ${L} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Projection de l'épargne">
      <path d={aire} fill="var(--indigo)" opacity="0.09" />
      <path d={traceur("verse")} fill="none" stroke="var(--doux)" strokeWidth="1.5" strokeDasharray="4 4" />
      <path d={traceur("valeur")} fill="none" stroke="var(--indigo)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) =>
        i % Math.ceil(points.length / 6) === 0 || i === points.length - 1 ? (
          <text key={i} x={x(i)} y={H - 6} fontSize="10" fill="var(--doux)" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontFamily="var(--mono)">
            {p.annee === 0 ? "auj." : `+${p.annee} an${p.annee > 1 ? "s" : ""}`}
          </text>
        ) : null
      )}
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ONGLET FOYER
   ═══════════════════════════════════════════════════════════════ */
function OngletFoyer({ etat, maj, setEtat, calc }) {
  const modifierMembre = (id, patch) => maj({ membres: etat.membres.map((m) => (m.id === id ? { ...m, ...patch } : m)) });

  return (
    <>
      <Carte titre="Les deux revenus" note="Salaires nets mensuels du foyer">
        {etat.membres.map((m) => (
          <div className="ligne" key={m.id}>
            <Champ libelle="Prénom" valeur={m.nom} onChange={(v) => modifierMembre(m.id, { nom: v })} largeur={150} />
            <Champ libelle="Revenu net /mois" valeur={String(m.revenu)} onChange={(v) => modifierMembre(m.id, { revenu: num(v) })} largeur={130} />
            <div className="pousse" style={{ textAlign: "right" }}>
              <div className="stat-lib">Part des revenus</div>
              <div className="chiffre" style={{ fontWeight: 600 }}>
                {calc.salaires ? Math.round((m.revenu / calc.salaires) * 100) : 0}%
              </div>
            </div>
          </div>
        ))}
        <div className="corps">
          <button className="btn fant mini" onClick={() => maj({ membres: [...etat.membres, { id: uid(), nom: "Nouveau", revenu: 0 }] })}>
            Ajouter une personne
          </button>
        </div>
      </Carte>

      <Carte titre="Partage des charges communes">
        <div className="corps">
          <div className="forme">
            <Champ libelle="Méthode" valeur={etat.repartition} onChange={(v) => maj({ repartition: v })} largeur={230}
              options={[{ v: "prorata", l: "Au prorata des revenus" }, { v: "moitie", l: "Moitié-moitié" }]} />
          </div>
          <div className="carte-note" style={{ marginTop: 10 }}>
            {etat.repartition === "prorata"
              ? "Chacun contribue proportionnellement à ce qu'il gagne. Le reste à vivre est plus équilibré quand les salaires diffèrent."
              : "Chacun paie la même somme, quel que soit son salaire."}
          </div>
        </div>
      </Carte>

      <Carte titre="Données">
        <div className="corps">
          <div className="carte-note">
            Tout est enregistré sur cet appareil, rien n'est envoyé ailleurs. Le jeu de départ est fictif : remplacez-le par vos chiffres.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button className="btn fant mini" onClick={() => setEtat({ ...ETAT_DEMO })}>Recharger les données d'exemple</button>
            <button
              className="btn fant mini"
              onClick={() => setEtat({ version: 1, membres: etat.membres.map((m) => ({ ...m })), repartition: etat.repartition, transactions: [], credits: [], projets: [], placements: [] })}
            >
              Repartir de zéro
            </button>
          </div>
        </div>
      </Carte>
    </>
  );
}

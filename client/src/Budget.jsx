// Application budget du foyer — structure et calculs du prototype,
// données servies par l'API (/api/etat) au lieu du stockage navigateur.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "./api.js";
import { mensualite, capitalRestant, cotisationAssurance, repartirParMembre } from "./finance.js";
import { euro, moisCle, decalerMois, ecartMois, libelleMois, POSTES } from "./utiles.js";
import Flux from "./onglets/Flux.jsx";
import Historique from "./onglets/Historique.jsx";
import Credits from "./onglets/Credits.jsx";
import Emprunt from "./onglets/Emprunt.jsx";
import { retourDeBanque } from "./composants/SourceRevenus.jsx";
import Projets from "./onglets/Projets.jsx";
import Epargne from "./onglets/Epargne.jsx";
import Foyer from "./onglets/Foyer.jsx";
import MenuCompte from "./composants/MenuCompte.jsx";

const ONGLETS = [
  { id: "flux", nom: "Flux" },
  { id: "historique", nom: "Historique" },
  { id: "credits", nom: "Crédits" },
  { id: "emprunt", nom: "Emprunt" },
  { id: "projets", nom: "Projets" },
  { id: "epargne", nom: "Épargne" },
  { id: "foyer", nom: "Foyer" },
];

// Route API de modification pour chaque ressource éditable au clavier.
const MODIFICATEURS = {
  projets: api.modifierProjet,
  placements: api.modifierPlacement,
  membres: api.modifierMembre,
};

// Route API de suppression, et nom affiché dans le bandeau d'annulation.
const SUPPRESSIONS = {
  transactions: { appeler: api.supprimerTransaction, nom: "La ligne" },
  credits: { appeler: api.supprimerCredit, nom: "Le crédit" },
  projets: { appeler: api.supprimerProjet, nom: "Le projet" },
  placements: { appeler: api.supprimerPlacement, nom: "Le support" },
};

// Temps laissé pour se raviser avant que la suppression ne parte vraiment.
const DELAI_ANNULATION = 6000;

export default function Budget({ compte, onDeconnexion, onSessionExpiree, ouvrirPage }) {
  const [etat, setEtat] = useState(null);
  const [mois, setMois] = useState(moisCle());
  // Au retour de la banque, on rouvre l'onglet d'où l'on était parti : c'est
  // lui qui confirme la liaison.
  const [onglet, setOnglet] = useState(() => (retourDeBanque() ? "emprunt" : "flux"));
  const [posteActif, setPosteActif] = useState(null);
  const [erreur, setErreur] = useState(null);
  const [rafraichissement, setRafraichissement] = useState(false);
  const [annulable, setAnnulable] = useState(null); // suppression rétractable en cours
  const jetonChargement = useRef(0);
  const enAttente = useRef({}); // envois différés des champs éditables, par "type:id"
  const suppressionEnAttente = useRef(null);
  const moisAffiche = useRef(mois);
  moisAffiche.current = mois;

  // Une session tombée (expirée, ou fermée depuis un autre appareil) ne se
  // rattrape pas ici : on renvoie vers la connexion plutôt que d'afficher une
  // erreur devant un budget que l'API refuse désormais de servir.
  const signaler = (err) => {
    if (err.nonAutorise) onSessionExpiree();
    else setErreur(err.message);
  };

  // Charge l'état d'un mois. L'écran précédent reste affiché pendant le fetch
  // (pas d'écran blanc) ; un jeton ignore les réponses périmées si on navigue vite.
  const charger = async (m) => {
    const jeton = ++jetonChargement.current;
    setErreur(null);
    setRafraichissement(true);
    try {
      const e = await api.etat(m);
      if (jeton === jetonChargement.current) setEtat(e);
    } catch (err) {
      if (jeton === jetonChargement.current) signaler(err);
    } finally {
      if (jeton === jetonChargement.current) setRafraichissement(false);
    }
  };

  useEffect(() => {
    charger(mois);
  }, [mois]); // eslint-disable-line react-hooks/exhaustive-deps

  // Exécute une écriture puis recharge le mois affiché.
  const executer = async (action) => {
    try {
      setErreur(null);
      await action();
      await charger(moisAffiche.current);
    } catch (err) {
      signaler(err);
    }
  };

  // Édition au clavier : mise à jour locale immédiate (comme le prototype),
  // envoi à l'API différé de 400 ms — l'équivalent de son ancienne sauvegarde.
  const modifier = (type, id, patch) => {
    setEtat((e) => ({ ...e, [type]: e[type].map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
    const cle = `${type}:${id}`;
    const envoi = enAttente.current[cle] ?? { type, id, patch: {} };
    envoi.patch = { ...envoi.patch, ...patch };
    clearTimeout(envoi.minuterie);
    envoi.minuterie = setTimeout(async () => {
      delete enAttente.current[cle];
      try {
        await MODIFICATEURS[type](id, envoi.patch);
      } catch (err) {
        signaler(err);
        charger(moisAffiche.current); // l'état local et la base ont divergé : on resynchronise
      }
    }, 400);
    enAttente.current[cle] = envoi;
  };

  /**
   * Envoie sans attendre tout ce qui dort encore dans le délai de 400 ms.
   *
   * Sans cela, une modification affichée à l'écran disparaît si l'on ferme
   * l'onglet, se déconnecte ou navigue avant l'échéance : l'utilisateur a vu sa
   * valeur changer, et elle n'a jamais existé.
   *
   * `persistant` demande au navigateur de mener la requête à son terme même si
   * la page s'en va — un fetch ordinaire serait abandonné à la fermeture.
   */
  const viderEnAttente = useCallback(({ persistant = false } = {}) => {
    const envois = Object.values(enAttente.current);
    enAttente.current = {};
    return envois.map((envoi) => {
      clearTimeout(envoi.minuterie);
      // L'erreur est ignorée : à ce moment-là il n'y a souvent plus personne
      // pour la lire, et l'état local sera de toute façon rechargé.
      return MODIFICATEURS[envoi.type](envoi.id, envoi.patch, { persistant }).catch(() => {});
    });
  }, []);

  // Fermeture de l'onglet, mise en arrière-plan, ou démontage du composant.
  // `visibilitychange` couvre les mobiles, où `pagehide` n'est pas garanti.
  // Une suppression laissée en attente au départ est confirmée : l'utilisateur
  // l'a demandée et l'a vue disparaître de l'écran. La reprendre en douce serait
  // plus surprenant que de la mener à son terme.
  const viderTout = useRef(null);
  useEffect(() => {
    const surDepart = () => viderTout.current({ persistant: true });
    const surMasquage = () => document.visibilityState === "hidden" && surDepart();
    window.addEventListener("pagehide", surDepart);
    document.addEventListener("visibilitychange", surMasquage);
    return () => {
      window.removeEventListener("pagehide", surDepart);
      document.removeEventListener("visibilitychange", surMasquage);
      viderTout.current();
    };
  }, []);

  /* ─── Suppression avec délai de rétractation ─────────────────────────────
     La ligne disparaît de l'écran tout de suite, mais l'appel à l'API n'est
     émis qu'au bout de quelques secondes. Se raviser ne demande donc aucune
     restauration : rien n'a encore été supprimé. */

  const envoyerSuppression = useCallback((suppression, { persistant = false } = {}) => {
    clearTimeout(suppression.minuterie);
    return SUPPRESSIONS[suppression.type].appeler(suppression.id, { persistant });
  }, []);

  // Fait partir la suppression en attente, s'il y en a une.
  const validerSuppression = useCallback(
    (options) => {
      const suppression = suppressionEnAttente.current;
      if (!suppression) return null;
      suppressionEnAttente.current = null;
      setAnnulable(null);
      return envoyerSuppression(suppression, options);
    },
    [envoyerSuppression],
  );

  const supprimer = (type, id, libelle) => {
    // Une suppression déjà en attente part immédiatement : garder plusieurs
    // rétractations ouvertes rendrait le bandeau ambigu.
    const precedente = validerSuppression();
    if (precedente) precedente.catch(signaler);

    setEtat((e) => ({ ...e, [type]: e[type].filter((x) => x.id !== id) }));

    const suppression = { type, id, libelle };
    suppression.minuterie = setTimeout(() => {
      suppressionEnAttente.current = null;
      setAnnulable(null);
      envoyerSuppression(suppression).catch(signaler);
    }, DELAI_ANNULATION);

    suppressionEnAttente.current = suppression;
    setAnnulable({ type, libelle });
  };

  // Tout ce qui dort — saisies comme suppression — part d'un coup au départ.
  viderTout.current = (options) =>
    [...viderEnAttente(options), validerSuppression(options)].filter(Boolean);

  // Se raviser : la minuterie tombe, et l'écran retrouve la vérité de la base —
  // que rien n'a jamais quittée.
  const annulerSuppression = () => {
    const suppression = suppressionEnAttente.current;
    if (!suppression) return;
    clearTimeout(suppression.minuterie);
    suppressionEnAttente.current = null;
    setAnnulable(null);
    charger(moisAffiche.current);
  };

  // Se déconnecter ferme la session : ce qui n'est pas parti avant ne partira
  // plus. On vide donc d'abord, et on attend que ce soit fait.
  const deconnexionApresVidage = async () => {
    await Promise.allSettled(viderTout.current());
    onDeconnexion();
  };

  // Le mode de répartition s'applique immédiatement à l'écran, puis en base.
  const changerRepartition = (v) => {
    setEtat((e) => ({ ...e, repartition: v }));
    executer(() => api.modifierFoyer(v));
  };

  /* ─── Calculs du mois — identiques au prototype ─── */
  const calc = useMemo(() => {
    if (!etat) return null;
    const actifs = etat.transactions; // déjà filtrées par mois côté API
    const salaires = etat.membres.reduce((s, m) => s + m.revenu, 0);
    const autresRevenus = actifs.filter((t) => t.type === "revenu").reduce((s, t) => s + t.montant, 0);
    const revenus = salaires + autresRevenus;

    const depenses = actifs.filter((t) => t.type === "depense").reduce((s, t) => s + t.montant, 0);

    const creditsActifs = etat.credits.map((c) => {
      const k = Math.max(0, ecartMois(c.debut, mois));
      const M = mensualite(c.capital, c.taux, c.duree);
      const restant = capitalRestant(c.capital, c.taux, c.duree, k);
      // L'assurance fait partie du prélèvement : c'est « echeance » qui pèse sur
      // le budget, pas la seule mensualité d'amortissement.
      const assurance = cotisationAssurance(c.capital, restant, c.assuranceTaux ?? 0, c.assuranceBase);
      return { ...c, k, mensualite: M, assurance, echeance: M + assurance, restant, solde: k >= c.duree };
    });
    const credits = creditsActifs.filter((c) => !c.solde).reduce((s, c) => s + c.echeance, 0);

    const projets = etat.projets.reduce((s, p) => s + p.versement, 0);
    const placements = etat.placements.reduce((s, p) => s + p.versement, 0);
    const reste = revenus - depenses - credits - projets - placements;

    // Répartition par membre : la même fonction que celle du serveur, pour que
    // l'écran et l'API ne puissent pas raconter deux choses différentes.
    const parMembre = repartirParMembre(
      {
        membres: etat.membres,
        transactions: etat.transactions,
        credits: etat.credits,
        projets: etat.projets,
        placements: etat.placements,
        repartition: etat.repartition,
      },
      mois
    );

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
      <div className="bdg">
        <div className="vide" style={{ paddingTop: 60 }}>
          {erreur ? (
            <>
              <p>Impossible de charger le budget : {erreur}</p>
              <button className="btn" onClick={() => charger(mois)}>Réessayer</button>
            </>
          ) : (
            "Chargement du budget…"
          )}
        </div>
      </div>
    );
  }

  const allerVers = (poste) => {
    setPosteActif(poste);
    const cible = { depenses: "flux", credits: "credits", projets: "projets", placements: "epargne", reste: "flux" }[poste];
    setOnglet(cible);
  };

  return (
    <div className="bdg" style={{ opacity: rafraichissement ? 0.6 : 1, transition: "opacity .15s" }}>
      {/* ── Barre d'application : la marque, et le compte à portée de clic ── */}
      <div className="barre">
        <div className="barre-inner">
          <div className="marque-app">
            <span className="marque-logo" aria-hidden="true">€</span>
            Budget du foyer
          </div>
          <MenuCompte
            compte={compte}
            onReglages={() => setOnglet("foyer")}
            onDeconnexion={deconnexionApresVidage}
            ouvrirPage={ouvrirPage}
          />
        </div>
      </div>

      {/* ── En-tête du mois + bande ── */}
      <header className="entete">
        <div className="entete-haut">
          <div className="mois-nav">
            <button className="fleche" onClick={() => setMois(decalerMois(mois, -1))} aria-label="Mois précédent">‹</button>
            <span className="mois-titre chiffre">{libelleMois(mois)}</span>
            <button className="fleche" onClick={() => setMois(decalerMois(mois, 1))} aria-label="Mois suivant">›</button>
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
        {erreur && (
          <div className="avis alerte" role="alert" style={{ marginTop: 0, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span>{erreur}</span>
            <button className="btn fant mini" onClick={() => charger(mois)}>Réessayer</button>
          </div>
        )}
        {annulable && (
          <div
            className="avis"
            role="status"
            style={{ marginTop: 0, marginBottom: 14, background: "var(--filet-fin)", color: "var(--ardoise)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
          >
            <span>{SUPPRESSIONS[annulable.type].nom} « {annulable.libelle} » a été supprimé.</span>
            <button className="btn fant mini" onClick={annulerSuppression}>Annuler</button>
          </div>
        )}
        {onglet === "flux" && <Flux etat={etat} calc={calc} mois={mois} executer={executer} supprimer={supprimer} />}
        {onglet === "historique" && <Historique mois={mois} />}
        {onglet === "credits" && <Credits etat={etat} calc={calc} mois={mois} executer={executer} supprimer={supprimer} />}
        {onglet === "emprunt" && <Emprunt etat={etat} calc={calc} compte={compte} signaler={signaler} />}
        {onglet === "projets" && <Projets etat={etat} mois={mois} executer={executer} modifier={modifier} supprimer={supprimer} />}
        {onglet === "epargne" && <Epargne etat={etat} mois={mois} executer={executer} modifier={modifier} supprimer={supprimer} />}
        {onglet === "foyer" && <Foyer etat={etat} calc={calc} executer={executer} modifier={modifier} changerRepartition={changerRepartition} compte={compte} onDeconnexion={deconnexionApresVidage} onCompteSupprime={onSessionExpiree} ouvrirPage={ouvrirPage} />}
      </div>
    </div>
  );
}

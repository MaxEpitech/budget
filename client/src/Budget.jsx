// Application budget du foyer — structure et calculs du prototype,
// données servies par l'API (/api/etat) au lieu du stockage navigateur.
//
// Ce composant tient l'état du mois et les écritures ; l'affichage est
// délégué au cadre (Coquille) et à l'écran courant, choisi par l'adresse.
import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "./api.js";
import { mensualite, capitalRestant, cotisationAssurance, repartirParMembre, revenusDuMois } from "./finance.js";
import { CATEGORIE_SALAIRE } from "./utiles.js";
import { reelDuMois } from "./reel.js";
import { moisCle, ecartMois } from "./utiles.js";
import { useNavigation } from "./navigation.js";
import Coquille from "./composants/Coquille.jsx";
import Icone from "./composants/Icone.jsx";
import Accueil from "./pages/Accueil.jsx";
import Flux from "./pages/Flux.jsx";
import Enveloppes from "./pages/Enveloppes.jsx";
import Historique from "./pages/Historique.jsx";
import Credits from "./pages/Credits.jsx";
import Emprunt from "./pages/Emprunt.jsx";
import { retourDeBanque } from "./composants/SourceRevenus.jsx";
import Projets from "./pages/Projets.jsx";
import Epargne from "./pages/Epargne.jsx";
import Reglages from "./reglages/Reglages.jsx";

// Route API de modification pour chaque ressource éditable au clavier.
const MODIFICATEURS = {
  projets: api.modifierProjet,
  placements: api.modifierPlacement,
  membres: api.modifierMembre,
};

// Route API de suppression, et ce qu'en dit le bandeau d'annulation.
const SUPPRESSIONS = {
  transactions: { appeler: api.supprimerTransaction, nom: "La ligne", accord: "supprimée" },
  credits: { appeler: api.supprimerCredit, nom: "Le crédit", accord: "supprimé" },
  projets: { appeler: api.supprimerProjet, nom: "Le projet", accord: "supprimé" },
  placements: { appeler: api.supprimerPlacement, nom: "Le support", accord: "supprimé" },
};

// Temps laissé pour se raviser avant que la suppression ne parte vraiment.
const DELAI_ANNULATION = 6000;

export default function Budget({ compte, onDeconnexion, onSessionExpiree, ouvrirPage }) {
  const [etat, setEtat] = useState(null);
  const [mois, setMois] = useState(moisCle());
  // Au retour de la banque, on rouvre le simulateur d'où l'on était parti :
  // c'est lui qui confirme la liaison.
  const [route, naviguer] = useNavigation(retourDeBanque() ? "emprunt" : undefined);
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
    // Le salaire saisi dans les réglages n'est qu'une référence : la paie du
    // mois, quand elle figure dans le flux, la remplace (revenusDuMois).
    const membresDuMois = revenusDuMois(etat.membres, actifs);
    const salaires = membresDuMois.reduce((s, m) => s + m.revenu, 0);
    const paies = new Set(membresDuMois.filter((m) => m.salaireReel).map((m) => m.id));
    const autresRevenus = actifs
      .filter((t) => t.type === "revenu" && !(t.categorie === CATEGORIE_SALAIRE && paies.has(t.pour)))
      .reduce((s, t) => s + t.montant, 0);
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

    // Le réel, face au prévu : ce qui est vraiment passé sur les comptes (reel.js).
    const reel = reelDuMois(etat, mois);

    return { actifs, revenus, salaires, depenses, credits, creditsActifs, projets, placements, reste, reel, parts, parMembre };
  }, [etat, mois]);

  // Les écrans du budget ont tous besoin de l'état du mois ; tant qu'il n'est
  // pas là, le cadre s'affiche déjà, avec de quoi patienter ou réessayer.
  let ecranCourant;
  if (!etat || !calc) {
    ecranCourant = (
      <div className="etat-vide" style={{ paddingTop: 80 }}>
        {erreur ? (
          <>
            <span className="etat-vide-icone"><Icone nom="alerte" taille={22} /></span>
            <div className="etat-vide-titre">Impossible de charger le budget</div>
            <p className="etat-vide-texte">{erreur}</p>
            <button className="btn" style={{ marginTop: 14 }} onClick={() => charger(mois)}>Réessayer</button>
          </>
        ) : (
          <div className="chargement" role="status">Chargement du budget…</div>
        )}
      </div>
    );
  } else if (route.reglages) {
    ecranCourant = (
      <Reglages
        section={route.id} naviguer={naviguer} etat={etat} calc={calc} executer={executer} modifier={modifier}
        changerRepartition={changerRepartition} compte={compte} onDeconnexion={deconnexionApresVidage}
        onCompteSupprime={onSessionExpiree} ouvrirPage={ouvrirPage}
      />
    );
  } else {
    const communs = { etat, calc, mois, executer, supprimer, modifier, naviguer };
    ecranCourant = {
      accueil: () => <Accueil {...communs} />,
      operations: () => <Flux {...communs} />,
      enveloppes: () => <Enveloppes budgets={etat.budgets ?? []} executer={executer} />,
      historique: () => <Historique mois={mois} />,
      credits: () => <Credits {...communs} />,
      projets: () => <Projets {...communs} />,
      epargne: () => <Epargne {...communs} />,
      emprunt: () => <Emprunt etat={etat} calc={calc} compte={compte} signaler={signaler} />,
    }[route.id]();
  }

  return (
    <div className="bdg">
      <Coquille
        route={route} naviguer={naviguer} compte={compte} mois={mois} setMois={setMois}
        reste={calc?.reste} reel={calc?.reel} occupe={rafraichissement && Boolean(etat)}
        onDeconnexion={deconnexionApresVidage} ouvrirPage={ouvrirPage}
      >
        {erreur && etat && (
          <div className="avis alerte bandeau" role="alert">
            <Icone nom="alerte" />
            <span>{erreur}</span>
            <button className="btn fant mini" onClick={() => charger(mois)}>Réessayer</button>
          </div>
        )}
        {ecranCourant}
      </Coquille>

      {/* La zone d'annonce existe en permanence : un lecteur d'écran ne lit
          que les changements d'une région qu'il connaissait déjà. */}
      <div className="toasts" role="status" aria-live="polite">
        {annulable && (
          <div className="toast">
            <span>
              {SUPPRESSIONS[annulable.type].nom} « {annulable.libelle} » a été {SUPPRESSIONS[annulable.type].accord}.
            </span>
            <button className="toast-action" onClick={annulerSuppression}>Annuler</button>
          </div>
        )}
      </div>
    </div>
  );
}

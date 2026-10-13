import { useState, useEffect, useLayoutEffect, useRef, useId, useCallback } from "react";
import { ETAPES, placerBulle } from "../tutoriel.js";

// Même seuil que le tiroir du menu dans styles.css : en dessous, la bulle se
// colle en bas de l'écran, sous le pouce, au lieu de flotter près de l'élément.
const ECRAN_ETROIT = "(max-width: 1023px)";
const MARGE = 16;
const AIR = 8; // l'éclairage déborde un peu de l'élément
const ATTENTE_MAX = 1500; // au-delà, la cible est réputée absente

const viseur = (cible) => `[data-tutoriel="${cible}"]`;

// Un élément qu'on ne peut pas montrer : sans taille, masqué, ou hors de la
// fenêtre. C'est le cas du menu sur téléphone — un tiroir fermé, rejeté à
// gauche de l'écran — où l'éclairer ne mènerait nulle part.
function mesurerVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  const style = window.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return null;
  if (r.right <= 0 || r.left >= window.innerWidth) return null;
  return r;
}

const memeRect = (a, b) =>
  a === b || (a && b && a.haut === b.haut && a.gauche === b.gauche && a.largeur === b.largeur && a.hauteur === b.hauteur);

/**
 * La visite guidée : un halo autour de l'élément présenté, et une bulle qui
 * l'explique. Elle emmène d'écran en écran (`naviguer`) puis ramène là d'où
 * l'on est parti.
 *
 * @param route     l'écran courant (pour savoir quand il faut naviguer)
 * @param naviguer  change d'écran, par identifiant
 * @param onFermer  appelée une fois la visite terminée ou passée
 */
export default function Tutoriel({ route, naviguer, onFermer }) {
  const [indice, setIndice] = useState(0);
  // Résultat de la recherche de cible, estampillé de l'étape qui l'a produit :
  // une valeur d'une étape précédente ne peut jamais passer pour la bonne.
  const [resolu, setResolu] = useState(null); // { indice, cible }
  const [halo, setHalo] = useState(null); // rectangle éclairé, ou null
  const [position, setPosition] = useState(null);
  const [etroit, setEtroit] = useState(() => window.matchMedia(ECRAN_ETROIT).matches);
  const bulleRef = useRef(null);
  const idTitre = useId();
  const idTexte = useId();

  // L'écran de départ est celui du premier rendu ; `route` suit ensuite chaque
  // navigation de la visite, sans relancer les effets qui la lisent.
  const depart = useRef(route);
  const routeCourante = useRef(route);
  routeCourante.current = route;
  const etape = ETAPES[indice];
  const pret = resolu?.indice === indice; // la cible est trouvée (ou renoncée)
  // Lue pendant le rendu, donc toujours celle de l'étape affichée — jamais un
  // reliquat écrit par un effet qui n'a pas encore tourné.
  const cibleCourante = useRef(null);
  cibleCourante.current = pret ? resolu.cible : null;
  const derniere = indice === ETAPES.length - 1;

  const terminer = useCallback(() => {
    if (routeCourante.current.id !== depart.current.id) naviguer(depart.current.id);
    onFermer();
  }, [naviguer, onFermer]);

  const aller = useCallback((i) => {
    if (i >= 0 && i < ETAPES.length) setIndice(i);
  }, []);

  // Le focus revient où il était à la fermeture. Si ce bouton a disparu entre
  // temps (une entrée de menu), le contenu de la page prend le relais.
  useEffect(() => {
    const avant = document.activeElement;
    return () => {
      if (avant && avant.isConnected && avant !== document.body) avant.focus({ preventScroll: true });
      else document.getElementById("contenu")?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const mq = window.matchMedia(ECRAN_ETROIT);
    const change = () => setEtroit(mq.matches);
    mq.addEventListener("change", change);
    return () => mq.removeEventListener("change", change);
  }, []);

  // Une étape : aller à l'écran, attendre la cible, la mettre au centre.
  useEffect(() => {
    let annule = false;
    let image = 0;
    if (etape.page && routeCourante.current.id !== etape.page) naviguer(etape.page);

    const conclure = (cible) => {
      if (!annule) setResolu({ indice, cible });
    };

    if (!etape.cible) {
      conclure(null);
      return undefined;
    }

    // L'écran visé se rend après la navigation, parfois après un chargement :
    // on guette la cible image par image, sans attendre indéfiniment.
    const debut = performance.now();
    const chercher = () => {
      if (annule) return;
      const el = document.querySelector(viseur(etape.cible));
      if (el) {
        if (!mesurerVisible(el)) return conclure(null);
        el.scrollIntoView({ block: "center" });
        return conclure(etape.cible);
      }
      if (performance.now() - debut > ATTENTE_MAX) return conclure(null);
      image = requestAnimationFrame(chercher);
    };
    image = requestAnimationFrame(chercher);

    return () => {
      annule = true;
      cancelAnimationFrame(image);
    };
  }, [indice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mesure du halo : à l'arrivée, puis quand la fenêtre change ou défile.
  const mesurer = useCallback(() => {
    const cible = cibleCourante.current;
    const el = cible && document.querySelector(viseur(cible));
    const r = el && mesurerVisible(el);
    const suivant = r
      ? { haut: r.top - AIR, gauche: r.left - AIR, largeur: r.width + 2 * AIR, hauteur: r.height + 2 * AIR }
      : null;
    setHalo((ancien) => (memeRect(ancien, suivant) ? ancien : suivant));
  }, []);

  useLayoutEffect(() => {
    if (pret) mesurer();
    else setHalo(null);
  }, [resolu, pret, mesurer]);

  useEffect(() => {
    if (!pret) return undefined;
    let image = 0;
    const replanifier = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(mesurer);
    };
    window.addEventListener("resize", replanifier);
    window.addEventListener("scroll", replanifier, true); // aussi les conteneurs qui défilent
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("resize", replanifier);
      window.removeEventListener("scroll", replanifier, true);
    };
  }, [pret, mesurer]);

  // Placement de la bulle, avant la peinture pour qu'elle n'apparaisse pas
  // d'abord au mauvais endroit.
  useLayoutEffect(() => {
    if (!pret || !bulleRef.current) return;
    if (etroit) {
      // Collée en bas : si elle masque l'élément, on fait défiler pour le dégager.
      setPosition(null);
      if (halo) {
        const libre = window.innerHeight - bulleRef.current.offsetHeight - 2 * MARGE;
        const exces = halo.haut + halo.hauteur - libre;
        if (exces > 0) window.scrollBy(0, Math.min(exces, Math.max(0, halo.haut - MARGE)));
      }
      return;
    }
    const { haut, gauche } = placerBulle({
      cible: halo,
      bulle: { largeur: bulleRef.current.offsetWidth, hauteur: bulleRef.current.offsetHeight },
      ecran: { largeur: window.innerWidth, hauteur: window.innerHeight },
      marge: MARGE,
    });
    setPosition({ haut, gauche });
  }, [pret, halo, etroit, indice]);

  // Le focus suit la bulle à chaque étape : un lecteur d'écran lit alors le
  // titre et le texte de l'étape qui vient d'apparaître.
  // Il faut attendre que la bulle soit visible : un élément masqué refuse le focus.
  const affichee = pret && (etroit || Boolean(position));
  useEffect(() => {
    if (affichee) bulleRef.current?.focus({ preventScroll: true });
  }, [affichee, indice]);

  // Clavier : Échap ferme, les flèches avancent. Tab reste dans la bulle — le
  // reste de la page est derrière un voile, y atterrir serait trompeur.
  useEffect(() => {
    const auClavier = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        terminer();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (derniere) terminer();
        else aller(indice + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        aller(indice - 1);
      } else if (e.key === "Tab" && bulleRef.current) {
        const focalisables = [...bulleRef.current.querySelectorAll("button:not([disabled])")];
        const premier = focalisables[0];
        const dernier = focalisables[focalisables.length - 1];
        const actif = document.activeElement;
        if (e.shiftKey && (actif === premier || actif === bulleRef.current)) {
          e.preventDefault();
          dernier?.focus();
        } else if (!e.shiftKey && actif === dernier) {
          e.preventDefault();
          premier?.focus();
        } else if (!bulleRef.current.contains(actif)) {
          e.preventDefault();
          premier?.focus();
        }
      }
    };
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, [indice, derniere, terminer, aller]);

  const style = !etroit && position ? { top: position.haut, left: position.gauche } : undefined;

  return (
    <div className="tuto">
      {/* Le voile intercepte les clics : l'application derrière reste inerte
          pendant la visite, et toucher le fond ne la ferme pas. */}
      <div className="tuto-voile" data-sombre={halo ? "0" : "1"} aria-hidden="true" />
      {halo && (
        <div
          className="tuto-halo"
          aria-hidden="true"
          style={{ top: halo.haut, left: halo.gauche, width: halo.largeur, height: halo.hauteur }}
        />
      )}
      <div
        ref={bulleRef}
        className={`tuto-bulle${etroit ? " bas" : ""}`}
        style={style}
        data-pret={affichee ? "1" : "0"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        aria-describedby={idTexte}
        tabIndex={-1}
      >
        <div className="tuto-progression chiffre">{indice + 1} / {ETAPES.length}</div>
        <h2 className="tuto-titre" id={idTitre}>{etape.titre}</h2>
        <p className="tuto-texte" id={idTexte}>{etape.texte}</p>
        <div className="tuto-actions">
          <button type="button" className="btn fant mini" onClick={terminer}>Passer la visite</button>
          <span className="tuto-pas">
            <button type="button" className="btn fant mini" onClick={() => aller(indice - 1)} disabled={indice === 0}>
              Précédent
            </button>
            <button type="button" className="btn mini" onClick={() => (derniere ? terminer() : aller(indice + 1))}>
              {derniere ? "Terminer" : "Suivant"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

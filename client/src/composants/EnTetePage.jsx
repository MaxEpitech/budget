/**
 * Titre d'un écran, ce qu'on y trouve, et ses commandes principales.
 *
 * Toujours au même endroit, toujours la même forme : l'action qu'on vient
 * faire sur un écran — ajouter un crédit, un projet — se trouve en haut à
 * droite, où qu'on soit.
 *
 * `tutoriel` nomme l'en-tête pour la visite guidée (data-tutoriel).
 */
export default function EnTetePage({ titre, description, actions, tutoriel }) {
  return (
    <header className="page-tete" data-tutoriel={tutoriel}>
      <div className="page-tete-texte">
        <h1 className="page-titre">{titre}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

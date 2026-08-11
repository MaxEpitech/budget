// Gabarits des emails transactionnels.
//
// Chaque gabarit est une fonction pure qui renvoie { sujet, html, texte, lien },
// ce qui les rend testables sans rien envoyer. Version texte systématique :
// certains clients mail n'affichent pas le HTML, et un lien de validation qui
// n'arrive pas est un compte perdu.
//
// Mise en page volontairement sobre et en styles en ligne : les clients mail
// ignorent les feuilles de style et une bonne partie du CSS moderne.

const ENCRE = "#101A24";
const ARDOISE = "#46596B";
const DOUX = "#7A8B98";

// L'URL publique de l'application, base des liens envoyés par email.
export const urlApplication = () => (process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");

// Toute donnée venant de l'utilisateur (son adresse) traverse cette fonction
// avant d'entrer dans le HTML.
export const echapper = (texte) =>
  String(texte)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const enveloppe = (titre, corps) => `
<div style="margin:0;padding:24px;background:#E7EBED;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${ENCRE};">
  <div style="max-width:520px;margin:0 auto;background:#FFFFFF;border:1px solid #D3DADE;border-radius:7px;overflow:hidden;">
    <div style="background:${ENCRE};color:#FFFFFF;padding:18px 24px;">
      <div style="font-size:11px;letter-spacing:0.18em;text-transform:uppercase;color:#8FA3B4;">Budget du foyer</div>
      <div style="font-size:19px;font-weight:600;margin-top:4px;">${titre}</div>
    </div>
    <div style="padding:22px 24px;font-size:15px;line-height:1.5;">
${corps}
    </div>
  </div>
</div>`.trim();

const bouton = (lien, libelle) => `
      <p style="margin:22px 0;">
        <a href="${echapper(lien)}" style="display:inline-block;background:${ENCRE};color:#FFFFFF;text-decoration:none;padding:11px 20px;border-radius:5px;font-size:14px;font-weight:600;">${libelle}</a>
      </p>
      <p style="margin:0 0 4px;font-size:12px;color:${DOUX};">Si le bouton ne fonctionne pas, copiez cette adresse dans votre navigateur :</p>
      <p style="margin:0;font-size:12px;color:${ARDOISE};word-break:break-all;">${echapper(lien)}</p>`;

/** Email envoyé à l'inscription, pour confirmer l'adresse. */
export function gabaritValidation({ email, jeton }) {
  const lien = `${urlApplication()}/valider?jeton=${encodeURIComponent(jeton)}`;
  return {
    lien,
    sujet: "Confirmez votre adresse — Budget du foyer",
    html: enveloppe(
      "Confirmez votre adresse",
      `      <p style="margin:0;">Un compte vient d'être créé avec l'adresse ${echapper(email)}. Il ne reste qu'à confirmer que cette adresse est bien la vôtre.</p>
${bouton(lien, "Confirmer mon adresse")}
      <p style="margin:22px 0 0;font-size:12px;color:${DOUX};">Ce lien est valable 24 heures et ne fonctionne qu'une fois. Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message : sans confirmation, le compte reste inutilisable.</p>`
    ),
    texte: [
      "Confirmez votre adresse — Budget du foyer",
      "",
      `Un compte vient d'être créé avec l'adresse ${email}.`,
      "Ouvrez ce lien pour confirmer que cette adresse est bien la vôtre :",
      "",
      lien,
      "",
      "Ce lien est valable 24 heures et ne fonctionne qu'une fois.",
      "Si vous n'êtes pas à l'origine de cette inscription, ignorez ce message :",
      "sans confirmation, le compte reste inutilisable.",
    ].join("\n"),
  };
}

/** Email envoyé quand on tente de s'inscrire avec une adresse déjà connue. */
export function gabaritInscriptionExistante({ email }) {
  const lien = `${urlApplication()}/`;
  return {
    lien,
    sujet: "Tentative d'inscription — Budget du foyer",
    html: enveloppe(
      "Vous avez déjà un compte",
      `      <p style="margin:0;">Quelqu'un vient de demander la création d'un compte avec l'adresse ${echapper(email)}. Un compte existe déjà : aucun second compte n'a été créé et rien n'a changé.</p>
      <p style="margin:14px 0 0;">Si c'était vous, connectez-vous simplement — et utilisez « Mot de passe oublié » si vous ne vous en souvenez plus.</p>
${bouton(lien, "Aller à la connexion")}
      <p style="margin:22px 0 0;font-size:12px;color:${DOUX};">Si ce n'était pas vous, il n'y a rien à faire : sans accès à cette boîte mail, personne ne peut prendre la main sur votre compte.</p>`
    ),
    texte: [
      "Vous avez déjà un compte — Budget du foyer",
      "",
      `Quelqu'un vient de demander la création d'un compte avec l'adresse ${email}.`,
      "Un compte existe déjà : aucun second compte n'a été créé et rien n'a changé.",
      "",
      "Si c'était vous, connectez-vous simplement :",
      "",
      lien,
      "",
      "Si vous ne vous souvenez plus de votre mot de passe, utilisez « Mot de passe oublié ».",
      "Si ce n'était pas vous, il n'y a rien à faire.",
    ].join("\n"),
  };
}

/** Email de réinitialisation du mot de passe. */
export function gabaritReinitialisation({ email, jeton }) {
  const lien = `${urlApplication()}/reinitialiser?jeton=${encodeURIComponent(jeton)}`;
  return {
    lien,
    sujet: "Réinitialisation de votre mot de passe — Budget du foyer",
    html: enveloppe(
      "Nouveau mot de passe",
      `      <p style="margin:0;">Une réinitialisation du mot de passe a été demandée pour ${echapper(email)}.</p>
${bouton(lien, "Choisir un nouveau mot de passe")}
      <p style="margin:22px 0 0;font-size:12px;color:${DOUX};">Ce lien est valable 1 heure et ne fonctionne qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste valable.</p>`
    ),
    texte: [
      "Nouveau mot de passe — Budget du foyer",
      "",
      `Une réinitialisation du mot de passe a été demandée pour ${email}.`,
      "Ouvrez ce lien pour en choisir un nouveau :",
      "",
      lien,
      "",
      "Ce lien est valable 1 heure et ne fonctionne qu'une fois.",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message :",
      "votre mot de passe actuel reste valable.",
    ].join("\n"),
  };
}

/**
 * Email envoyé quand une réinitialisation est demandée pour une adresse
 * inconnue. Répondre systématiquement « email envoyé » à l'écran évite de
 * révéler qui possède un compte ; ce message évite en contrepartie de laisser
 * quelqu'un attendre en vain un courrier qui n'arrivera jamais.
 */
export function gabaritReinitialisationSansCompte({ email }) {
  const lien = `${urlApplication()}/`;
  return {
    lien,
    sujet: "Réinitialisation de votre mot de passe — Budget du foyer",
    html: enveloppe(
      "Aucun compte à cette adresse",
      `      <p style="margin:0;">Une réinitialisation de mot de passe a été demandée pour ${echapper(email)}, mais aucun compte n'existe à cette adresse.</p>
      <p style="margin:14px 0 0;">Vous vous êtes peut-être inscrit avec une autre adresse. Vous pouvez aussi créer un compte.</p>
${bouton(lien, "Ouvrir l'application")}
      <p style="margin:22px 0 0;font-size:12px;color:${DOUX};">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>`
    ),
    texte: [
      "Aucun compte à cette adresse — Budget du foyer",
      "",
      `Une réinitialisation de mot de passe a été demandée pour ${email},`,
      "mais aucun compte n'existe à cette adresse.",
      "",
      "Vous vous êtes peut-être inscrit avec une autre adresse.",
      `Vous pouvez aussi créer un compte : ${lien}`,
      "",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
    ].join("\n"),
  };
}

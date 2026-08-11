// Envoi des emails transactionnels.
//
// Deux modes, choisis automatiquement :
//   • RESEND_API_KEY renseignée → envoi réel via l'API HTTP de Resend
//   • sinon                     → mode console : le message et son lien sont
//     écrits dans le journal du serveur
//
// Le mode console n'est pas un bouchon de test : c'est ce qui permet de
// développer et d'essayer tout le parcours d'inscription sans compte Resend ni
// configuration SMTP. Le lien est affiché en clair, il suffit de le coller
// dans le navigateur.

const POINT_DE_TERMINAISON = "https://api.resend.com/emails";

export const modeEnvoi = () => (process.env.RESEND_API_KEY ? "resend" : "console");

// Expéditeur par défaut : l'adresse de test de Resend, qui fonctionne sans
// domaine vérifié mais n'écrit qu'au propriétaire du compte.
const expediteur = () => process.env.EMAIL_EXPEDITEUR || "Budget du foyer <onboarding@resend.dev>";

/**
 * Envoie un email. Lève en cas d'échec du transport : c'est à l'appelant de
 * décider s'il veut le signaler à l'utilisateur ou seulement le journaliser.
 *
 * @param {{destinataire: string, sujet: string, html: string, texte: string, lien?: string}} message
 */
export async function envoyerEmail({ destinataire, sujet, html, texte, lien }) {
  if (modeEnvoi() === "console") {
    const barre = "─".repeat(72);
    console.log(
      [
        barre,
        "EMAIL — mode console (RESEND_API_KEY absente du .env)",
        `À      : ${destinataire}`,
        `Sujet  : ${sujet}`,
        ...(lien ? ["", `Lien   : ${lien}`, ""] : [""]),
        texte,
        barre,
      ].join("\n")
    );
    return { mode: "console" };
  }

  let reponse;
  try {
    reponse = await fetch(POINT_DE_TERMINAISON, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: expediteur(), to: [destinataire], subject: sujet, html, text: texte }),
    });
  } catch (cause) {
    throw new Error("Service d'envoi d'emails injoignable", { cause });
  }

  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => "");
    throw new Error(`Envoi refusé par Resend (${reponse.status}) ${detail}`.trim());
  }

  const { id } = await reponse.json().catch(() => ({}));
  return { mode: "resend", id };
}

// Trace au démarrage du serveur, pour qu'on sache dans quel mode on travaille.
export function annoncerModeEnvoi() {
  if (modeEnvoi() === "console") {
    console.log("Emails : mode console — les liens de validation s'afficheront ici.");
  } else {
    console.log(`Emails : envoi réel via Resend, expéditeur « ${expediteur()} ».`);
  }
}

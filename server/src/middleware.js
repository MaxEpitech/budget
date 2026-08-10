// Middlewares et aides partagés par les routes.

// Express 4 ne remonte pas les rejets des handlers async : on les attrape ici.
export const attraper = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Valide req.body avec un schéma Zod ; en cas d'échec → 400 avec un message
// exploitable côté UI. Les données validées atterrissent dans req.donnees.
export const valider = (schema) => (req, res, next) => {
  const r = schema.safeParse(req.body);
  if (!r.success) {
    return res.status(400).json({ erreur: r.error.issues.map((i) => i.message).join(" ; ") });
  }
  req.donnees = r.data;
  next();
};

// Exécute une action Prisma ; un enregistrement introuvable (P2025) → 404.
// Renvoie null dans ce cas pour que l'appelant court-circuite sa réponse.
export async function ou404(res, nom, action) {
  try {
    return await action();
  } catch (e) {
    if (e?.code === "P2025") {
      res.status(404).json({ erreur: `${nom} introuvable` });
      return null;
    }
    throw e;
  }
}

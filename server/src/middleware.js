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

/* ─── Accès bornés au foyer ───────────────────────────────────────────────
   Toutes les écritures passent par updateMany/deleteMany avec le foyer dans
   le filtre : un identifiant appartenant à un autre foyer ne correspond à
   aucune ligne et se comporte exactement comme un identifiant inexistant
   (404), sans jamais divulguer son existence. */

// Modifie un enregistrement du foyer ; renvoie null et répond 404 si l'objet
// n'existe pas ou appartient à un autre foyer.
export async function modifierDansFoyer(res, nom, modele, id, foyerId, data) {
  if (Object.keys(data).length === 0) {
    // Rien à modifier : on vérifie seulement que l'objet est bien dans le foyer.
    const existant = await modele.findFirst({ where: { id, foyerId } });
    if (!existant) {
      res.status(404).json({ erreur: `${nom} introuvable` });
      return null;
    }
    return existant;
  }
  const { count } = await modele.updateMany({ where: { id, foyerId }, data });
  if (count === 0) {
    res.status(404).json({ erreur: `${nom} introuvable` });
    return null;
  }
  return modele.findUnique({ where: { id } });
}

// Supprime un enregistrement du foyer ; renvoie false et répond 404 sinon.
export async function supprimerDansFoyer(res, nom, modele, id, foyerId) {
  const { count } = await modele.deleteMany({ where: { id, foyerId } });
  if (count === 0) {
    res.status(404).json({ erreur: `${nom} introuvable` });
    return false;
  }
  return true;
}

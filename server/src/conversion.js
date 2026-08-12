// Frontière API ↔ base.
// En base : montants en centimes (entiers), noms normalisés (revenuMensuel,
// dureeMois, versementMensuel, membreId…).
// Côté API : euros et noms de champs du prototype (revenu, duree, debut,
// versement, epargne, pour…) pour que la logique des onglets ne bouge pas.

export const enCentimes = (euros) => Math.round(euros * 100);
export const enEuros = (centimes) => centimes / 100;

/* ─── Membre ─── */
export const membreVersApi = (m) => ({
  id: m.id,
  nom: m.nom,
  revenu: enEuros(m.revenuMensuel),
});

// Accepte un objet partiel : seuls les champs présents sont mappés (PUT partiel).
export const membreVersDb = (d) => {
  const patch = {};
  if (d.nom !== undefined) patch.nom = d.nom;
  if (d.revenu !== undefined) patch.revenuMensuel = enCentimes(d.revenu);
  return patch;
};

/* ─── Transaction — `pour` : "foyer" ou l'id d'un membre (membreId en base) ─── */
export const transactionVersApi = (t) => ({
  id: t.id,
  date: t.date,
  type: t.type,
  libelle: t.libelle,
  montant: enEuros(t.montant),
  categorie: t.categorie,
  pour: t.membreId ?? "foyer",
  recurrent: t.recurrent,
  mois: t.mois,
  periodicite: t.periodicite,
  debut: t.debut,
  fin: t.fin,
});

export const transactionVersDb = (d) => ({
  type: d.type,
  libelle: d.libelle,
  montant: enCentimes(d.montant),
  categorie: d.categorie,
  membreId: d.pour === "foyer" ? null : d.pour,
  recurrent: d.recurrent,
  // Comme dans le prototype : une ligne récurrente n'est rattachée à aucun mois.
  mois: d.recurrent ? null : d.mois,
  // Une ligne ponctuelle porte une date réelle ; à défaut de jour saisi, le
  // premier du mois. Une récurrente n'en a pas : elle revient tous les mois,
  // elle n'arrive pas un jour précis.
  date: d.recurrent ? null : (d.date ? new Date(d.date) : new Date(`${d.mois}-01T00:00:00.000Z`)),
  // Rythme et validité n'ont de sens que pour une récurrente.
  periodicite: d.recurrent ? (d.periodicite ?? "mensuel") : "mensuel",
  debut: d.recurrent ? (d.debut ?? null) : null,
  fin: d.recurrent ? (d.fin ?? null) : null,
});

/* ─── Crédit ─── */
export const creditVersApi = (c) => ({
  id: c.id,
  libelle: c.libelle,
  capital: enEuros(c.capital),
  taux: c.taux,
  duree: c.dureeMois,
  debut: c.moisDebut,
  assuranceTaux: c.assuranceTaux,
  assuranceBase: c.assuranceBase,
  pour: c.membreId ?? "foyer",
});

export const creditVersDb = (d) => ({
  libelle: d.libelle,
  capital: enCentimes(d.capital),
  taux: d.taux,
  dureeMois: d.duree,
  moisDebut: d.debut,
  // Absent vaut « pas d'assurance » : un crédit saisi sans ce champ reste
  // exactement ce qu'il était.
  assuranceTaux: d.assuranceTaux ?? 0,
  assuranceBase: d.assuranceBase ?? "initial",
  // "foyer" et l'absence de champ valent la même chose : personne en propre.
  membreId: !d.pour || d.pour === "foyer" ? null : d.pour,
});

/* ─── Projet — l'épargne est la somme des versements, jamais un champ stocké ─── */
// `pour` : "foyer" ou l'id du membre qui a mis au pot (membreId en base).
export const versementVersApi = (v) => ({
  id: v.id,
  montant: enEuros(v.montant),
  date: v.date,
  pour: v.membreId ?? "foyer",
});

export const projetVersApi = (p) => ({
  id: p.id,
  libelle: p.libelle,
  objectif: enEuros(p.objectif),
  echeance: p.echeance,
  versement: enEuros(p.versementMensuel),
  epargne: enEuros(p.versements.reduce((s, v) => s + v.montant, 0)),
  versements: p.versements.map(versementVersApi),
});

export const projetVersDb = (d) => {
  const patch = {};
  if (d.libelle !== undefined) patch.libelle = d.libelle;
  if (d.objectif !== undefined) patch.objectif = enCentimes(d.objectif);
  if (d.echeance !== undefined) patch.echeance = d.echeance;
  if (d.versement !== undefined) patch.versementMensuel = enCentimes(d.versement);
  return patch;
};

/* ─── Placement ─── */
// `pour` : "foyer" ou l'id du membre qui a versé (membreId en base).
export const mouvementVersApi = (m) => ({
  id: m.id,
  type: m.type,
  montant: enEuros(m.montant),
  valeurApres: enEuros(m.valeurApres),
  date: m.date,
  pour: m.membreId ?? "foyer",
});

export const placementVersApi = (p) => ({
  id: p.id,
  libelle: p.libelle,
  valeur: enEuros(p.valeur),
  versement: enEuros(p.versementMensuel),
  rendement: p.rendement,
  plafond: p.plafond == null ? null : enEuros(p.plafond),
  pour: p.membreId ?? "foyer",
  // Les mouvements accompagnent toujours le support : c'est leur somme qui dit
  // ce qui a réellement été mis de côté, quand la valeur, elle, comprend aussi
  // les intérêts.
  mouvements: (p.mouvements ?? []).map(mouvementVersApi),
});

export const placementVersDb = (d) => {
  const patch = {};
  if (d.libelle !== undefined) patch.libelle = d.libelle;
  if (d.valeur !== undefined) patch.valeur = enCentimes(d.valeur);
  if (d.versement !== undefined) patch.versementMensuel = enCentimes(d.versement);
  if (d.rendement !== undefined) patch.rendement = d.rendement;
  // null efface le plafond, une valeur le pose.
  if (d.plafond !== undefined) patch.plafond = d.plafond == null ? null : enCentimes(d.plafond);
  // "foyer" remet le support en commun ; l'absence de champ ne change rien.
  if (d.pour !== undefined) patch.membreId = d.pour === "foyer" ? null : d.pour;
  return patch;
};

/* ─── Budget par catégorie ─── */
export const budgetVersApi = (b) => ({
  id: b.id,
  categorie: b.categorie,
  montant: enEuros(b.montant),
});

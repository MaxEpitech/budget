import { Router } from "express";
import { prisma } from "../db.js";
import { attraper, valider } from "../middleware.js";
import { foyerCourant } from "../foyerCourant.js";
import { FoyerSchema, InvitationSchema, RoleSchema } from "../schemas.js";
import { inviter } from "../auth/invitations.js";
import { envoyerEmail } from "../email/envoyer.js";
import { gabaritInvitation } from "../email/gabarits.js";
import { cadenceEmail, cadenceEmailIp } from "../auth/cadence.js";
import { journal } from "../journal.js";

const routeur = Router();

/** Inviter, retirer quelqu'un ou changer un rôle ne regarde que le propriétaire. */
const exigerProprietaire = (req, res, suite) => {
  if (req.utilisateur?.role !== "proprietaire") {
    return res.status(403).json({ erreur: "Seul un propriétaire du foyer peut faire cela." });
  }
  suite();
};

// Ce que le foyer sait de chaque compte. Ni empreinte, ni date de dernière
// connexion : la liste sert à savoir qui a accès, pas à se surveiller.
const compteVersApi = (u) => ({
  id: u.id,
  email: u.email,
  role: u.role,
  emailValide: Boolean(u.emailValideLe),
  membreId: u.membre?.id ?? null,
  depuis: u.creeLe,
});

const invitationVersApi = (i) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  membreId: i.membreId,
  expireLe: i.expireLe,
});

/* ─── Réglages du foyer ──────────────────────────────────────────────────── */

routeur.put("/", valider(FoyerSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const foyer = await prisma.foyer.update({
    where: { id: foyerId },
    data: { repartition: req.donnees.repartition },
  });
  res.json({ repartition: foyer.repartition });
}));

/* ─── Qui a accès ────────────────────────────────────────────────────────── */

routeur.get("/acces", attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const [comptes, invitations] = await Promise.all([
    prisma.utilisateur.findMany({ where: { foyerId }, include: { membre: { select: { id: true } } }, orderBy: { creeLe: "asc" } }),
    prisma.invitation.findMany({ where: { foyerId, utiliseLe: null, expireLe: { gt: new Date() } }, orderBy: { creeLe: "asc" } }),
  ]);
  res.json({
    moi: req.utilisateur.id,
    comptes: comptes.map(compteVersApi),
    invitations: invitations.map(invitationVersApi),
  });
}));

/* ─── Invitations ────────────────────────────────────────────────────────── */

routeur.post("/invitations", exigerProprietaire, cadenceEmailIp, cadenceEmail, valider(InvitationSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { email, role, membreId } = req.donnees;

  if (email === req.utilisateur.email) {
    return res.status(400).json({ erreur: "Vous faites déjà partie de ce foyer." });
  }

  const dejaLa = await prisma.utilisateur.findFirst({ where: { email, foyerId } });
  if (dejaLa) return res.status(409).json({ erreur: "Cette personne fait déjà partie du foyer." });

  // Le membre désigné doit appartenir à ce foyer, et n'être pris par personne.
  if (membreId) {
    const membre = await prisma.membre.findFirst({ where: { id: membreId, foyerId }, include: { utilisateur: true } });
    if (!membre) return res.status(400).json({ erreur: "Ce membre du budget est introuvable." });
    if (membre.utilisateur) return res.status(409).json({ erreur: "Ce membre est déjà relié à un compte." });
  }

  const { invitation, secret } = await inviter({ foyerId, email, role, membreId });

  try {
    await envoyerEmail({
      destinataire: email,
      ...gabaritInvitation({ email, jeton: secret, invitePar: req.utilisateur.email }),
    });
  } catch (e) {
    // L'invitation existe en base ; le lien peut être renvoyé. Mais il faut le
    // dire, sinon on attendrait un email qui n'est jamais parti.
    journal.erreur("invitation non envoyée", { detail: e.message, foyerId });
    return res.status(502).json({
      erreur: "L'invitation est enregistrée mais l'email n'a pas pu partir. Réessayez de l'envoyer.",
      invitation: invitationVersApi(invitation),
    });
  }

  res.status(201).json(invitationVersApi(invitation));
}));

routeur.delete("/invitations/:id", exigerProprietaire, attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const { count } = await prisma.invitation.deleteMany({ where: { id: req.params.id, foyerId } });
  if (count === 0) return res.status(404).json({ erreur: "Invitation introuvable" });
  res.status(204).end();
}));

/* ─── Comptes du foyer ───────────────────────────────────────────────────── */

routeur.put("/acces/:id", exigerProprietaire, valider(RoleSchema), attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  const cible = await prisma.utilisateur.findFirst({ where: { id: req.params.id, foyerId } });
  if (!cible) return res.status(404).json({ erreur: "Compte introuvable" });

  // Se rétrograder soi-même quand on est le dernier propriétaire fermerait la
  // porte de l'intérieur : plus personne ne pourrait inviter ni supprimer.
  if (cible.role === "proprietaire" && req.donnees.role !== "proprietaire") {
    const autres = await prisma.utilisateur.count({ where: { foyerId, role: "proprietaire", id: { not: cible.id } } });
    if (autres === 0) {
      return res.status(409).json({ erreur: "Le foyer doit garder au moins un propriétaire." });
    }
  }

  const modifie = await prisma.utilisateur.update({
    where: { id: cible.id },
    data: { role: req.donnees.role },
    include: { membre: { select: { id: true } } },
  });
  res.json(compteVersApi(modifie));
}));

routeur.delete("/acces/:id", exigerProprietaire, attraper(async (req, res) => {
  const foyerId = await foyerCourant(req);
  if (req.params.id === req.utilisateur.id) {
    return res.status(400).json({ erreur: "Pour partir vous-même, supprimez votre compte." });
  }

  const cible = await prisma.utilisateur.findFirst({ where: { id: req.params.id, foyerId } });
  if (!cible) return res.status(404).json({ erreur: "Compte introuvable" });

  // Retirer un compte ne touche pas au budget : le membre qu'il incarnait reste,
  // avec son revenu et ses lignes.
  await prisma.utilisateur.delete({ where: { id: cible.id } });
  res.status(204).end();
}));

export default routeur;

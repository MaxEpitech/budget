// Rattache un compte à un foyer existant.
//
// À l'inscription, chaque compte reçoit un foyer neuf et vide. Ce script sert
// au cas de reprise : les données étaient là avant les comptes, et il faut
// désigner qui en est propriétaire.
//
//   npm run rattacher -- mon@adresse.fr        (rattache au foyer contenant des données)
//   npm run rattacher -- mon@adresse.fr 1      (rattache au foyer n°1 explicitement)
//
// Le foyer vide libéré par l'opération est supprimé. Le script refuse d'agir
// si le foyer visé appartient déjà à quelqu'un, ou si le compte détient des
// données qui seraient abandonnées.
import "../src/env.js";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const compterFoyer = async (foyerId) => {
  const [membres, transactions, credits, projets, placements] = await Promise.all([
    prisma.membre.count({ where: { foyerId } }),
    prisma.transaction.count({ where: { foyerId } }),
    prisma.credit.count({ where: { foyerId } }),
    prisma.projet.count({ where: { foyerId } }),
    prisma.placement.count({ where: { foyerId } }),
  ]);
  return { membres, transactions, credits, projets, placements, total: membres + transactions + credits + projets + placements };
};

const decrire = (c) =>
  `${c.membres} membre(s), ${c.transactions} transaction(s), ${c.credits} crédit(s), ${c.projets} projet(s), ${c.placements} placement(s)`;

const echouer = (message) => {
  console.error(message);
  process.exitCode = 1;
};

async function main() {
  const [emailBrut, foyerVoulu] = process.argv.slice(2);
  if (!emailBrut) {
    return echouer("Usage : npm run rattacher -- mon@adresse.fr [numéro de foyer]");
  }
  const email = emailBrut.trim().toLowerCase();

  const utilisateur = await prisma.utilisateur.findUnique({ where: { email } });
  if (!utilisateur) {
    const connus = await prisma.utilisateur.findMany({ select: { email: true } });
    return echouer(
      `Aucun compte pour « ${email} ».` +
        (connus.length ? `\nComptes existants : ${connus.map((u) => u.email).join(", ")}` : "\nAucun compte n'existe encore : inscrivez-vous d'abord dans l'application.")
    );
  }

  // Foyer visé : celui demandé, sinon le foyer non réclamé qui contient des données.
  let cibleId = foyerVoulu ? Number(foyerVoulu) : null;
  if (cibleId !== null && !Number.isInteger(cibleId)) {
    return echouer(`Numéro de foyer invalide : « ${foyerVoulu} »`);
  }

  if (cibleId === null) {
    const foyers = await prisma.foyer.findMany({ include: { utilisateur: true }, orderBy: { id: "asc" } });
    const candidats = [];
    for (const f of foyers) {
      if (f.utilisateur) continue; // déjà réclamé
      const c = await compterFoyer(f.id);
      if (c.total > 0) candidats.push({ foyer: f, compte: c });
    }
    if (candidats.length === 0) {
      return echouer("Aucun foyer libre contenant des données. Rien à rattacher.");
    }
    if (candidats.length > 1) {
      console.error("Plusieurs foyers libres contiennent des données ; précisez lequel :");
      for (const { foyer, compte } of candidats) console.error(`  foyer n°${foyer.id} — ${decrire(compte)}`);
      process.exitCode = 1;
      return;
    }
    cibleId = candidats[0].foyer.id;
  }

  if (cibleId === utilisateur.foyerId) {
    console.log(`Le compte « ${email} » est déjà rattaché au foyer n°${cibleId}. Rien à faire.`);
    return;
  }

  const cible = await prisma.foyer.findUnique({ where: { id: cibleId }, include: { utilisateur: true } });
  if (!cible) return echouer(`Le foyer n°${cibleId} n'existe pas.`);
  if (cible.utilisateur) {
    return echouer(`Le foyer n°${cibleId} appartient déjà à « ${cible.utilisateur.email} ». Rattachement refusé.`);
  }

  // Le foyer que le compte quitte ne doit rien contenir : il va être supprimé.
  const ancien = await compterFoyer(utilisateur.foyerId);
  if (ancien.total > 0) {
    return echouer(
      `Le compte détient déjà des données dans son foyer n°${utilisateur.foyerId} (${decrire(ancien)}).\n` +
        "Elles seraient abandonnées. Rattachement refusé — sauvegardez et faites le ménage d'abord."
    );
  }

  const contenu = await compterFoyer(cibleId);
  await prisma.$transaction(async (tx) => {
    const ancienFoyerId = utilisateur.foyerId;
    await tx.utilisateur.update({ where: { id: utilisateur.id }, data: { foyerId: cibleId } });
    await tx.foyer.delete({ where: { id: ancienFoyerId } });
  });

  console.log(`« ${email} » est désormais rattaché au foyer n°${cibleId} — ${decrire(contenu)}.`);
  console.log(`Le foyer vide n°${utilisateur.foyerId} a été supprimé.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

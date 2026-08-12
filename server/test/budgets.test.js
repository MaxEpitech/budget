// Budgets par catégorie.
//
// L'enveloppe seule ne dit rien : ce qui compte est sa comparaison avec les
// dépenses réellement tombées sur le mois — échéances non mensuelles comprises,
// puisque c'est justement là qu'un budget se fait surprendre.
import assert from "node:assert/strict";
import { before, after } from "node:test";
import {
  baseDEssaiDisponible,
  testIntegration,
  demarrerServeur,
  avecFoyer,
  clientConnecte,
  chargerPrisma,
  reinitialiserCadenceEssais,
  silencieux,
} from "./aide/harnais.js";

let serveur = null;
let rendreLaParole = null;

before(async () => {
  if (!baseDEssaiDisponible) return;
  rendreLaParole = silencieux();
  await reinitialiserCadenceEssais();
  serveur = await demarrerServeur();
});

after(async () => {
  if (serveur) await serveur.arreter();
  if (baseDEssaiDisponible) await reinitialiserCadenceEssais();
  if (rendreLaParole) rendreLaParole();
});

const depense = (client, libelle, montant, categorie, extra = {}) =>
  client.appel("/transactions", "POST", { type: "depense", libelle, montant, categorie, recurrent: false, mois: "2026-08", ...extra });

testIntegration("poser deux fois une enveloppe la remplace au lieu de la doubler", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);

    // Du point de vue de l'utilisateur il n'y a qu'un geste : « pour les
    // courses, c'est tant ». Savoir si l'enveloppe existait ne le regarde pas.
    assert.equal((await client.appel("/budgets", "PUT", { categorie: "Courses", montant: 500 })).code, 200);
    const second = await client.appel("/budgets", "PUT", { categorie: "Courses", montant: 450 });
    assert.equal(second.code, 200);
    assert.equal(second.corps.montant, 450);

    const enBase = await prisma.budget.findMany({ where: { foyerId: contexte.foyer.id } });
    assert.equal(enBase.length, 1, "deux enveloppes concurrentes sur la même catégorie n'auraient aucun sens");
  });
});

testIntegration("l'état du mois sert l'enveloppe avec ce qui en a été consommé", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/budgets", "PUT", { categorie: "Courses", montant: 500 });
    await depense(client, "Marché", 62.4, "Courses");
    await depense(client, "Supermarché", 130, "Courses");
    await depense(client, "Cinéma", 24, "Loisirs");

    const etat = (await client.appel("/etat?mois=2026-08")).corps;
    const courses = etat.budgets.find((b) => b.categorie === "Courses");
    assert.equal(courses.montant, 500);
    assert.equal(courses.consomme, 192.4, "seules les dépenses de cette catégorie comptent");
  });
});

testIntegration("la consommation ne compte que le mois affiché", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/budgets", "PUT", { categorie: "Loisirs", montant: 100 });
    await depense(client, "Concert", 80, "Loisirs");

    const aout = (await client.appel("/etat?mois=2026-08")).corps;
    const septembre = (await client.appel("/etat?mois=2026-09")).corps;
    assert.equal(aout.budgets[0].consomme, 80);
    assert.equal(septembre.budgets[0].consomme, 0, "une enveloppe se remplit à neuf chaque mois");
  });
});

testIntegration("une échéance trimestrielle pèse sur son mois, pas sur les autres", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/budgets", "PUT", { categorie: "Logement", montant: 300 });
    await client.appel("/transactions", "POST", {
      type: "depense", libelle: "Charges", montant: 320, categorie: "Logement",
      recurrent: true, periodicite: "trimestriel", debut: "2026-02",
    });

    // C'est précisément là qu'un budget se fait surprendre : le mois de
    // l'échéance déborde, les deux autres non.
    const mai = (await client.appel("/etat?mois=2026-05")).corps.budgets[0];
    const juin = (await client.appel("/etat?mois=2026-06")).corps.budgets[0];
    assert.equal(mai.consomme, 320);
    assert.ok(mai.consomme > mai.montant, "le mois de l'échéance dépasse");
    assert.equal(juin.consomme, 0);
  });
});

testIntegration("les revenus n'entament pas une enveloppe de dépenses", async () => {
  await avecFoyer(async (contexte) => {
    const client = await clientConnecte(serveur.base, contexte);
    await client.appel("/budgets", "PUT", { categorie: "Autre", montant: 200 });
    await client.appel("/transactions", "POST", {
      type: "revenu", libelle: "Remboursement", montant: 90, categorie: "Autre", recurrent: false, mois: "2026-08",
    });

    const etat = (await client.appel("/etat?mois=2026-08")).corps;
    assert.equal(etat.budgets[0].consomme, 0);
  });
});

testIntegration("une enveloppe se supprime, un montant nul est refusé", async () => {
  await avecFoyer(async (contexte) => {
    const prisma = await chargerPrisma();
    const client = await clientConnecte(serveur.base, contexte);
    const cree = await client.appel("/budgets", "PUT", { categorie: "Transport", montant: 150 });

    // Pour ne plus rien s'autoriser, on retire l'enveloppe — la mettre à zéro
    // afficherait un dépassement permanent.
    assert.equal((await client.appel("/budgets", "PUT", { categorie: "Transport", montant: 0 })).code, 400);
    assert.equal((await client.appel(`/budgets/${cree.corps.id}`, "DELETE")).code, 204);
    assert.equal(await prisma.budget.count({ where: { foyerId: contexte.foyer.id } }), 0);
  });
});

testIntegration("les enveloppes d'un autre foyer sont hors de portée", async () => {
  await avecFoyer(async (mien) => {
    await avecFoyer(async (voisin) => {
      const prisma = await chargerPrisma();
      const sienne = await prisma.budget.create({
        data: { foyerId: voisin.foyer.id, categorie: "Courses", montant: 50000 },
      });

      const client = await clientConnecte(serveur.base, mien);
      assert.deepEqual((await client.appel("/budgets")).corps, []);
      assert.equal((await client.appel(`/budgets/${sienne.id}`, "DELETE")).code, 404);
      assert.equal(await prisma.budget.count({ where: { id: sienne.id } }), 1);

      // Et poser la même catégorie chez soi ne touche pas à la sienne.
      await client.appel("/budgets", "PUT", { categorie: "Courses", montant: 300 });
      const intacte = await prisma.budget.findUnique({ where: { id: sienne.id } });
      assert.equal(intacte.montant, 50000);
    });
  });
});

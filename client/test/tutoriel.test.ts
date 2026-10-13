// Tests de la visite guidée : placement de la bulle et cohérence des étapes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ETAPES, placerBulle } from "../src/tutoriel.js";
import { PAGES, REGLAGES } from "../src/navigation.js";

const ecran = { largeur: 1000, hauteur: 700 };
const bulle = { largeur: 360, hauteur: 200 };
const cibleA = (haut: number, gauche = 100, largeur = 200, hauteur = 40) => ({ haut, gauche, largeur, hauteur });

test("la bulle se place sous l'élément quand la place suffit", () => {
  const p = placerBulle({ cible: cibleA(100), bulle, ecran, marge: 16 });
  assert.equal(p.cote, "dessous");
  assert.equal(p.haut, 100 + 40 + 12);
  assert.equal(p.gauche, 100);
});

test("elle passe au-dessus quand le bas de l'écran est trop près", () => {
  const p = placerBulle({ cible: cibleA(600), bulle, ecran, marge: 16 });
  assert.equal(p.cote, "dessus");
  assert.equal(p.haut, 600 - 12 - 200);
});

test("elle reste dans la fenêtre, marges comprises", () => {
  const p = placerBulle({ cible: cibleA(100, 900, 80), bulle, ecran, marge: 16 });
  assert.equal(p.gauche, 1000 - 16 - 360);
  const q = placerBulle({ cible: cibleA(100, -50, 80), bulle, ecran, marge: 16 });
  assert.equal(q.gauche, 16);
});

test("un élément pleine hauteur reçoit la bulle à sa droite", () => {
  const p = placerBulle({ cible: { haut: 0, gauche: 0, largeur: 252, hauteur: 700 }, bulle, ecran, marge: 16 });
  assert.equal(p.cote, "droite");
  assert.equal(p.gauche, 252 + 12);
  assert.ok(p.haut >= 16 && p.haut + 200 <= 700 - 16);
});

test("sans élément, la bulle est centrée", () => {
  const p = placerBulle({ cible: null, bulle, ecran, marge: 16 });
  assert.equal(p.cote, "centre");
  assert.equal(p.gauche, (1000 - 360) / 2);
  assert.equal(p.haut, (700 - 200) / 2);
});

test("une bulle plus grande que l'écran reste ancrée à la marge", () => {
  const p = placerBulle({ cible: null, bulle: { largeur: 400, hauteur: 900 }, ecran, marge: 16 });
  assert.equal(p.haut, 16);
});

test("chaque étape pointe un écran qui existe", () => {
  const ids = new Set([...PAGES, ...REGLAGES].map((p) => p.id));
  for (const e of ETAPES) {
    if (e.page) assert.ok(ids.has(e.page), `étape « ${e.id} » : écran inconnu « ${e.page} »`);
  }
});

test("les identifiants et les cibles des étapes sont uniques", () => {
  const ids = ETAPES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants d'étape en double");
  const cibles = ETAPES.flatMap((e) => (e.cible ? [e.cible] : []));
  assert.equal(new Set(cibles).size, cibles.length, "cibles en double");
});

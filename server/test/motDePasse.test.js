// Tests du hachage des mots de passe (scrypt).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hacherMotDePasse, verifierMotDePasse } from "../src/auth/motDePasse.js";

test("un mot de passe se vérifie contre son empreinte", async () => {
  const empreinte = await hacherMotDePasse("correct cheval batterie agrafe");
  assert.equal(await verifierMotDePasse("correct cheval batterie agrafe", empreinte), true);
});

test("un mot de passe erroné est rejeté", async () => {
  const empreinte = await hacherMotDePasse("correct cheval batterie agrafe");
  assert.equal(await verifierMotDePasse("correct cheval batterie agrafË", empreinte), false);
  assert.equal(await verifierMotDePasse("", empreinte), false);
  assert.equal(await verifierMotDePasse("correct cheval batterie agrafe ", empreinte), false);
});

test("le mot de passe n'apparaît jamais dans l'empreinte", async () => {
  const empreinte = await hacherMotDePasse("phrase secrète du foyer");
  assert.ok(!empreinte.includes("phrase"), "l'empreinte laisse fuiter le mot de passe");
  assert.ok(!empreinte.includes("secrète"), "l'empreinte laisse fuiter le mot de passe");
});

test("deux empreintes du même mot de passe diffèrent (sel aléatoire)", async () => {
  const a = await hacherMotDePasse("même mot de passe");
  const b = await hacherMotDePasse("même mot de passe");
  assert.notEqual(a, b);
  // …mais les deux se vérifient.
  assert.equal(await verifierMotDePasse("même mot de passe", a), true);
  assert.equal(await verifierMotDePasse("même mot de passe", b), true);
});

test("l'empreinte porte ses paramètres, pour pouvoir les durcir plus tard", async () => {
  const empreinte = await hacherMotDePasse("peu importe");
  const [algo, N, r, p, sel, cle] = empreinte.split("$");
  assert.equal(algo, "scrypt");
  assert.equal(Number(N), 2 ** 15);
  assert.equal(Number(r), 8);
  assert.equal(Number(p), 2);
  assert.ok(sel.length > 0 && cle.length > 0);
});

test("une empreinte produite avec d'autres paramètres reste vérifiable", async () => {
  // Empreinte fabriquée à la main avec N=2^14 : le format doit se relire seul.
  const { scrypt } = await import("node:crypto");
  const { promisify } = await import("node:util");
  const scryptAsync = promisify(scrypt);
  const sel = Buffer.from("selfixepourletest");
  const params = { N: 2 ** 14, r: 8, p: 1 };
  const cle = await scryptAsync("ancien mot de passe", sel, 64, { ...params, maxmem: 128 * params.N * params.r * 2 });
  const ancienne = ["scrypt", params.N, params.r, params.p, sel.toString("base64url"), cle.toString("base64url")].join("$");

  assert.equal(await verifierMotDePasse("ancien mot de passe", ancienne), true);
  assert.equal(await verifierMotDePasse("mauvais", ancienne), false);
});

test("les accents équivalents Unicode sont acceptés (normalisation NFKC)", async () => {
  // « é » composé (e + accent combinant) et « é » précomposé sont le même mot de passe.
  const empreinte = await hacherMotDePasse("clé secrete");
  assert.equal(await verifierMotDePasse("clé secrete", empreinte), true);
});

test("une empreinte illisible est rejetée sans lever d'exception", async () => {
  for (const mauvaise of ["", "n'importe quoi", "scrypt$$$$", "bcrypt$1$2$3$a$b", null, undefined, 42]) {
    assert.equal(await verifierMotDePasse("mot de passe", mauvaise), false, `empreinte ${JSON.stringify(mauvaise)}`);
  }
});

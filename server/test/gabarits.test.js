// Tests des gabarits d'emails (fonctions pures, rien n'est envoyé).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gabaritValidation,
  gabaritInscriptionExistante,
  gabaritReinitialisation,
  gabaritReinitialisationSansCompte,
  echapper,
  urlApplication,
} from "../src/email/gabarits.js";

const TOUS = [
  ["validation", () => gabaritValidation({ email: "alex@exemple.fr", jeton: "jeton-abc" })],
  ["inscription existante", () => gabaritInscriptionExistante({ email: "alex@exemple.fr" })],
  ["réinitialisation", () => gabaritReinitialisation({ email: "alex@exemple.fr", jeton: "jeton-abc" })],
  ["réinitialisation sans compte", () => gabaritReinitialisationSansCompte({ email: "alex@exemple.fr" })],
];

test("chaque gabarit fournit sujet, html, texte et lien", () => {
  for (const [nom, fabriquer] of TOUS) {
    const g = fabriquer();
    assert.ok(g.sujet?.length > 0, `${nom} : sujet manquant`);
    assert.ok(g.html?.length > 0, `${nom} : html manquant`);
    assert.ok(g.texte?.length > 0, `${nom} : texte manquant`);
    assert.ok(g.lien?.startsWith("http"), `${nom} : lien manquant`);
  }
});

test("le lien figure dans les deux versions du message", () => {
  for (const [nom, fabriquer] of TOUS) {
    const g = fabriquer();
    assert.ok(g.html.includes(g.lien), `${nom} : lien absent du HTML`);
    assert.ok(g.texte.includes(g.lien), `${nom} : lien absent de la version texte`);
  }
});

test("le lien de validation porte le jeton et pointe vers /valider", () => {
  const g = gabaritValidation({ email: "alex@exemple.fr", jeton: "jeton-abc" });
  assert.ok(g.lien.startsWith(`${urlApplication()}/valider?jeton=`));
  assert.ok(g.lien.endsWith("jeton-abc"));
});

test("le lien de réinitialisation porte le jeton et pointe vers /reinitialiser", () => {
  const g = gabaritReinitialisation({ email: "alex@exemple.fr", jeton: "jeton-abc" });
  assert.ok(g.lien.startsWith(`${urlApplication()}/reinitialiser?jeton=`));
  assert.ok(g.lien.endsWith("jeton-abc"));
});

test("un jeton à caractères spéciaux est encodé dans l'URL", () => {
  const g = gabaritValidation({ email: "a@b.fr", jeton: "a+b/c=d&e" });
  assert.ok(!g.lien.includes("&e"), "le & casserait la lecture du paramètre");
  assert.ok(g.lien.includes("a%2Bb%2Fc%3Dd%26e"));
});

test("les messages sans jeton n'en contiennent aucun", () => {
  for (const g of [gabaritInscriptionExistante({ email: "a@b.fr" }), gabaritReinitialisationSansCompte({ email: "a@b.fr" })]) {
    assert.ok(!g.lien.includes("jeton"), "un lien sans jeton ne doit pas en porter");
  }
});

test("l'adresse de l'utilisateur est échappée dans le HTML", () => {
  const hostile = `"><script>alert(1)</script>@x.fr`;
  for (const [nom, _] of TOUS) void nom;
  const gabarits = [
    gabaritValidation({ email: hostile, jeton: "j" }),
    gabaritInscriptionExistante({ email: hostile }),
    gabaritReinitialisation({ email: hostile, jeton: "j" }),
    gabaritReinitialisationSansCompte({ email: hostile }),
  ];
  for (const g of gabarits) {
    assert.ok(!g.html.includes("<script>"), "balise script injectée dans le HTML");
    assert.ok(g.html.includes("&lt;script&gt;"), "l'adresse devrait être échappée");
  }
});

test("echapper neutralise les caractères sensibles du HTML", () => {
  assert.equal(echapper(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  // L'esperluette est traitée en premier, sinon les entités seraient ré-échappées.
  assert.equal(echapper("&lt;"), "&amp;lt;");
});

test("les durées annoncées correspondent à celles des jetons", () => {
  assert.ok(gabaritValidation({ email: "a@b.fr", jeton: "j" }).texte.includes("24 heures"));
  assert.ok(gabaritReinitialisation({ email: "a@b.fr", jeton: "j" }).texte.includes("1 heure"));
});

test("APP_URL est prise en compte, sans slash final en double", () => {
  const avant = process.env.APP_URL;
  try {
    process.env.APP_URL = "https://budget.exemple.fr/";
    assert.equal(urlApplication(), "https://budget.exemple.fr");
    assert.ok(gabaritValidation({ email: "a@b.fr", jeton: "j" }).lien.startsWith("https://budget.exemple.fr/valider?"));
  } finally {
    if (avant === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = avant;
  }
});

test("le message d'inscription existante ne révèle rien d'exploitable", () => {
  const g = gabaritInscriptionExistante({ email: "alex@exemple.fr" });
  // Il est envoyé au propriétaire de l'adresse, pas à qui a tenté l'inscription :
  // il doit expliquer qu'aucun second compte n'a été créé.
  assert.ok(/aucun second compte/i.test(g.texte));
  assert.ok(!/mot de passe\s*:/i.test(g.texte), "aucun secret ne doit figurer dans le message");
});

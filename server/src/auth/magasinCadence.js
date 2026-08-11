// Magasin Postgres pour express-rate-limit.
//
// L'implémentation par défaut garde ses compteurs en mémoire, ce qui convient à
// un serveur permanent mais pas à des fonctions sans état : chaque instance
// aurait le sien, et il disparaîtrait avec elle. La protection contre le bourrage
// de mots de passe ne tiendrait pas.
import { prisma } from "../db.js";

export class MagasinPostgres {
  constructor() {
    this.fenetreMs = 0;
  }

  init(options) {
    this.fenetreMs = options.windowMs;
  }

  /**
   * Incrémente le compteur d'une clé et renvoie son état.
   *
   * Tout se fait en une seule instruction : deux requêtes simultanées ne peuvent
   * pas lire la même valeur puis l'écrire chacune de leur côté. La fenêtre
   * expirée est remise à zéro dans le même mouvement.
   */
  async increment(cle) {
    const expiration = new Date(Date.now() + this.fenetreMs);
    const [ligne] = await prisma.$queryRaw`
      INSERT INTO "LimiteCadence" ("cle", "compteur", "expireLe")
      VALUES (${cle}, 1, ${expiration})
      ON CONFLICT ("cle") DO UPDATE SET
        "compteur" = CASE
          WHEN "LimiteCadence"."expireLe" <= now() THEN 1
          ELSE "LimiteCadence"."compteur" + 1
        END,
        "expireLe" = CASE
          WHEN "LimiteCadence"."expireLe" <= now() THEN EXCLUDED."expireLe"
          ELSE "LimiteCadence"."expireLe"
        END
      RETURNING "compteur", "expireLe"
    `;
    return { totalHits: Number(ligne.compteur), resetTime: ligne.expireLe };
  }

  // Appelé quand une requête ne doit finalement pas être décomptée.
  async decrement(cle) {
    await prisma.$executeRaw`
      UPDATE "LimiteCadence" SET "compteur" = GREATEST("compteur" - 1, 0) WHERE "cle" = ${cle}
    `;
  }

  async resetKey(cle) {
    await prisma.limiteCadence.deleteMany({ where: { cle } });
  }

  async resetAll() {
    await prisma.limiteCadence.deleteMany();
  }
}

/**
 * Supprime les compteurs dont la fenêtre est passée. Appelé de temps en temps
 * plutôt qu'à chaque requête : ces lignes ne gênent personne, elles occupent
 * juste de la place.
 */
export async function purgerCompteursPerimes() {
  const { count } = await prisma.limiteCadence.deleteMany({ where: { expireLe: { lt: new Date() } } });
  return count;
}

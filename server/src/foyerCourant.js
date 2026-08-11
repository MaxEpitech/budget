// Détermine le foyer auquel s'applique une requête.
//
// Toutes les routes métier passent par exigerAuth, qui renseigne req.foyerId
// depuis la session. Cette fonction reste le point unique où les routeurs lisent
// le foyer : elle isolerait un changement de règle (foyer partagé, sélection
// d'un foyer parmi plusieurs) sans qu'aucun routeur ne bouge.
export async function foyerCourant(req) {
  if (!req?.foyerId) {
    // Signe qu'une route métier a été montée sans exigerAuth : mieux vaut une
    // erreur franche qu'une requête qui servirait le foyer de quelqu'un d'autre.
    throw new Error("foyerCourant() appelé hors d'une requête authentifiée");
  }
  return req.foyerId;
}

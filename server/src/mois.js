// Aides sur les clés de mois « YYYY-MM » — mêmes conventions que le prototype.

export const moisCourant = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Nombre de mois entre deux clés (positif si `vers` est après `de`).
export const ecartMois = (de, vers) => {
  const [a1, m1] = de.split("-").map(Number);
  const [a2, m2] = vers.split("-").map(Number);
  return (a2 - a1) * 12 + (m2 - m1);
};

// Mois obtenu en décalant une clé « YYYY-MM » de `delta` mois.
export const decalerMois = (cle, delta) => {
  const [a, m] = cle.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

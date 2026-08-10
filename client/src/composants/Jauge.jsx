// Jauge de progression du prototype, reprise à l'identique.
export default function Jauge({ pct, couleur }) {
  return (
    <div className="jauge">
      <div className="jauge-fill" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: couleur }} />
    </div>
  );
}

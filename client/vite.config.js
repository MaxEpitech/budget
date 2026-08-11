import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Le port de l'API est lu dans le .env de la racine, celui-là même que lit le
// serveur : changer PORT à un seul endroit suffit, le proxy suit.
const racine = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, racine, "");
  // `npm run dev` réserve les ports libres et les passe par l'environnement ;
  // lancé seul (`npm run dev:client`), on retombe sur le .env puis les défauts.
  const portApi = process.env.PORT || env.PORT || 3011;
  const portClient = Number(process.env.PORT_CLIENT || env.PORT_CLIENT) || undefined;

  return {
    plugins: [react()],
    server: {
      port: portClient,
      // strictPort reste à false : si le port est pris, Vite passe au suivant.
      // En dev, /api est proxié vers l'API Express : le front ne connaît jamais son port.
      proxy: {
        "/api": `http://localhost:${portApi}`,
      },
    },
  };
});

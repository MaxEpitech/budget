import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// Le port de l'API est lu dans le .env de la racine, celui-là même que lit le
// serveur : changer PORT à un seul endroit suffit, le proxy suit.
const racine = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, racine, "");
  const portApi = env.PORT || 3001;

  return {
    plugins: [react()],
    server: {
      // En dev, /api est proxié vers l'API Express : le front ne connaît jamais son port.
      proxy: {
        "/api": `http://localhost:${portApi}`,
      },
    },
  };
});

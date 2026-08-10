import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// En dev, /api est proxié vers l'API Express : le front ne connaît jamais son port.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
  },
});

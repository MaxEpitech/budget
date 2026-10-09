import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { appliquerTheme, lireTheme } from "./theme.js";

// Avant le premier rendu : sinon l'écran s'affiche un instant dans le mauvais thème.
appliquerTheme(lireTheme());

createRoot(document.getElementById("root")).render(<App />);

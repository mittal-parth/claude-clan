import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AudioProvider } from "./components/audio-provider";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <AudioProvider>
      <App />
    </AudioProvider>
  </StrictMode>,
);

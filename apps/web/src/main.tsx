import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Root from "./Root";
import { AudioProvider } from "./components/audio-provider";
import { FpsProvider } from "./components/fps-provider";
import { initAnalytics } from "./lib/analytics";
import "./styles.css";

initAnalytics();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <StrictMode>
    <AudioProvider>
      <FpsProvider>
        <Root />
      </FpsProvider>
    </AudioProvider>
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createBridge } from "./bridge";
import "./styles.css";

const bridge = createBridge();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App bridge={bridge} />
  </StrictMode>,
);

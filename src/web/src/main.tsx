import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createBridge } from "./bridge";
import { V2App } from "./v2/V2App";
import "./styles.css";

const bridge = createBridge();

/** V2 runs in a browser tab only; ?v=2 or the last choice picks it, ?map=… always opens V1. */
function wantsV2(): boolean {
  if (bridge.mode !== "standalone") return false;
  const params = new URLSearchParams(location.search);
  if (params.has("map")) return false;
  if (params.get("v") === "2") return true;
  if (params.get("v") === "1") return false;
  try {
    return localStorage.getItem("cartograph.version") === "v2";
  } catch {
    return false;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {wantsV2() ? <V2App bridge={bridge} /> : <App bridge={bridge} />}
  </StrictMode>,
);

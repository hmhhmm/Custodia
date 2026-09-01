// Wraps App in DAppKitProvider so wallet hooks (useCurrentAccount, etc.)
// work anywhere in the tree. See src/sui/dapp-kit.ts for the dAppKit
// instance config.
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./app/App";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKit } from "./sui/dapp-kit";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found in index.html");
}

createRoot(container).render(
  <DAppKitProvider dAppKit={dAppKit}>
    <App />
  </DAppKitProvider>
);
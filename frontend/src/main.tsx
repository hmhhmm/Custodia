// Owner: Person 4 (frontend + orchestration).
// PROVIDER ADDED by Person 2 (2026-09-01): wraps App in DAppKitProvider so
// wallet hooks (useCurrentAccount, etc.) work anywhere in the tree. See
// src/sui/dapp-kit.ts for the dAppKit instance config. Flagging per
// CLAUDE.md rule 4 — ping Person 2 if this needs to move/change.
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
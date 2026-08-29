// Owner: Person 4 (frontend + orchestration).
// STATUS: minimal placeholder render — wires up App so the dev server
// shows something real. Top-level providers (wallet provider, zkLogin
// context from Person 2's src/sui, etc.) still need to be added here once
// those are built — do not invent their shape yet, coordinate with
// Person 2.
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root element not found in index.html");
}

createRoot(container).render(<App />);

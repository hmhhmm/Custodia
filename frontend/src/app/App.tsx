// Owner: Person 4 (frontend + orchestration).
// STATUS: minimal placeholder — proves the render pipeline works. This is
// NOT the real UI; the actual goal-input / discovery / negotiation /
// deal-status flow (see /docs/ARCHITECTURE.md) is still to be built here,
// and should replace this placeholder rather than grow around it.

export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem" }}>
      <h1>Warrant</h1>
      <p>On-chain trust and settlement for AI agents on Sui.</p>
      <p style={{ color: "#666" }}>
        Placeholder screen — real UI (goal input, agent discovery, deal
        status) not yet implemented. See /docs/ARCHITECTURE.md.
      </p>
    </main>
  );
}

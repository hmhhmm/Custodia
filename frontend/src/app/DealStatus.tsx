// Owner: Person 4 (frontend + orchestration).
// STATUS: stub only.
//
// Displays a Deal's on-chain status (Negotiating -> Escrowed -> Delivered
// -> Verified -> Released / Disputed). Reads Deal data via Person 2's
// src/sui layer. Confirm the exact status enum variant names with Person 1
// once escrow::deal is implemented — do not invent them independently
// (see /docs/ARCHITECTURE.md Deal object fields).

// TODO: export function DealStatus(props: { dealId: string }): JSX.Element

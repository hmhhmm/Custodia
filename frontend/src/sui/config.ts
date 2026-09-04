// Deployed Custodia package + registry object, read once here instead of
// being redeclared per-file. Real deployed addresses (see frontend/.env);
// fallbacks below match the same testnet deployment.
//
// PACKAGE_ID vs ORIGINAL_PACKAGE_ID: identical until the package is ever
// upgraded via `sui client upgrade` — that's why every existing call site
// in this codebase safely used one PACKAGE_ID for both moveCall targets
// AND type-filtered GraphQL queries (deal-queries.ts's
// `${PACKAGE_ID}::deal::Deal` etc.) up to now. Per Sui's package-upgrade
// model, an upgrade gets a NEW package id, but every object type a prior
// version defined stays permanently anchored to the id it was FIRST
// published under (VERIFY re-confirmed against the sui-publish skill's
// "type anchoring" section this session — Move struct types do not
// migrate to a new package id on upgrade). So after any future upgrade:
//   - moveCall targets (new functions, including ones only the upgraded
//     module adds) must use PACKAGE_ID (the latest/upgraded id).
//   - type-filtered queries for object types that existed BEFORE that
//     upgrade (Deal, DealProof, DealAllowlist, Mandate, AgentIdentity,
//     etc.) must keep using ORIGINAL_PACKAGE_ID, or they will silently
//     stop finding every object created under the pre-upgrade id.
//   - a brand-new type introduced BY an upgrade (e.g. checkpoint::
//     DealCheckpoint) is anchored to THAT upgrade's package id, so
//     queries for it use PACKAGE_ID, not ORIGINAL_PACKAGE_ID.
// Both env vars currently default to the same value because this package
// has not been upgraded yet — set VITE_CUSTODIA_ORIGINAL_PACKAGE_ID
// explicitly only once an upgrade actually happens, so the two can
// diverge without touching every call site that reads ORIGINAL_PACKAGE_ID.
export const PACKAGE_ID: string = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;

export const ORIGINAL_PACKAGE_ID: string =
  import.meta.env.VITE_CUSTODIA_ORIGINAL_PACKAGE_ID ?? PACKAGE_ID;

export const AGENT_REGISTRY_ID: string =
  import.meta.env.VITE_AGENT_REGISTRY_ID ??
  "0x81ee790128d7a27b9712836b5400d98f3e04d42aa3376c7beded1c4bb857b473";

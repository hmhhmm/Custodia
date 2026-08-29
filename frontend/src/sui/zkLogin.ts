// Owner: Person 2 (transaction layer).
// STATUS: stub only — no working logic yet.
//
// zkLogin sign-in flow: OAuth provider -> ephemeral keypair -> ZK proof ->
// Sui address. VERIFY exact SDK entry points (likely under @mysten/sui or
// a dedicated zkLogin package) against current Sui docs before
// implementing — do not guess function names or the proving service URL.

// TODO: export async function beginZkLogin(provider: "google" | "facebook" | ...): Promise<...>
//   VERIFY which OAuth providers are actually supported today.

// TODO: export async function completeZkLogin(oauthJwt: string): Promise<{ address: string }>
//   VERIFY the current proving service endpoint — do not hardcode a URL
//   without checking official docs first.

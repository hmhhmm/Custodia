
// Owner: Person 2 (transaction layer).
// STATUS: NOT IMPLEMENTED — deliberate scope decision for the hackathon
// deadline, not an oversight. See below.
//
// Enoki sponsored transactions require a backend service holding the
// PRIVATE Enoki API key (sponsorship must never run client-side — see
// https://docs.enoki.mystenlabs.com/ts-sdk/sponsored-transactions). This
// repo currently has no backend/server directory (checked 2026-09-02).
//
// DECISION: for the hackathon demo, zkLogin addresses are funded manually
// via the testnet faucet (faucet.sui.io) ahead of time, instead of
// building a backend just for sponsorship. Every new zkLogin sign-in
// gets a fresh, unfunded address and WILL hit "insufficient SUI balance"
// until funded this way — this is expected, not a bug.
//
// Real fix, post-hackathon: stand up a minimal backend endpoint that
// holds the private Enoki key and wraps createSponsoredTransaction /
// executeSponsoredTransaction.

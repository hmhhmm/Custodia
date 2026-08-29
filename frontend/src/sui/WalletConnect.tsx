// Owner: Person 2 (transaction layer).
// STATUS: stub only — no working logic yet.
//
// Wallet connect UI component: surfaces zkLogin sign-in and/or standard
// wallet-adapter connect.
//
// IMPORTANT — verified this session: @mysten/dapp-kit is now fully
// DEPRECATED (npm install warns "only supports the deprecated JSON RPC
// API and will not receive further updates"). The current recommended
// replacement is @mysten/dapp-kit-react + @mysten/dapp-kit-core (added to
// frontend/package.json), confirmed on npm at versions 2.1.22 / 1.6.20
// respectively as of this session. Per the migration guide at
// https://sdk.mystenlabs.com/sui/migrations/sui-2.0/dapp-kit, this is a
// full rewrite: gRPC instead of JSON-RPC, and UI built as Web Components
// (Lit Elements) rather than React-specific components — this changes
// how a ConnectButton-equivalent gets used from React (likely via a
// custom element in JSX, e.g. <dapp-kit-connect-button>, not a React
// component import). VERIFY the exact current API/component names
// against @mysten/dapp-kit-react's own docs before implementing — do not
// assume it mirrors the old package's React hooks/components 1:1.

// TODO: export function WalletConnect(): JSX.Element

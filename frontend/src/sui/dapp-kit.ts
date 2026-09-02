// dApp Kit instance config — shared by Landing.tsx and any component using
// wallet hooks. See https://sdk.mystenlabs.com/dapp-kit/getting-started/react
// Enoki wallets (zkLogin via Google) registered per
// https://docs.sui.io/getting-started/examples/defi-trading-zklogin

import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { registerEnokiWallets } from "@mysten/enoki";

const GRPC_URLS = {
  testnet: "https://fullnode.testnet.sui.io:443",
};

export const dAppKit = createDAppKit({
  networks: ["testnet"],
  createClient: (network: keyof typeof GRPC_URLS) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
});

// Registers Google sign-in as a zkLogin "wallet" — shows up in the standard
// <ConnectButton /> alongside any browser-extension wallets, no separate UI
// needed. Sponsored-transaction (private key) wiring is separate — see
// enoki.ts, since that key must never reach frontend code.
registerEnokiWallets({
  apiKey: import.meta.env.VITE_ENOKI_PUBLIC_API_KEY,
  providers: {
    google: {
      clientId: import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
    },
  },
  clients: dAppKit.networks.map((network) => dAppKit.getClient(network)),
  getCurrentNetwork: () => dAppKit.stores.$currentNetwork.get(),
});

// Registers this instance's types so hooks like useCurrentAccount() get
// correct type inference elsewhere in the app.
declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
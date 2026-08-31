// Owner: Person 2 (transaction layer).
// dApp Kit instance config — shared by WalletConnect.tsx and any component
// using wallet hooks. See https://sdk.mystenlabs.com/dapp-kit/getting-started/react

import { createDAppKit } from '@mysten/dapp-kit-react';
import { SuiGrpcClient } from '@mysten/sui/grpc';

const GRPC_URLS = {
  testnet: 'https://fullnode.testnet.sui.io:443',
};

export const dAppKit = createDAppKit({
  networks: ['testnet'],
  createClient: (network: keyof typeof GRPC_URLS) =>
    new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
});

// Registers this instance's types so hooks like useCurrentAccount() get
// correct type inference elsewhere in the app.
declare module '@mysten/dapp-kit-react' {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
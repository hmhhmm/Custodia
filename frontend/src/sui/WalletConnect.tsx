// Owner: Person 2 (transaction layer).
// STATUS: implemented against @mysten/dapp-kit-react, verified this
// session against https://sdk.mystenlabs.com/dapp-kit/getting-started/react
//
// FIXED: `ConnectButton` is not exported from the package root — verified
// by reading node_modules/@mysten/dapp-kit-react/src/index.ts (hooks only)
// vs src/ui.ts (ConnectButton, ConnectModal), and confirmed the package.json
// "exports" map declares a real "./ui" subpath backed by dist/ui.mjs.
// Must import from '@mysten/dapp-kit-react/ui', not the package root.

import { useCurrentAccount, useCurrentWallet } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';

export function WalletConnect() {
  const account = useCurrentAccount();
  const wallet = useCurrentWallet();

  return (
    <div>
      <ConnectButton />
      {account ? (
        <div>
          <p>Wallet: {wallet?.name}</p>
          <p>Address: {account.address}</p>
        </div>
      ) : (
        <p>Connect your wallet to get started</p>
      )}
    </div>
  );
}
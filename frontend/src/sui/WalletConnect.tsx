// Owner: Person 2 (transaction layer).
// STATUS: implemented against @mysten/dapp-kit-react, verified this
// session against https://sdk.mystenlabs.com/dapp-kit/getting-started/react

import { ConnectButton, useCurrentAccount, useCurrentWallet } from '@mysten/dapp-kit-react';

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
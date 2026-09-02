import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { generateNonce, generateRandomness, jwtToAddress } from "@mysten/sui/zklogin";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
// VERIFY: current Mysten-hosted (or self-hosted) prover URL for testnet —
// do not hardcode without checking https://docs.sui.io/guides/developer/cryptography/zklogin-integration/developer-account
const PROVER_URL = "VERIFY_BEFORE_USE";

/**
 * Step 1 of zkLogin: generates a throwaway keypair + nonce, then builds the
 * Google OAuth URL. Call this when the user clicks "Continue with Google".
 * The ephemeral keypair must be saved (sessionStorage) so completeZkLogin
 * can use it after the redirect back.
 */
export async function beginZkLogin(): Promise<{ loginUrl: string }> {
  const ephemeralKeypair = new Ed25519Keypair();

  // maxEpoch: how long this ephemeral key stays valid — VERIFY current
  // epoch-fetching pattern (likely client.getLatestSuiSystemState()).
  const maxEpoch = 0; // VERIFY: replace with a real fetched epoch + buffer

  const randomness = generateRandomness();
  const nonce = generateNonce(
    ephemeralKeypair.getPublicKey(),
    maxEpoch,
    randomness,
  );

  // Save what we'll need after the redirect — sessionStorage survives the
  // OAuth round-trip (a full page navigation) but clears when the tab closes.
  sessionStorage.setItem("zklogin_ephemeral_sk", ephemeralKeypair.getSecretKey());
  sessionStorage.setItem("zklogin_max_epoch", String(maxEpoch));
  sessionStorage.setItem("zklogin_randomness", randomness);

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: window.location.origin,
    response_type: "id_token",
    scope: "openid",
    nonce,
  });

  return {
    loginUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
  };
}
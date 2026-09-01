// Deployed Custodia package + registry object, read once here instead of
// being redeclared per-file. Real deployed addresses (see frontend/.env);
// fallbacks below match the same testnet deployment.

export const PACKAGE_ID: string = import.meta.env.VITE_CUSTODIA_PACKAGE_ID;

export const AGENT_REGISTRY_ID: string =
  import.meta.env.VITE_AGENT_REGISTRY_ID ??
  "0xf42821c47c23e96967bdc04b4265f38f7c92697bb966204205aff3a7d8e214e4";

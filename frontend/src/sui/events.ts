// Shared helper for reading a typed event out of a signAndExecuteTransaction
// result — every PTB builder that needs an object id created inside its own
// transaction reads it this way (the alternative, parsing effects.changedObjects,
// is only needed when no event exists at all — see ptb-deal-access.ts).

export interface TxResultWithEvents {
  events?: { type: string; parsedJson?: unknown }[];
}

export function findEvent<T>(result: TxResultWithEvents, typeSuffix: string): T | null {
  const event = result.events?.find((e) => e.type.endsWith(typeSuffix));
  return (event?.parsedJson as T | undefined) ?? null;
}

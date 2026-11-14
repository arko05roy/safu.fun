export interface Outflow {
  txHash: string;
  amount: bigint;
  to: string;
}

/** Read access to one token chain. */
export interface ChainAdapter {
  /** Short label used in evidence strings, e.g. "near-testnet", "base-sepolia". */
  readonly label: string;
  balanceOf(token: string, holder: string): Promise<bigint>;
  /** Current block/height — recorded with balance evidence. */
  head(): Promise<bigint>;
  /**
   * Outgoing token transfers from `holder` since the watch was registered,
   * newest first, stopping once `enough` has been accounted for.
   */
  outflows(token: string, holder: string, since: { block: bigint; ms: number }, enough: bigint): Promise<Outflow[]>;
}

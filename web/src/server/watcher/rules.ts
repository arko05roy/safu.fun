/**
 * Rug rules (PRD §5.1), as pure functions over balances.
 *
 * R1: the deployer has moved out ≥ threshold of its baseline holdings.
 * R2: the insider set (top non-pool holders at cover time) has collectively
 *     moved out ≥ threshold of its combined baseline. Transfers *between*
 *     insiders net out, because we compare summed balances.
 *
 * Baselines come from the on-chain TokenWatch, so anyone can recompute this.
 */
export interface HolderState {
  address: string;
  baseline: bigint;
  current: bigint;
}

export interface RuleHit {
  rule: "R1" | "R2";
  /** Tokens that left the watched wallet(s). */
  outflow: bigint;
  baseline: bigint;
  /** Wallets whose balance dropped — where to look for evidence txs. */
  sellers: HolderState[];
}

const BPS = 10_000n;

function dropped(h: HolderState): bigint {
  return h.baseline > h.current ? h.baseline - h.current : 0n;
}

export function checkR1(deployer: HolderState, thresholdBps: number): RuleHit | null {
  if (deployer.baseline === 0n) return null;
  const out = dropped(deployer);
  if (out * BPS < deployer.baseline * BigInt(thresholdBps)) return null;
  return { rule: "R1", outflow: out, baseline: deployer.baseline, sellers: [deployer] };
}

export function checkR2(insiders: HolderState[], thresholdBps: number): RuleHit | null {
  const baseline = insiders.reduce((a, h) => a + h.baseline, 0n);
  if (baseline === 0n) return null;
  const current = insiders.reduce((a, h) => a + (h.current < h.baseline ? h.current : h.baseline), 0n);
  const out = baseline - current;
  if (out * BPS < baseline * BigInt(thresholdBps)) return null;
  return { rule: "R2", outflow: out, baseline, sellers: insiders.filter((h) => dropped(h) > 0n) };
}

/** R1 takes precedence (strongest, simplest evidence). */
export function evaluate(
  deployer: HolderState,
  insiders: HolderState[],
  r1Bps: number,
  r2Bps: number,
): RuleHit | null {
  return checkR1(deployer, r1Bps) ?? checkR2(insiders, r2Bps);
}

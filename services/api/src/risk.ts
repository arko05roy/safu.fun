/**
 * Rug odds → premium (PRD §5.2):
 *   premium_bps = clamp(100 + risk × 600, 100, 700)
 * risk ∈ [0,1] is a transparent weighted heuristic over on-chain facts. It is
 * a pricing heuristic, not a probability model; every factor is returned so the
 * UI can show why a coin is priced the way it is.
 */
import type { TokenProfile } from "./explorers.js";

export interface RiskFactor {
  name: string;
  value: number; // 0..1, higher = riskier
  weight: number;
  detail: string;
}

export interface Risk {
  score: number;
  rugOddsPct: number;
  premiumBps: number;
  factors: RiskFactor[];
}

const DAY = 86_400_000;
const share = (part: bigint, whole: bigint) => (whole === 0n ? 0 : Number((part * 1_000_000n) / whole) / 1_000_000);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function assessRisk(p: TokenProfile, now = Date.now()): Risk {
  const deployerShare = share(p.deployerBalance, p.totalSupply);
  const insiderShare = share(p.insiders.reduce((a, h) => a + h.balance, 0n), p.totalSupply);
  const ageDays = p.createdAtMs !== null ? (now - p.createdAtMs) / DAY : null;
  const holders = p.holderCount;

  const factors: RiskFactor[] = [
    {
      name: "deployer_share",
      value: clamp(deployerShare / 0.5, 0, 1),
      weight: 0.35,
      detail: `deployer holds ${(deployerShare * 100).toFixed(1)}% of supply`,
    },
    {
      name: "insider_concentration",
      value: clamp(insiderShare / 0.5, 0, 1),
      weight: 0.3,
      detail: `top ${p.insiders.length} non-contract holders hold ${(insiderShare * 100).toFixed(1)}%`,
    },
    {
      name: "token_age",
      value: ageDays === null ? 0.5 : ageDays < 1 ? 1 : ageDays < 7 ? 0.6 : ageDays < 30 ? 0.3 : 0.1,
      weight: 0.2,
      detail: ageDays === null ? "creation time unknown" : `${ageDays.toFixed(1)} days old`,
    },
    {
      name: "holder_count",
      value: holders === null ? 0.3 : holders < 50 ? 1 : holders < 500 ? 0.5 : holders < 5000 ? 0.2 : 0,
      weight: 0.15,
      detail: holders === null ? "≥25 holders (exact count unavailable)" : `${holders} holders`,
    },
  ];
  const score = clamp(factors.reduce((a, f) => a + f.value * f.weight, 0), 0, 1);
  return {
    score,
    rugOddsPct: Math.round(score * 1000) / 10,
    premiumBps: Math.round(clamp(100 + score * 600, 100, 700)),
    factors,
  };
}

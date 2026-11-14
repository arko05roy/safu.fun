/** Typed client for services/api. Every number from the chain arrives as a decimal string. */

export const API = process.env.NEXT_PUBLIC_SAFU_API ?? "http://localhost:8787";
export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT = process.env.NEXT_PUBLIC_SAFU_CONTRACT ?? "cover.safufun-d73f3d.testnet";

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly retry = false) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError(0, "safu API unreachable, is services/api running?");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, Boolean(body.retry));
  return body as T;
}

// ───────────────────────── types ─────────────────────────

export interface PoolStats {
  available_usdc: string;
  reserved_usdc: string;
  premiums_earned_usdc: string;
  total_paid_out_usdc: string;
  policies: number;
  reports: number;
  payouts: number;
}

export interface ContractConfig {
  owner: string;
  usdc: string;
  api: string;
  watchers: string[];
  relayers: string[];
  dispute_window_ms: number;
  waiting_period_ms: number;
  deductible_bps: number;
  max_token_exposure_bps: number;
  mpc_signer: string;
}

export interface ConfigView {
  network: string;
  contract: string;
  config: ContractConfig;
  pool: PoolStats;
  watcher_heartbeat_ms: number;
}

export interface RiskFactor {
  name: string;
  value: number;
  weight: number;
  detail: string;
}

export interface Holder {
  address: string;
  balance: string;
  isContract: boolean;
}

export interface TokenView {
  profile: {
    chain: string;
    address: string;
    name: string;
    symbol: string;
    decimals: number;
    totalSupply: string;
    holderCount: number | null;
    createdAtMs: number | null;
    deployer: string | null;
    deployerBalance: string;
    insiders: Holder[];
    snapshotBlock: string;
  };
  risk: { score: number; rugOddsPct: number; premiumBps: number; factors: RiskFactor[] };
  onchain: {
    token_key: string;
    active_policy_ids: number[];
    exposure_usdc: string;
    open_report_id: number | null;
    rugged_report_id: number | null;
    watch: {
      deployer: { address: string; baseline: string };
      insiders: { address: string; baseline: string }[];
      snapshot_block: number;
      registered_at_ms: number;
    } | null;
  };
  uno: { id: number; status: unknown } | null;
}

export type PolicyStatus = "Active" | "NotEligible" | "Expired" | { Claimed: { payout_id: number } };

export interface Policy {
  id: number;
  token_key: string;
  token_chain: string;
  token_addr: string;
  payout_chain: string;
  payout_asset: string;
  recipient: string;
  cover_usdc: string;
  premium_bps: number;
  buy_ref: string;
  created_at_ms: number;
  starts_at_ms: number;
  expires_at_ms: number;
  status: PolicyStatus;
}

export interface Report {
  id: number;
  token_key: string;
  reporter: string;
  rule: string;
  evidence: string[];
  reported_at_ms: number;
  dispute_deadline_ms: number;
  status: "Pending" | "Disputed" | "Rejected" | "Finalized";
  payout_ids: number[];
  total_payout_usdc: string;
}

export interface Payout {
  id: number;
  policy_id: number;
  report_id: number;
  amount_usdc: string;
  payout_chain: string;
  payout_asset: string;
  recipient: string;
  status: "Queued" | "Processing" | "Sent" | "Signed" | "Paid";
  rail: "Intents" | "ChainSig" | "Near" | null;
  deposit_address: string | null;
  dest_tx_hash: string | null;
  signed_tx: string | null;
  evm_tx_hash: string | null;
}

export interface StakingStats {
  safu_token: string | null;
  total_staked_safu: string;
  active_shares: string;
  unbonding_shares: string;
  rewards_reserved_usdc: string;
  rewards_paid_usdc: string;
  total_burned_safu: string;
  staker_share_bps: number;
  max_slash_bps: number;
  unbond_ms: number;
  safu_total_supply: string | null;
}

export interface StakeView {
  account_id: string;
  active_shares: string;
  unbonding_shares: string;
  release_at_ms: number;
  staked_safu: string;
  claimable_usdc: string;
}

export interface UnoLaunch {
  id: number;
  token: string;
  dev: string;
  dev_alloc: string;
  dev_claimed: string;
  locked_at_ms: number;
  tranche_bps: number;
  period_ms: number;
  pool_token: string;
  pool_usdc: string;
  status: "Active" | { Reversed: { report_id: number } };
  refund_pot_usdc: string;
  burned_token: string;
  snapshot_total: string;
  refunds_paid_usdc: string;
  created_at_ms: number;
}

export interface UnoHolder {
  account_id: string;
  amount: string;
  paid: boolean;
}

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  contractAddress?: string;
}

export interface CoverQuote {
  mode: "cover_only";
  quote: {
    contract: string;
    payer: string;
    token_chain: string;
    token_addr: string;
    payout_chain: string;
    payout_asset: string;
    recipient: string;
    cover_usdc: string;
    premium_bps: number;
    premium_usdc: string;
    expires_at_ms: number;
    quote_expires_at_ms: number;
    nonce: string;
  };
  signature: string;
  rug_odds_pct: number;
  watch: "existing" | "registered";
  pay: {
    receiver_id: string;
    method: "ft_transfer_call";
    args: { receiver_id: string; amount: string; msg: string };
    deposit_yocto: string;
    gas_tgas: number;
  };
}

// ───────────────────────── endpoints ─────────────────────────

export const api = {
  config: () => req<ConfigView>("/config"),
  tokens: () => req<OneClickToken[]>("/tokens"),
  token: (chain: string, addr: string) => req<TokenView>(`/token/${encodeURIComponent(chain)}/${encodeURIComponent(addr)}`),
  policy: (id: number) => req<Policy>(`/policy/${id}`),
  payout: (id: number) => req<Payout>(`/payout/${id}`),
  report: (id: number) => req<Report>(`/report/${id}`),
  wall: () => req<Report[]>("/wall"),
  staking: () => req<StakingStats>("/staking"),
  stake: (account: string) => req<StakeView>(`/stake/${encodeURIComponent(account)}`),
  uno: () => req<UnoLaunch[]>("/uno"),
  unoOne: (id: number) => req<{ launch: UnoLaunch; snapshot: UnoHolder[] }>(`/uno/${id}`),
  coverQuote: (body: {
    token_chain: string;
    token_addr: string;
    cover_usdc: string;
    payout_chain: string;
    payout_asset: string;
    recipient: string;
    payer: string;
  }) => req<CoverQuote>("/cover/quote", { method: "POST", body: JSON.stringify(body) }),
};

// ───────────────────────── formatting ─────────────────────────

export function units(raw: string | bigint | number, decimals: number): number {
  const s = BigInt(raw).toString().padStart(decimals + 1, "0");
  return Number(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`);
}

export const usdc = (raw: string | bigint | number) => units(raw, 6);

export function fmtUsd(n: number, opts: { compact?: boolean; digits?: number } = {}) {
  if (opts.compact && Math.abs(n) >= 1000)
    return `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n)}`;
  const d = opts.digits ?? (Math.abs(n) < 10 ? 2 : 0);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function fmtCompact(n: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function shortAddr(a: string, head = 6, tail = 4) {
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(sec)}` : `${p(h)}:${p(m)}:${p(sec)}`;
}

export function splitTokenKey(key: string) {
  const i = key.indexOf(":");
  return { chain: key.slice(0, i), addr: key.slice(i + 1) };
}

// ───────────────────────── explorers ─────────────────────────

const NEARBLOCKS = NETWORK === "testnet" ? "https://testnet.nearblocks.io" : "https://nearblocks.io";

export const explorer = {
  nearTx: (h: string) => `${NEARBLOCKS}/txns/${h}`,
  nearAccount: (a: string) => `${NEARBLOCKS}/address/${a}`,
  evmTx: (chain: string, h: string) => `${evmBase(chain)}/tx/${h}`,
  evmAddr: (chain: string, a: string) => `${evmBase(chain)}/address/${a}`,
};

function evmBase(chain: string) {
  return (
    {
      "base-sepolia": "https://sepolia.basescan.org",
      sepolia: "https://sepolia.etherscan.io",
      base: "https://basescan.org",
      eth: "https://etherscan.io",
      arb: "https://arbiscan.io",
    } as Record<string, string>
  )[chain] ?? "https://blockscan.com";
}

/** Evidence strings look like `near-testnet:tx:<hash>` or `near-testnet:balance:<acct>:<a>-><b>@<block>`. */
export function parseEvidence(e: string): { kind: "tx"; hash: string; href: string } | { kind: "balance"; account: string; from: string; to: string } | { kind: "raw"; text: string } {
  const parts = e.split(":");
  if (parts[1] === "tx") {
    const hash = parts.slice(2).join(":");
    const chain = parts[0];
    return { kind: "tx", hash, href: chain.startsWith("near") ? explorer.nearTx(hash) : explorer.evmTx(chain, hash) };
  }
  if (parts[1] === "balance") {
    const account = parts[2];
    const [from, rest] = parts.slice(3).join(":").split("->");
    return { kind: "balance", account, from, to: (rest ?? "").split("@")[0] };
  }
  return { kind: "raw", text: e };
}

export const CHAIN_LABEL: Record<string, string> = {
  near: "NEAR",
  eth: "Ethereum",
  base: "Base",
  "base-sepolia": "Base Sepolia",
  sepolia: "Sepolia",
  arb: "Arbitrum",
  sol: "Solana",
  btc: "Bitcoin",
  ton: "TON",
  sui: "Sui",
  tron: "Tron",
  bsc: "BNB Chain",
  pol: "Polygon",
  op: "Optimism",
  avax: "Avalanche",
  doge: "Dogecoin",
  xrp: "XRP",
  zec: "Zcash",
  gnosis: "Gnosis",
  bera: "Berachain",
  aptos: "Aptos",
  stellar: "Stellar",
  cardano: "Cardano",
  ltc: "Litecoin",
};

export const chainLabel = (c: string) => CHAIN_LABEL[c] ?? c.toUpperCase();

/**
 * Intents path (PRD Layer 1): the buyer pays any asset on any chain, 1Click
 * swaps it into the memecoin, and the cover premium is taken inside the swap
 * via `appFees` (fee bps = premium bps, paid to TREASURY_ACCOUNT). When 1Click
 * reports SUCCESS, the API registers the policy for the USD value bought.
 *
 * Mainnet only (1Click has no testnet) and only for tokens 1Click lists.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { HttpError, tokenView, ensureWatch } from "./cover";
import { safu } from "./near";

interface OneClickToken {
  assetId: string;
  blockchain: string;
  contractAddress?: string;
  symbol: string;
  decimals: number;
  price: number;
}

let tokenCache: { at: number; tokens: OneClickToken[] } | null = null;
export async function oneClickTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 300_000) return tokenCache.tokens;
  const r = await fetch(`${config.oneClickUrl}/v0/tokens`);
  if (!r.ok) throw new HttpError(502, `1Click tokens ${r.status}`);
  tokenCache = { at: Date.now(), tokens: (await r.json()) as OneClickToken[] };
  return tokenCache.tokens;
}

async function oneClick<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.oneClickJwt) headers.authorization = `Bearer ${config.oneClickJwt}`;
  const r = await fetch(`${config.oneClickUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new HttpError(502, `1Click ${path} ${r.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

export interface BuyRequest {
  origin_asset: string; // what the buyer pays with (1Click asset id)
  amount: string; // in origin asset base units
  token_asset: string; // memecoin's 1Click asset id
  recipient: string; // buyer's address on the memecoin's chain
  refund_to: string; // buyer's address on the origin chain
  payout_chain: string;
  payout_asset: string;
  payout_recipient: string;
  dry?: boolean;
}

interface PendingBuy {
  depositAddress: string;
  createdAt: number;
  policy: Parameters<typeof safu.registerPolicy>[0] & { cover_usdc: string };
  status: "pending" | "registered" | "failed";
  policyId?: number;
  note?: string;
}

const storePath = join(config.dataDir, "buys.json");
function load(): PendingBuy[] {
  return existsSync(storePath) ? JSON.parse(readFileSync(storePath, "utf8")) : [];
}
function save(b: PendingBuy[]) {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(b, null, 2));
}

export async function buyQuote(req: BuyRequest) {
  const dry = req.dry !== false;
  if (!dry) {
    if (config.network !== "mainnet") throw new HttpError(501, "Intents buys need mainnet (1Click has no testnet)");
    if (!config.treasury) throw new HttpError(501, "TREASURY_ACCOUNT not configured");
  }
  const tokens = await oneClickTokens();
  const t = tokens.find((x) => x.assetId === req.token_asset);
  if (!t) throw new HttpError(422, `1Click does not list ${req.token_asset}; use /cover/quote (cover-only) instead`);
  const tokenAddr = t.contractAddress;
  if (!tokenAddr) throw new HttpError(422, `${t.symbol} is a native asset, not a memecoin contract`);

  const v = await tokenView(t.blockchain, tokenAddr);
  const premiumBps = v.risk.premiumBps;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw 1Click quote JSON, read field by field below
  const q = await oneClick<any>("POST", "/v0/quote", {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: req.origin_asset,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: req.token_asset,
    amount: req.amount,
    refundTo: req.refund_to,
    refundType: "ORIGIN_CHAIN",
    recipient: req.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 3_600_000).toISOString(),
    ...(config.treasury ? { appFees: [{ recipient: config.treasury, fee: premiumBps }] } : {}),
  });
  // Cover the USD value going in, minus the premium itself.
  const coverUsdc = BigInt(Math.floor(Number(q.quote.amountInUsd ?? 0) * 1e6 * (1 - premiumBps / 10_000)));
  const result = {
    mode: "intents" as const,
    token: { chain: t.blockchain, address: tokenAddr, symbol: t.symbol },
    rug_odds_pct: v.risk.rugOddsPct,
    risk: v.risk,
    premium_bps: premiumBps,
    cover_usdc: coverUsdc.toString(),
    oneclick: q,
    premium_included_in_quote: Boolean(config.treasury),
  };
  if (dry) return result;

  await ensureWatch(v);
  const buys = load();
  buys.push({
    depositAddress: q.quote.depositAddress,
    createdAt: Date.now(),
    status: "pending",
    policy: {
      token_chain: t.blockchain,
      token_addr: tokenAddr,
      payout_chain: req.payout_chain,
      payout_asset: req.payout_asset,
      recipient: req.payout_recipient,
      cover_usdc: coverUsdc.toString(),
      premium_bps: premiumBps,
      insiders_root: "",
      buy_ref: q.quote.depositAddress,
      expires_at_ms: Date.now() + config.coverDays * 86_400_000,
    },
  });
  save(buys);
  return result;
}

/** Register cover for every Intents buy 1Click has settled. */
export async function settleBuys(log: (m: string) => void) {
  const buys = load();
  let changed = false;
  for (const b of buys.filter((x) => x.status === "pending")) {
    const s = await oneClick<{ status: string }>("GET", `/v0/status?depositAddress=${b.depositAddress}`).catch(() => null);
    if (!s) continue;
    if (s.status === "SUCCESS") {
      b.policy.expires_at_ms = Date.now() + config.coverDays * 86_400_000;
      b.policyId = await safu.registerPolicy(b.policy);
      b.status = "registered";
      log(`buy ${b.depositAddress} settled -> policy #${b.policyId}`);
      changed = true;
    } else if (s.status === "REFUNDED" || s.status === "FAILED") {
      b.status = "failed";
      b.note = s.status;
      changed = true;
    }
  }
  if (changed) save(buys);
}

export function buyStatus(depositAddress: string) {
  return load().find((b) => b.depositAddress === depositAddress) ?? null;
}

/**
 * Token profiles from free explorer APIs: NearBlocks v3 (NEAR) and Blockscout
 * v2 (EVM). Holder *lists* come from the indexer; the *balances* we commit
 * on-chain as baselines are re-read from chain RPC at a single block, so they
 * match exactly what the watcher reads later.
 */
import { createPublicClient, http, parseAbi } from "viem";
import { CHAINS, config, nearProvider } from "./config.js";

export interface HolderInfo {
  address: string;
  balance: bigint;
  isContract: boolean;
}

export interface TokenProfile {
  chain: string;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: bigint;
  holderCount: number | null;
  createdAtMs: number | null;
  /** Wallet that received the initial supply (NEAR ft_mint) / contract creator (EVM). */
  deployer: string | null;
  deployerBalance: bigint;
  /** Top holders excluding the deployer and contracts (pools, routers, the token itself). */
  insiders: HolderInfo[];
  /** Block / height the balances above were read at. */
  snapshotBlock: bigint;
}

/** The explorer hasn't indexed a fresh token yet; retry shortly (API maps this to 503). */
export class IndexerLagError extends Error {}

/**
 * Explorer GET with a TTL cache (Infinity for immutable data) and 429 backoff.
 * Responses failing `keep` (e.g. empty results for a token not indexed yet)
 * are never cached, so a lagging indexer can't poison the cache.
 */
const cache = new Map<string, { at: number; v: unknown }>();
async function getJson<T>(url: string, headers: Record<string, string> = {}, ttlMs = 60_000, keep: (v: T) => boolean = () => true): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as T;
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers });
    if (r.status === 429 && attempt < 4) {
      await new Promise((res) => setTimeout(res, 2_000 * 2 ** attempt));
      continue;
    }
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const v = (await r.json()) as T;
    if (keep(v)) cache.set(url, { at: Date.now(), v });
    return v;
  }
}
const FOREVER = Number.POSITIVE_INFINITY;

// ───────────── NEAR (NEP-141) ─────────────

const nearRpc = nearProvider(config.network);

async function nearBlocks<T>(path: string, ttlMs = 60_000, keep?: (v: T) => boolean): Promise<T> {
  return getJson<T>(
    `${CHAINS.near.explorer}/v3${path}`,
    config.nearblocksKey ? { authorization: `Bearer ${config.nearblocksKey}` } : {},
    ttlMs,
    keep,
  );
}
const nonEmpty = (v: { data: unknown }) => (Array.isArray(v.data) ? v.data.length > 0 : v.data != null);

async function nearIsContract(account: string): Promise<boolean> {
  try {
    const a = (await nearRpc.query({ request_type: "view_account", account_id: account, finality: "final" })) as unknown as { code_hash: string };
    return a.code_hash !== "11111111111111111111111111111111";
  } catch {
    return false;
  }
}

/** Initial-supply recipient: the ft_mint event in the token's first deployment tx. */
async function nearDeployer(token: string): Promise<string | null> {
  const deps = await nearBlocks<{ data: { transaction_hash: string }[] }>(`/accounts/${token}/contract/deployments`, FOREVER, nonEmpty);
  const first = deps.data.at(-1)?.transaction_hash;
  if (!first) throw new IndexerLagError(`indexer has no deployment for ${token} yet`);
  const rec = await nearBlocks<{ data: unknown }>(`/txns/${first}/receipts`, FOREVER, nonEmpty);
  const logs: string[] = [];
  const walk = (r: any) => {
    logs.push(...(r?.outcome?.logs ?? []));
    (r?.receipts ?? []).forEach(walk);
  };
  (Array.isArray(rec.data) ? rec.data : [rec.data]).forEach(walk);
  if (logs.length === 0) throw new IndexerLagError(`indexer has no receipts for ${token}'s deployment yet`);
  for (const l of logs) {
    if (!l.startsWith("EVENT_JSON:")) continue;
    const ev = JSON.parse(l.slice(11));
    if (ev.standard === "nep141" && ev.event === "ft_mint") return ev.data?.[0]?.owner_id ?? null;
  }
  return null;
}

async function nearProfile(token: string): Promise<TokenProfile> {
  const [ft, holders, acct, deployer, head] = await Promise.all([
    // metadata straight from the token contract (chain truth, no indexer lag)
    nearRpc.callFunction({ contractId: token, method: "ft_metadata", args: {} }) as Promise<{ name: string; symbol: string; decimals: number }>,
    nearBlocks<{ data: { account: string; amount: string }[] }>(`/fts/${token}/holders?limit=25`, 10_000, nonEmpty),
    nearBlocks<{ data: { created?: { block_timestamp?: string } } }>(`/accounts/${token}`, FOREVER, (v) => Boolean(v.data?.created?.block_timestamp)),
    nearDeployer(token),
    nearRpc.viewBlock({ finality: "final" }),
  ]);
  if (holders.data.length === 0) throw new IndexerLagError(`indexer has no holders for ${token} yet`);
  const height = BigInt(head.header.height);
  const balance = async (acc: string) =>
    BigInt(
      ((await nearRpc.callFunction({
        contractId: token,
        method: "ft_balance_of",
        args: { account_id: acc },
        blockQuery: { blockId: Number(height) },
      })) as string) ?? "0",
    );
  const supply = BigInt(
    ((await nearRpc.callFunction({ contractId: token, method: "ft_total_supply", args: {}, blockQuery: { blockId: Number(height) } })) as string) ?? "0",
  );

  const deployerBalance = deployer ? await balance(deployer) : 0n;
  // holder index behind chain state -> insider list would be wrong; wait for it
  // The indexer's view of the dev must match chain state at the snapshot block;
  // if it doesn't, its holder list is stale (transfers not indexed yet).
  const indexedDev = deployer ? BigInt(holders.data.find((h) => h.account === deployer)?.amount ?? "0") : 0n;
  if (deployer && indexedDev !== deployerBalance) {
    throw new IndexerLagError(`indexer holder list for ${token} is behind chain state`);
  }
  // For small tokens the indexer returns every holder: their balances must add
  // up to the on-chain supply, otherwise the index is behind (missed transfers).
  if (holders.data.length < 25) {
    const indexed = holders.data.reduce((a, h) => a + BigInt(h.amount), 0n);
    if (indexed !== supply) throw new IndexerLagError(`indexer holder balances for ${token} don't match on-chain supply yet`);
  }
  const candidates = holders.data.map((h) => h.account).filter((a) => a !== deployer && a !== token);
  const insiders: HolderInfo[] = [];
  for (const a of candidates) {
    if (insiders.length >= config.maxInsiders) break;
    if (await nearIsContract(a)) continue;
    insiders.push({ address: a, balance: await balance(a), isContract: false });
  }
  const created = acct.data.created?.block_timestamp;
  return {
    chain: "near",
    address: token,
    name: ft.name,
    symbol: ft.symbol,
    decimals: ft.decimals,
    totalSupply: supply,
    holderCount: holders.data.length < 25 ? holders.data.length : null,
    createdAtMs: created ? Number(BigInt(created) / 1_000_000n) : null,
    deployer,
    deployerBalance,
    insiders,
    snapshotBlock: height,
  };
}

// ───────────── EVM (ERC-20) ─────────────

const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
]);

interface BsToken { name: string; symbol: string; decimals: string; holders_count?: string; holders?: string }
interface BsAddress { creator_address_hash: string | null; creation_transaction_hash: string | null }
interface BsHolders { items: { address: { hash: string; is_contract: boolean }; value: string }[] }

async function evmProfile(chain: string, token: string): Promise<TokenProfile> {
  const c = CHAINS[chain];
  const client = createPublicClient({ transport: http(c.rpc) });
  const pro = c.chainId !== undefined && config.blockscoutKey;
  const bs = (path: string) =>
    pro ? `https://api.blockscout.com/${c.chainId}/api/v2${path}${path.includes("?") ? "&" : "?"}apikey=${config.blockscoutKey}` : `${c.explorer}/api/v2${path}`;
  const [meta, addr, holders, head] = await Promise.all([
    getJson<BsToken>(bs(`/tokens/${token}`)),
    getJson<BsAddress>(bs(`/addresses/${token}`), {}, FOREVER),
    getJson<BsHolders>(bs(`/tokens/${token}/holders`)),
    client.getBlockNumber(),
  ]);
  let createdAtMs: number | null = null;
  if (addr.creation_transaction_hash) {
    const tx = await getJson<{ timestamp: string }>(bs(`/transactions/${addr.creation_transaction_hash}`), {}, FOREVER).catch(() => null);
    if (tx?.timestamp) createdAtMs = Date.parse(tx.timestamp);
  }
  const deployer = addr.creator_address_hash;
  const bal = (a: string) =>
    client.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [a as `0x${string}`], blockNumber: head });
  const insiders: HolderInfo[] = [];
  for (const h of holders.items) {
    if (insiders.length >= config.maxInsiders) break;
    const a = h.address.hash;
    if (h.address.is_contract || a.toLowerCase() === deployer?.toLowerCase() || a.toLowerCase() === token.toLowerCase()) continue;
    insiders.push({ address: a, balance: await bal(a), isContract: false });
  }
  const hc = meta.holders_count ?? meta.holders;
  return {
    chain,
    address: token,
    name: meta.name,
    symbol: meta.symbol,
    decimals: Number(meta.decimals),
    totalSupply: await client.readContract({ address: token as `0x${string}`, abi: ERC20, functionName: "totalSupply", blockNumber: head }),
    holderCount: hc ? Number(hc) : null,
    createdAtMs,
    deployer,
    deployerBalance: deployer ? await bal(deployer) : 0n,
    insiders,
    snapshotBlock: head,
  };
}

export function tokenProfile(chain: string, token: string): Promise<TokenProfile> {
  const c = CHAINS[chain];
  if (!c) throw new Error(`unsupported token chain "${chain}" (supported: ${Object.keys(CHAINS).join(", ")})`);
  return c.kind === "near" ? nearProfile(token) : evmProfile(chain, token);
}

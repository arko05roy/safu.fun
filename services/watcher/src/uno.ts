/**
 * UNO REVERSE follow-through. After `finalize_rug` reverses a launch, the
 * watcher (allowlisted) posts who held the coin — dev, insiders and the
 * contract excluded — and then pushes pro-rata USDC refunds until every
 * holder in the snapshot is paid. Anyone could call distribute; we just do it.
 */
import { config, nearProvider } from "./config.js";
import { safu } from "./near.js";

const provider = nearProvider(config.network);

interface UnoLaunch {
  id: number;
  token: string;
  dev: string;
  status: "Active" | { Reversed: { report_id: number } };
  refund_pot_usdc: string;
  snapshot_total: string;
  refunds_paid_usdc: string;
}

async function holdersOf(token: string): Promise<string[]> {
  const url = `${config.nearblocksApi}/v3/fts/${token}/holders?limit=100`;
  const r = await fetch(url, { headers: config.nearblocksKey ? { authorization: `Bearer ${config.nearblocksKey}` } : {} });
  if (!r.ok) throw new Error(`NearBlocks holders ${r.status}`);
  const body = (await r.json()) as { data: { account: string }[] };
  return body.data.map((h) => h.account);
}

async function balanceOf(token: string, account: string): Promise<bigint> {
  return BigInt(((await provider.callFunction({ contractId: token, method: "ft_balance_of", args: { account_id: account } })) as string) ?? "0");
}

export async function unoTick(log: (tag: string, m: string) => void) {
  const count = await safu.view<number>("uno_launch_count");
  for (let id = 0; id < count; id++) {
    const l = await safu.view<UnoLaunch>("get_uno_launch", { launch_id: id });
    if (!l || l.status === "Active") continue;
    const tag = `uno#${id}`;
    if (l.snapshot_total === "0") {
      if (l.refund_pot_usdc === "0") continue;
      const tok = await safu.view<{ watch: { insiders: { address: string }[] } | null }>("get_token", { token_chain: "near", token_addr: l.token });
      const excluded = new Set([l.dev, config.contract, ...(tok.watch?.insiders.map((h) => h.address) ?? [])]);
      const holders: [string, string][] = [];
      for (const a of await holdersOf(l.token)) {
        if (excluded.has(a)) continue;
        const b = await balanceOf(l.token, a);
        if (b > 0n) holders.push([a, b.toString()]);
      }
      if (holders.length === 0) {
        log(tag, "reversed, but no eligible holders found yet (indexer lag?)");
        continue;
      }
      await safu.call("set_uno_snapshot", { launch_id: id, holders }, 100n);
      log(tag, `UNO REVERSE'd — snapshot posted: ${holders.length} holders, pot ${l.refund_pot_usdc} USDC base units`);
      continue;
    }
    const snap = await safu.view<{ paid: boolean }[]>("get_uno_snapshot", { launch_id: id });
    if (snap.some((h) => !h.paid)) {
      const n = await safu.call<number>("distribute_uno_refunds", { launch_id: id, limit: 10 }, 300n);
      log(tag, `refunds sent to ${n} holders`);
    }
  }
}

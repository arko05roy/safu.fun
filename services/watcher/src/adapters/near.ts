/**
 * NEP-141 tokens on NEAR. Balances via RPC `ft_balance_of`; transfer evidence
 * via the NearBlocks v3 FT events index (tx hashes for each outgoing transfer).
 */
import { config, nearProvider } from "../config.js";
import type { ChainAdapter, Outflow } from "./types.js";

interface FtTxn {
  transaction_hash: string;
  delta_amount: string;
  involved_account_id: string | null;
  block_timestamp: string; // ns
  cause: string;
}

export class NearAdapter implements ChainAdapter {
  readonly label = `near-${config.network}`;
  private provider = nearProvider(config.network);

  async balanceOf(token: string, holder: string): Promise<bigint> {
    const r = await this.provider.callFunction({ contractId: token, method: "ft_balance_of", args: { account_id: holder } });
    return BigInt((r as string) ?? "0");
  }

  async head(): Promise<bigint> {
    const b = await this.provider.viewBlock({ finality: "final" });
    return BigInt(b.header.height);
  }

  async outflows(token: string, holder: string, since: { ms: number }, enough: bigint): Promise<Outflow[]> {
    const out: Outflow[] = [];
    let total = 0n;
    let next: string | undefined;
    const sinceNs = BigInt(since.ms) * 1_000_000n;
    for (let page = 0; page < 20; page++) {
      const url = new URL(`${config.nearblocksApi}/v3/accounts/${holder}/ft-txns`);
      url.searchParams.set("contract", token);
      url.searchParams.set("limit", "50");
      if (next) url.searchParams.set("next", next);
      const res = await fetch(url, {
        headers: config.nearblocksKey ? { authorization: `Bearer ${config.nearblocksKey}` } : {},
      });
      if (!res.ok) throw new Error(`NearBlocks ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const body = (await res.json()) as { data: FtTxn[]; meta?: { next_page?: string } };
      for (const t of body.data) {
        if (BigInt(t.block_timestamp) < sinceNs) return out;
        const delta = BigInt(t.delta_amount);
        if (delta >= 0n) continue;
        out.push({ txHash: t.transaction_hash, amount: -delta, to: t.involved_account_id ?? "(burn)" });
        total += -delta;
        if (total >= enough) return out;
      }
      next = body.meta?.next_page;
      if (!next || body.data.length === 0) return out;
    }
    return out;
  }
}

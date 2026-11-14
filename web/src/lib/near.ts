/** Minimal NEAR JSON-RPC reads (no SDK) + event-log parsing. */
import { NETWORK } from "./api";

export const RPC = NETWORK === "testnet" ? "https://test.rpc.fastnear.com" : "https://free.rpc.fastnear.com";

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "safu", method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error?.cause?.name ?? body.error.message ?? "rpc error");
  return body.result as T;
}

export async function viewCall<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export const ftBalance = (token: string, account: string) =>
  viewCall<string>(token, "ft_balance_of", { account_id: account }).catch(() => "0");

interface Outcome {
  receipts_outcome: { outcome: { logs: string[] } }[];
  transaction_outcome: { outcome: { logs: string[] } };
}

export interface SafuEvent {
  event: string;
  data: Record<string, unknown>[];
}

export function eventsFrom(outcome: Outcome): SafuEvent[] {
  const logs = [...outcome.transaction_outcome.outcome.logs, ...outcome.receipts_outcome.flatMap((r) => r.outcome.logs)];
  return logs
    .filter((l) => l.startsWith("EVENT_JSON:"))
    .map((l) => {
      try {
        return JSON.parse(l.slice("EVENT_JSON:".length)) as SafuEvent & { standard: string };
      } catch {
        return null;
      }
    })
    .filter((e): e is SafuEvent & { standard: string } => e !== null && e.standard === "safu");
}

export async function txOutcome(hash: string, sender: string): Promise<Outcome> {
  return rpc<Outcome>("EXPERIMENTAL_tx_status", { tx_hash: hash, sender_account_id: sender, wait_until: "EXECUTED" });
}

/** Find the policy id minted by a `buy_cover` ft_transfer_call. */
export function policyIdFrom(outcome: Outcome): number | null {
  const ev = eventsFrom(outcome).find((e) => e.event === "cover_bought");
  const id = ev?.data?.[0]?.policy_id;
  return typeof id === "number" ? id : null;
}

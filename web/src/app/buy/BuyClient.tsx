"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { parseTokenInput } from "@/components/landing/Hero";
import { TokenRisk } from "@/components/TokenRisk";
import { ArrowRight, Button, Chip, Corners, Dot, Eyebrow, Notice, Panel } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { api, ApiError, chainLabel, CONTRACT, countdown, fmtUsd, NETWORK, type CoverQuote, type TokenView, usdc } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { ftBalance, policyIdFrom, txOutcome, viewCall } from "@/lib/near";

type Dest = { id: string; chain: string; label: string; asset: (usdcId: string) => string; rail: string; addr: "near" | "evm"; live: boolean };

const DESTS: Dest[] = [
  { id: "near", chain: "near", label: "USDC on NEAR", asset: (u) => `nep141:${u}`, rail: "direct · instant", addr: "near", live: true },
  {
    id: "base-sepolia",
    chain: "base-sepolia",
    label: "USDC on Base Sepolia",
    asset: () => "nep141:base-0x036cbd53842c5426634e7929541ec2318f3dcf7e.omft.near",
    rail: "chain signatures · MPC-signed",
    addr: "evm",
    live: true,
  },
];

const INTENTS_PREVIEW = ["sol", "eth", "base", "arb", "btc", "ton", "sui", "tron", "bsc"];

const PRESETS = [5, 25, 100, 500];

export default function BuyClient() {
  const params = useSearchParams();
  const router = useRouter();
  const chain = params.get("chain");
  const token = params.get("token");
  const [input, setInput] = useState(token ? (chain && chain !== "near" ? `${chain}:${token}` : token) : "");

  const { data: view, error, loading, reload } = useApi(chain && token ? () => api.token(chain, token) : null, [chain, token]);
  const { data: cfg } = useApi(() => api.config(), []);

  // explorer indexer can lag on fresh tokens → API answers 503 retry
  useEffect(() => {
    if (error?.retry) {
      const t = setTimeout(reload, 4000);
      return () => clearTimeout(t);
    }
  }, [error, reload]);

  const submit = (raw: string) => {
    const t = parseTokenInput(raw);
    if (t) router.push(`/buy?chain=${encodeURIComponent(t.chain)}&token=${encodeURIComponent(t.addr)}`);
  };

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-28 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow>buy cover</Eyebrow>
          <h1 className="mt-4 font-display text-4xl text-bone sm:text-5xl">cover any coin.</h1>
        </div>
        <div className="font-mono text-[12px] text-dim">
          7-day window · 80% payout · {cfg ? `${Math.round(cfg.config.dispute_window_ms / 1000)}s dispute` : "…"}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="relative mt-8 flex border border-line-strong bg-ink transition-colors focus-within:border-safu"
      >
        <Corners />
        <span className="hidden items-center pl-5 font-mono text-sm text-slate sm:flex">CA&gt;</span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="token address · NEAR account · chain:address"
          spellCheck={false}
          autoComplete="off"
          aria-label="Token contract address"
          className="h-14 min-w-0 flex-1 bg-transparent px-4 font-mono text-[15px] text-bone placeholder:text-dim focus:outline-none"
        />
        <button type="submit" className="group/btn m-1.5 inline-flex items-center gap-2 bg-bone px-5 font-mono text-[12px] font-medium uppercase tracking-[0.1em] text-void hover:bg-white">
          Profile <ArrowRight />
        </button>
      </form>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[1fr_420px]">
        <div className="min-w-0">
          <AnimatePresence mode="wait">
            {!chain || !token ? (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Watched onPick={(c, a) => router.push(`/buy?chain=${c}&token=${a}`)} />
              </motion.div>
            ) : loading && !view ? (
              <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Profiling />
              </motion.div>
            ) : error && !view ? (
              <motion.div key="err" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <Notice tone={error.retry ? "ice" : "rug"}>
                  {error.retry ? "The explorer hasn't indexed this token yet. Retrying…" : error.message}
                </Notice>
              </motion.div>
            ) : view ? (
              <motion.div key={view.profile.address} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
                <TokenRisk v={view} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>

        <div className="lg:sticky lg:top-24">
          <Ticket view={view} usdcId={cfg?.config.usdc ?? null} capacity={cfg ? (BigInt(cfg.pool.available_usdc) * BigInt(cfg.config.max_token_exposure_bps)) / 10_000n : null} />
        </div>
      </div>
    </div>
  );
}

function Profiling() {
  const lines = ["reading token metadata", "finding the deployer", "ranking top holders", "snapshotting balances", "pricing rug odds"];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => Math.min(lines.length - 1, x + 1)), 650);
    return () => clearInterval(t);
  }, [lines.length]);
  return (
    <Panel className="relative overflow-hidden p-8">
      <div aria-hidden className="absolute inset-0 animate-pulse bg-dither opacity-[0.08]" />
      <div className="relative space-y-3 font-mono text-[14px]">
        {lines.map((l, j) => (
          <div key={l} className={j < i ? "text-slate" : j === i ? "text-bone" : "text-line-strong"}>
            {j < i ? "✓" : j === i ? "›" : "·"} {l}
            {j === i && <span className="ml-1 inline-block h-3.5 w-2 animate-blink bg-safu align-middle" />}
          </div>
        ))}
      </div>
    </Panel>
  );
}

interface WatchedRow {
  watch: { token_chain: string; token_addr: string; registered_at_ms: number; insiders: unknown[] };
  active_policies: number;
  exposure_usdc: string;
  open_report_id: number | null;
}

function Watched({ onPick }: { onPick: (chain: string, addr: string) => void }) {
  const { data } = useApi(() => viewCall<WatchedRow[]>(CONTRACT, "list_watched", { limit: 30 }), []);
  return (
    <Panel>
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">currently watched</div>
        <span className="flex items-center gap-2 font-mono text-[11px] text-dim">
          <Dot tone="safu" pulse /> live
        </span>
      </div>
      {!data && (
        <div className="space-y-px p-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-14 animate-pulse bg-line/50" />
          ))}
        </div>
      )}
      {data && data.length === 0 && <div className="p-6 text-sm text-slate">No coins under cover right now. Paste one above to price it.</div>}
      <ul className="divide-y divide-line">
        {data?.map((w) => (
          <li key={`${w.watch.token_chain}:${w.watch.token_addr}`}>
            <button
              onClick={() => onPick(w.watch.token_chain, w.watch.token_addr)}
              className="group grid w-full grid-cols-[1fr_auto] items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-white/[0.02]"
            >
              <span className="min-w-0">
                <span className="block truncate font-mono text-[14px] text-bone">{w.watch.token_addr}</span>
                <span className="mt-0.5 block font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
                  {chainLabel(w.watch.token_chain)} · {1 + w.watch.insiders.length} wallets watched
                </span>
              </span>
              <span className="flex items-center gap-4">
                {w.open_report_id !== null ? <Chip tone="rug">reported</Chip> : <Chip tone="dim">{w.active_policies} policies</Chip>}
                <span className="font-mono text-[13px] text-ice">{fmtUsd(usdc(w.exposure_usdc))}</span>
                <span className="text-slate transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ───────────────────────── the cover ticket ─────────────────────────

type Stage = { k: "idle" } | { k: "quoting" } | { k: "quoted"; q: CoverQuote } | { k: "paying"; q: CoverQuote } | { k: "confirming" } | { k: "done"; policyId: number | null; hash?: string } | { k: "error"; msg: string };

function Ticket({ view, usdcId, capacity }: { view: TokenView | null; usdcId: string | null; capacity: bigint | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const { accountId, connect, call, ready } = useWallet();
  const [amount, setAmount] = useState("25");
  const [destId, setDestId] = useState("near");
  const [recipient, setRecipient] = useState("");
  const [stage, setStage] = useState<Stage>({ k: "idle" });
  const [balance, setBalance] = useState<string | null>(null);
  const now = useNow(1000);
  const dest = DESTS.find((d) => d.id === destId)!;

  useEffect(() => {
    if (dest.addr === "near" && accountId && !recipient) setRecipient(accountId);
  }, [accountId, dest.addr, recipient]);

  useEffect(() => {
    if (accountId && usdcId) ftBalance(usdcId, accountId).then(setBalance);
  }, [accountId, usdcId, stage.k]);

  // returning from a redirect wallet: ?transactionHashes=…
  useEffect(() => {
    const h = params.get("transactionHashes");
    if (!h || !accountId) return;
    setStage({ k: "confirming" });
    txOutcome(h.split(",").pop()!, accountId)
      .then((o) => setStage({ k: "done", policyId: policyIdFrom(o as never), hash: h }))
      .catch((e) => setStage({ k: "error", msg: e.message }));
  }, [params, accountId]);

  // reset the quote whenever inputs change
  useEffect(() => {
    setStage((s) => (s.k === "quoted" ? { k: "idle" } : s));
  }, [amount, destId, recipient, view?.profile.address]);

  const bps = view?.risk.premiumBps ?? 0;
  const coverNum = Number(amount) || 0;
  const coverBase = BigInt(Math.round(coverNum * 1e6));
  const premium = (coverNum * bps) / 10_000;
  const roomUsd = capacity !== null && view ? usdc(capacity - BigInt(view.onchain.exposure_usdc)) : null;
  const overCap = roomUsd !== null && coverNum > roomUsd;

  // start each coin at a cover size the pool can actually take
  const coinKey = view?.onchain.token_key;
  useEffect(() => {
    if (roomUsd !== null && roomUsd > 0 && Number(amount) > roomUsd) setAmount(String(Math.floor(roomUsd * 100) / 100));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinKey, roomUsd !== null]);
  const rugged = view && (view.onchain.rugged_report_id !== null || view.onchain.open_report_id !== null);
  const validRecipient = dest.addr === "near" ? /^[a-z0-9._-]{2,64}$/.test(recipient) : /^0x[0-9a-fA-F]{40}$/.test(recipient);
  const insufficient = balance !== null && stage.k === "quoted" && BigInt(balance) < BigInt(stage.q.quote.premium_usdc);

  const quote = async () => {
    if (!view || !accountId || !usdcId) return;
    setStage({ k: "quoting" });
    try {
      const q = await api.coverQuote({
        token_chain: view.profile.chain,
        token_addr: view.profile.address,
        cover_usdc: coverBase.toString(),
        payout_chain: dest.chain,
        payout_asset: dest.asset(usdcId),
        recipient,
        payer: accountId,
      });
      setStage({ k: "quoted", q });
    } catch (e) {
      setStage({ k: "error", msg: e instanceof ApiError ? e.message : (e as Error).message });
    }
  };

  const pay = async (q: CoverQuote) => {
    setStage({ k: "paying", q });
    try {
      const out = await call({ receiverId: q.pay.receiver_id, method: q.pay.method, args: q.pay.args, gasTgas: q.pay.gas_tgas, depositYocto: q.pay.deposit_yocto });
      if (!out) return; // redirect wallet: we'll resume from ?transactionHashes
      const id = policyIdFrom(out as never);
      setStage({ k: "done", policyId: id, hash: (out as { transaction?: { hash?: string } }).transaction?.hash });
      if (id !== null) setTimeout(() => router.push(`/cover/${id}`), 1600);
    } catch (e) {
      setStage({ k: "error", msg: (e as Error).message || "transaction rejected" });
    }
  };

  const quoteLeft = stage.k === "quoted" ? stage.q.quote.quote_expires_at_ms - now : 0;

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">cover ticket</div>
        <Chip tone={NETWORK === "testnet" ? "ice" : "safu"}>{NETWORK}</Chip>
      </div>

      <div className="space-y-6 p-6">
        <div>
          <label htmlFor="cover-amt" className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">
            cover amount
          </label>
          <div className="mt-2 flex items-center border border-line-strong bg-ink focus-within:border-safu">
            <span className="pl-4 font-mono text-xl text-dim">$</span>
            <input
              id="cover-amt"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              className="h-14 min-w-0 flex-1 bg-transparent px-2 font-mono text-2xl text-bone tabular focus:outline-none"
            />
            <span className="pr-4 font-mono text-[12px] text-dim">USDC</span>
          </div>
          <div className="mt-2 flex gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setAmount(String(p))}
                className={`flex-1 border py-1.5 font-mono text-[12px] transition-colors ${Number(amount) === p ? "border-safu text-safu" : "border-line text-slate hover:border-line-strong hover:text-bone"}`}
              >
                ${p}
              </button>
            ))}
          </div>
          {roomUsd !== null && <div className={`mt-2 font-mono text-[11px] ${overCap ? "text-rug" : "text-dim"}`}>capacity left on this coin: {fmtUsd(Math.max(0, roomUsd))}</div>}
        </div>

        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">get paid on</div>
          <div className="mt-2 grid gap-2">
            {DESTS.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDestId(d.id);
                  setRecipient(d.addr === "near" ? (accountId ?? "") : "");
                }}
                className={`flex items-center justify-between border px-4 py-3 text-left transition-colors ${destId === d.id ? "border-safu bg-safu/[0.06]" : "border-line hover:border-line-strong"}`}
              >
                <span>
                  <span className="block text-sm text-bone">{d.label}</span>
                  <span className="block font-mono text-[11px] text-dim">{d.rail}</span>
                </span>
                <span className={`h-3 w-3 border ${destId === d.id ? "border-safu bg-safu" : "border-line-strong"}`} />
              </button>
            ))}
            <div className="border border-dashed border-line px-4 py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate">any chain via NEAR Intents</span>
                <Chip tone="dim">mainnet</Chip>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {INTENTS_PREVIEW.map((c) => (
                  <span key={c} className="font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
                    {chainLabel(c)} ·
                  </span>
                ))}
                <span className="font-mono text-[10px] text-dim">+120 assets</span>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="recipient" className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">
            recipient on {chainLabel(dest.chain)}
          </label>
          <input
            id="recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value.trim())}
            placeholder={dest.addr === "near" ? "you.testnet" : "0x…"}
            spellCheck={false}
            className={`mt-2 h-12 w-full border bg-ink px-4 font-mono text-[14px] text-bone placeholder:text-dim focus:outline-none ${recipient && !validRecipient ? "border-rug" : "border-line-strong focus:border-safu"}`}
          />
        </div>

        <dl className="space-y-2.5 border-t border-dashed border-line-strong pt-5 font-mono text-[13px]">
          <Line k="rug odds" v={view ? `${view.risk.rugOddsPct.toFixed(1)}%` : "-"} />
          <Line k="premium rate" v={view ? `${(bps / 100).toFixed(2)}%` : "-"} />
          <Line k="max payout (80%)" v={fmtUsd(coverNum * 0.8)} />
          <Line k="window" v="7 days from purchase" />
          <div className="flex items-baseline justify-between border-t border-line pt-3">
            <dt className="text-ice">you pay</dt>
            <dd className="font-display text-2xl text-bone">{view ? fmtUsd(premium, { digits: 2 }) : "-"}</dd>
          </div>
          {accountId && balance !== null && (
            <div className="text-right text-[11px] text-dim">
              balance {fmtUsd(usdc(balance), { digits: 2 })} USDC
            </div>
          )}
        </dl>

        <AnimatePresence mode="wait">
          {stage.k === "error" && (
            <motion.div key="e" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <Notice tone="rug">{stage.msg}</Notice>
            </motion.div>
          )}
          {stage.k === "quoted" && (
            <motion.div key="q" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              <Notice tone="safu">
                Quote signed by the safu API · {stage.q.watch === "registered" ? "insider snapshot written on-chain" : "insider snapshot already locked"} · valid {countdown(quoteLeft)}
              </Notice>
            </motion.div>
          )}
          {stage.k === "done" && (
            <motion.div key="d" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
              <Notice tone="safu">
                Funds are safu. {stage.policyId !== null ? <Link href={`/cover/${stage.policyId}`} className="underline">Policy #{stage.policyId} →</Link> : "Policy created."}
              </Notice>
            </motion.div>
          )}
        </AnimatePresence>

        {!accountId ? (
          <Button className="w-full" size="lg" onClick={connect} disabled={!ready}>
            Connect NEAR wallet
          </Button>
        ) : stage.k === "quoted" && quoteLeft > 0 ? (
          <Button className="w-full" size="lg" onClick={() => pay(stage.q)} disabled={insufficient}>
            {insufficient ? "Not enough USDC" : `Pay ${fmtUsd(usdc(stage.q.quote.premium_usdc), { digits: 2 })} · buy safu`} <ArrowRight />
          </Button>
        ) : (
          <Button
            className="w-full"
            size="lg"
            onClick={quote}
            disabled={!view || !usdcId || coverNum <= 0 || overCap || !validRecipient || Boolean(rugged) || ["quoting", "paying", "confirming"].includes(stage.k)}
          >
            {stage.k === "quoting" ? "Snapshotting insiders…" : stage.k === "paying" ? "Confirm in wallet…" : stage.k === "confirming" ? "Confirming…" : rugged ? "Coin already reported" : "Get signed quote"}
            {stage.k === "idle" || stage.k === "error" ? <ArrowRight /> : null}
          </Button>
        )}
        <p className="text-center font-mono text-[11px] leading-relaxed text-dim">
          Premium is paid in USDC with one ft_transfer_call. If any check fails on-chain, NEP-141 refunds you in full.
        </p>
      </div>
    </Panel>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-dim">{k}</dt>
      <dd className="text-ice">{v}</dd>
    </div>
  );
}

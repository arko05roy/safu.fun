"use client";

import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Reveal, Tilt } from "@/components/fx";
import { Addr, ArrowRight, Button, Chip, Corners, Dot, Eyebrow, Notice, Panel } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { api, CONTRACT, explorer, fmtCompact, fmtUsd, type UnoLaunch, units, usdc } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { viewCall } from "@/lib/near";

export default function LaunchClient() {
  const { data: launches, reload } = useApi(() => api.uno(), [], 20_000);

  return (
    <div>
      <section className="relative isolate overflow-hidden border-b border-line pb-20 pt-36">
        <div aria-hidden className="absolute inset-0 -z-10 bg-dither opacity-[0.14]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-r from-void via-void/90 to-void/40" />
        <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-[1320px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <Eyebrow tone="safu">uno reverse launches</Eyebrow>
            <h1 className="mt-5 font-display text-[clamp(2.6rem,6.5vw,5.4rem)] leading-[0.95] text-bone">
              prove you
              <br />
              can&apos;t rug.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-ice">
              Your liquidity and dev bag live in an account controlled by the safu contract. You can&apos;t touch it, and neither can we. Holders get 1% cover instead of 7%. If insiders dump anyway, the contract reverses the launch.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Button href="#create">
                Launch a coin <ArrowRight />
              </Button>
              <Button href="#launches" variant="outline">
                {launches ? `${launches.length} launches` : "Launches"}
              </Button>
            </div>
          </div>
          <Tilt max={10} className="hidden lg:block">
            <Panel className="p-7">
              <Corners className="border-safu" />
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">custodian</div>
              <div className="mt-3 break-all font-mono text-[15px] text-safu">{CONTRACT}</div>
              <div className="mt-1 font-mono text-[11px] text-dim">on other chains: chain-signatures address · path uno-&lt;id&gt;</div>
              <div className="my-7 border-t border-dashed border-line-strong" />
              <div className="font-display text-2xl leading-tight text-bone">
                you can&apos;t touch this.
                <br />
                <span className="text-slate">neither can we.</span>
              </div>
            </Panel>
          </Tilt>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-4">
          {[
            ["lock", "Your dev allocation goes into the contract and unlocks in tranches, e.g. 10% a week."],
            ["seed", "Seed a constant-product pool owned by the contract. Nobody can pull the LP."],
            ["trade", "Holders buy and sell against the pool and get cover at a fixed 1%."],
            ["reverse", "On a finalized rug: pool frozen, holders refunded pro-rata, your locked bag burned."],
          ].map(([k, v], i) => (
            <Reveal key={k} delay={i * 0.06}>
              <div className="h-full border-t-2 border-line-strong pt-5 transition-colors hover:border-safu">
                <div className="font-mono text-[11px] text-dim">0{i + 1}</div>
                <div className={`mt-3 font-display text-2xl ${i === 3 ? "text-rug" : "text-bone"}`}>{k}</div>
                <p className="mt-3 text-sm leading-relaxed text-slate">{v}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="create" className="mx-auto max-w-[1320px] scroll-mt-24 px-4 sm:px-6">
        <Wizard launches={launches ?? []} onChange={reload} />
      </section>

      <section id="launches" className="mx-auto max-w-[1320px] scroll-mt-24 px-4 pt-24 sm:px-6">
        <Eyebrow>launches</Eyebrow>
        <h2 className="mt-4 font-display text-3xl text-bone sm:text-4xl">on the record.</h2>
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          {!launches && <div className="h-72 animate-pulse border border-line bg-panel" />}
          {launches?.length === 0 && <div className="font-mono text-slate">No launches yet. Be the first dev who can prove it.</div>}
          {launches
            ?.slice()
            .reverse()
            .map((l) => (
              <Reveal key={l.id}>
                <LaunchCard l={l} />
              </Reveal>
            ))}
        </div>
      </section>
    </div>
  );
}

function LaunchCard({ l }: { l: UnoLaunch }) {
  const now = useNow(5000);
  const [open, setOpen] = useState(false);
  const { data: detail } = useApi(open ? () => api.unoOne(l.id) : null, [open, l.id]);
  const reversed = typeof l.status === "object";
  const alloc = units(l.dev_alloc, 18);
  const claimed = units(l.dev_claimed, 18);
  const periods = l.locked_at_ms ? Math.floor((now - l.locked_at_ms) / l.period_ms) : 0;
  const vestedPct = Math.min(100, (periods * l.tranche_bps) / 100);
  const segs = Math.min(50, Math.ceil(10000 / l.tranche_bps));

  return (
    <Panel className={`overflow-hidden ${reversed ? "border-rug/40" : ""}`}>
      {reversed && <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-flames opacity-[0.1] [mask-image:linear-gradient(to_bottom,black,transparent)]" />}
      <div className="relative p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-dim">#{l.id}</span>
            {reversed ? (
              <Chip tone="rug">⟲ uno reverse&apos;d · report #{(l.status as { Reversed: { report_id: number } }).Reversed.report_id}</Chip>
            ) : (
              <Chip tone="safu">
                <Dot tone="safu" pulse /> live · 1% cover
              </Chip>
            )}
          </div>
          <span className="font-mono text-[11px] text-dim">{new Date(l.created_at_ms).toLocaleDateString()}</span>
        </div>
        <div className="mt-6 grid gap-2 font-mono text-[13px]">
          <div className="flex justify-between gap-4">
            <span className="text-dim">coin</span>
            <Addr value={l.token} href={explorer.nearAccount(l.token)} />
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-dim">dev</span>
            <Addr value={l.dev} href={explorer.nearAccount(l.dev)} />
          </div>
        </div>

        {reversed ? (
          <div className="mt-6 grid grid-cols-3 gap-4 border-t border-line pt-5">
            <Mini label="refund pot" value={fmtUsd(usdc(l.refund_pot_usdc), { digits: 2 })} tone="safu" />
            <Mini label="refunded" value={fmtUsd(usdc(l.refunds_paid_usdc), { digits: 2 })} />
            <Mini label="burned" value={fmtCompact(units(l.burned_token, 18))} tone="rug" />
          </div>
        ) : (
          <div className="mt-6 space-y-5 border-t border-line pt-5">
            <div className="grid grid-cols-3 gap-4">
              <Mini label="pool USDC" value={fmtUsd(usdc(l.pool_usdc), { digits: 2 })} />
              <Mini label="pool coin" value={fmtCompact(units(l.pool_token, 18))} />
              <Mini label="dev locked" value={fmtCompact(alloc - claimed)} tone="safu" />
            </div>
            <div>
              <div className="flex justify-between font-mono text-[11px] text-dim">
                <span>
                  vesting · {l.tranche_bps / 100}% every {fmtPeriod(l.period_ms)}
                </span>
                <span>{vestedPct.toFixed(0)}%</span>
              </div>
              <div className="mt-1.5 flex h-2 gap-[2px]">
                {Array.from({ length: segs }, (_, i) => (
                  <span key={i} className={`flex-1 ${(i + 1) / segs <= vestedPct / 100 ? "bg-safu" : "bg-line"}`} />
                ))}
              </div>
            </div>
          </div>
        )}

        {reversed && (
          <button onClick={() => setOpen((o) => !o)} className="mt-5 font-mono text-[12px] text-slate hover:text-bone">
            {open ? "hide" : "show"} refund snapshot {open ? "↑" : "↓"}
          </button>
        )}
        <AnimatePresence>
          {open && (
            <motion.ul initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mt-3 overflow-hidden border border-line">
              {!detail && <li className="p-3 font-mono text-[12px] text-dim">loading…</li>}
              {detail?.snapshot.map((h) => {
                const share = Number(BigInt(h.amount) * 10000n / (BigInt(detail.launch.snapshot_total) || 1n)) / 100;
                return (
                  <li key={h.account_id} className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 font-mono text-[12px] last:border-0">
                    <span className="truncate text-ice">{h.account_id}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-dim">{share.toFixed(1)}%</span>
                      <span className={h.paid ? "text-safu" : "text-slate"}>{fmtUsd((usdc(detail.launch.refund_pot_usdc) * share) / 100, { digits: 4 })}</span>
                    </span>
                  </li>
                );
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </Panel>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "safu" | "rug" }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">{label}</div>
      <div className={`mt-1 font-mono text-[15px] ${tone === "safu" ? "text-safu" : tone === "rug" ? "text-rug" : "text-bone"}`}>{value}</div>
    </div>
  );
}

const fmtPeriod = (ms: number) => (ms >= 86_400_000 ? `${Math.round(ms / 86_400_000)}d` : ms >= 3_600_000 ? `${Math.round(ms / 3_600_000)}h` : `${Math.round(ms / 1000)}s`);

// ───────────────────────── dev wizard: state = on-chain launch ─────────────────────────

const PERIODS = [
  ["1 week", 7 * 86_400_000],
  ["1 day", 86_400_000],
  ["1 hour", 3_600_000],
] as const;

function toBase(n: string, dec: number) {
  const [i, f = ""] = n.split(".");
  return (BigInt(i || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0")).toString();
}

function Wizard({ launches, onChange }: { launches: UnoLaunch[]; onChange: () => void }) {
  const { accountId, connect, call, ready } = useWallet();
  const [token, setToken] = useState("");
  const [tranche, setTranche] = useState(10);
  const [period, setPeriod] = useState<number>(PERIODS[0][1]);
  const [alloc, setAlloc] = useState("");
  const [seedCoin, setSeedCoin] = useState("");
  const [seedUsdc, setSeedUsdc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { data: cfg } = useApi(() => api.config(), []);
  const { data: meta } = useApi(token.endsWith(".testnet") || token.endsWith(".near") ? () => viewCall<{ symbol: string; decimals: number }>(token, "ft_metadata") : null, [token]);
  const launch = launches.find((l) => l.token === token) ?? null;
  const mineLaunch = launch && launch.dev === accountId;

  const step = !launch ? 0 : launch.locked_at_ms === 0 ? 1 : BigInt(launch.pool_token) === 0n ? 2 : BigInt(launch.pool_usdc) === 0n ? 3 : 4;
  const dec = meta?.decimals ?? 18;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      setTimeout(onChange, 1500);
    } catch (e) {
      setErr((e as Error).message || "rejected");
    } finally {
      setBusy(false);
    }
  };

  const steps = [
    {
      title: "register the coin",
      body: "Creates the launch and registers the contract on your coin so it can hold the allocation and LP.",
      action: () => run(() => call({ receiverId: CONTRACT, method: "create_uno_launch", args: { token, tranche_bps: tranche * 100, period_ms: period }, gasTgas: 100 })),
      ok: Boolean(meta),
    },
    {
      title: "lock dev allocation",
      body: `Unlocks ${tranche}% every ${fmtPeriod(period)}. Burned if you rug.`,
      input: [alloc, setAlloc, meta?.symbol ?? "coin"] as const,
      action: () => run(() => call({ receiverId: token, method: "ft_transfer_call", args: { receiver_id: CONTRACT, amount: toBase(alloc, dec), msg: JSON.stringify({ uno_lock: launch!.id }) }, gasTgas: 100, depositYocto: "1" })),
      ok: Number(alloc) > 0,
    },
    {
      title: "seed the coin side",
      body: "Coin into the contract-owned pool.",
      input: [seedCoin, setSeedCoin, meta?.symbol ?? "coin"] as const,
      action: () => run(() => call({ receiverId: token, method: "ft_transfer_call", args: { receiver_id: CONTRACT, amount: toBase(seedCoin, dec), msg: JSON.stringify({ uno_seed: launch!.id }) }, gasTgas: 100, depositYocto: "1" })),
      ok: Number(seedCoin) > 0,
    },
    {
      title: "seed the USDC side",
      body: "USDC into the same pool. Trading opens when both sides are in.",
      input: [seedUsdc, setSeedUsdc, "USDC"] as const,
      action: () =>
        run(() => call({ receiverId: cfg!.config.usdc, method: "ft_transfer_call", args: { receiver_id: CONTRACT, amount: toBase(seedUsdc, 6), msg: JSON.stringify({ uno_seed: launch!.id }) }, gasTgas: 100, depositYocto: "1" })),
      ok: Number(seedUsdc) > 0 && Boolean(cfg),
    },
  ];

  return (
    <Panel className="overflow-hidden">
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[360px_1fr]">
        <div className="border-b border-line p-6 sm:p-8 lg:border-b-0 lg:border-r">
          <Eyebrow tone="safu">dev console</Eyebrow>
          <h2 className="mt-4 font-display text-3xl text-bone">launch with uno.</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate">Each step is one wallet transaction. Progress is read from the contract, so you can leave and come back.</p>

          <label htmlFor="uno-token" className="mt-8 block font-mono text-[11px] uppercase tracking-[0.16em] text-slate">
            coin (NEP-141 account)
          </label>
          <input
            id="uno-token"
            value={token}
            onChange={(e) => setToken(e.target.value.trim())}
            placeholder="mycoin.you.testnet"
            spellCheck={false}
            className="mt-2 h-12 w-full border border-line-strong bg-ink px-4 font-mono text-[14px] text-bone placeholder:text-dim focus:border-safu focus:outline-none"
          />
          {meta && <div className="mt-2 font-mono text-[12px] text-safu">✓ {meta.symbol} · {meta.decimals} decimals</div>}
          {launch && !mineLaunch && <div className="mt-2 font-mono text-[12px] text-rug">This coin already has a launch by {launch.dev}.</div>}

          <div className="mt-6 grid grid-cols-2 gap-3">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">tranche</div>
              <div className="mt-2 flex border border-line-strong">
                {[5, 10, 25].map((t) => (
                  <button key={t} disabled={step > 0} onClick={() => setTranche(t)} className={`h-10 flex-1 font-mono text-[12px] ${tranche === t ? "bg-safu text-void" : "text-slate hover:text-bone"}`}>
                    {t}%
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">every</div>
              <select
                value={period}
                disabled={step > 0}
                onChange={(e) => setPeriod(Number(e.target.value))}
                className="mt-2 h-10 w-full border border-line-strong bg-ink px-3 font-mono text-[12px] text-bone focus:border-safu focus:outline-none"
              >
                {PERIODS.map(([l, v]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-8">
          <ol className="space-y-3">
            {steps.map((s, i) => {
              const done = step > i;
              const current = step === i && (i === 0 || mineLaunch);
              return (
                <li key={s.title} className={`border p-5 transition-colors ${current ? "border-safu/60 bg-safu/[0.03]" : "border-line"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex gap-4">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center border font-mono text-[12px] ${done ? "border-safu bg-safu text-void" : current ? "border-safu text-safu" : "border-line-strong text-dim"}`}>
                        {done ? "✓" : i + 1}
                      </span>
                      <div>
                        <div className={`font-mono text-[13px] uppercase tracking-[0.12em] ${done || current ? "text-bone" : "text-dim"}`}>{s.title}</div>
                        <p className="mt-1 text-sm text-slate">{s.body}</p>
                      </div>
                    </div>
                  </div>
                  {current && (
                    <div className="mt-4 flex flex-wrap items-center gap-3 pl-11">
                      {"input" in s && s.input && (
                        <div className="flex h-11 min-w-0 flex-1 items-center border border-line-strong bg-ink focus-within:border-safu">
                          <input
                            inputMode="decimal"
                            value={s.input[0]}
                            onChange={(e) => s.input![1](e.target.value.replace(/[^0-9.]/g, ""))}
                            placeholder="0"
                            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-bone placeholder:text-dim focus:outline-none"
                          />
                          <span className="pr-3 font-mono text-[11px] text-dim">{s.input[2]}</span>
                        </div>
                      )}
                      {!accountId ? (
                        <Button size="sm" onClick={connect} disabled={!ready}>
                          Connect wallet
                        </Button>
                      ) : (
                        <Button size="sm" onClick={s.action} disabled={!s.ok || busy}>
                          {busy ? "Confirm in wallet…" : "Sign"} <ArrowRight />
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {step === 4 && mineLaunch && (
            <div className="mt-4">
              <Notice tone="safu">Launch #{launch!.id} is live. Your LP is held by the contract and your bag unlocks on schedule. Holders now get 1% cover.</Notice>
            </div>
          )}
          {err && (
            <div className="mt-4">
              <Notice tone="rug">{err}</Notice>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

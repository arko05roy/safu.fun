"use client";

import { motion } from "motion/react";
import { useState } from "react";
import { Reveal, Tick, Tilt } from "@/components/fx";
import { ArrowRight, Button, Chip, Eyebrow, Notice, Panel, Stat } from "@/components/ui";
import { useWallet } from "@/components/wallet";
import { api, CONTRACT, countdown, fmtCompact, fmtUsd, units, usdc } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { ftBalance } from "@/lib/near";

const SAFU_DEC = 18;
const toBase = (n: string) => {
  const [i, f = ""] = n.split(".");
  return (BigInt(i || "0") * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18) || "0")).toString();
};

export default function UnderwriteClient() {
  const { data: cfg } = useApi(() => api.config(), [], 20_000);
  const { data: st, reload: reloadSt } = useApi(() => api.staking(), [], 20_000);
  const staked = st ? units(st.total_staked_safu, SAFU_DEC) : 0;
  const burned = st ? units(st.total_burned_safu, SAFU_DEC) : 0;
  const supply = st?.safu_total_supply ? units(st.safu_total_supply, SAFU_DEC) : 0;
  const genesis = supply + burned;

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-28 sm:px-6">
      <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <Eyebrow>underwrite</Eyebrow>
          <h1 className="mt-4 font-display text-4xl leading-[1] text-bone sm:text-6xl">
            back the pool.
            <br />
            <span className="text-safu">earn the spread.</span>
          </h1>
        </div>
        <p className="max-w-lg leading-relaxed text-ice">
          Stakers earn {st ? st.staker_share_bps / 100 : 50}% of every premium in USDC. When a rug is finalized, the staked pot burns by the pool&apos;s loss ratio, capped at {st ? st.max_slash_bps / 100 : 50}% per rug. Unstaking unbonds past the dispute window, so nobody can dodge a pending report.
        </p>
      </div>

      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["pool capital", cfg ? usdc(cfg.pool.available_usdc) : 0, (n: number) => fmtUsd(n, { digits: 2 })],
          ["premiums earned", cfg ? usdc(cfg.pool.premiums_earned_usdc) : 0, (n: number) => fmtUsd(n, { digits: 4 })],
          ["paid to rugged holders", cfg ? usdc(cfg.pool.total_paid_out_usdc) : 0, (n: number) => fmtUsd(n, { digits: 2 })],
          ["$SAFU staked", staked, fmtCompact],
        ].map(([label, v, f]) => (
          <div key={label as string} className="bg-panel p-6">
            <Stat label={label as string}>
              <Tick value={v as number} format={f as (n: number) => string} />
            </Stat>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1fr_420px]">
        <Reveal>
          <Panel className="p-6 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">$SAFU supply</div>
                <div className="mt-2 font-display text-3xl text-bone">{fmtCompact(supply)}</div>
                <div className="mt-1 font-mono text-[12px] text-dim">of {fmtCompact(genesis)} minted</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-rug">burned by rugs</div>
                <div className="mt-2 font-display text-3xl text-rug">
                  <Tick value={burned} format={fmtCompact} />
                </div>
                <div className="mt-1 font-mono text-[12px] text-dim">{genesis ? ((burned / genesis) * 100).toFixed(2) : "0"}% of genesis</div>
              </div>
            </div>
            <BurnGrid ratio={genesis ? burned / genesis : 0} />
            <div className="mt-4 flex flex-wrap gap-5 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 bg-ice" /> circulating
              </span>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 bg-rug" /> burned by finalized rugs
              </span>
            </div>
          </Panel>
        </Reveal>

        <Reveal delay={0.08}>
          <StakeBox token={st?.safu_token ?? null} unbondMs={st?.unbond_ms ?? 0} onChange={reloadSt} />
        </Reveal>
      </div>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
        {[
          ["premium in", "Every cover premium splits: half to stakers in USDC, half to pool capital."],
          ["rug finalized", "Payouts queue at 80% of cover. The staked pot burns by payout ÷ pool capital."],
          ["unbond", "Unstaked $SAFU stays slashable while unbonding. The window outlasts any dispute window."],
        ].map(([k, v], i) => (
          <Reveal key={k} delay={i * 0.06}>
            <Tilt max={6} className="h-full">
              <Panel className="h-full p-6">
                <div className="font-mono text-[11px] text-dim">0{i + 1}</div>
                <div className="mt-4 font-display text-xl text-bone">{k}</div>
                <p className="mt-3 text-sm leading-relaxed text-slate">{v}</p>
              </Panel>
            </Tilt>
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/** 400 pixels of supply; burned ones flash red in a dithered order. */
function BurnGrid({ ratio }: { ratio: number }) {
  const N = 400;
  const burned = Math.round(ratio * N);
  // deterministic scatter so burns look dithered, not a block
  const rnd = (i: number) => {
    const s = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const order = Array.from({ length: N }, (_, i) => i).sort((a, b) => rnd(a) - rnd(b));
  const burnedSet = new Set(order.slice(0, burned));
  return (
    <div className="mt-8 grid grid-cols-[repeat(40,minmax(0,1fr))] gap-[2px]" aria-label={`${(ratio * 100).toFixed(1)}% burned`}>
      {Array.from({ length: N }, (_, i) => (
        <motion.span
          key={i}
          className={`aspect-square ${burnedSet.has(i) ? "bg-rug" : "bg-ice/25"}`}
          initial={{ opacity: 0, scale: 0.4 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ delay: ((i * 37) % N) / N * 0.8, duration: 0.25 }}
        />
      ))}
    </div>
  );
}

function StakeBox({ token, unbondMs, onChange }: { token: string | null; unbondMs: number; onChange: () => void }) {
  const { accountId, connect, call, ready } = useWallet();
  const now = useNow(1000);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "safu" | "rug"; text: string } | null>(null);
  const { data: bal, reload: reloadBal } = useApi(accountId && token ? () => ftBalance(token, accountId) : null, [accountId, token]);
  const { data: me, reload: reloadMe, error: meErr } = useApi(accountId ? () => api.stake(accountId) : null, [accountId], 15_000);
  const mine = meErr?.status === 404 ? null : me;

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "safu", text: `${label} confirmed.` });
      setAmount("");
      reloadBal();
      reloadMe();
      onChange();
    } catch (e) {
      setMsg({ tone: "rug", text: (e as Error).message || "rejected" });
    } finally {
      setBusy(null);
    }
  };

  const releaseLeft = mine ? mine.release_at_ms - now : 0;
  const hasUnbonding = mine && BigInt(mine.unbonding_shares) > 0n;

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-6 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">your position</div>
        {mine ? <Chip tone="safu">underwriter</Chip> : <Chip tone="dim">not staked</Chip>}
      </div>
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-4">
          <Stat label="staked">{mine ? fmtCompact(units(mine.staked_safu, SAFU_DEC)) : "0"}</Stat>
          <Stat label="claimable">{mine ? fmtUsd(usdc(mine.claimable_usdc), { digits: 4 }) : "$0"}</Stat>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="stake-amt" className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">
              stake $SAFU
            </label>
            {bal && (
              <button className="font-mono text-[11px] text-dim hover:text-bone" onClick={() => setAmount(String(units(bal, SAFU_DEC)))}>
                wallet {fmtCompact(units(bal, SAFU_DEC))} · max
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center border border-line-strong bg-ink focus-within:border-safu">
            <input
              id="stake-amt"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              className="h-12 min-w-0 flex-1 bg-transparent px-4 font-mono text-xl text-bone tabular placeholder:text-dim focus:outline-none"
            />
            <span className="pr-4 font-mono text-[12px] text-dim">SAFU</span>
          </div>
        </div>

        {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}

        {!accountId ? (
          <Button className="w-full" onClick={connect} disabled={!ready}>
            Connect NEAR wallet
          </Button>
        ) : (
          <div className="space-y-2">
            <Button
              className="w-full"
              disabled={!token || !amount || Number(amount) < 1 || busy !== null}
              onClick={() =>
                run("Stake", () => call({ receiverId: token!, method: "ft_transfer_call", args: { receiver_id: CONTRACT, amount: toBase(amount), msg: "stake" }, gasTgas: 100, depositYocto: "1" }))
              }
            >
              {busy === "Stake" ? "Confirm in wallet…" : "Stake"} <ArrowRight />
            </Button>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" disabled={!mine || BigInt(mine.claimable_usdc) === 0n || busy !== null} onClick={() => run("Claim", () => call({ receiverId: CONTRACT, method: "claim_rewards", args: {}, gasTgas: 100 }))}>
                Claim USDC
              </Button>
              {hasUnbonding ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={releaseLeft > 0 || busy !== null}
                  onClick={() => run("Withdraw", () => call({ receiverId: CONTRACT, method: "withdraw_unstaked", args: {}, gasTgas: 100 }))}
                >
                  {releaseLeft > 0 ? countdown(releaseLeft) : "Withdraw"}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!mine || BigInt(mine.active_shares) === 0n || busy !== null}
                  onClick={() => run("Unstake", () => call({ receiverId: CONTRACT, method: "request_unstake", args: {}, gasTgas: 30 }))}
                >
                  Unstake
                </Button>
              )}
            </div>
          </div>
        )}
        <p className="font-mono text-[11px] leading-relaxed text-dim">Min stake 1 $SAFU. Unbonding takes {Math.round(unbondMs / 1000)}s on testnet and stays slashable until withdrawn.</p>
      </div>
    </Panel>
  );
}

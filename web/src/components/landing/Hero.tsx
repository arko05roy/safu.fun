"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useState } from "react";
import { api, ago, chainLabel, fmtUsd, splitTokenKey, usdc } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { Tilt } from "../fx";
import { ArrowRight, Chip, Corners, Dot } from "../ui";

const FlameField = dynamic(() => import("../three/FlameField"), { ssr: false });

export function parseTokenInput(raw: string): { chain: string; addr: string } | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(":") && !s.startsWith("0x")) {
    const { chain, addr } = splitTokenKey(s);
    return { chain, addr };
  }
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { chain: "base-sepolia", addr: s };
  if (/\.(testnet|near)$/.test(s)) return { chain: "near", addr: s };
  return { chain: "near", addr: s };
}

const EXAMPLE = "moon.safudemo-81cf1a.testnet";

export function Hero() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const go = (v = value) => {
    const t = parseTokenInput(v || EXAMPLE);
    if (t) router.push(`/buy?chain=${encodeURIComponent(t.chain)}&token=${encodeURIComponent(t.addr)}`);
  };

  return (
    <section className="relative isolate min-h-[100svh] overflow-hidden pt-16">
      <FlameField className="absolute inset-0 -z-10 opacity-90" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_25%_40%,rgb(10_10_10/0.92),rgb(10_10_10/0.55)_55%,transparent)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-56 bg-gradient-to-t from-void to-transparent" />
      <div aria-hidden className="absolute inset-0 -z-10 scanlines opacity-40" />

      <div className="mx-auto grid grid-cols-[minmax(0,1fr)] min-h-[calc(100svh-4rem)] max-w-[1320px] items-center gap-14 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1fr_340px]">
        <div>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="flex flex-wrap items-center gap-2">
            <Chip tone="safu">
              <Dot tone="safu" pulse /> cover live on testnet
            </Chip>
            <Chip tone="dim">near intents · chain signatures</Chip>
          </motion.div>

          <h1 className="mt-8 font-display text-[clamp(2.3rem,4.6vw,4.6rem)] leading-[0.92] tracking-[-0.02em] text-bone">
            {["buy any memecoin.", "if it rugs,", "you get paid."].map((line, i) => (
              <span key={line} className="block overflow-hidden pb-[0.06em]">
                <motion.span
                  className={`block ${i === 2 ? "text-safu" : ""}`}
                  initial={{ y: "105%" }}
                  animate={{ y: 0 }}
                  transition={{ duration: 0.9, delay: 0.1 + i * 0.12, ease: [0.16, 1, 0.3, 1] }}
                >
                  {line}
                </motion.span>
              </span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.8 }}
            className="mt-7 max-w-xl text-[17px] leading-relaxed text-ice"
          >
            Rug cover for any token on any chain. A watcher tracks the deployer and insiders for 7 days. If they dump, a NEAR contract pays you back, on the chain and in the asset you choose.
          </motion.p>

          <motion.form
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
            className="relative mt-10 max-w-2xl"
          >
            <div className="relative flex items-stretch border border-line-strong bg-ink/80 backdrop-blur-md transition-colors focus-within:border-safu">
              <Corners className="border-safu" />
              <span className="hidden items-center pl-5 font-mono text-sm text-slate sm:flex">CA&gt;</span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="paste any memecoin contract address"
                spellCheck={false}
                autoComplete="off"
                aria-label="Token contract address"
                className="h-16 min-w-0 flex-1 bg-transparent px-4 font-mono text-[15px] text-bone placeholder:text-dim focus:outline-none"
              />
              <button type="submit" className="group/btn m-2 inline-flex items-center gap-2 bg-safu px-5 font-mono text-[13px] font-medium uppercase tracking-[0.1em] text-void transition-colors hover:bg-[#d6ff70]">
                <span className="hidden sm:inline">Check odds</span>
                <ArrowRight />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[12px] text-dim">
              <span>try</span>
              <button type="button" onClick={() => go(EXAMPLE)} className="text-slate underline decoration-line-strong underline-offset-4 hover:text-bone">
                MOON (near testnet)
              </button>
              <span className="hidden sm:inline">·</span>
              <span className="hidden sm:inline">EVM 0x… · NEAR account · chain:address</span>
            </div>
          </motion.form>
        </div>

        <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9, duration: 1, ease: [0.16, 1, 0.3, 1] }} className="hidden lg:block">
          <LastRugCard />
        </motion.div>
      </div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4 }} className="absolute bottom-8 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-dim">
        <span className="flex flex-col items-center gap-2">
          scroll
          <span className="block h-8 w-px animate-pulse bg-gradient-to-b from-slate to-transparent" />
        </span>
      </motion.div>
    </section>
  );
}

/** The most recent caught rug as a tilting 3D receipt. */
function LastRugCard() {
  const { data: wall } = useApi(() => api.wall(), []);
  const r = wall?.[0];
  const { addr, chain } = r ? splitTokenKey(r.token_key) : { addr: "—", chain: "near" };
  return (
    <Tilt max={12} className="ml-auto max-w-sm">
      <div className="relative overflow-hidden border border-line-strong bg-ink/90 p-6 backdrop-blur-xl" style={{ transform: "translateZ(0)" }}>
        <Corners className="border-rug" />
        <div aria-hidden className="absolute -right-10 -top-10 h-48 w-48 bg-flames opacity-25 [mask-image:radial-gradient(circle,black,transparent_70%)]" />
        <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.2em]">
          <span className="text-rug">● rugged</span>
          <span className="text-dim">{r ? ago(r.reported_at_ms) : "…"}</span>
        </div>
        <div className="mt-6 font-display text-3xl leading-none text-bone" style={{ transform: "translateZ(40px)" }}>
          {r ? fmtUsd(usdc(r.total_payout_usdc)) : "$—"}
        </div>
        <div className="mt-2 font-mono text-[12px] text-slate">paid back to holders</div>
        <div className="mt-6 space-y-2.5 border-t border-dashed border-line-strong pt-5 font-mono text-[12px]">
          <Row k="token" v={addr.length > 28 ? `${addr.slice(0, 26)}…` : addr} />
          <Row k="chain" v={chainLabel(chain)} />
          <Row k="rule" v={r ? `${r.rule} · deployer dumped` : "—"} />
          <Row k="payouts" v={r ? `${r.payout_ids.length}` : "—"} />
        </div>
        <div className="mt-6 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-safu">
          <span className="inline-block h-1.5 w-1.5 bg-safu" /> the rug got rugged
        </div>
      </div>
    </Tilt>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-dim">{k}</span>
      <span className="truncate text-ice">{v}</span>
    </div>
  );
}

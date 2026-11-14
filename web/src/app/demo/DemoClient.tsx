"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { PixelMeter } from "@/components/landing/Sections";
import { Mascot, type Phase } from "@/components/landing/Mascot";
import { ArrowRight, Button, Chip, Corners, Panel } from "@/components/ui";
import { api, explorer, fmtUsd, usdc } from "@/lib/api";
import { useApi } from "@/lib/hooks";

const PixelScene = dynamic(() => import("@/components/landing/PixelScene"), { ssr: false });

/**
 * A replay of one real end-to-end testnet run (rug report #6, UNO launch #0),
 * so anyone can see the whole product in ~90 seconds without a wallet. Every
 * number below is from the chain; every step links to its proof.
 */
const RUN = {
  coin: "coin-1d3483.rugdev-9a21e0.testnet",
  symbol: "PEPERUG",
  dev: "rugdev-9a21e0.testnet",
  insider: "insider-1d3483.rugdev-9a21e0.testnet",
  buyer: "buyer.safudemo-81cf1a.testnet",
  evmRecipient: "0x7A69e5aBa08eAC068A45ddf9E1818c7d89518d0d",
  dumpTxs: ["AXqxuXQbfkUkoZqCBZqUg3GMkAVFj9C8uVRCb9VHMkZq", "8tzNk8TUGTcjnNF3uTAbBHtcKA9uqywkkN8sqMzYiHNS"],
  mpcTx: "0x3cb5c012e61c5eee9a81a63284d9fdebb475a75bf853de844c5aae7b565ec145",
  uno: { token: "uno-5051ac.rugdev-28a8de.testnet", dev: "rugdev-28a8de.testnet", reverseTx: "DGuQSzVrGZNJQjLVY6Bd9Q8BGZZUN1QjWqwe6Az72SvB" },
};

type Proof = { label: string; href: string };
type Step = {
  key: string;
  label: string;
  title: string;
  body: string;
  say: string;
  phase?: Phase;
  ms: number;
  proof?: Proof[];
  Stage: () => React.ReactNode;
};

const STEPS: Step[] = [
  {
    key: "intro",
    label: "Rugged",
    title: "everyone's been rugged.",
    body: "Millions of memecoins died in a single quarter. Holders get nothing back. safu.fun sells cover on any coin, on any chain, and pays out when the dev dumps.",
    say: "this is a replay of a real testnet run. watch.",
    ms: 7000,
    Stage: StageIntro,
  },
  {
    key: "profile",
    label: "Profile",
    title: "paste a coin.",
    body: "We profile PEPERUG on NEAR testnet: the deployer holds 80% of supply, the coin is hours old, three holders. The public price of that risk: 82% rug odds.",
    say: "deployer holds 80%. yeah, I'm watching this one.",
    ms: 8500,
    proof: [{ label: "PEPERUG on nearblocks", href: explorer.nearAccount(RUN.coin) }],
    Stage: StageProfile,
  },
  {
    key: "cover",
    label: "Cover",
    title: "buy cover. pick where you get paid.",
    body: "Two policies on the same coin. One pays out on NEAR, the other on Base Sepolia. Premium 5.92% each, paid in one transaction.",
    say: "two policies. one gets paid on NEAR, one on Base.",
    ms: 8000,
    proof: [{ label: "buyer account", href: explorer.nearAccount(RUN.buyer) }],
    Stage: StageCover,
  },
  {
    key: "watch",
    label: "Watch",
    title: "the watcher locks the baselines.",
    body: "The deployer and insider balances were written to the contract before cover was sold. Nobody can move them after the fact.",
    say: "baselines are on-chain. no take-backs.",
    ms: 7500,
    proof: [{ label: "dev wallet", href: explorer.nearAccount(RUN.dev) }],
    Stage: StageWatch,
  },
  {
    key: "dump",
    label: "Dump",
    title: "the dev dumps.",
    body: "600M of the deployer's 800M PEPERUG leave the wallet. That's 75% out, past the 50% line for rule R1. The watcher reports it with the dump transactions as evidence.",
    say: "75% out. that's a rug. reporting it.",
    phase: "pulled",
    ms: 8500,
    proof: RUN.dumpTxs.map((h, i) => ({ label: `dump tx ${i + 1}`, href: explorer.nearTx(h) })),
    Stage: StageDump,
  },
  {
    key: "finalize",
    label: "Finalize",
    title: "dispute window, then final.",
    body: "Anyone can contest a report while the window is open (60s on testnet, 24h in production). Nobody did. finalize_rug queued two payouts at 80% of cover.",
    say: "nobody disputed. it's final.",
    ms: 7500,
    Stage: StageFinalize,
  },
  {
    key: "paid",
    label: "Paid",
    title: "paid. on the chain they picked.",
    body: "$0.59 USDC landed in the buyer's NEAR account. The Base Sepolia payout was built and MPC-signed by the contract through Chain Signatures. No one holds that key.",
    say: "nice try, dev. uno reverse.",
    phase: "back",
    ms: 9000,
    proof: [
      { label: "buyer on NEAR", href: explorer.nearAccount(RUN.buyer) },
      { label: "pool's derived EVM address", href: explorer.evmAddr("base-sepolia", "0xE10d19780674b165b22Fb2DC8cF69a5A79968b4b") },
    ],
    Stage: StagePaid,
  },
  {
    key: "stakers",
    label: "Stakers",
    title: "stakers eat the rug.",
    body: "$SAFU stakers earn half of every premium. When a rug is finalized, their stake burns by the pool's loss ratio. In one run that was 71.8M $SAFU, 7.18% of the pot.",
    say: "underwriters got paid. then they got burned.",
    ms: 8000,
    proof: [{ label: "$SAFU token", href: explorer.nearAccount("safu-token.safufun-d73f3d.testnet") }],
    Stage: StageStakers,
  },
  {
    key: "uno",
    label: "UNO",
    title: "uno reverse launches.",
    body: "This dev launched TRUSTME with the LP and dev bag held by the contract. They dumped anyway. The contract froze the pool, refunded every holder pro-rata and burned 822M of the dev's coin.",
    say: "when the dev rugs, the liquidity rugs the dev.",
    phase: "back",
    ms: 9500,
    proof: [
      { label: "reverse tx", href: explorer.nearTx(RUN.uno.reverseTx) },
      { label: "TRUSTME on nearblocks", href: explorer.nearAccount(RUN.uno.token) },
    ],
    Stage: StageUno,
  },
  {
    key: "outro",
    label: "Your turn",
    title: "funds are safu.",
    body: "Every number in this demo came from the contract. Price any coin, buy cover, or back the pool yourself.",
    say: "your turn. paste a coin.",
    ms: 12000,
    Stage: StageOutro,
  },
];

export default function DemoClient() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const elapsed = useRef(0);
  const startedAt = useRef(0);
  const step = STEPS[i];

  // live check that the replayed run is really on-chain
  const { data: report } = useApi(() => api.report(6), []);
  const { data: payout } = useApi(() => api.payout(9), []);
  const verified = report?.status === "Finalized" && payout?.status === "Paid";

  const go = useCallback((n: number) => {
    elapsed.current = 0;
    setI(Math.max(0, Math.min(STEPS.length - 1, n)));
  }, []);

  // auto-advance with pause/resume that keeps the time already spent
  useEffect(() => {
    if (!playing) return;
    startedAt.current = performance.now();
    const left = Math.max(0, step.ms - elapsed.current);
    const t = setTimeout(() => {
      elapsed.current = 0;
      if (i < STEPS.length - 1) setI(i + 1);
      else setPlaying(false);
    }, left);
    return () => {
      clearTimeout(t);
      elapsed.current += performance.now() - startedAt.current;
    };
  }, [i, playing, step.ms]);

  // the hero fire flares red while the rug is being pulled
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("safu:rug", { detail: step.phase === "pulled" ? "pulled" : "back" }));
  }, [step.phase]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [i, go]);

  const Stage = step.Stage;

  return (
    <section className="relative isolate min-h-[100dvh] overflow-hidden pt-16">
      <PixelScene className="absolute inset-0 -z-10 h-full w-full" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_70%_60%_at_35%_40%,rgb(10_10_10/0.9),rgb(10_10_10/0.55)_65%,rgb(10_10_10/0.2))]" />

      <div className="mx-auto max-w-[1320px] px-4 pb-16 sm:px-6">
        {/* timeline */}
        <div className="mt-6 grid grid-cols-[repeat(10,minmax(0,1fr))] gap-1.5">
          {STEPS.map((s, j) => (
            <button key={s.key} onClick={() => go(j)} className="group text-left" aria-label={`Go to step: ${s.label}`} aria-current={j === i ? "step" : undefined}>
              <span className="relative block h-1 overflow-hidden bg-white/10 transition-colors group-hover:bg-white/20">
                {j < i && <span className="absolute inset-0 bg-safu/70" />}
                {j === i && (
                  <span
                    key={`${s.key}-${i}`}
                    className="absolute inset-y-0 left-0 bg-safu"
                    style={{ animation: `demo-fill ${s.ms}ms linear forwards`, animationPlayState: playing ? "running" : "paused" }}
                  />
                )}
              </span>
              <span className={`mt-2 hidden truncate text-[12px] transition-colors md:block ${j === i ? "text-bone" : "text-dim group-hover:text-slate"}`}>{s.label}</span>
            </button>
          ))}
        </div>

        <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-14">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Chip tone={verified ? "safu" : "dim"}>{verified ? "real testnet run · verified live" : "real testnet run"}</Chip>
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={step.key} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}>
                <h1 className={`mt-6 font-display text-[clamp(2rem,3.6vw,3.4rem)] leading-[1] ${step.phase === "pulled" ? "text-rug" : "text-bone"}`}>{step.title}</h1>
                <p className="mt-5 max-w-[48ch] text-[17px] leading-relaxed text-ice">{step.body}</p>
                {step.proof && (
                  <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
                    {step.proof.map((p) => (
                      <a key={p.href} href={p.href} target="_blank" rel="noreferrer" className="text-slate underline decoration-line-strong underline-offset-4 transition-colors hover:text-bone">
                        {p.label} ↗
                      </a>
                    ))}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-8 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous step">
                ←
              </Button>
              <Button variant="light" size="sm" onClick={() => (i === STEPS.length - 1 && !playing ? (go(0), setPlaying(true)) : setPlaying((p) => !p))} className="min-w-[96px]">
                {i === STEPS.length - 1 && !playing ? "Replay" : playing ? "Pause" : "Play"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => go(i + 1)} disabled={i === STEPS.length - 1} aria-label="Next step">
                →
              </Button>
              <span className="ml-3 hidden text-[13px] text-dim sm:inline">arrow keys · space</span>
            </div>

            <div className="mt-10 hidden lg:block">
              <Mascot size={9} say={step.say} phase={step.phase ?? "idle"} />
            </div>
          </div>

          <div className="min-h-[460px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={step.key}
                initial={{ opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              >
                <Stage />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── stages ─────────────────────────

function Card({ children, tone, className = "" }: { children: React.ReactNode; tone?: "rug" | "safu"; className?: string }) {
  return (
    <Panel className={`bg-ink/90 p-6 sm:p-8 ${tone === "rug" ? "border-rug/50" : tone === "safu" ? "border-safu/40" : ""} ${className}`}>
      {children}
    </Panel>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] text-slate">{children}</div>;
}

function Row({ k, v, tone }: { k: string; v: React.ReactNode; tone?: "rug" | "safu" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5 text-[14px]">
      <span className="text-slate">{k}</span>
      <span className={`truncate font-mono ${tone === "rug" ? "text-rug" : tone === "safu" ? "text-safu" : "text-bone"}`}>{v}</span>
    </div>
  );
}

function StageIntro() {
  return (
    <Card className="relative overflow-hidden">
      <div aria-hidden className="absolute inset-0 bg-flames opacity-[0.06]" />
      <div className="relative">
        <Label>Q1 2025</Label>
        <div className="mt-3 font-display text-[clamp(3rem,7vw,6rem)] leading-none text-rug">1.8M</div>
        <div className="mt-2 text-lg text-ice">memecoins crashed in one quarter.</div>
        <div className="mt-10 grid grid-cols-2 gap-6 border-t border-white/10 pt-6">
          <div>
            <Label>paid back to their holders</Label>
            <div className="mt-2 font-display text-3xl text-bone">$0</div>
          </div>
          <div>
            <Label>paid back with safu.fun cover</Label>
            <div className="mt-2 font-display text-3xl text-safu">80%</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const FACTORS = [
  { k: "deployer share", d: "80% of supply", v: 1, w: 0.35 },
  { k: "top holders", d: "20% of supply", v: 0.4, w: 0.3 },
  { k: "token age", d: "under 1 day", v: 1, w: 0.2 },
  { k: "holders", d: "3", v: 1, w: 0.15 },
];

function StageProfile() {
  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="grid h-14 w-14 place-items-center border border-white/15 font-display text-bone">PEP</div>
          <div>
            <div className="font-display text-2xl text-bone">{RUN.symbol}</div>
            <div className="mt-1 truncate font-mono text-[12px] text-slate">{RUN.coin}</div>
          </div>
        </div>
        <Chip tone="dim">NEAR testnet</Chip>
      </div>
      <div className="mt-8 flex items-end justify-between">
        <div>
          <Label>rug odds</Label>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="mt-2 font-display text-7xl leading-none text-rug">
            82%
          </motion.div>
        </div>
        <div className="text-right">
          <Label>premium</Label>
          <div className="mt-2 font-mono text-2xl text-bone">5.92%</div>
        </div>
      </div>
      <PixelMeter value={0.82} hot cells={32} />
      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4">
        {FACTORS.map((f, j) => (
          <div key={f.k}>
            <div className="flex justify-between text-[13px]">
              <span className="text-ice">{f.k}</span>
              <span className="text-dim">w {f.w}</span>
            </div>
            <div className="mt-2 h-1.5 bg-white/10">
              <motion.div className={`h-full ${f.v > 0.6 ? "bg-rug" : "bg-ice"}`} initial={{ width: 0 }} animate={{ width: `${f.v * 100}%` }} transition={{ delay: 0.4 + j * 0.12, duration: 0.8 }} />
            </div>
            <div className="mt-1.5 text-[13px] text-slate">{f.d}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Ticket({ id, cover, chain, to, delay }: { id: number; cover: string; chain: string; to: string; delay: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20, rotate: -2 }} animate={{ opacity: 1, y: 0, rotate: 0 }} transition={{ delay, type: "spring", stiffness: 200, damping: 20 }}>
      <Card tone="safu">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-safu">Policy #{id}</span>
          <span className="text-[13px] text-slate">7 days</span>
        </div>
        <div className="mt-5 font-display text-4xl text-bone">{cover}</div>
        <div className="mt-1 text-[14px] text-slate">covered on {RUN.symbol}</div>
        <div className="mt-5 border-t border-white/10 pt-3">
          <Row k="paid on" v={chain} />
          <Row k="to" v={to} />
          <Row k="max payout" v="80% of cover" />
        </div>
      </Card>
    </motion.div>
  );
}

function StageCover() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Ticket id={10} cover="$0.73" chain="NEAR" to="buyer.safudemo…" delay={0.1} />
      <Ticket id={11} cover="$0.47" chain="Base Sepolia" to="0x7A69…8d0d" delay={0.35} />
    </div>
  );
}

function StageWatch() {
  return (
    <Card className="relative overflow-hidden">
      <motion.div
        aria-hidden
        className="absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-safu/10 to-transparent"
        animate={{ top: ["-20%", "110%"] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      />
      <div className="relative">
        <div className="flex items-center justify-between">
          <Label>watched wallets · baselines on-chain</Label>
          <span className="flex items-center gap-2 text-[13px] text-safu">
            <span className="h-1.5 w-1.5 animate-pulse-dot bg-safu" /> live
          </span>
        </div>
        <div className="mt-4 divide-y divide-white/10">
          <Row k="deployer (R1)" v="800M PEPERUG" />
          <Row k="insider (R2)" v="200M PEPERUG" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-4 border-t border-white/10 pt-5 text-[14px]">
          <div>
            <Label>R1 triggers at</Label>
            <div className="mt-1 font-mono text-bone">deployer sells ≥ 50%</div>
          </div>
          <div>
            <Label>R2 triggers at</Label>
            <div className="mt-1 font-mono text-bone">top 5 insiders sell ≥ 50%</div>
          </div>
        </div>
      </div>
    </Card>
  );
}

function StageDump() {
  return (
    <Card tone="rug" className="relative overflow-hidden">
      <motion.div aria-hidden className="absolute inset-0 bg-rug" initial={{ opacity: 0.5 }} animate={{ opacity: 0 }} transition={{ duration: 0.8 }} />
      <div className="relative">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-rug">R1 triggered</span>
          <span className="font-mono text-[13px] text-slate">report #6</span>
        </div>
        <div className="mt-6">
          <Label>deployer balance</Label>
          <div className="mt-2 flex items-baseline gap-3 font-display">
            <motion.span initial={{ opacity: 1 }} animate={{ opacity: 0.35 }} transition={{ delay: 0.6 }} className="text-3xl text-bone line-through decoration-rug">
              800M
            </motion.span>
            <motion.span initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }} className="text-5xl text-rug">
              200M
            </motion.span>
          </div>
          <div className="mt-4 h-3 bg-white/10">
            <motion.div className="h-full bg-rug" initial={{ width: "0%" }} animate={{ width: "75%" }} transition={{ delay: 0.5, duration: 1.2, ease: [0.16, 1, 0.3, 1] }} />
          </div>
          <div className="mt-2 flex justify-between text-[13px]">
            <span className="text-rug">75% sold</span>
            <span className="text-slate">threshold 50%</span>
          </div>
        </div>
        <div className="mt-6 border-t border-white/10 pt-3">
          {RUN.dumpTxs.map((h, j) => (
            <Row key={h} k={`evidence ${j + 1}`} v={`${h.slice(0, 14)}…`} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function StageFinalize() {
  const [s, setS] = useState(60);
  useEffect(() => {
    const t = setInterval(() => setS((x) => Math.max(0, x - 2)), 70);
    return () => clearInterval(t);
  }, []);
  const done = s === 0;
  return (
    <Card tone={done ? "safu" : undefined}>
      <Label>dispute window</Label>
      <div className={`mt-3 font-display text-7xl tabular ${done ? "text-safu" : "text-bone"}`}>00:{String(s).padStart(2, "0")}</div>
      <div className="mt-4 h-1.5 bg-white/10">
        <div className="h-full bg-safu transition-[width] duration-100" style={{ width: `${((60 - s) / 60) * 100}%` }} />
      </div>
      <AnimatePresence>
        {done && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-8 border-t border-white/10 pt-4">
            <div className="font-mono text-[15px] text-bone">finalize_rug(6)</div>
            <Row k="disputes" v="0" />
            <Row k="payouts queued" v="#9, #10" tone="safu" />
            <Row k="amount" v="80% of each policy" />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function StagePaid() {
  return (
    <div className="space-y-4">
      <motion.div initial={{ scale: 1.15, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 14 }}>
        <Card tone="safu" className="relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 bg-flames opacity-[0.1]" />
          <div className="relative flex items-end justify-between gap-4">
            <div>
              <span className="text-[13px] font-medium text-safu">Payout #9 · paid</span>
              <div className="mt-3 font-display text-6xl text-safu">$0.59</div>
              <div className="mt-2 text-[14px] text-ice">USDC on NEAR → buyer.safudemo-81cf1a.testnet</div>
            </div>
            <Chip tone="safu">NEAR direct</Chip>
          </div>
        </Card>
      </motion.div>
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <Card>
          <div className="flex items-end justify-between gap-4">
            <div className="min-w-0">
              <span className="text-[13px] font-medium text-ice">Payout #10 · MPC-signed</span>
              <div className="mt-3 font-display text-4xl text-bone">$0.37</div>
              <div className="mt-2 text-[14px] text-slate">USDC on Base Sepolia → 0x7A69…8d0d</div>
              <div className="mt-3 truncate font-mono text-[12px] text-dim">{RUN.mpcTx}</div>
            </div>
            <Chip tone="ice">chain signatures</Chip>
          </div>
          <div className="mt-4 border-t border-white/10 pt-3 text-[13px] text-slate">Signed by NEAR&apos;s v1.signer network for the contract. Ready to broadcast once the pool address has testnet gas.</div>
        </Card>
      </motion.div>
    </div>
  );
}

function StageStakers() {
  const N = 200;
  const burned = Math.round(N * 0.0718);
  return (
    <Card>
      <div className="grid grid-cols-2 gap-6">
        <div>
          <Label>stakers earned</Label>
          <div className="mt-2 font-display text-4xl text-safu">50%</div>
          <div className="mt-1 text-[13px] text-slate">of every premium, in USDC</div>
        </div>
        <div>
          <Label>burned on one rug</Label>
          <div className="mt-2 font-display text-4xl text-rug">71.8M</div>
          <div className="mt-1 text-[13px] text-slate">$SAFU, 7.18% loss ratio</div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-[repeat(25,minmax(0,1fr))] gap-[3px]">
        {Array.from({ length: N }, (_, j) => (
          <motion.span
            key={j}
            className="aspect-square"
            initial={{ backgroundColor: "rgb(185 195 214 / 0.3)" }}
            animate={{ backgroundColor: j >= N - burned ? "#ff3b30" : "rgb(185 195 214 / 0.3)" }}
            transition={{ delay: j >= N - burned ? 0.6 + (j - (N - burned)) * 0.06 : 0 }}
          />
        ))}
      </div>
      <div className="mt-4 text-[13px] text-slate">1B $SAFU staked. Supply went from 1B to 928.2M after the rug.</div>
    </Card>
  );
}

function StageUno() {
  const { data } = useApi(() => api.unoOne(0), []);
  return (
    <Card tone="safu">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-safu">UNO launch #0 · reversed</span>
        <span className="font-mono text-[13px] text-slate">TRUSTME</span>
      </div>
      <div className="mt-6 grid grid-cols-3 gap-4">
        <div>
          <Label>pool</Label>
          <div className="mt-1 font-display text-2xl text-bone">frozen</div>
        </div>
        <div>
          <Label>refunded</Label>
          <div className="mt-1 font-display text-2xl text-safu">$0.95</div>
        </div>
        <div>
          <Label>dev coin burned</Label>
          <div className="mt-1 font-display text-2xl text-rug">822M</div>
        </div>
      </div>
      <div className="mt-6 border-t border-white/10 pt-3">
        <Label>refunds, pro-rata by holdings</Label>
        {(data
          ? data.snapshot.map((h) => ({
              who: h.account_id,
              usd: (usdc(data.launch.refund_pot_usdc) * Number((BigInt(h.amount) * 10000n) / (BigInt(data.launch.snapshot_total) || 1n))) / 10000,
              paid: h.paid,
            }))
          : [
              { who: "buyer.safudemo-81cf1a.testnet", usd: 0.7105, paid: true },
              { who: "fan-5051ac.rugdev-28a8de.testnet", usd: 0.2368, paid: true },
            ]
        ).map((h, j) => (
          <motion.div key={h.who} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + j * 0.2 }}>
            <Row k={h.who.length > 30 ? `${h.who.slice(0, 28)}…` : h.who} v={`${fmtUsd(h.usd, { digits: 2 })}${h.paid ? " ✓" : ""}`} tone="safu" />
          </motion.div>
        ))}
      </div>
    </Card>
  );
}

function StageOutro() {
  return (
    <Card className="relative overflow-hidden">
      <Corners className="border-safu" />
      <div aria-hidden className="absolute inset-0 bg-flames opacity-[0.12]" />
      <div className="relative">
        <div className="font-display text-[clamp(2.2rem,5vw,4rem)] leading-none text-bone">
          buy anything.
          <br />
          <span className="text-safu">get paid if it rugs.</span>
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2">
          <Button href="/buy" size="lg">
            Price a coin <ArrowRight />
          </Button>
          <Button href="/wall" size="lg" variant="outline">
            Wall of Rugs
          </Button>
          <Button href="/underwrite" size="lg" variant="outline">
            Underwrite
          </Button>
          <Button href="/launch" size="lg" variant="outline">
            Launch with UNO
          </Button>
        </div>
        <div className="mt-8 text-[13px] text-slate">
          Built on NEAR Intents and Chain Signatures. Contract:{" "}
          <Link href={explorer.nearAccount("cover.safufun-d73f3d.testnet")} target="_blank" className="underline decoration-line-strong underline-offset-4 hover:text-bone">
            cover.safufun-d73f3d.testnet ↗
          </Link>
        </div>
      </div>
    </Card>
  );
}

"use client";

import Link from "next/link";
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import { api, ago, chainLabel, fmtCompact, fmtUsd, splitTokenKey, units, usdc } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { DitherIn, Marquee, Reveal, Scramble, Tick, Tilt } from "../fx";
import { ArrowRight, Button, Chip, Corners, Dot, Eyebrow, Panel } from "../ui";

const W = "mx-auto max-w-[1320px] px-4 sm:px-6";

// ───────────────────────── live stats strip ─────────────────────────

export function StatsStrip() {
  const { data: cfg } = useApi(() => api.config(), [], 20_000);
  const { data: st } = useApi(() => api.staking(), [], 30_000);
  const items: [string, string][] = cfg
    ? [
        ["pool capital", fmtUsd(usdc(cfg.pool.available_usdc))],
        ["premiums earned", fmtUsd(usdc(cfg.pool.premiums_earned_usdc))],
        ["paid back to holders", fmtUsd(usdc(cfg.pool.total_paid_out_usdc))],
        ["policies written", String(cfg.pool.policies)],
        ["rugs reported", String(cfg.pool.reports)],
        ["$SAFU burned by rugs", st ? fmtCompact(units(st.total_burned_safu, 18)) : "…"],
        ["dispute window", `${Math.round(cfg.config.dispute_window_ms / 1000)}s`],
        ["deductible", `${cfg.config.deductible_bps / 100}%`],
      ]
    : [["connecting to cover contract", "…"]];
  return (
    <div className="relative border-y border-line bg-ink">
      <Marquee className="py-4">
        {items.map(([k, v]) => (
          <span key={k} className="flex shrink-0 items-center gap-3 font-mono text-[12px] uppercase tracking-[0.16em]">
            <span className="text-dim">{k}</span>
            <span className="text-bone">{v}</span>
            <span aria-hidden className="ml-9 inline-block h-1 w-1 bg-slate" />
          </span>
        ))}
      </Marquee>
    </div>
  );
}

// ───────────────────────── how it works (pinned scroll) ─────────────────────────

const STEPS = [
  {
    k: "01",
    title: "paste any coin",
    body: "Any token on any supported chain. No dev cooperation needed. We profile the deployer, the top holders, age and holder count, and price the risk in the open.",
    term: ["> profile moon.safudemo-81cf1a.testnet", "  deployer   70.0% of supply", "  insiders   2 wallets · 30.0%", "  age        0.3d · 3 holders", "> rug odds   88.0%  → premium 6.28%"],
  },
  {
    k: "02",
    title: "pay with anything",
    body: "Pay from whatever you hold, on whatever chain. NEAR Intents routes the swap and the cover premium (1-7%) is taken inside it. No bridge UI, no wrapped tokens.",
    term: ["> 1click quote", "  origin       ETH on Base", "  destination  MOON", "  appFees      628 bps → safu pool", "> status SUCCESS · policy #3 registered"],
  },
  {
    k: "03",
    title: "the watcher never blinks",
    body: "For 7 days the deployer and the top insiders are watched against balances snapshotted on-chain at buy time. They cannot be moved after the fact.",
    term: ["> watch near:moon.safudemo…", "  R1 deployer out   0.0% / 50%", "  R2 insiders out   0.0% / 50%", "  heartbeat         12s ago", "> status ACTIVE"],
  },
  {
    k: "04",
    title: "rugged? paid. anywhere.",
    body: "If they dump, the report goes on-chain with the tx evidence. After the dispute window the contract pays you, on the chain and in the asset you picked, through Intents or its own Chain Signatures address.",
    term: ["> report_rug R1 · 2 evidence txs", "  dispute window   60s … closed", "> finalize_rug → payout #9 queued", "  rail             intents → SOL", "> PAID  $0.59 → 7a…d0d  ✓"],
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));
  const bar = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section ref={ref} className="relative" style={{ height: `${STEPS.length * 85 + 40}vh` }}>
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden pt-16">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-60 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className={`${W} relative grid w-full gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20`}>
          <div className="flex flex-col justify-center">
            <Eyebrow>how cover works</Eyebrow>
            <div className="relative mt-6 h-[1em] font-display text-[clamp(5rem,14vw,11rem)] leading-none text-line-strong">
              {STEPS.map((s, i) => (
                <motion.span
                  key={s.k}
                  className="absolute left-0 top-0"
                  animate={{ opacity: i === active ? 1 : 0, y: i === active ? 0 : i < active ? -40 : 40 }}
                  transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                >
                  <span className={i === 3 ? "text-safu" : "text-bone"}>{s.k}</span>
                </motion.span>
              ))}
            </div>
            <div className="relative mt-8 min-h-[190px]">
              {STEPS.map((s, i) => (
                <motion.div
                  key={s.k}
                  className="absolute inset-0"
                  animate={{ opacity: i === active ? 1 : 0, y: i === active ? 0 : 16, pointerEvents: i === active ? "auto" : "none" }}
                  transition={{ duration: 0.45 }}
                >
                  <h3 className="font-display text-3xl text-bone sm:text-4xl">{s.title}</h3>
                  <p className="mt-4 max-w-md text-[16px] leading-relaxed text-ice">{s.body}</p>
                </motion.div>
              ))}
            </div>
            <div className="mt-6 flex gap-2">
              {STEPS.map((s, i) => (
                <span key={s.k} className={`h-1 w-10 transition-colors duration-300 ${i <= active ? "bg-safu" : "bg-line-strong"}`} />
              ))}
            </div>
          </div>

          <div className="flex items-center">
            <Tilt max={6} className="w-full">
              <Panel className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-line px-4 py-3 font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 bg-rug/70" />
                    <span className="h-2 w-2 bg-ice/40" />
                    <span className="h-2 w-2 bg-safu/70" />
                  </span>
                  <span>safu · cover.safufun-d73f3d.testnet</span>
                </div>
                <div className="relative min-h-[300px] p-6 font-mono text-[14px] leading-7 sm:min-h-[340px] sm:p-8">
                  {STEPS.map((s, i) =>
                    i === active ? (
                      <div key={s.k}>
                        {s.term.map((line, j) => (
                          <motion.div
                            key={line}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: j * 0.12 }}
                            className={line.startsWith(">") ? (line.includes("PAID") ? "text-safu" : "text-bone") : "text-slate"}
                          >
                            {line}
                          </motion.div>
                        ))}
                        <span className="mt-1 inline-block h-4 w-2 animate-blink bg-safu align-middle" />
                      </div>
                    ) : null,
                  )}
                </div>
                <div className="h-px bg-line">
                  <motion.div className="h-px bg-safu" style={{ width: bar }} />
                </div>
              </Panel>
            </Tilt>
          </div>
        </div>
      </div>
    </section>
  );
}

// ───────────────────────── rug rules ─────────────────────────

const RULES = [
  { id: "R1", title: "deployer dumps", body: "The deployer wallet sells or moves out ≥ 50% of what it held when your cover started.", stat: "≥50%" },
  { id: "R2", title: "insiders dump", body: "The top 5 non-pool holders captured at buy time collectively sell ≥ 50%.", stat: "≥50%" },
  { id: "R3", title: "liquidity pulled", body: "Pool liquidity drops ≥ 80% inside an hour. UNO REVERSE coins can't trigger it: their LP is contract-held.", stat: "≥80%" },
];

export function Rules() {
  return (
    <section id="rules" className={`${W} scroll-mt-24 py-32`}>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <Reveal>
          <Eyebrow tone="rug">what counts as a rug</Eyebrow>
          <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone sm:text-5xl">
            narrow rules.
            <br />
            checkable on-chain.
          </h2>
          <p className="mt-6 max-w-md leading-relaxed text-ice">
            No vibes, no committee. A rug is a measurable balance change against a snapshot written to the contract before your cover was sold. Every report links the dump transactions.
          </p>
        </Reveal>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
          {RULES.map((r, i) => (
            <Reveal key={r.id} delay={i * 0.08}>
              <Tilt max={8} className="h-full">
                <Panel className="flex h-full flex-col p-6">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-xl text-rug">{r.id}</span>
                    <span className="font-mono text-[11px] text-dim">{i < 2 ? "live" : "roadmap"}</span>
                  </div>
                  <div className="mt-10 font-display text-4xl text-bone">{r.stat}</div>
                  <div className="mt-3 font-mono text-[13px] uppercase tracking-[0.12em] text-ice">{r.title}</div>
                  <p className="mt-3 text-sm leading-relaxed text-slate">{r.body}</p>
                </Panel>
              </Tilt>
            </Reveal>
          ))}
        </div>
      </div>

      <Reveal className="mt-14">
        <Panel className="overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line md:grid-cols-4 md:divide-x md:divide-y-0">
            {[
              ["report_rug", "watcher posts rule + evidence txs", "rug"],
              ["dispute window", "anyone can contest. 60s on testnet, 24h in prod", "ice"],
              ["finalize_rug", "payouts queued at 80% of cover", "ice"],
              ["paid", "delivered on your chain, tx hash on-chain", "safu"],
            ].map(([k, v, t], i) => (
              <div key={k} className="relative p-6">
                <div className="font-mono text-[11px] text-dim">0{i + 1}</div>
                <div className={`mt-3 font-mono text-[14px] uppercase tracking-[0.1em] ${t === "rug" ? "text-rug" : t === "safu" ? "text-safu" : "text-bone"}`}>{k}</div>
                <div className="mt-2 text-sm text-slate">{v}</div>
              </div>
            ))}
          </div>
        </Panel>
      </Reveal>
    </section>
  );
}

// ───────────────────────── rug odds lab ─────────────────────────

const FACTORS = [
  { key: "deployer", label: "deployer share of supply", weight: 0.35, unit: "%", max: 100, def: 40, risk: (v: number) => Math.min(1, v / 100 / 0.5) },
  { key: "insiders", label: "top-holder concentration", weight: 0.3, unit: "%", max: 100, def: 25, risk: (v: number) => Math.min(1, v / 100 / 0.5) },
  { key: "age", label: "token age", weight: 0.2, unit: "d", max: 60, def: 3, risk: (v: number) => (v < 1 ? 1 : v < 7 ? 0.6 : v < 30 ? 0.3 : 0.1) },
  { key: "holders", label: "holders", weight: 0.15, unit: "", max: 6000, def: 120, risk: (v: number) => (v < 50 ? 1 : v < 500 ? 0.5 : v < 5000 ? 0.2 : 0) },
] as const;

export function OddsLab() {
  const [vals, setVals] = useState<number[]>(FACTORS.map((f) => f.def));
  const score = FACTORS.reduce((a, f, i) => a + f.risk(vals[i]) * f.weight, 0);
  const odds = Math.round(score * 1000) / 10;
  const bps = Math.round(Math.min(700, Math.max(100, 100 + score * 600)));
  const hot = odds >= 60;

  return (
    <section id="odds" className="relative scroll-mt-24 overflow-hidden border-y border-line bg-ink py-32">
      <div aria-hidden className="absolute inset-y-0 right-0 w-1/2 bg-dither opacity-[0.16] [mask-image:linear-gradient(to_left,black,transparent)]" />
      <div className={`${W} relative grid gap-14 lg:grid-cols-2`}>
        <Reveal>
          <Eyebrow>rug odds</Eyebrow>
          <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone sm:text-5xl">
            the price
            <br />
            is the warning.
          </h2>
          <p className="mt-6 max-w-md leading-relaxed text-ice">
            Every coin gets a public rug premium from four on-chain facts. No black box: the weights are below and every quote returns each factor. A rug-cover market ends up being the best rug detector on any chain.
          </p>
          <div className="mt-10 font-mono text-[12px] text-dim">premium_bps = clamp(100 + risk × 600, 100, 700)</div>
        </Reveal>

        <Reveal delay={0.1}>
          <Panel className="p-6 sm:p-8">
            <div className="flex items-end justify-between gap-6">
              <div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">rug odds</div>
                <div className={`mt-2 font-display text-6xl tabular transition-colors sm:text-7xl ${hot ? "text-rug" : "text-safu"}`}>{odds.toFixed(1)}%</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">premium</div>
                <div className="mt-2 font-mono text-3xl text-bone tabular">{(bps / 100).toFixed(2)}%</div>
              </div>
            </div>
            <PixelMeter value={score} hot={hot} />
            <div className="mt-8 space-y-6">
              {FACTORS.map((f, i) => (
                <label key={f.key} className="block">
                  <div className="flex items-baseline justify-between font-mono text-[12px]">
                    <span className="uppercase tracking-[0.12em] text-ice">{f.label}</span>
                    <span className="text-bone tabular">
                      {vals[i].toLocaleString()}
                      {f.unit} <span className="text-dim">· w {f.weight}</span>
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={f.max}
                    value={vals[i]}
                    onChange={(e) => setVals((v) => v.map((x, j) => (j === i ? Number(e.target.value) : x)))}
                    className="mt-3 h-1 w-full cursor-pointer appearance-none bg-line-strong accent-safu"
                  />
                </label>
              ))}
            </div>
            <div className="mt-8 flex items-center justify-between border-t border-line pt-5 font-mono text-[12px] text-slate">
              <span>UNO REVERSE coins: fixed 1.00%</span>
              <Link href="/buy" className="text-safu hover:underline">
                price a real coin →
              </Link>
            </div>
          </Panel>
        </Reveal>
      </div>
    </section>
  );
}

export function PixelMeter({ value, hot, cells = 40 }: { value: number; hot: boolean; cells?: number }) {
  const lit = Math.round(value * cells);
  return (
    <div className="mt-6 flex gap-[3px]" role="meter" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          className={`h-6 flex-1 transition-colors duration-300 ${i < lit ? (hot ? (i > cells * 0.6 ? "bg-rug" : "bg-ice") : "bg-safu") : "bg-line"}`}
          style={{ transitionDelay: `${i * 8}ms` }}
        />
      ))}
    </div>
  );
}

// ───────────────────────── payout rails ─────────────────────────

const PAYOUT_CHAINS = ["near", "eth", "base", "arb", "sol", "btc", "ton", "sui", "tron", "bsc", "pol", "op", "avax", "doge", "xrp", "zec", "gnosis", "bera", "aptos", "stellar", "cardano", "ltc"];

export function Rails() {
  return (
    <section className={`${W} py-32`}>
      <Reveal className="max-w-3xl">
        <Eyebrow tone="safu">get paid on any chain</Eyebrow>
        <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone sm:text-5xl">NEAR is invisible. the payout isn&apos;t.</h2>
        <p className="mt-6 max-w-2xl leading-relaxed text-ice">
          You never touch NEAR. The cover contract holds the pool and decides who gets paid. Then it delivers the payout through whichever rail reaches your chain.
        </p>
      </Reveal>

      <div className="mt-14 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
        {[
          {
            tag: "rail a",
            title: "intents payout",
            body: "Pool USDC goes to a 1Click deposit address whose quote pays your asset to your address. The contract verifies 1Click's signature on the quote on-chain before sending a cent.",
            foot: "every chain 1Click supports",
          },
          {
            tag: "rail b",
            title: "chain signatures",
            body: "The contract builds the transfer itself and asks the v1.signer MPC network to sign it from its own derived address. It ecrecovers the signature and stores the raw tx. Nobody holds that key.",
            foot: "EVM live · Ed25519 next",
          },
          {
            tag: "direct",
            title: "near-native",
            body: "Paid on NEAR? Pool USDC lands in your account in the same block the payout is requested. One call, no relayer.",
            foot: "instant",
          },
        ].map((r, i) => (
          <Reveal key={r.tag} delay={i * 0.08}>
            <Tilt max={7} className="h-full">
              <Panel className="flex h-full flex-col p-7">
                <Chip tone={i === 0 ? "safu" : "ice"}>{r.tag}</Chip>
                <h3 className="mt-8 font-display text-2xl text-bone">{r.title}</h3>
                <p className="mt-4 flex-1 text-sm leading-relaxed text-slate">{r.body}</p>
                <div className="mt-8 border-t border-line pt-4 font-mono text-[11px] uppercase tracking-[0.16em] text-ice">{r.foot}</div>
              </Panel>
            </Tilt>
          </Reveal>
        ))}
      </div>

      <Reveal className="mt-10">
        <div className="flex flex-wrap gap-2">
          {PAYOUT_CHAINS.map((c, i) => (
            <motion.span
              key={c}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.025 }}
              className="border border-line px-3 py-1.5 font-mono text-[12px] text-ice transition-colors hover:border-safu hover:text-safu"
            >
              {chainLabel(c)}
            </motion.span>
          ))}
          <span className="px-3 py-1.5 font-mono text-[12px] text-dim">+ everything in /v0/tokens</span>
        </div>
      </Reveal>
    </section>
  );
}

// ───────────────────────── UNO REVERSE (3D flip on scroll) ─────────────────────────

export function UnoReverse() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const rotateY = useTransform(scrollYProgress, [0.25, 0.55], [0, 180]);
  const rotateZ = useTransform(scrollYProgress, [0.1, 0.55, 0.9], [-8, 0, 6]);
  const y = useTransform(scrollYProgress, [0, 1], [80, -80]);
  const { data: launches } = useApi(() => api.uno(), []);
  const reversed = launches?.filter((l) => l.status !== "Active") ?? [];
  const refunded = reversed.reduce((a, l) => a + usdc(l.refunds_paid_usdc), 0);
  const burned = reversed.reduce((a, l) => a + units(l.burned_token, 18), 0);

  return (
    <section ref={ref} className="relative overflow-hidden border-y border-line py-32">
      <div aria-hidden className="absolute inset-0 bg-flames opacity-[0.07]" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-void via-void/70 to-void" />
      <div className={`${W} relative grid items-center gap-16 lg:grid-cols-2`}>
        <div>
          <Reveal>
            <Eyebrow tone="safu">for devs: uno reverse launches</Eyebrow>
            <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone sm:text-6xl">
              when the dev rugs,
              <br />
              <span className="text-safu">the liquidity rugs the dev.</span>
            </h2>
            <p className="mt-6 max-w-lg leading-relaxed text-ice">
              Launch with your LP and dev bag held by the safu contract. Nobody can pull it, including you and including us. Your allocation unlocks in tranches. If insiders dump, the contract freezes the pool, refunds every holder pro-rata and burns what&apos;s left of your bag.
            </p>
          </Reveal>
          <Reveal delay={0.1} className="mt-10 grid grid-cols-3 gap-6 border-t border-line pt-8">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">cover cost</div>
              <div className="mt-2 font-display text-3xl text-safu">1%</div>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">refunded</div>
              <div className="mt-2 font-display text-3xl text-bone">
                <Tick value={refunded} format={(n) => fmtUsd(n)} />
              </div>
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">dev tokens burned</div>
              <div className="mt-2 font-display text-3xl text-bone">
                <Tick value={burned} format={fmtCompact} />
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.15} className="mt-10 flex flex-wrap gap-3">
            <Button href="/launch">
              Launch with UNO <ArrowRight />
            </Button>
            <Button href="/launch#launches" variant="outline">
              See reversed launches
            </Button>
          </Reveal>
        </div>

        <motion.div style={{ y }} className="mx-auto w-full max-w-[340px] [perspective:1400px]">
          <motion.div style={{ rotateY, rotateZ, transformStyle: "preserve-3d" }} className="relative aspect-[5/7] w-full">
            {/* front: the rug */}
            <div className="absolute inset-0 flex flex-col overflow-hidden border-2 border-rug bg-ink p-6 [backface-visibility:hidden]">
              <div className="flex justify-between font-display text-rug">
                <span>R1</span>
                <span>⟲</span>
              </div>
              <div className="relative my-auto">
                <div className="mx-auto grid h-40 w-40 rotate-[-12deg] place-items-center border-2 border-rug bg-rug/10">
                  <span className="font-display text-5xl text-rug">RUG</span>
                </div>
              </div>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-rug/80">dev dumped 200M · pool drained</div>
            </div>
            {/* back: reversed */}
            <div className="absolute inset-0 flex flex-col overflow-hidden border-2 border-safu bg-ink p-6 [backface-visibility:hidden] [transform:rotateY(180deg)]">
              <div aria-hidden className="absolute inset-0 bg-flames opacity-40" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ink via-ink/60 to-ink/30" />
              <div className="relative flex justify-between font-display text-safu">
                <span>UNO</span>
                <span>⟲</span>
              </div>
              <div className="relative my-auto text-center">
                <div className="font-display text-[44px] leading-[0.95] text-bone">
                  UNO
                  <br />
                  REVERSE&apos;D
                </div>
                <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-safu">LP pulled · holders refunded · dev burned</div>
              </div>
              <div className="relative font-mono text-[11px] uppercase tracking-[0.18em] text-ice">signed by the contract</div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

// ───────────────────────── underwriters ─────────────────────────

export function Underwriters() {
  const { data: st } = useApi(() => api.staking(), []);
  const staked = st ? units(st.total_staked_safu, 18) : 0;
  const burned = st ? units(st.total_burned_safu, 18) : 0;
  const rewards = st ? usdc(BigInt(st.rewards_paid_usdc) + BigInt(st.rewards_reserved_usdc)) : 0;
  return (
    <section className={`${W} py-32`}>
      <div className="grid grid-cols-[minmax(0,1fr)] items-end gap-12 lg:grid-cols-2">
        <Reveal>
          <Eyebrow>$SAFU underwriters</Eyebrow>
          <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone sm:text-5xl">
            stakers earn the spread.
            <br />
            <span className="text-rug">stakers eat the rugs.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="max-w-lg leading-relaxed text-ice">
            Stake $SAFU to back the pool and earn half of every premium in USDC. When a rug is finalized, the staked pot is burned by the pool&apos;s loss ratio. Good underwriting gets paid. Bad underwriting shrinks the supply.
          </p>
        </Reveal>
      </div>
      <Reveal delay={0.1} className="mt-14">
        <Panel className="relative overflow-hidden">
          <DitherIn />
          <div className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <BigStat label="$SAFU staked" value={staked} format={fmtCompact} />
            <BigStat label="premium share" value={st ? st.staker_share_bps / 100 : 0} format={(n) => `${n.toFixed(0)}%`} />
            <BigStat label="rewards to stakers" value={rewards} format={(n) => fmtUsd(n, { digits: 4 })} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-5 sm:px-8">
            <div className="flex items-center gap-3 font-mono text-[13px] text-ice">
              <span className="inline-block h-2 w-2 bg-rug" />
              <Tick value={burned} format={(n) => `${fmtCompact(n)} $SAFU`} className="text-bone" /> burned by finalized rugs
            </div>
            <Button href="/underwrite" variant="outline" size="sm">
              Start underwriting <ArrowRight />
            </Button>
          </div>
        </Panel>
      </Reveal>
    </section>
  );
}

function BigStat({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  return (
    <div className="p-6 sm:p-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">{label}</div>
      <div className="mt-4 font-display text-4xl text-bone sm:text-5xl">
        <Tick value={value} format={format} />
      </div>
    </div>
  );
}

// ───────────────────────── trust model ─────────────────────────

export function Trust() {
  const rows = [
    ["payout keys", "MPC only. The Chain Signatures network signs only what the contract asks for. Contract logic is the only path to a signature.", "trustless"],
    ["payout amounts", "Fixed by contract state: 80% of cover, pro-rata if the pool is short, per-token exposure capped at 10% of the pool.", "trustless"],
    ["intents quotes", "1Click's quote signature is verified on-chain before USDC leaves the pool.", "trustless"],
    ["rug detection", "Allowlisted watcher plus a public dispute window. Balance baselines are locked on-chain before cover is sold.", "trusted · beta"],
    ["roadmap", "Attested watchers and a quorum of independent watchers.", "next"],
  ];
  return (
    <section id="trust" className={`${W} scroll-mt-24 py-24`}>
      <Reveal className="max-w-2xl">
        <Eyebrow>trust model</Eyebrow>
        <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone">what you trust, said out loud.</h2>
      </Reveal>
      <div className="mt-12 border-t border-line">
        {rows.map(([k, v, t], i) => (
          <Reveal key={k} delay={i * 0.05}>
            <div className="group grid grid-cols-[minmax(0,1fr)] gap-3 border-b border-line py-6 transition-colors hover:bg-white/[0.015] md:grid-cols-[220px_1fr_160px] md:items-center md:gap-8">
              <div className="font-mono text-[13px] uppercase tracking-[0.14em] text-bone">{k}</div>
              <div className="text-sm leading-relaxed text-slate">{v}</div>
              <div className="md:text-right">
                <Chip tone={t === "trustless" ? "safu" : t === "next" ? "dim" : "ice"}>{t}</Chip>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────── wall preview ─────────────────────────

export function WallPreview() {
  const { data } = useApi(() => api.wall(), []);
  const rows = data?.slice(0, 4) ?? [];
  return (
    <section className={`${W} py-24`}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Reveal>
          <Eyebrow tone="rug">wall of rugs</Eyebrow>
          <h2 className="mt-5 font-display text-4xl leading-[1.02] text-bone">
            <Scramble text="caught. pinned. forever." />
          </h2>
        </Reveal>
        <Button href="/wall" variant="ghost">
          Full wall <ArrowRight />
        </Button>
      </div>
      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        {rows.length === 0 &&
          Array.from({ length: 4 }, (_, i) => <div key={i} className="h-36 animate-pulse border border-line bg-panel" />)}
        {rows.map((r, i) => {
          const { chain, addr } = splitTokenKey(r.token_key);
          return (
            <Reveal key={r.id} delay={i * 0.06}>
              <Link href={`/wall#r${r.id}`} className="group block">
                <Panel className="relative overflow-hidden p-6 transition-colors group-hover:border-rug/50">
                  <div aria-hidden className="absolute inset-y-0 right-0 w-40 bg-flames opacity-0 transition-opacity duration-500 [mask-image:linear-gradient(to_left,black,transparent)] group-hover:opacity-30" />
                  <div className="relative flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-rug">
                        <Dot tone="rug" /> report #{r.id} · {r.rule}
                      </div>
                      <div className="mt-3 truncate font-mono text-[15px] text-bone">{addr}</div>
                      <div className="mt-1 font-mono text-[12px] text-dim">
                        {chainLabel(chain)} · {ago(r.reported_at_ms)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-display text-2xl text-safu">{fmtUsd(usdc(r.total_payout_usdc))}</div>
                      <div className="font-mono text-[11px] text-dim">paid out</div>
                    </div>
                  </div>
                </Panel>
              </Link>
            </Reveal>
          );
        })}
      </div>
    </section>
  );
}

// ───────────────────────── closing CTA ─────────────────────────

export function FinalCta() {
  return (
    <section className={`${W} pb-8 pt-16`}>
      <Reveal>
        <div className="relative isolate overflow-hidden border border-line-strong px-6 py-24 text-center sm:px-16">
          <Corners className="border-safu" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-flames opacity-[0.22]" />
          <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,rgb(10_10_10/0.75),rgb(10_10_10/0.96))]" />
          <DitherIn cell={16} duration={1300} />
          <h2 className="font-display text-[clamp(2.4rem,6vw,5rem)] leading-[0.95] text-bone">
            funds are <span className="text-safu">safu.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-lg text-ice">Check any coin&apos;s rug odds in seconds. Cover it for 7 days. Get paid on the chain you choose.</p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Button href="/buy" size="lg">
              Buy cover <ArrowRight />
            </Button>
            <Button href="/underwrite" size="lg" variant="outline">
              Underwrite
            </Button>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

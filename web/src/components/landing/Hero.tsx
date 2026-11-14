"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useState } from "react";
import Link from "next/link";
import { api, fmtUsd, splitTokenKey, usdc } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { ArrowRight } from "../ui";
import { Mascot } from "./Mascot";

const PixelScene = dynamic(() => import("./PixelScene"), { ssr: false });

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

  const { data: cfg } = useApi(() => api.config(), [], 20_000);
  const paid = cfg ? usdc(cfg.pool.total_paid_out_usdc) : null;

  return (
    <section className="relative isolate min-h-[100dvh] overflow-hidden pt-16">
      <PixelScene className="absolute inset-0 -z-10 h-full w-full" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_55%_at_22%_45%,rgb(10_10_10/0.85),rgb(10_10_10/0.4)_60%,transparent)]" />
      <div aria-hidden className="absolute inset-x-0 bottom-0 -z-10 h-10 bg-gradient-to-t from-void to-transparent" />

      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-[1320px] grid-cols-[minmax(0,1fr)] items-center gap-14 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1fr_400px]">
        <div>
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: paid === null ? 0 : 1, y: 0 }} transition={{ duration: 0.6 }}>
            <Link href="/wall" className="group inline-flex items-center gap-3 text-sm text-slate transition-colors hover:text-bone">
              <span className="h-px w-8 bg-safu transition-all duration-300 group-hover:w-12" />
              <span>
                <span className="font-mono text-bone">{paid !== null ? fmtUsd(paid, { digits: 2 }) : "$0.00"}</span> paid back to rugged holders so far
              </span>
            </Link>
          </motion.div>

          <h1 className="mt-7 font-display text-[clamp(2.3rem,4.6vw,4.6rem)] leading-[0.95] tracking-[-0.02em] text-bone">
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

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6, duration: 0.8 }} className="mt-7 max-w-[46ch] text-lg leading-relaxed text-ice">
            Rug cover for any memecoin on any chain. If the dev dumps within 7 days, you&apos;re paid wherever you choose.
          </motion.p>

          <motion.form
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.75, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
            className="mt-10 max-w-2xl"
          >
            <label htmlFor="hero-ca" className="sr-only">
              Token contract address
            </label>
            <div className="flex items-stretch border border-white/10 bg-ink/80 shadow-[inset_0_1px_0_rgb(255_255_255/0.06)] backdrop-blur-md transition-colors focus-within:border-safu/70">
              <input
                id="hero-ca"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste a token address or NEAR account"
                spellCheck={false}
                autoComplete="off"
                className="h-16 min-w-0 flex-1 bg-transparent px-5 font-mono text-[15px] text-bone placeholder:text-slate focus:outline-none"
              />
              <button
                type="submit"
                className="group/btn m-2 inline-flex items-center gap-2 bg-safu px-5 text-sm font-medium text-void transition-colors hover:bg-[#d6ff70] active:translate-y-px"
              >
                <span className="hidden sm:inline">Check rug odds</span>
                <ArrowRight />
              </button>
            </div>
          </motion.form>
        </div>

        <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9, duration: 1, ease: [0.16, 1, 0.3, 1] }} className="hidden lg:block">
          <Mascot />
        </motion.div>
      </div>
    </section>
  );
}

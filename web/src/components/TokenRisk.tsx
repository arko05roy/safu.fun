"use client";

import { motion } from "motion/react";
import { useNow } from "@/lib/hooks";
import { chainLabel, explorer, fmtCompact, fmtUsd, type TokenView, units, usdc } from "@/lib/api";
import { PixelMeter } from "./landing/Sections";
import { Addr, Chip, Dot, Panel } from "./ui";

const FACTOR_LABEL: Record<string, string> = {
  deployer_share: "deployer share",
  insider_concentration: "insider concentration",
  token_age: "token age",
  holder_count: "holder count",
  uno_reverse: "uno reverse",
};

const addrHref = (chain: string, a: string) => (chain === "near" ? explorer.nearAccount(a) : explorer.evmAddr(chain, a));

export function TokenRisk({ v }: { v: TokenView }) {
  const { profile: p, risk, onchain } = v;
  const uno = v.uno && v.uno.status === "Active";
  const hot = risk.rugOddsPct >= 60 && !uno;
  const supply = units(p.totalSupply, p.decimals);
  const pct = (b: string) => (supply > 0 ? (units(b, p.decimals) / supply) * 100 : 0);
  const now = useNow(60_000);
  const ageDays = p.createdAtMs ? (now - p.createdAtMs) / 86_400_000 : null;

  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line p-6">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center border border-line-strong bg-ink font-display text-lg text-bone">{p.symbol.slice(0, 3)}</div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-2xl text-bone">{p.symbol}</h2>
                {uno && <Chip tone="safu">⟲ uno reverse</Chip>}
                {onchain.rugged_report_id !== null && <Chip tone="rug">rugged</Chip>}
              </div>
              <div className="mt-1 text-sm text-slate">
                {p.name} · {chainLabel(p.chain)}
              </div>
            </div>
          </div>
          <Addr value={p.address} href={addrHref(p.chain, p.address)} />
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-8 p-6 md:grid-cols-[auto_1fr] md:items-center">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">rug odds</div>
            <motion.div
              key={risk.rugOddsPct}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-2 font-display text-7xl leading-none tabular ${uno ? "text-safu" : hot ? "text-rug" : "text-bone"}`}
            >
              {risk.rugOddsPct.toFixed(1)}
              <span className="text-4xl">%</span>
            </motion.div>
            <div className="mt-3 font-mono text-[13px] text-ice">
              premium <span className="text-bone">{(risk.premiumBps / 100).toFixed(2)}%</span> of cover
            </div>
          </div>
          <div>
            <PixelMeter value={uno ? 0.02 : risk.score} hot={hot} cells={32} />
            <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
              <span>safu</span>
              <span>degen</span>
              <span>rug</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] border-t border-line sm:grid-cols-2">
          {risk.factors.map((f, i) => (
            <div key={f.name} className={`p-5 ${i % 2 === 0 ? "sm:border-r" : ""} ${i < risk.factors.length - (risk.factors.length % 2 === 0 ? 2 : 1) ? "border-b" : ""} border-line`}>
              <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em]">
                <span className="text-ice">{FACTOR_LABEL[f.name] ?? f.name}</span>
                <span className="text-dim">w {f.weight}</span>
              </div>
              <div className="mt-3 h-1.5 bg-line">
                <motion.div
                  className={`h-full ${f.value >= 0.7 ? "bg-rug" : f.value >= 0.4 ? "bg-ice" : "bg-safu"}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(2, f.value * 100)}%` }}
                  transition={{ duration: 0.9, delay: 0.1 * i, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <div className="mt-2 text-[13px] text-slate">{f.detail}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3">
        <Panel className="p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">supply</div>
          <div className="mt-2 font-mono text-xl text-bone">{fmtCompact(supply)}</div>
        </Panel>
        <Panel className="p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">holders · age</div>
          <div className="mt-2 font-mono text-xl text-bone">
            {p.holderCount ?? "25+"} · {ageDays === null ? "?" : ageDays < 1 ? `${Math.round(ageDays * 24)}h` : `${ageDays.toFixed(0)}d`}
          </div>
        </Panel>
        <Panel className="p-5">
          <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">live cover</div>
          <div className="mt-2 font-mono text-xl text-bone">
            {fmtUsd(usdc(onchain.exposure_usdc))} <span className="text-sm text-dim">· {onchain.active_policy_ids.length} pol.</span>
          </div>
        </Panel>
      </div>

      <Panel>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">wallets the watcher will track</div>
          <span className="flex items-center gap-2 font-mono text-[11px] text-dim">
            <Dot tone="safu" pulse /> {1 + p.insiders.length} watched
          </span>
        </div>
        <ul className="divide-y divide-line">
          {p.deployer && <WalletRow chain={p.chain} label="deployer · R1" addr={p.deployer} share={pct(p.deployerBalance)} hot />}
          {p.insiders.map((h, i) => (
            <WalletRow key={h.address} chain={p.chain} label={`insider ${i + 1} · R2`} addr={h.address} share={pct(h.balance)} />
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function WalletRow({ chain, label, addr, share, hot }: { chain: string; label: string; addr: string; share: number; hot?: boolean }) {
  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-4 px-5 py-3.5 sm:grid-cols-[150px_1fr_auto]">
      <span className={`font-mono text-[11px] uppercase tracking-[0.14em] ${hot ? "text-rug" : "text-slate"}`}>{label}</span>
      <span className="order-3 col-span-2 min-w-0 sm:order-none sm:col-span-1">
        <Addr value={addr} href={addrHref(chain, addr)} />
      </span>
      <span className="text-right font-mono text-[13px] text-bone tabular">{share.toFixed(1)}%</span>
    </li>
  );
}

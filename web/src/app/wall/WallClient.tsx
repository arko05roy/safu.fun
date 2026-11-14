"use client";

import { motion } from "motion/react";
import { Reveal, Scramble, Tick } from "@/components/fx";
import { Addr, Chip, Corners, Dot, Eyebrow, Panel } from "@/components/ui";
import { ago, api, chainLabel, explorer, fmtUsd, parseEvidence, type Report, splitTokenKey, usdc } from "@/lib/api";
import { useApi } from "@/lib/hooks";

export default function WallClient() {
  const { data, error } = useApi(() => api.wall(), [], 30_000);
  const total = data?.reduce((a, r) => a + usdc(r.total_payout_usdc), 0) ?? 0;
  const devs = new Set(data?.map((r) => devOf(r)).filter(Boolean));

  return (
    <div>
      <section className="relative isolate overflow-hidden border-b border-line pb-20 pt-36">
        <div aria-hidden className="absolute inset-0 -z-10 bg-flames opacity-[0.16]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-b from-void/40 via-void/85 to-void" />
        <div className="mx-auto max-w-[1320px] px-4 sm:px-6">
          <Eyebrow tone="rug">wall of rugs</Eyebrow>
          <h1 className="mt-5 font-display text-[clamp(2.8rem,8vw,6.5rem)] leading-[0.92] text-bone">
            <Scramble text="every dev who rugged." />
            <br />
            <span className="text-rug">
              <Scramble text="pinned forever." delay={0.3} />
            </span>
          </h1>
          <div className="mt-14 grid max-w-3xl grid-cols-3 gap-6 border-t border-line pt-8">
            <Big label="rugs caught" value={data?.length ?? 0} format={(n) => String(Math.round(n))} />
            <Big label="paid back" value={total} format={(n) => fmtUsd(n, { digits: 2 })} />
            <Big label="dev wallets" value={devs.size} format={(n) => String(Math.round(n))} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 pt-14 sm:px-6">
        {error && <div className="font-mono text-sm text-rug">{error.message}</div>}
        {!data && !error && (
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-72 animate-pulse border border-line bg-panel" />
            ))}
          </div>
        )}
        {data && data.length === 0 && <div className="py-20 text-center font-mono text-slate">No rugs yet. The wall is waiting.</div>}
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.map((r, i) => (
            <Reveal key={r.id} delay={(i % 3) * 0.06}>
              <Plaque r={r} />
            </Reveal>
          ))}
        </div>
      </section>
    </div>
  );
}

function devOf(r: Report): string | null {
  for (const e of r.evidence) {
    const ev = parseEvidence(e);
    if (ev.kind === "balance") return ev.account;
  }
  return null;
}

function Big({ label, value, format }: { label: string; value: number; format: (n: number) => string }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">{label}</div>
      <div className="mt-2 font-display text-3xl text-bone sm:text-4xl">
        <Tick value={value} format={format} />
      </div>
    </div>
  );
}

function Plaque({ r }: { r: Report }) {
  const { chain, addr } = splitTokenKey(r.token_key);
  const dev = devOf(r);
  const bal = r.evidence.map(parseEvidence).find((e) => e.kind === "balance");
  const txs = r.evidence.map(parseEvidence).filter((e) => e.kind === "tx");
  const dumped = bal && bal.kind === "balance" ? pctDrop(bal.from, bal.to) : null;

  return (
    <motion.article id={`r${r.id}`} whileHover={{ y: -4 }} transition={{ type: "spring", stiffness: 300, damping: 22 }} className="group relative scroll-mt-28">
      <Panel className="overflow-hidden transition-colors group-hover:border-rug/50">
        <div aria-hidden className="absolute inset-x-0 top-0 h-28 bg-flames opacity-[0.12] transition-opacity duration-500 [mask-image:linear-gradient(to_bottom,black,transparent)] group-hover:opacity-40" />
        <div className="relative p-6">
          <div className="flex items-center justify-between">
            <Chip tone="rug">
              <Dot tone="rug" /> {r.rule} · {r.rule === "R1" ? "deployer dump" : r.rule === "R2" ? "insider dump" : "lp pull"}
            </Chip>
            <span className="font-mono text-[11px] text-dim">#{r.id}</span>
          </div>
          <div className="mt-8 font-mono text-[11px] uppercase tracking-[0.18em] text-slate">dev wallet</div>
          <div className="mt-1 truncate font-display text-lg text-bone">{dev ?? "—"}</div>
          {dumped !== null && (
            <div className="mt-4">
              <div className="flex justify-between font-mono text-[11px] text-dim">
                <span>dumped</span>
                <span className="text-rug">{dumped.toFixed(0)}%</span>
              </div>
              <div className="mt-1.5 h-1.5 bg-line">
                <motion.div className="h-full bg-rug" initial={{ width: 0 }} whileInView={{ width: `${dumped}%` }} viewport={{ once: true }} transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }} />
              </div>
            </div>
          )}
          <dl className="mt-6 space-y-2 border-t border-dashed border-line-strong pt-4 font-mono text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-dim">coin</dt>
              <dd className="min-w-0">
                <Addr value={addr} href={chain === "near" ? explorer.nearAccount(addr) : explorer.evmAddr(chain, addr)} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dim">chain</dt>
              <dd className="text-ice">{chainLabel(chain)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-dim">caught</dt>
              <dd className="text-ice">{ago(r.reported_at_ms)}</dd>
            </div>
          </dl>
          <div className="mt-6 flex items-end justify-between">
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-slate">paid back</div>
              <div className="mt-1 font-display text-3xl text-safu">{fmtUsd(usdc(r.total_payout_usdc), { digits: 2 })}</div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {txs.slice(0, 2).map((t) =>
                t.kind === "tx" ? (
                  <a key={t.hash} href={t.href} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-slate underline decoration-line-strong underline-offset-4 hover:text-bone">
                    {t.hash.slice(0, 8)}… ↗
                  </a>
                ) : null,
              )}
            </div>
          </div>
        </div>
        <Corners className="border-rug/60" />
      </Panel>
    </motion.article>
  );
}

function pctDrop(from: string, to: string) {
  try {
    const f = BigInt(from), t = BigInt(to);
    if (f === 0n) return null;
    return Number(((f - t) * 10000n) / f) / 100;
  } catch {
    return null;
  }
}

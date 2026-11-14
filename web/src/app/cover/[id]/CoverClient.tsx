"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PayoutTakeover, payoutLink } from "@/components/PayoutTakeover";
import { Addr, ArrowRight, Button, Chip, Dot, Eyebrow, Notice, Panel } from "@/components/ui";
import { ago, api, chainLabel, countdown, explorer, fmtUsd, parseEvidence, type Payout, type Policy, type Report, usdc } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";

type Phase = "ACTIVE" | "REPORTED" | "FINALIZED" | "PAID" | "EXPIRED" | "NOT_ELIGIBLE";

const PHASES: Phase[] = ["ACTIVE", "REPORTED", "FINALIZED", "PAID"];

export default function CoverClient() {
  const { id } = useParams<{ id: string }>();
  const pid = Number(id);
  const now = useNow(1000);
  const { data: policy, error } = useApi(() => api.policy(pid), [pid], 8000);
  const claimedPayoutId = policy && typeof policy.status === "object" ? policy.status.Claimed.payout_id : null;
  const { data: payout } = useApi(claimedPayoutId !== null ? () => api.payout(claimedPayoutId) : null, [claimedPayoutId], 6000);
  const { data: token } = useApi(policy ? () => api.token(policy.token_chain, policy.token_addr) : null, [policy?.token_key], 10_000);
  const reportId = payout?.report_id ?? token?.onchain.open_report_id ?? token?.onchain.rugged_report_id ?? null;
  const { data: report } = useApi(reportId !== null ? () => api.report(reportId) : null, [reportId], 6000);
  const { data: cfg } = useApi(() => api.config(), [], 15_000);

  const phase = phaseOf(policy, report, payout, now);
  const [takeover, setTakeover] = useState(false);

  // trigger the payout moment once per policy per browser
  useEffect(() => {
    if (!payout || !["Paid", "Signed", "Sent"].includes(payout.status)) return;
    const key = `safu:takeover:${pid}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {}
    setTakeover(true);
  }, [payout, pid]);

  if (error)
    return (
      <div className="mx-auto max-w-3xl px-4 pt-32">
        <Notice tone="rug">{error.status === 404 ? `Policy #${id} doesn't exist.` : error.message}</Notice>
      </div>
    );

  if (!policy)
    return (
      <div className="mx-auto max-w-[1320px] px-4 pt-32 sm:px-6">
        <div className="h-64 animate-pulse border border-line bg-panel" />
      </div>
    );

  const left = policy.expires_at_ms - now;
  const total = policy.expires_at_ms - policy.starts_at_ms;
  const elapsed = Math.min(1, Math.max(0, (now - policy.starts_at_ms) / total));
  const hb = cfg?.watcher_heartbeat_ms;
  const watch = token?.onchain.watch;
  const symbol = token?.profile.symbol ?? policy.token_addr.split(".")[0];
  const rugged = ["REPORTED", "FINALIZED", "PAID"].includes(phase);

  return (
    <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-28 sm:px-6">
      <PayoutTakeover open={takeover} payout={payout} onClose={() => setTakeover(false)} />

      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <Eyebrow tone={rugged ? "rug" : "safu"}>policy #{policy.id}</Eyebrow>
          <h1 className="mt-4 font-display text-4xl text-bone sm:text-5xl">
            {fmtUsd(usdc(policy.cover_usdc), { digits: 2 })} on <span className={rugged ? "text-rug" : "text-safu"}>{symbol}</span>
          </h1>
        </div>
        <PhaseBadge phase={phase} />
      </div>

      {/* state machine */}
      <Panel className="mt-8 overflow-hidden">
        <div className="grid grid-cols-4">
          {PHASES.map((p, i) => {
            const idx = PHASES.indexOf(phase as Phase);
            const done = idx >= i;
            const current = idx === i;
            const tone = p === "ACTIVE" ? "safu" : p === "PAID" ? "safu" : "rug";
            return (
              <div key={p} className={`relative border-line p-4 sm:p-6 ${i > 0 ? "border-l" : ""}`}>
                <div className="font-mono text-[10px] text-dim">0{i + 1}</div>
                <div className={`mt-2 font-mono text-[11px] uppercase tracking-[0.14em] sm:text-[13px] ${done ? (tone === "rug" ? "text-rug" : "text-safu") : "text-dim"}`}>{p}</div>
                {current && <motion.div layoutId="phase" className={`absolute inset-x-0 bottom-0 h-0.5 ${tone === "rug" ? "bg-rug" : "bg-safu"}`} />}
                {done && !current && <div className={`absolute inset-x-0 bottom-0 h-0.5 ${tone === "rug" ? "bg-rug/40" : "bg-safu/40"}`} />}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[1fr_400px]">
        <div className="space-y-6">
          {/* countdown */}
          <Panel className="relative overflow-hidden p-6 sm:p-8">
            <div aria-hidden className="absolute inset-y-0 right-0 w-1/2 bg-dither opacity-[0.1] [mask-image:linear-gradient(to_left,black,transparent)]" />
            <div className="relative">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">{phase === "ACTIVE" ? "cover ends in" : phase === "EXPIRED" ? "cover ended" : "rug detected"}</div>
              <div className={`mt-3 font-display text-[clamp(2.6rem,7vw,5rem)] leading-none tabular ${rugged ? "text-rug" : "text-bone"}`}>
                {phase === "ACTIVE" ? countdown(left) : phase === "EXPIRED" ? "00:00:00" : report ? ago(report.reported_at_ms, now) : "-"}
              </div>
              <div className="mt-6 flex h-2 gap-[2px]">
                {Array.from({ length: 56 }, (_, i) => (
                  <span key={i} className={`flex-1 ${i / 56 < elapsed ? (rugged ? "bg-rug/70" : "bg-safu/70") : "bg-line"}`} />
                ))}
              </div>
              <div className="mt-2 flex justify-between font-mono text-[11px] text-dim">
                <span>{new Date(policy.starts_at_ms).toLocaleString()}</span>
                <span>{new Date(policy.expires_at_ms).toLocaleString()}</span>
              </div>
            </div>
          </Panel>

          {report && <ReportPanel report={report} now={now} />}
          {payout && <PayoutPanel payout={payout} onReplay={() => setTakeover(true)} />}

          {/* watched wallets */}
          <Panel>
            <div className="flex items-center justify-between border-b border-line px-6 py-4">
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">watch</div>
              <span className="flex items-center gap-2 font-mono text-[11px] text-dim">
                <Dot tone={hb && now - hb < 300_000 ? "safu" : "dim"} pulse={Boolean(hb && now - hb < 300_000)} />
                heartbeat {hb ? ago(hb, now) : "-"}
              </span>
            </div>
            {watch ? (
              <ul className="divide-y divide-line">
                {[{ ...watch.deployer, role: "deployer · R1" }, ...watch.insiders.map((h, i) => ({ ...h, role: `insider ${i + 1} · R2` }))].map((h) => (
                  <li key={h.address} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3.5">
                    <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-slate">{h.role}</span>
                    <Addr value={h.address} href={policy.token_chain === "near" ? explorer.nearAccount(h.address) : explorer.evmAddr(policy.token_chain, h.address)} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-6 py-5 text-sm text-slate">{rugged ? "Watch closed after the rug was reported." : "Loading watch…"}</div>
            )}
          </Panel>
        </div>

        <div className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <Panel className="p-6">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">policy</div>
            <dl className="mt-5 space-y-3 font-mono text-[13px]">
              <Row k="token">
                <Link href={`/buy?chain=${policy.token_chain}&token=${policy.token_addr}`} className="text-ice hover:text-bone">
                  {policy.token_addr.length > 24 ? `${policy.token_addr.slice(0, 22)}…` : policy.token_addr}
                </Link>
              </Row>
              <Row k="token chain">{chainLabel(policy.token_chain)}</Row>
              <Row k="cover">{fmtUsd(usdc(policy.cover_usdc), { digits: 2 })}</Row>
              <Row k="premium">{(policy.premium_bps / 100).toFixed(2)}%</Row>
              <Row k="max payout">{fmtUsd(usdc(policy.cover_usdc) * 0.8, { digits: 2 })}</Row>
              <Row k="paid on">{chainLabel(policy.payout_chain)}</Row>
              <Row k="recipient">
                <Addr value={policy.recipient} />
              </Row>
              <Row k="bought">{new Date(policy.created_at_ms).toLocaleDateString()}</Row>
            </dl>
          </Panel>
          <Button href="/buy" variant="outline" className="w-full">
            Cover another coin <ArrowRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function phaseOf(policy: Policy | null, report: Report | null, payout: Payout | null, now: number): Phase {
  if (!policy) return "ACTIVE";
  if (payout && ["Paid", "Signed", "Sent"].includes(payout.status)) return "PAID";
  if (typeof policy.status === "object") return "FINALIZED";
  if (policy.status === "NotEligible") return "NOT_ELIGIBLE";
  if (report && (report.status === "Pending" || report.status === "Disputed")) return "REPORTED";
  if (policy.status === "Expired" || now > policy.expires_at_ms) return "EXPIRED";
  return "ACTIVE";
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, [string, "safu" | "rug" | "dim" | "ice"]> = {
    ACTIVE: ["cover active", "safu"],
    REPORTED: ["rug reported · dispute window", "rug"],
    FINALIZED: ["rug finalized · payout queued", "rug"],
    PAID: ["paid out", "safu"],
    EXPIRED: ["expired · no rug", "dim"],
    NOT_ELIGIBLE: ["not eligible", "dim"],
  };
  const [label, tone] = map[phase];
  return (
    <Chip tone={tone} className="py-1.5 text-[12px]">
      <Dot tone={tone === "dim" ? "dim" : tone} pulse={phase === "ACTIVE" || phase === "REPORTED"} /> {label}
    </Chip>
  );
}

function ReportPanel({ report, now }: { report: Report; now: number }) {
  const left = report.dispute_deadline_ms - now;
  return (
    <Panel className="border-rug/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-6 py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-rug">
          report #{report.id} · rule {report.rule}
        </div>
        <Chip tone={report.status === "Finalized" ? "rug" : "ice"}>{report.status === "Pending" && left > 0 ? `dispute window ${countdown(left)}` : report.status.toLowerCase()}</Chip>
      </div>
      <ul className="divide-y divide-line">
        {report.evidence.map((e) => {
          const ev = parseEvidence(e);
          return (
            <li key={e} className="px-6 py-3.5 font-mono text-[13px]">
              {ev.kind === "tx" ? (
                <a href={ev.href} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-4 text-ice hover:text-bone">
                  <span>dump tx</span>
                  <span className="truncate">{ev.hash.slice(0, 18)}… ↗</span>
                </a>
              ) : ev.kind === "balance" ? (
                <div className="flex flex-wrap items-center justify-between gap-2 text-slate">
                  <span className="truncate">{ev.account}</span>
                  <span className="text-ice">
                    {short(ev.from)} → <span className="text-rug">{short(ev.to)}</span>
                  </span>
                </div>
              ) : (
                <span className="break-all text-slate">{ev.text}</span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const short = (raw: string) => {
  try {
    const n = Number(BigInt(raw) / 10n ** 18n);
    return new Intl.NumberFormat("en-US", { notation: "compact" }).format(n);
  } catch {
    return raw;
  }
};

function PayoutPanel({ payout, onReplay }: { payout: Payout; onReplay: () => void }) {
  const link = payoutLink(payout);
  const rail = payout.rail === "ChainSig" ? "chain signatures (MPC)" : payout.rail === "Intents" ? "NEAR Intents" : payout.rail === "Near" ? "NEAR direct" : "pending";
  return (
    <Panel className="relative overflow-hidden border-safu/40">
      <div aria-hidden className="absolute inset-0 bg-flames opacity-[0.08]" />
      <div className="relative p-6 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Eyebrow tone="safu">payout #{payout.id}</Eyebrow>
          <Chip tone={payout.status === "Paid" ? "safu" : "ice"}>{payout.status === "Signed" ? "signed · ready to broadcast" : payout.status.toLowerCase()}</Chip>
        </div>
        <div className="mt-5 font-display text-5xl text-safu">{fmtUsd(usdc(payout.amount_usdc), { digits: 2 })}</div>
        <div className="mt-2 font-mono text-[13px] text-ice">
          to {chainLabel(payout.payout_chain)} via {rail}
        </div>
        {payout.rail === "ChainSig" && payout.evm_tx_hash && payout.status !== "Paid" && (
          <div className="mt-5 space-y-2 border-t border-line pt-4 font-mono text-[12px] text-slate">
            <div>Signed by the v1.signer MPC network from the pool&apos;s derived address. Anyone can broadcast it.</div>
            <Addr value={payout.evm_tx_hash} />
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          {link && (
            <Button href={link.href} size="sm">
              {link.label} ↗
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onReplay}>
            Replay the moment
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-dim">{k}</dt>
      <dd className="min-w-0 truncate text-right text-ice">{children}</dd>
    </div>
  );
}

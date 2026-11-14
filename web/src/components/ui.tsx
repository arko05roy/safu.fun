"use client";

import Link from "next/link";
import { useState } from "react";
import { head, rects } from "./mascot/sprite";

type Variant = "primary" | "light" | "ghost" | "outline" | "danger";

const BTN: Record<Variant, string> = {
  primary: "bg-safu text-void hover:bg-[#d6ff70]",
  light: "bg-bone text-void hover:bg-white",
  ghost: "text-ice hover:text-bone hover:bg-white/5",
  outline: "border border-white/15 text-bone hover:border-white/40 hover:bg-white/[0.04]",
  danger: "bg-rug text-bone hover:bg-[#ff5a50]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  href,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; href?: string }) {
  const sz = size === "lg" ? "h-13 px-6 text-[15px]" : size === "sm" ? "h-9 px-3.5 text-[13px]" : "h-11 px-5 text-sm";
  const cls = `group/btn relative inline-flex select-none items-center justify-center gap-2 font-medium transition-colors duration-200 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 ${sz} ${BTN[variant]} ${className}`;
  if (href)
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  );
}

export function Panel({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`relative border border-line bg-panel/80 backdrop-blur-sm ${className}`} {...rest}>
      <Corners />
      {children}
    </div>
  );
}

/** Pixel registration marks at each corner. */
export function Corners({ className = "border-ice/50" }: { className?: string }) {
  const c = `pointer-events-none absolute h-2 w-2 ${className}`;
  return (
    <>
      <span aria-hidden className={`${c} -left-px -top-px border-l border-t`} />
      <span aria-hidden className={`${c} -right-px -top-px border-r border-t`} />
      <span aria-hidden className={`${c} -bottom-px -left-px border-b border-l`} />
      <span aria-hidden className={`${c} -bottom-px -right-px border-b border-r`} />
    </>
  );
}

export function Eyebrow({ children, className = "", tone = "ice" }: { children: React.ReactNode; className?: string; tone?: "ice" | "safu" | "rug" }) {
  const t = tone === "safu" ? "text-safu" : tone === "rug" ? "text-rug" : "text-slate";
  return (
    <div className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] ${t} ${className}`}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 bg-current" />
      {children}
    </div>
  );
}

export function Chip({ children, tone = "ice", className = "" }: { children: React.ReactNode; tone?: "ice" | "safu" | "rug" | "dim"; className?: string }) {
  const t = {
    ice: "border-line-strong text-ice",
    safu: "border-safu/40 bg-safu/10 text-safu",
    rug: "border-rug/40 bg-rug/10 text-rug",
    dim: "border-line text-dim",
  }[tone];
  return <span className={`inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] ${t} ${className}`}>{children}</span>;
}

export function Dot({ tone = "safu", pulse = false }: { tone?: "safu" | "rug" | "ice" | "dim"; pulse?: boolean }) {
  const c = { safu: "bg-safu", rug: "bg-rug", ice: "bg-ice", dim: "bg-dim" }[tone];
  return <span aria-hidden className={`inline-block h-2 w-2 ${c} ${pulse ? "animate-pulse-dot" : ""}`} />;
}

export function Stat({ label, children, sub, className = "" }: { label: string; children: React.ReactNode; sub?: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate">{label}</div>
      <div className="mt-2 font-mono text-2xl text-bone tabular sm:text-3xl">{children}</div>
      {sub && <div className="mt-1 font-mono text-xs text-dim">{sub}</div>}
    </div>
  );
}

export function Addr({ value, href, className = "" }: { value: string; href?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const short = value.length > 26 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[13px] ${className}`}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="text-ice underline decoration-line-strong underline-offset-4 hover:text-bone hover:decoration-ice" title={value}>
          {short}
        </a>
      ) : (
        <span className="text-ice" title={value}>
          {short}
        </span>
      )}
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="text-dim transition-colors hover:text-bone"
      >
        {copied ? <span className="text-safu">✓</span> : <CopyIcon />}
      </button>
    </span>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" stroke="currentColor" />
      <path d="M1.5 8V1.5H8" stroke="currentColor" />
    </svg>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`inline-block animate-pulse bg-line ${className}`} />;
}

export function Notice({ tone = "ice", children }: { tone?: "ice" | "rug" | "safu"; children: React.ReactNode }) {
  const t = tone === "rug" ? "border-rug/40 text-rug bg-rug/5" : tone === "safu" ? "border-safu/40 text-safu bg-safu/5" : "border-line-strong text-ice bg-white/[0.02]";
  return <div className={`border px-4 py-3 font-mono text-[13px] leading-relaxed ${t}`}>{children}</div>;
}

/** The mascot's face: our logo mark. */
export function Mark({ size = 26, className = "" }: { size?: number; className?: string }) {
  const { cells, x, y, w, h } = head();
  return (
    <svg width={size} height={(size * h) / w} viewBox={`${x} ${y} ${w} ${h}`} className={className} shapeRendering="crispEdges" aria-hidden>
      {rects(cells).map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w + 0.02} height="1.02" fill={r.c} />
      ))}
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Mark />
      <span className="font-display text-[17px] leading-none tracking-tight text-bone">
        safu<span className="text-slate">.fun</span>
      </span>
    </span>
  );
}

export function ArrowRight({ className = "" }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={`transition-transform duration-200 group-hover/btn:translate-x-0.5 ${className}`} aria-hidden>
      <path d="M1 7h11M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square" />
    </svg>
  );
}

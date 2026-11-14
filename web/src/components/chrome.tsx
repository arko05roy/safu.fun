"use client";

import Lenis from "lenis";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useScroll, useSpring } from "motion/react";
import { useEffect, useState } from "react";
import { api, CONTRACT, explorer, NETWORK } from "@/lib/api";
import { useApi, useNow } from "@/lib/hooks";
import { Button, Logo } from "./ui";
import { useWallet } from "./wallet";

export function SmoothScroll() {
  const pathname = usePathname();
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 0.95 });
    let raf = 0;
    const loop = (t: number) => {
      lenis.raf(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const LINKS = [
  { href: "/buy", label: "Buy cover" },
  { href: "/underwrite", label: "Underwrite" },
  { href: "/launch", label: "UNO Reverse" },
  { href: "/wall", label: "Wall of Rugs" },
];

export function Nav() {
  const pathname = usePathname();
  const { accountId, connect, disconnect, ready } = useWallet();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [menu, setMenu] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 200, damping: 30 });

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="border-b border-line/80 bg-void/70 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-8 px-4 sm:px-6">
          <Link href="/" aria-label="safu.fun home" className="shrink-0">
            <Logo />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {LINKS.map((l) => {
              const active = pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`relative px-3 py-2 text-[14px] transition-colors ${active ? "text-bone" : "text-slate hover:text-bone"}`}
                >
                  {l.label}
                  {active && <motion.span layoutId="nav-active" className="absolute inset-x-3 -bottom-[17px] h-px bg-safu" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-5">
            <WatcherPill />
            {accountId ? (
              <div className="relative">
                <button
                  onClick={() => setMenu((m) => !m)}
                  className="flex h-9 items-center gap-2.5 border border-white/15 px-3 font-mono text-[13px] text-bone transition-colors hover:border-white/40"
                >
                  <span className="max-w-[160px] truncate">{accountId}</span>
                  <span aria-hidden className="text-slate">▾</span>
                </button>
                <AnimatePresence>
                  {menu && (
                    <motion.div
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      className="absolute right-0 top-11 w-48 border border-line bg-ink p-1 font-mono text-[12px]"
                    >
                      <a className="block px-3 py-2 text-ice hover:bg-white/5 hover:text-bone" href={explorer.nearAccount(accountId)} target="_blank" rel="noreferrer">
                        View on explorer ↗
                      </a>
                      <button
                        className="block w-full px-3 py-2 text-left text-rug hover:bg-rug/10"
                        onClick={async () => {
                          setMenu(false);
                          await disconnect();
                        }}
                      >
                        Disconnect
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <Button size="sm" variant="light" onClick={connect} disabled={!ready}>
                Connect wallet
              </Button>
            )}
            <button className="grid h-9 w-9 place-items-center border border-line-strong md:hidden" aria-label="Menu" onClick={() => setOpenOn(open ? null : pathname)}>
              <span className="block h-px w-4 bg-bone shadow-[0_5px_0_#f2f2f2,0_-5px_0_#f2f2f2]" />
            </button>
          </div>
        </div>
        <AnimatePresence>
          {open && (
            <motion.nav initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-line md:hidden">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className="block border-b border-line px-4 py-4 font-mono text-sm uppercase tracking-[0.14em] text-ice">
                  {l.label}
                </Link>
              ))}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
      <motion.div className="h-px origin-left bg-safu/70" style={{ scaleX: progress }} />
    </header>
  );
}

function WatcherPill() {
  const { data } = useApi(() => api.config(), [], 15_000);
  const now = useNow(5000);
  const hb = data?.watcher_heartbeat_ms;
  const age = hb ? now - hb : null;
  const live = age !== null && age < 5 * 60_000;
  return (
    <div
      className="hidden items-center gap-2 text-[13px] text-slate lg:flex"
      title={hb ? `Rug watcher last checked in ${new Date(hb).toLocaleTimeString()}` : "Rug watcher status unknown"}
    >
      {live && <span aria-label="Rug watcher live" className="h-1.5 w-1.5 animate-pulse-dot bg-safu" />}
      <span className="capitalize">{NETWORK}</span>
    </div>
  );
}

export function Footer() {
  return (
    <footer className="relative mt-32 border-t border-line">
      <div aria-hidden className="absolute inset-x-0 -top-px h-24 -translate-y-full bg-dither opacity-[0.12] [mask-image:linear-gradient(to_top,black,transparent)]" />
      <div className="mx-auto grid grid-cols-[minmax(0,1fr)] max-w-[1320px] gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-slate">Rug cover for any memecoin on any chain. Paid out on the chain you choose by a NEAR contract nobody can override.</p>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-dim">cover, not insurance. testnet beta.</p>
        </div>
        <FooterCol title="Product" links={[["Buy cover", "/buy"], ["Underwrite", "/underwrite"], ["UNO Reverse", "/launch"], ["Wall of Rugs", "/wall"]]} />
        <FooterCol
          title="Protocol"
          links={[
            ["Cover contract ↗", explorer.nearAccount(CONTRACT)],
            ["NEAR Intents ↗", "https://docs.near-intents.org"],
            ["Chain Signatures ↗", "https://docs.near.org/chain-abstraction/chain-signatures"],
          ]}
        />
        <FooterCol title="Rules" links={[["How rugs are judged", "/#rules"], ["Rug odds model", "/#odds"], ["Trust model", "/#trust"]]} />
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1320px] flex-wrap items-center justify-between gap-3 px-4 py-5 font-mono text-[11px] uppercase tracking-[0.16em] text-dim sm:px-6">
          <span>© 2026 safu.fun</span>
          <span>built on NEAR · Intents · Chain Signatures</span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-dim">{title}</div>
      <ul className="mt-4 space-y-2.5">
        {links.map(([label, href]) => (
          <li key={href}>
            {href.startsWith("http") ? (
              <a href={href} target="_blank" rel="noreferrer" className="text-sm text-ice transition-colors hover:text-bone">
                {label}
              </a>
            ) : (
              <Link href={href} className="text-sm text-ice transition-colors hover:text-bone">
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

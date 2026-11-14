"use client";

import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { chainLabel, explorer, fmtUsd, type Payout, shortAddr, usdc } from "@/lib/api";
import { Button } from "./ui";

const FlameField = dynamic(() => import("./three/FlameField"), { ssr: false });

export function payoutLink(p: Payout): { href: string; label: string } | null {
  if (p.rail === "ChainSig") return p.status === "Paid" && p.evm_tx_hash ? { href: explorer.evmTx(p.payout_chain, p.evm_tx_hash), label: "view tx" } : null;
  if (p.dest_tx_hash) {
    if (p.payout_chain === "near" || p.rail === "Near") return { href: explorer.nearTx(p.dest_tx_hash), label: "view tx" };
    if (p.dest_tx_hash.startsWith("0x")) return { href: explorer.evmTx(p.payout_chain, p.dest_tx_hash), label: "view tx" };
  }
  if (p.rail === "Near" && p.status === "Paid") return { href: explorer.nearAccount(p.recipient), label: "view recipient" };
  return null;
}

/** Full-screen flame takeover for the payout moment (PRD §7.1-3). */
export function PayoutTakeover({ open, payout, onClose }: { open: boolean; payout: Payout | null; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.documentElement.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", k);
      document.documentElement.style.overflow = "";
    };
  }, [open, onClose]);

  const link = payout ? payoutLink(payout) : null;

  return (
    <AnimatePresence>
      {open && payout && (
        <motion.div
          role="dialog"
          aria-modal
          aria-label="Payout sent"
          className="fixed inset-0 z-[100] overflow-hidden bg-void"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.4 } }}
        >
          {/* red flash */}
          <motion.div className="absolute inset-0 bg-rug" initial={{ opacity: 0.9 }} animate={{ opacity: 0 }} transition={{ duration: 0.7, ease: "easeOut" }} />
          {/* rising brand flames */}
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-flames opacity-30"
            initial={{ backgroundPositionY: "0px" }}
            animate={{ backgroundPositionY: "-598px" }}
            transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
          />
          <FlameField heat={1} className="absolute inset-x-0 bottom-0 h-[70vh] opacity-80" />
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(10_10_10/0.88),rgb(10_10_10/0.35)_70%)]" />
          <div aria-hidden className="absolute inset-0 scanlines opacity-50" />

          <div className="relative flex h-full flex-col items-center justify-center px-6 text-center">
            <motion.div
              initial={{ scale: 2.4, opacity: 0, rotate: -6 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: "spring", stiffness: 160, damping: 14, delay: 0.15 }}
              className="font-display text-[clamp(3.4rem,13vw,10rem)] leading-none text-rug [text-shadow:0_0_60px_rgb(255_59_48/0.6)]"
            >
              ⟲ RUGGED.
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.6 }} className="mt-6 font-display text-[clamp(1.6rem,4.6vw,3.4rem)] leading-tight text-bone">
              {fmtUsd(usdc(payout.amount_usdc), { digits: 2 })} {payout.status === "Signed" ? "signed for" : "sent to"} {chainLabel(payout.payout_chain)}
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-4 font-mono text-[15px] text-ice">
              → {shortAddr(payout.recipient, 14, 8)}
              {payout.status === "Signed" && <div className="mt-2 text-[12px] text-slate">MPC-signed by NEAR Chain Signatures · ready to broadcast</div>}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3 }} className="mt-12 flex flex-wrap justify-center gap-3">
              {link && (
                <Button href={link.href} variant="primary">
                  {link.label} ↗
                </Button>
              )}
              <Button variant="outline" className="border-ice/60 bg-void/60" onClick={onClose}>
                Close
              </Button>
            </motion.div>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6 }} className="absolute bottom-8 font-mono text-[11px] uppercase tracking-[0.24em] text-safu">
              the rug got rugged · paid by a NEAR contract
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { WalletSelector } from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { CONTRACT, NETWORK } from "@/lib/api";
import "@near-wallet-selector/modal-ui/styles.css";

export interface FnCall {
  receiverId: string;
  method: string;
  args: object;
  gasTgas?: number;
  depositYocto?: string;
}

interface WalletCtx {
  ready: boolean;
  accountId: string | null;
  connect: () => void;
  disconnect: () => Promise<void>;
  /** Returns the final outcome (injected/popup wallets) or null when the wallet redirects. */
  call: (c: FnCall) => Promise<unknown | null>;
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMyNearWallet }] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/my-near-wallet"),
      ]);
      const s = await setupWalletSelector({ network: NETWORK, modules: [setupMyNearWallet()] });
      if (cancelled) return;
      const m = setupModal(s, { contractId: CONTRACT, theme: "dark", description: "Connect a NEAR wallet to pay cover premiums and stake $SAFU." });
      const sync = () => setAccountId(s.store.getState().accounts.find((a) => a.active)?.accountId ?? null);
      sync();
      const sub = s.store.observable.subscribe(sync);
      unsub = () => sub.unsubscribe();
      setSelector(s);
      setModal(m);
    })().catch((e) => console.error("wallet selector", e));
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, []);

  const connect = useCallback(() => modal?.show(), [modal]);

  const disconnect = useCallback(async () => {
    if (!selector) return;
    const w = await selector.wallet();
    await w.signOut();
  }, [selector]);

  const call = useCallback(
    async (c: FnCall) => {
      if (!selector) throw new Error("wallet not ready");
      const { actionCreators } = await import("@near-wallet-selector/core");
      const w = await selector.wallet();
      const outcome = await w.signAndSendTransaction({
        receiverId: c.receiverId,
        actions: [
          actionCreators.functionCall(
            c.method,
            c.args as Record<string, unknown>,
            BigInt(c.gasTgas ?? 100) * 10n ** 12n,
            BigInt(c.depositYocto ?? "0"),
          ),
        ],
      });
      return outcome ?? null;
    },
    [selector],
  );

  const value = useMemo(() => ({ ready: Boolean(selector), accountId, connect, disconnect, call }), [selector, accountId, connect, disconnect, call]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet outside WalletProvider");
  return v;
}

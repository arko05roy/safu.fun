"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtUsd, parseEvidence, usdc } from "@/lib/api";
import { useApi } from "@/lib/hooks";
import { type Eyes, H, rects, sprite, W } from "../mascot/sprite";

const P = 13; // screen px per sprite pixel
const RUG_W = 26;

function Sprite({ eyes, gx, gy }: { eyes: Eyes; gx: number; gy: number }) {
  const runs = useMemo(() => rects(sprite(eyes, gx, gy)), [eyes, gx, gy]);
  return (
    <svg width={W * P} height={H * P} viewBox={`0 0 ${W} ${H}`} shapeRendering="crispEdges" aria-hidden className="block">
      {runs.map((r) => (
        <rect key={`${r.x}-${r.y}`} x={r.x} y={r.y} width={r.w + 0.02} height="1.02" fill={r.c} />
      ))}
    </svg>
  );
}

/** Striped red rug with white fringe. */
function Rug() {
  const cells: [number, number, string][] = [];
  for (let x = 0; x < RUG_W; x++) {
    const fringe = x === 0 || x === RUG_W - 1;
    for (let y = 0; y < 4; y++) {
      if (fringe) {
        if (y % 2 === 0) cells.push([x, y, "#f2f2f2"]);
        continue;
      }
      const stripe = x === 3 || x === RUG_W - 4 || (y === 1 && x > 5 && x < RUG_W - 6 && x % 4 === 0);
      cells.push([x, y, stripe ? "#f2f2f2" : y === 3 ? "#b8261e" : "#ff3b30"]);
    }
  }
  return (
    <svg width={RUG_W * P} height={4 * P} viewBox={`0 0 ${RUG_W} 4`} shapeRendering="crispEdges" aria-hidden className="block">
      {cells.map(([x, y, c]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={c} />
      ))}
    </svg>
  );
}

/** Pixel speech-bubble tail: outline + fill, 4px per pixel. */
function Tail({ alert }: { alert: boolean }) {
  const rows = ["obbbo", ".obbo", "..obo", "...oo"];
  const fill = alert ? "#ff3b30" : "#f2f2f2";
  return (
    <svg width={20} height={16} viewBox="0 0 5 4" shapeRendering="crispEdges" aria-hidden className="block">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={c === "o" ? "#15171c" : fill} />)))}
    </svg>
  );
}

type Phase = "idle" | "pulled" | "back";

export function Mascot() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [hover, setHover] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [hop, setHop] = useState(0);
  const [line, setLine] = useState(0);
  const [typed, setTyped] = useState(false);

  const { data: wall } = useApi(() => api.wall(), [], 60_000);
  const { data: cfg } = useApi(() => api.config(), [], 30_000);

  // live numbers from the contract, in its own voice
  const lines = useMemo(() => {
    const l = ["funds are safu.", "paste a coin. I'll sniff out the dev."];
    if (cfg) l.push(`${cfg.pool.policies} policies written. I watch every one.`);
    for (const r of wall?.slice(0, 3) ?? []) {
      const bal = r.evidence.map(parseEvidence).find((e) => e.kind === "balance");
      const dev = bal && bal.kind === "balance" ? bal.account.split(".")[0] : "a dev";
      l.push(`caught ${dev} dumping. paid holders ${fmtUsd(usdc(r.total_payout_usdc), { digits: 2 })}.`);
    }
    if (wall?.length) l.push(`${wall.length} rugs caught. every one is on the wall.`);
    return l;
  }, [wall, cfg]);

  const say = phase === "pulled" ? "hey! who pulled my rug?" : phase === "back" ? "nice try. uno reverse." : lines[line % lines.length];

  // eyes follow the pointer, quantized to whole pixels
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height * 0.55);
      const x = dx < -90 ? -1 : dx > 90 ? 1 : 0;
      const y = dy < -110 ? -1 : dy > 110 ? 1 : 0;
      setGaze((g) => (g.x === x && g.y === y ? g : { x, y }));
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    if (reduce) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, 2400 + Math.random() * 2600);
    };
    loop();
    return () => clearTimeout(t);
  }, [reduce]);

  useEffect(() => {
    if (phase !== "idle") return;
    const t = setTimeout(() => setLine((n) => n + 1), 5600);
    return () => clearTimeout(t);
  }, [line, phase]);

  const pullRug = useCallback(() => {
    if (phase !== "idle") return;
    setPhase("pulled");
    window.dispatchEvent(new CustomEvent("safu:rug", { detail: "pulled" }));
    setTimeout(() => {
      setPhase("back");
      window.dispatchEvent(new CustomEvent("safu:rug", { detail: "back" }));
    }, 1500);
    setTimeout(() => {
      setPhase("idle");
      setLine((n) => n + 1);
    }, 3800);
  }, [phase]);

  useEffect(() => {
    if (reduce || phase !== "idle") return;
    const t = setTimeout(pullRug, 15000);
    return () => clearTimeout(t);
  }, [reduce, phase, pullRug]);

  const eyes: Eyes = phase === "pulled" ? "wide" : phase === "back" || hover ? "happy" : blink ? "blink" : "open";
  const alert = phase === "pulled";
  const next = () => {
    setHop((h) => h + 1);
    setLine((n) => n + 1);
  };

  return (
    <div ref={ref} className="relative mx-auto flex w-[340px] select-none flex-col items-center">
      {/* dialogue box */}
      <div className="relative mb-5 h-[104px] w-full">
        <AnimatePresence mode="wait">
          <motion.button
            type="button"
            key={say}
            onClick={next}
            aria-label="Next line"
            initial={{ opacity: 0, y: 8 }}
            animate={alert ? { opacity: 1, y: 0, x: [0, -4, 4, -3, 3, 0] } : { opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: alert ? 0.4 : 0.22, ease: "easeOut" }}
            className="absolute inset-x-1 bottom-0 text-left"
          >
            {/* name plate */}
            <span className="absolute -top-3 left-3 z-10 bg-safu px-2 py-0.5 font-display text-[11px] leading-none text-void shadow-[0_-3px_0_0_#15171c,0_3px_0_0_#15171c,-3px_0_0_0_#15171c,3px_0_0_0_#15171c]">
              safu
            </span>
            <span
              className={`relative block px-5 pb-4 pt-5 font-mono text-[14px] font-medium leading-[1.5] shadow-[0_-4px_0_0_#15171c,0_4px_0_0_#15171c,-4px_0_0_0_#15171c,4px_0_0_0_#15171c,inset_0_-4px_0_0_rgb(0_0_0/0.12)] ${alert ? "bg-rug text-bone" : "bg-bone text-void"}`}
            >
              <Typed text={say} onDone={setTyped} />
              <span aria-hidden className={`absolute bottom-2 right-3 text-[10px] ${typed ? "animate-blink" : "opacity-0"} ${alert ? "text-bone" : "text-void"}`}>
                ▼
              </span>
            </span>
            <span className="absolute -bottom-[19px] left-[44%]">
              <Tail alert={alert} />
            </span>
          </motion.button>
        </AnimatePresence>
      </div>

      {/* critter */}
      <motion.button
        type="button"
        aria-label="safu, the mascot. Click to hear the next line."
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        onClick={next}
        className="relative z-10 cursor-pointer drop-shadow-[0_0_28px_rgb(185_195_214/0.18)] focus-visible:outline-offset-8"
        animate={
          phase === "pulled"
            ? { y: [0, -70, -70, 0], transition: { duration: 0.9, times: [0, 0.3, 0.6, 1], ease: "easeOut" } }
            : { y: [0, -26, 0], transition: { duration: 0.35, ease: "easeOut" } }
        }
        key={`${hop}-${phase === "pulled"}`}
      >
        <div className={reduce ? "" : "animate-bob"}>
          <Sprite eyes={eyes} gx={eyes === "open" || eyes === "blink" ? gaze.x : 0} gy={eyes === "open" || eyes === "blink" ? gaze.y : 0} />
        </div>
        <AnimatePresence>
          {alert && (
            <motion.span initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute -right-6 top-2 font-display text-4xl text-rug">
              !
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      {/* the rug */}
      <div className="relative -mt-[8px] h-[52px] w-[338px]">
        <motion.button
          type="button"
          aria-label="Pull the rug"
          onClick={pullRug}
          className="absolute left-0 top-0 cursor-grab"
          animate={
            phase === "pulled"
              ? { x: 460, opacity: 0, transition: { duration: 0.35, ease: "easeIn" } }
              : phase === "back"
                ? { x: [-460, 0], opacity: [0, 1], transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } }
                : { x: 0, opacity: 1 }
          }
        >
          <Rug />
        </motion.button>
        <AnimatePresence>
          {phase === "back" && (
            <motion.span
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 0.3 }}
              className="absolute -bottom-6 left-0 right-0 text-center font-display text-[12px] text-safu"
            >
              ⟲ uno reverse
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Typed({ text, onDone }: { text: string; onDone: (done: boolean) => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    const t = setInterval(() => setN((x) => Math.min(text.length, x + 1)), 24);
    return () => clearInterval(t);
  }, [text]);
  useEffect(() => onDone(n >= text.length), [n, text, onDone]);
  return (
    <>
      <span className="sr-only" aria-live="polite">
        {text}
      </span>
      <span aria-hidden>
        {text.slice(0, n)}
        {/* reserve the full line so the box never resizes while typing */}
        <span className="invisible">{text.slice(n)}</span>
      </span>
    </>
  );
}

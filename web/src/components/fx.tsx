"use client";

import { animate, motion, useInView, useMotionValue, useSpring, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Fade + rise on enter. */
export function Reveal({
  children,
  delay = 0,
  y = 24,
  className,
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  y?: number;
  className?: string;
  as?: "div" | "section" | "li" | "span";
}) {
  const M = motion[as];
  return (
    <M
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-10% 0px -10% 0px" }}
      transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </M>
  );
}

/** Pointer-tracked 3D tilt with a moving glare. */
export function Tilt({ children, className, max = 10, glare = true }: { children: React.ReactNode; className?: string; max?: number; glare?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mx = useMotionValue(0.5);
  const my = useMotionValue(0.5);
  const sx = useSpring(mx, { stiffness: 180, damping: 18 });
  const sy = useSpring(my, { stiffness: 180, damping: 18 });
  const rotateY = useTransform(sx, [0, 1], [-max, max]);
  const rotateX = useTransform(sy, [0, 1], [max, -max]);
  const gx = useTransform(sx, (v) => `${v * 100}%`);
  const gy = useTransform(sy, (v) => `${v * 100}%`);
  const bg = useTransform([gx, gy] as never, ([x, y]: string[]) => `radial-gradient(420px circle at ${x} ${y}, rgb(242 242 242 / 0.10), transparent 45%)`);

  return (
    <div style={{ perspective: 1100 }} className={className}>
      <motion.div
        ref={ref}
        onPointerMove={(e) => {
          const r = ref.current!.getBoundingClientRect();
          mx.set((e.clientX - r.left) / r.width);
          my.set((e.clientY - r.top) / r.height);
        }}
        onPointerLeave={() => {
          mx.set(0.5);
          my.set(0.5);
        }}
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
        className="relative h-full will-change-transform"
      >
        {children}
        {glare && <motion.div aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: bg }} />}
      </motion.div>
    </div>
  );
}

/** Number that ticks up like a terminal when it scrolls into view and on change. */
export function Tick({ value, format, className, duration = 1.4 }: { value: number; format: (n: number) => string; className?: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(from.current, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        from.current = v;
        setShown(v);
      },
    });
    return () => c.stop();
  }, [inView, value, duration]);
  return (
    <span ref={ref} className={className}>
      {format(shown)}
    </span>
  );
}

const GLYPHS = "#%&*+=<>/?!01";

/** Characters resolve out of block noise, like pixels settling. */
export function Scramble({ text, className, delay = 0, speed = 28 }: { text: string; className?: string; delay?: number; speed?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [out, setOut] = useState(text.replace(/\S/g, " "));
  useEffect(() => {
    if (!inView) return;
    let frame = 0;
    let raf = 0;
    const start = performance.now() + delay * 1000;
    const total = text.length;
    const tick = (now: number) => {
      if (now < start) {
        raf = requestAnimationFrame(tick);
        return;
      }
      frame = Math.floor((now - start) / speed);
      const settled = Math.min(total, Math.floor(frame * 0.6));
      let s = "";
      for (let i = 0; i < total; i++) {
        const ch = text[i];
        if (ch === " " || i < settled) s += ch;
        else s += GLYPHS[(i * 7 + frame) % GLYPHS.length];
      }
      setOut(s);
      if (settled < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, text, delay, speed]);
  return (
    <span ref={ref} className={className} aria-label={text}>
      <span aria-hidden>{out}</span>
    </span>
  );
}

/** Dithered pixel dissolve: a canvas of squares that clears in Bayer order as it enters view. */
export function DitherIn({ className, cell = 14, color = "#0a0a0a", duration = 900 }: { className?: string; cell?: number; color?: string; duration?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    c.width = Math.ceil(r.width / cell);
    c.height = Math.ceil(r.height / cell);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, c.width, c.height);
    if (!inView) return;
    const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    const start = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.fillStyle = color;
      for (let y = 0; y < c.height; y++) {
        // sweep top → bottom, dithered at the edge
        const local = p * 1.6 - (y / c.height) * 0.6;
        for (let x = 0; x < c.width; x++) {
          const th = (B[(y % 4) * 4 + (x % 4)] + 0.5) / 16;
          if (local < th) ctx.fillRect(x, y, 1, 1);
        }
      }
      if (p < 1) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [inView, cell, color, duration]);
  return <canvas ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 h-full w-full pixelated ${className ?? ""}`} />;
}

/** Endless horizontal ticker. */
export function Marquee({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden ${className ?? ""}`}>
      <div className="flex w-max animate-marquee gap-12 pr-12">
        {children}
        {children}
      </div>
    </div>
  );
}

/** Magnetic hover: element drifts toward the pointer. */
export function Magnetic({ children, strength = 0.25, className }: { children: React.ReactNode; strength?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = useSpring(0, { stiffness: 220, damping: 16 });
  const y = useSpring(0, { stiffness: 220, damping: 16 });
  return (
    <motion.div
      ref={ref}
      className={`inline-block ${className ?? ""}`}
      style={{ x, y }}
      onPointerMove={(e) => {
        const r = ref.current!.getBoundingClientRect();
        x.set((e.clientX - r.left - r.width / 2) * strength);
        y.set((e.clientY - r.top - r.height / 2) * strength);
      }}
      onPointerLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

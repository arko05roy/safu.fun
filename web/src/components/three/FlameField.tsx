"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

/**
 * A field of voxels whose heights follow a rising flame noise — the
 * pixel-flames brand asset, extruded into 3D. The pointer "ignites" the
 * field; `heat` (0..1) pushes the whole field toward signal red.
 */

const COLS = 84;
const ROWS = 40;
const GAP = 0.32;

// cheap 2D value noise
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number) {
  return noise(x, y) * 0.55 + noise(x * 2.1, y * 2.1) * 0.3 + noise(x * 4.3, y * 4.3) * 0.15;
}

const ICE = new THREE.Color("#b9c3d6");
const SLATE = new THREE.Color("#7f8ba3");
const DEEP = new THREE.Color("#1a1d24");
const BONE = new THREE.Color("#f2f2f2");
const RUG = new THREE.Color("#ff3b30");

function Voxels({ heat = 0, pointer }: { heat?: number; pointer: React.RefObject<{ x: number; y: number; active: boolean }> }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const tmp = useMemo(() => new THREE.Object3D(), []);
  const col = useMemo(() => new THREE.Color(), []);
  const heatRef = useRef(heat);
  const smooth = useRef({ x: 0, y: 0, a: 0 });
  useEffect(() => {
    heatRef.current = heat;
  }, [heat]);

  useFrame(({ clock }, dt) => {
    const m = mesh.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const p = pointer.current!;
    const s = smooth.current;
    const k = Math.min(1, dt * 4);
    s.x += (p.x - s.x) * k;
    s.y += (p.y - s.y) * k;
    s.a += ((p.active ? 1 : 0) - s.a) * k;
    // pointer → grid coords
    const px = (s.x * 0.5 + 0.5) * COLS;
    const py = (s.y * 0.5 + 0.5) * ROWS;
    const h = heatRef.current;

    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // flames rise: sample noise scrolling downward over time, with tongues
        const n = fbm(c * 0.11, r * 0.13 - t * 0.55);
        const tongue = Math.pow(Math.max(0, n - 0.32) / 0.68, 1.6);
        const dx = c - px, dy = r - py;
        const d2 = dx * dx + dy * dy;
        const ignite = s.a * Math.exp(-d2 / 70);
        const v = Math.min(1, tongue + ignite * 0.9 + h * 0.25);
        // quantize like a pixel mosaic
        const q = Math.round(v * 8) / 8;
        const height = 0.06 + q * 2.4;
        tmp.position.set((c - COLS / 2) * GAP, height / 2, (r - ROWS / 2) * GAP);
        tmp.scale.set(GAP * 0.86, height, GAP * 0.86);
        tmp.updateMatrix();
        m.setMatrixAt(i, tmp.matrix);

        if (q < 0.2) col.copy(DEEP).lerp(SLATE, q * 2.5);
        else if (q < 0.7) col.copy(SLATE).lerp(ICE, (q - 0.2) * 2);
        else col.copy(ICE).lerp(BONE, (q - 0.7) / 0.3);
        if (h > 0) col.lerp(RUG, h * q);
        if (ignite > 0.05) col.lerp(BONE, Math.min(0.6, ignite));
        m.setColorAt(i, col);
        i++;
      }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COLS * ROWS]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.55} metalness={0.15} />
    </instancedMesh>
  );
}

function Rig({ scroll }: { scroll: React.RefObject<number> }) {
  const { camera } = useThree();
  useFrame(() => {
    const y = scroll.current ?? 0;
    camera.position.set(0, 9.5 - y * 4, 11 + y * 6);
    camera.lookAt(0, 0.4 - y * 1.2, 0);
  });
  return null;
}

export default function FlameField({ heat = 0, className }: { heat?: number; className?: string }) {
  const pointer = useRef({ x: 0, y: 0, active: false });
  const scroll = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.x = ((e.clientX - r.left) / r.width) * 2 - 1;
      // screen top = far rows
      pointer.current.y = ((e.clientY - r.top) / r.height) * 2 - 1;
      pointer.current.active = e.clientY >= r.top && e.clientY <= r.bottom;
    };
    const leave = () => (pointer.current.active = false);
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      scroll.current = Math.min(1, Math.max(0, -r.top / r.height));
    };
    window.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerleave", leave);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      document.removeEventListener("pointerleave", leave);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div ref={wrap} className={className}>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ fov: 42, position: [0, 9.5, 11], near: 0.1, far: 80 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => gl.setClearColor("#0a0a0a", 0)}
      >
        <fog attach="fog" args={["#0a0a0a", 12, 26]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[6, 14, 8]} intensity={2.2} color="#e6ecf7" />
        <directionalLight position={[-8, 4, -6]} intensity={0.7} color="#7f8ba3" />
        <pointLight position={[0, 3, 4]} intensity={6} distance={14} color={heat > 0.5 ? "#ff3b30" : "#c6ff3d"} />
        <Voxels heat={heat} pointer={pointer} />
        <Rig scroll={scroll} />
      </Canvas>
    </div>
  );
}

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Grid, OrbitControls } from "@react-three/drei";
import { XR, XROrigin } from "@react-three/xr";
import type { XRStore } from "@react-three/xr";
import { Expand, Maximize2, Minimize2, RotateCcw } from "lucide-react";
import SpatialJsonTree3D, { type SpatialJsonTree3DHandle, type TreeStats } from "./SpatialJsonTree3D";
import { getXRStore } from "@/utils/xrStore";

/* ------------------------------------------------------------------ */

interface VRCanvasProps {
  data: unknown;
  onStats?: (s: TreeStats) => void;
}

/**
 * R3F Canvas wrapper: XR session provider, dark grid environment tuned
 * for the Quest 3 (no shadows, no post-processing, capped pixel ratio).
 */
export default function VRCanvas({ data, onStats }: VRCanvasProps) {
  const [store, setStore] = useState<XRStore | null>(null);
  const treeRef = useRef<SpatialJsonTree3DHandle>(null);

  // Client-only store creation (SSR-safe: effect never runs on the server).
  useEffect(() => {
    setStore(getXRStore());
  }, []);

  if (!store) {
    return <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">Loading 3D engine…</div>;
  }

  return (
    <div className="relative h-full w-full">
      <Canvas
        dpr={[1, 2]}
        flat
        camera={{ position: [0, 1.65, 1.2], fov: 62, near: 0.05, far: 120 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        shadows={false}
      >
        <XR store={store}>
          <color attach="background" args={["#121212"]} />
          <fog attach="fog" args={["#121212", 12, 42]} />

          <ambientLight intensity={0.85} />
          <directionalLight position={[4, 6, 3]} intensity={1.4} />
          <hemisphereLight args={["#3a3a44", "#0c0c0e", 0.5]} />

          <XROrigin position={[0, 0, 0.4]} />

          {/* Dark grid floor — spatial reference for VR depth perception */}
          <Grid
            position={[0, 0, 0]}
            args={[60, 60]}
            cellSize={0.5}
            cellThickness={0.6}
            cellColor="#232328"
            sectionSize={2.5}
            sectionThickness={1}
            sectionColor="#35353c"
            fadeDistance={38}
            fadeStrength={2.5}
            infiniteGrid
          />
          {/* Back grid wall — reproduces the full-bleed blueprint backdrop */}
          <Grid
            position={[0, 4, -10]}
            args={[60, 24]}
            cellSize={0.5}
            cellThickness={0.6}
            cellColor="#1e1e23"
            sectionSize={2.5}
            sectionThickness={1}
            sectionColor="#2c2c33"
            fadeDistance={45}
            fadeStrength={2.5}
            infiniteGrid
          />

          <Suspense fallback={null}>
            <SpatialJsonTree3D ref={treeRef} data={data} onStats={onStats} />
          </Suspense>

          <AdaptiveControls />
        </XR>
      </Canvas>

      {/* Desktop / mirror HUD toolbar */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-xl border border-white/10 bg-black/60 p-1.5 backdrop-blur">
        <HudButton title="Zoom out" onClick={() => treeRef.current?.zoom(1 / 1.2)}>
          <Minimize2 size={15} />
        </HudButton>
        <HudButton title="Zoom in" onClick={() => treeRef.current?.zoom(1.2)}>
          <Maximize2 size={15} />
        </HudButton>
        <HudButton title="Rotate" onClick={() => treeRef.current?.rotateY(Math.PI / 12)}>
          <RotateCcw size={15} />
        </HudButton>
        <HudButton title="Expand all" onClick={() => treeRef.current?.expandAll()}>
          <Expand size={15} />
        </HudButton>
        <HudButton title="Reset view" onClick={() => treeRef.current?.resetView()}>
          <span className="px-1 text-[11px] font-semibold">Reset</span>
        </HudButton>
      </div>
    </div>
  );
}

function HudButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="pointer-events-auto flex h-8 min-w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 px-1 text-zinc-200 transition hover:bg-white/15"
    >
      {children}
    </button>
  );
}

/**
 * OrbitControls for the desktop preview. Automatically disabled while an
 * immersive session is presenting (the headset owns the camera then).
 */
function AdaptiveControls() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controls = useRef<any>(null);
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (controls.current) controls.current.enabled = !gl.xr.isPresenting;
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 1.4, -2]}
      enableDamping
      dampingFactor={0.12}
      minDistance={0.4}
      maxDistance={25}
      maxPolarAngle={Math.PI * 0.62}
    />
  );
}

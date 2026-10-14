"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Boxes, Glasses, Hand, MousePointer2, Move3d } from "lucide-react";
import JsonUploader from "@/components/ui/JsonUploader";
import { SAMPLE_JSON } from "@/utils/jsonToHierarchy";
import { getXRStore, probeVRSupport } from "@/utils/xrStore";
import type { TreeStats } from "@/components/xr/SpatialJsonTree3D";

// WebGL/XR code must not SSR — load the canvas client-side only so the
// Vercel build never hits hydration or `navigator.xr` issues.
const VRCanvas = dynamic(() => import("@/components/xr/VRCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center text-sm text-zinc-500">Loading 3D engine…</div>
  ),
});

export default function HomePage() {
  const [jsonData, setJsonData] = useState<unknown>(SAMPLE_JSON);
  const [fileName, setFileName] = useState("sample.json");
  const [stats, setStats] = useState<TreeStats | null>(null);
  const [vrSupport, setVrSupport] = useState<boolean | null>(null);
  const [entering, setEntering] = useState(false);

  useEffect(() => {
    probeVRSupport().then(setVrSupport);
  }, []);

  const handleLoad = useCallback((data: unknown, name: string) => {
    setJsonData(data);
    setFileName(name);
  }, []);

  const handleStats = useCallback((s: TreeStats) => setStats(s), []);

  const enterVR = useCallback(async () => {
    setEntering(true);
    try {
      // Querying support inside the user gesture is most reliable on Quest.
      const ok = await probeVRSupport();
      setVrSupport(ok);
      if (!ok) {
        alert("No immersive-vr session available. Open this page in the Meta Quest Browser (via your Vercel URL, https) and try again.");
        return;
      }
      await getXRStore().enterXR("immersive-vr");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? `Could not enter VR: ${err.message}` : "Could not enter VR.");
    } finally {
      setEntering(false);
    }
  }, []);

  return (
    <main className="bg-blueprint min-h-screen">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-white/10 px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-keyblue/15">
          <Boxes size={22} className="text-keyblue" />
        </span>
        <div className="mr-auto">
          <h1 className="text-lg font-bold leading-tight text-zinc-50">WebXR JSON Visualizer</h1>
          <p className="text-xs text-zinc-500">JSON Crack-style node graph · Meta Quest 3 · {fileName}</p>
        </div>
        <SupportBadge state={vrSupport} />
        <button
          onClick={enterVR}
          disabled={entering}
          className="flex items-center gap-2 rounded-xl bg-keyblue px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_24px_rgba(108,178,245,0.35)] transition hover:brightness-110 disabled:opacity-60"
        >
          <Glasses size={18} /> {entering ? "Entering…" : "Enter VR"}
        </button>
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[390px_1fr]">
        {/* Control panel */}
        <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-card/80 p-4 backdrop-blur">
          <h2 className="text-sm font-bold uppercase tracking-wider text-zinc-400">1 · Load JSON</h2>
          <JsonUploader onLoad={handleLoad} />

          <h2 className="mt-2 text-sm font-bold uppercase tracking-wider text-zinc-400">2 · Explore</h2>
          <ul className="flex flex-col gap-2.5 text-xs leading-relaxed text-zinc-400">
            <li className="flex gap-2">
              <MousePointer2 size={15} className="mt-0.5 shrink-0 text-keyblue" />
              <span><b className="text-zinc-200">Point &amp; click</b> the <b className="text-zinc-200">+</b>/<b className="text-zinc-200">−</b> buttons to expand or collapse branches. Drag cards to rearrange — lines follow live.</span>
            </li>
            <li className="flex gap-2">
              <Hand size={15} className="mt-0.5 shrink-0 text-keyblue" />
              <span><b className="text-zinc-200">In VR:</b> aim the controller ray + Trigger to toggle, grab cards to move them, drag empty space to pan the diagram.</span>
            </li>
            <li className="flex gap-2">
              <Move3d size={15} className="mt-0.5 shrink-0 text-keyblue" />
              <span><b className="text-zinc-200">On desktop:</b> drag to orbit, scroll to zoom, right-drag to pan. Use the floating toolbar above the graph in VR.</span>
            </li>
          </ul>

          {stats && (
            <div className="flex gap-2 text-xs">
              <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-zinc-300">
                Cards <b className="text-keyblue">{stats.visible}</b>
              </span>
              <span className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-zinc-300">
                Nodes <b className="text-valorange">{stats.total}</b>
              </span>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-500">
            <b className="text-zinc-300">Quest 3 tip:</b> deploy to Vercel (https), open the URL in the Quest Browser,
            then tap <b className="text-zinc-300">Enter VR</b>. Keep visible cards under ~160 for a steady 72 FPS.
          </div>
        </section>

        {/* 3D preview */}
        <section className="relative min-h-[62vh] overflow-hidden rounded-2xl border border-white/10 bg-void lg:h-[calc(100vh-130px)]">
          <VRCanvas data={jsonData} onStats={handleStats} />
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/10 bg-black/60 px-2.5 py-1.5 text-[11px] text-zinc-400 backdrop-blur">
            Desktop preview — drag to orbit · scroll to zoom
          </div>
        </section>
      </div>
    </main>
  );
}

function SupportBadge({ state }: { state: boolean | null }) {
  if (state === null) return <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-500">Checking WebXR…</span>;
  return state ? (
    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-300">
      VR ready
    </span>
  ) : (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-xs font-semibold text-amber-300">
      No VR session (preview only)
    </span>
  );
}

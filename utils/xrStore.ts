"use client";

import { createXRStore } from "@react-three/xr";
import type { XRStore } from "@react-three/xr";

/**
 * Singleton XR store, created lazily on the client only.
 * Never instantiate at module scope — Next.js prerenders client
 * components on the server, where `navigator.xr` does not exist.
 */
let store: XRStore | null = null;

export function getXRStore(): XRStore {
  if (!store) {
    store = createXRStore({
      // Advertise the page as VR-enterable (Quest browser shows its own UI).
      offerSession: "immersive-vr",
      foveation: 1,
      controller: { rayPointer: true, grabPointer: true },
      hand: { rayPointer: true, touchPointer: true },
    });
  }
  return store;
}

/** Best-effort WebXR immersive-vr support probe (client only). */
export async function probeVRSupport(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !("xr" in navigator)) return false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const xr = (navigator as any).xr;
    if (!xr?.isSessionSupported) return false;
    return await xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
}

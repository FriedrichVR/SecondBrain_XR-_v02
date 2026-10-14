"use client";

import { useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  useXRControllerLocomotion,
  useXRInputSourceState,
  type XRControllerState,
} from "@react-three/xr";
import type { SpatialJsonTree3DHandle } from "./SpatialJsonTree3D";

interface WorldRigProps {
  originRef: React.RefObject<THREE.Group | null>;
  treeRef: React.RefObject<SpatialJsonTree3DHandle | null>;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

function isSqueezed(s: XRControllerState | undefined): boolean {
  return s?.gamepad?.["xr-standard-squeeze"]?.state === "pressed";
}

function anchorOf(s: XRControllerState | undefined, out: THREE.Vector3): boolean {
  if (!s?.object) return false;
  s.object.getWorldPosition(out);
  return true;
}

function angleXZ(v: THREE.Vector3): number {
  return Math.atan2(v.x, v.z);
}

function wrapPi(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

type GrabMode =
  | { kind: "none" }
  | { kind: "single"; hand: "left" | "right"; prev: THREE.Vector3 }
  | { kind: "dual"; prevL: THREE.Vector3; prevR: THREE.Vector3 };

/**
 * VR locomotion + world manipulation for Meta Quest Touch controllers.
 *
 * - Left thumbstick: glide through the room (player rig locomotion).
 * - Right thumbstick: snap-turn 30° (official useXRControllerLocomotion).
 * - Grip (squeeze) with one hand: grab the whole diagram and move it.
 * - Grip with BOTH hands: pinch to scale, twist to rotate, drag to move —
 *   Google-Earth-style, computed around the hands' midpoint.
 * - Trigger ray keeps its existing role: toggle +/− and drag cards.
 *
 * The world group is mutated directly per-frame (zero React re-renders at
 * controller frequency) and persisted via commitWorld() on release.
 */
export default function WorldRig({ originRef, treeRef }: WorldRigProps) {
  useXRControllerLocomotion(originRef, { speed: 1.8 }, { type: "snap", degrees: 30 }, "left");

  const left = useXRInputSourceState("controller", "left");
  const right = useXRInputSourceState("controller", "right");
  const grab = useRef<GrabMode>({ kind: "none" });
  const tmpA = useRef(new THREE.Vector3());
  const tmpB = useRef(new THREE.Vector3());

  useFrame(() => {
    const group = treeRef.current?.getWorldGroup() ?? null;
    if (!group) {
      grab.current = { kind: "none" };
      return;
    }

    const lSq = isSqueezed(left);
    const rSq = isSqueezed(right);
    const lPos = tmpA.current;
    const rPos = tmpB.current;
    const hasL = lSq && anchorOf(left, lPos);
    const hasR = rSq && anchorOf(right, rPos);
    const mode = grab.current;

    if (hasL && hasR) {
      // ---- dual-hand: scale + rotate + translate around the midpoint ----
      if (mode.kind !== "dual") {
        grab.current = { kind: "dual", prevL: lPos.clone(), prevR: rPos.clone() };
        return;
      }
      const midPrev = mode.prevL.clone().add(mode.prevR).multiplyScalar(0.5);
      const midNow = lPos.clone().add(rPos).multiplyScalar(0.5);

      // translate (midpoint delta)
      group.position.add(midNow.clone().sub(midPrev));

      // scale about the midpoint
      const dPrev = Math.max(mode.prevL.distanceTo(mode.prevR), 1e-4);
      const ratio = THREE.MathUtils.clamp(lPos.distanceTo(rPos) / dPrev, 0.92, 1.08);
      const newScale = THREE.MathUtils.clamp(group.scale.x * ratio, MIN_SCALE, MAX_SCALE);
      const f = newScale / group.scale.x;
      group.position.sub(midNow).multiplyScalar(f).add(midNow);
      group.scale.setScalar(newScale);

      // rotate around Y through the midpoint
      const vPrev = mode.prevR.clone().sub(mode.prevL);
      const vNow = rPos.clone().sub(lPos);
      const dA = wrapPi(angleXZ(vNow) - angleXZ(vPrev));
      const clamped = THREE.MathUtils.clamp(dA, -0.2, 0.2);
      group.position.sub(midNow).applyAxisAngle(Y_AXIS, clamped).add(midNow);
      group.rotation.y += clamped;

      mode.prevL.copy(lPos);
      mode.prevR.copy(rPos);
    } else if (hasL || hasR) {
      // ---- single-hand: grab and move the diagram ----
      const hand = hasL ? ("left" as const) : ("right" as const);
      const now = hasL ? lPos : rPos;
      if (mode.kind !== "single" || mode.hand !== hand) {
        grab.current = { kind: "single", hand, prev: now.clone() };
        return;
      }
      group.position.add(now.clone().sub(mode.prev));
      mode.prev.copy(now);
    } else {
      // ---- released: persist once, no per-frame setState during the grab ----
      if (mode.kind !== "none") {
        grab.current = { kind: "none" };
        treeRef.current?.commitWorld();
      }
    }
  });

  return null;
}

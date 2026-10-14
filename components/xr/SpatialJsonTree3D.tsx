"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import {
  CARD_HEADER_H,
  CARD_ROW_H,
  defaultCollapsedSet,
  depthAccent,
  displayRows,
  flattenTree,
  getVisibleNodesAndEdges,
  layoutTree,
  parseJsonToTree,
  type PlacedNode,
  type SpatialNode,
} from "@/utils/jsonToHierarchy";
import SpatialCard3D from "./SpatialCard3D";
import ConnectorLine from "./ConnectorLine";

/* ------------------------------------------------------------------ */

export interface TreeStats {
  visible: number;
  total: number;
}

export interface WorldState {
  position: [number, number, number];
  rotationY: number;
  scale: number;
}

export interface SpatialJsonTree3DHandle {
  expandAll: () => void;
  collapseAll: () => void;
  resetView: () => void;
  zoom: (factor: number) => void;
  rotateY: (delta: number) => void;
  /** Direct access to the world group for per-frame VR manipulation (no re-renders). */
  getWorldGroup: () => THREE.Group | null;
  /** Persist the group's current transform into React state (call on gesture release). */
  commitWorld: () => void;
}

interface Props {
  data: unknown;
  onStats?: (s: TreeStats) => void;
}

const HOME = { position: [0, 1.5, -2] as [number, number, number], rotationY: 0, scale: 0.85 };
const LINE_SAMPLES = 20;
const MAX_VISIBLE_CARDS = 160;

/* Cubic bezier sampling between card edges: exits the parent's right edge
   at the child's own row height (fromRowOffY, metres above card centre)
   and lands on the child's left edge — each union visually belongs to
   its parent/child row pair. */
function sampleCurve(
  from: THREE.Vector3,
  fromW: number,
  fromRowOffY: number,
  to: THREE.Vector3,
  toW: number
): { points: [number, number, number][]; mid: [number, number, number] } {
  const p0 = new THREE.Vector3(from.x + fromW / 2, from.y + fromRowOffY, from.z);
  const p3 = new THREE.Vector3(to.x - toW / 2, to.y, to.z);
  const dx = Math.max(0.6, p3.x - p0.x);
  const p1 = new THREE.Vector3(p0.x + dx * 0.5, p0.y, p0.z);
  const p2 = new THREE.Vector3(p3.x - dx * 0.5, p3.y, p3.z);
  const curve = new THREE.CubicBezierCurve3(p0, p1, p2, p3);
  const pts = curve.getPoints(LINE_SAMPLES - 1).map((p) => [p.x, p.y, p.z] as [number, number, number]);
  const m = curve.getPoint(0.5);
  return { points: pts, mid: [m.x, m.y + 0.13, m.z] };
}

/* ------------------------------------------------------------------ */

const SpatialJsonTree3D = forwardRef<SpatialJsonTree3DHandle, Props>(function SpatialJsonTree3D(
  { data, onStats },
  ref
) {
  const root = useMemo(() => parseJsonToTree(data), [data]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => defaultCollapsedSet(root));
  const [world, setWorld] = useState(HOME);

  const nodeById = useMemo(() => {
    const m = new Map<string, SpatialNode>();
    for (const n of flattenTree(root)) m.set(n.id, n);
    return m;
  }, [root]);

  const visible = useMemo(() => getVisibleNodesAndEdges(root, collapsed), [root, collapsed]);
  const layout = useMemo(() => layoutTree(root, collapsed), [root, collapsed]);

  /* Live (mutable) animation + interaction state — refs so dragging at
     controller-ray frequency never triggers React re-renders. */
  const worldGroup = useRef<THREE.Group>(null);
  const groups = useRef(new Map<string, THREE.Group>());
  const lines = useRef(new Map<string, THREE.Object3D>());
  const labels = useRef(new Map<string, THREE.Object3D>());
  const cur = useRef(new Map<string, THREE.Vector3>());
  const offsets = useRef(new Map<string, THREE.Vector3>());
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const parentOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of layout.edges) m.set(e.to, e.from);
    return m;
  }, [layout]);

  /**
   * Row index of each edge's child inside its parent card (branch rows come
   * first in display order). Drives the row-anchored connector start point.
   */
  const edgeRow = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of layout.edges) {
      const parent = nodeById.get(e.from);
      const rows = parent ? displayRows(parent) : [];
      let idx = rows.findIndex((r) => r.kind === "branch" && r.child.id === e.to);
      if (idx < 0) idx = Math.max(0, rows.length - 1);
      m.set(`${e.from}→${e.to}`, idx);
    }
    return m;
  }, [layout, nodeById]);

  const edgeRowRef = useRef(edgeRow);
  edgeRowRef.current = edgeRow;

  useEffect(() => {
    onStats?.({ visible: layout.visibleCount, total: layout.totalCount });
  }, [layout, onStats]);

  /* ------------------------- public actions ------------------------- */

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => {
    const all = new Set<string>();
    for (const n of nodeById.values()) if (n.children.some((c) => c.children.length > 0)) all.add(n.id);
    // Keep at least the first level visible so the graph never vanishes.
    for (const n of visible.nodes) if (n.depth <= 1) all.delete(n.id);
    setCollapsed(all);
  }, [nodeById, visible]);
  const resetView = useCallback(() => {
    offsets.current.clear();
    setWorld(HOME);
  }, []);
  /** Read the live group transform back into React state. */
  const commitWorld = useCallback(() => {
    const g = worldGroup.current;
    if (!g) return;
    setWorld({
      position: [g.position.x, g.position.y, g.position.z],
      rotationY: g.rotation.y,
      scale: g.scale.x,
    });
  }, []);
  const getWorldGroup = useCallback(() => worldGroup.current, []);
  const zoom = useCallback(
    (f: number) => {
      const g = worldGroup.current;
      if (!g) return;
      g.scale.setScalar(THREE.MathUtils.clamp(g.scale.x * f, 0.3, 2.5));
      commitWorld();
    },
    [commitWorld]
  );
  const rotateY = useCallback(
    (d: number) => {
      const g = worldGroup.current;
      if (!g) return;
      g.rotation.y += d;
      commitWorld();
    },
    [commitWorld]
  );

  useImperativeHandle(
    ref,
    () => ({ expandAll, collapseAll, resetView, zoom, rotateY, getWorldGroup, commitWorld }),
    [expandAll, collapseAll, resetView, zoom, rotateY, getWorldGroup, commitWorld]
  );

  /* ------------------------- registration ------------------------- */

  const registerGroup = useCallback((id: string, g: THREE.Group | null) => {
    if (g) groups.current.set(id, g);
    else groups.current.delete(id);
  }, []);
  const registerLine = useCallback((key: string, o: THREE.Object3D | null) => {
    if (o) lines.current.set(key, o);
    else lines.current.delete(key);
  }, []);
  const registerLabel = useCallback((key: string, o: THREE.Object3D | null) => {
    if (o) labels.current.set(key, o);
    else labels.current.delete(key);
  }, []);

  /* ------------------------- card dragging ------------------------- */

  const handleDragMove = useCallback(
    (id: string, local: [number, number, number]) => {
      const target = layoutRef.current.nodes.get(id);
      if (!target) return;
      // Persist as an offset from the dagre target so expand/collapse
      // reflows keep the user's manual placement.
      offsets.current.set(id, new THREE.Vector3(local[0] - target.x, local[1] - target.y, local[2] - target.z));
      const c = cur.current.get(id);
      if (c) c.set(local[0], local[1], local[2]);
    },
    []
  );

  /* ------------------------- world panning ------------------------- */
  /* Grab empty space to pan the whole diagram. The PanCatcher sphere only */
  /* engages for immersive-XR controller rays so desktop OrbitControls     */
  /* stay in charge on the 2D preview.                                    */
  const panGrab = useRef<{ last: THREE.Vector3; origin: THREE.Vector3 } | null>(null);
  const startPan = useCallback((point: THREE.Vector3) => {
    if (!worldGroup.current) return;
    panGrab.current = { last: point.clone(), origin: worldGroup.current.position.clone() };
  }, []);
  const movePan = useCallback((point: THREE.Vector3) => {
    const grab = panGrab.current;
    if (!grab || !worldGroup.current) return;
    const delta = point.clone().sub(grab.last);
    delta.y = 0; // keep the diagram at eye height, pan across the room
    worldGroup.current.position.copy(grab.origin).add(delta);
  }, []);
  const endPan = useCallback(() => {
    if (!worldGroup.current) return;
    panGrab.current = null;
    const p = worldGroup.current.position;
    setWorld((w) => ({ ...w, position: [p.x, p.y, p.z] as [number, number, number] }));
  }, []);

  /* ------------------------- animation loop ------------------------- */
  /* Single useFrame lerps every card toward its target and rewrites all */
  /* connector polylines + labels — smooth reflow + real-time dragging.  */

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const k = 1 - Math.exp(-dt * 9);
    const L = layoutRef.current;
    let moved = false;

    for (const [id, p] of L.nodes) {
      let c = cur.current.get(id);
      if (!c) {
        // Spawn at the parent's current spot -> branches "unfold" outward.
        const parentId = parentOf.get(id);
        const seed = (parentId && cur.current.get(parentId)) || new THREE.Vector3(p.x, p.y, p.z);
        c = seed.clone();
        cur.current.set(id, c);
      }
      const off = offsets.current.get(id);
      const tx = p.x + (off?.x ?? 0);
      const ty = p.y + (off?.y ?? 0);
      const tz = p.z + (off?.z ?? 0);
      const dx = tx - c.x;
      const dy = ty - c.y;
      const dz = tz - c.z;
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 0.0004) {
        c.x += dx * k;
        c.y += dy * k;
        c.z += dz * k;
        moved = true;
      } else {
        c.set(tx, ty, tz);
      }
      groups.current.get(id)?.position.copy(c);
    }
    // Drop stale entries (collapsed away).
    for (const id of [...cur.current.keys()]) if (!L.nodes.has(id)) cur.current.delete(id);

    if (!moved) return;

    for (const e of L.edges) {
      const a = cur.current.get(e.from);
      const b = cur.current.get(e.to);
      const pa: PlacedNode | undefined = L.nodes.get(e.from);
      const pb: PlacedNode | undefined = L.nodes.get(e.to);
      if (!a || !b || !pa || !pb) continue;
      const rowIdx = edgeRowRef.current.get(`${e.from}→${e.to}`) ?? 0;
      const rowOffY = pa.height / 2 - CARD_HEADER_H - rowIdx * CARD_ROW_H - CARD_ROW_H / 2;
      const { points, mid } = sampleCurve(a, pa.width, rowOffY, b, pb.width);
      const line = lines.current.get(`${e.from}→${e.to}`) as unknown as
        | { geometry: { setPositions: (arr: number[]) => void } }
        | undefined;
      line?.geometry.setPositions(points.flat());
      labels.current.get(`${e.from}→${e.to}`)?.position.set(...mid);
    }
  });

  /* ------------------------- render ------------------------- */

  const overLimit = layout.visibleCount > MAX_VISIBLE_CARDS;
  const shownNodes = overLimit ? [...layout.nodes.values()].slice(0, MAX_VISIBLE_CARDS) : [...layout.nodes.values()];
  const shownIds = useMemo(() => new Set(shownNodes.map((n) => n.id)), [shownNodes]);
  const shownEdges = useMemo(
    () => layout.edges.filter((e) => shownIds.has(e.from) && shownIds.has(e.to)),
    [layout, shownIds]
  );

  // Toolbar floats above the graph.
  let topY = 0;
  for (const p of layout.nodes.values()) topY = Math.max(topY, p.y + p.height / 2);
  topY += 0.55;

  return (
    <group ref={worldGroup} position={world.position} rotation-y={world.rotationY} scale={world.scale}>
      {/* Grab-catcher: pan the world by dragging empty space in VR.
          Desktop OrbitControls own the mouse, so this only acts on XR rays. */}
      <PanCatcher onDown={startPan} onMove={movePan} onUp={endPan} />

      {shownNodes.map((p) => {
        const node = nodeById.get(p.id);
        if (!node) return null;
        return (
          <SpatialCard3D
            key={p.id}
            node={node}
            width={p.width}
            height={p.height}
            accent={depthAccent(node.depth)}
            worldRef={worldGroup}
            collapsed={collapsed.has(p.id)}
            collapsedIds={collapsed}
            onToggle={toggle}
            onDragMove={handleDragMove}
            registerGroup={registerGroup}
          />
        );
      })}

      {shownEdges.map((e) => {
        const a = layout.nodes.get(e.from);
        const b = layout.nodes.get(e.to);
        const parent = nodeById.get(e.from);
        const child = nodeById.get(e.to);
        if (!a || !b || !parent || !child) return null;
        const key = `${e.from}→${e.to}`;
        const rowIdx = edgeRow.get(key) ?? 0;
        const rowOffY = a.height / 2 - CARD_HEADER_H - rowIdx * CARD_ROW_H - CARD_ROW_H / 2;
        const { points, mid } = sampleCurve(
          new THREE.Vector3(a.x, a.y, a.z),
          a.width,
          rowOffY,
          new THREE.Vector3(b.x, b.y, b.z),
          b.width
        );
        return (
          <ConnectorLine
            key={key}
            edgeKey={key}
            label={e.label}
            color={depthAccent(parent.depth)}
            endColor={depthAccent(child.depth)}
            initialPoints={points}
            initialMid={mid}
            registerLine={registerLine}
            registerLabel={registerLabel}
          />
        );
      })}

      {overLimit && (
        <Text position={[0, topY + 0.4, 0]} fontSize={0.12} color="#e57d7d" anchorX="center">
          {`Too many nodes (${layout.visibleCount}). Collapse branches to stay under ${MAX_VISIBLE_CARDS} for 72 FPS.`}
        </Text>
      )}

      <Toolbar3D
        position={[0, topY, 0]}
        onZoom={zoom}
        onRotate={rotateY}
        onReset={resetView}
        onExpand={expandAll}
        onCollapse={collapseAll}
      />
    </group>
  );
});

/* ------------------------------------------------------------------ */
/* PanCatcher — invisible sphere around the scene; XR-ray drags pan world */
/* ------------------------------------------------------------------ */

function PanCatcher({
  onDown,
  onMove,
  onUp,
}: {
  onDown: (p: THREE.Vector3) => void;
  onMove: (p: THREE.Vector3) => void;
  onUp: () => void;
}) {
  const dragging = useRef(false);
  return (
    <mesh
      renderOrder={-10}
      onPointerDown={(e) => {
        // Only engage for immersive-XR controller rays (negative pointerId),
        // never for the desktop mouse — OrbitControls owns that.
        if (e.pointerId >= 0) return;
        e.stopPropagation();
        dragging.current = true;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        onDown(e.point.clone());
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        e.stopPropagation();
        onMove(e.point.clone());
      }}
      onPointerUp={(e) => {
        if (!dragging.current) return;
        dragging.current = false;
        e.stopPropagation();
        onUp();
      }}
    >
      <sphereGeometry args={[40, 12, 12]} />
      <meshBasicMaterial side={THREE.BackSide} transparent opacity={0} depthWrite={false} colorWrite={false} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */
/* Toolbar3D — floating mesh buttons (zoom / rotate / reset / all)       */
/* ------------------------------------------------------------------ */

function ToolButton({ x, label, onClick, wide = false }: { x: number; label: string; onClick: () => void; wide?: boolean }) {
  const [hover, setHover] = useState(false);
  const w = wide ? 0.72 : 0.4;
  return (
    <group position={[x, 0, 0]}>
      <mesh
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[w, 0.22, 0.06]} />
        <meshStandardMaterial color={hover ? "#3d3d44" : "#26262b"} roughness={0.7} toneMapped={false} />
      </mesh>
      <Text position={[0, 0, 0.035]} fontSize={0.11} color="#e8e8ea" anchorX="center" anchorY="middle" whiteSpace="nowrap">
        {label}
      </Text>
    </group>
  );
}

function Toolbar3D({
  position,
  onZoom,
  onRotate,
  onReset,
  onExpand,
  onCollapse,
}: {
  position: [number, number, number];
  onZoom: (f: number) => void;
  onRotate: (d: number) => void;
  onReset: () => void;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const buttons: { label: string; act: () => void; wide?: boolean }[] = [
    { label: "-", act: () => onZoom(1 / 1.15) },
    { label: "+", act: () => onZoom(1.15) },
    { label: "<", act: () => onRotate(Math.PI / 12) },
    { label: ">", act: () => onRotate(-Math.PI / 12) },
    { label: "Reset", act: onReset, wide: true },
    { label: "Expand", act: onExpand, wide: true },
    { label: "Hide", act: onCollapse, wide: true },
  ];
  let cursor = 0;
  const items = buttons.map((b) => {
    const w = b.wide ? 0.72 : 0.4;
    const x = cursor + w / 2;
    cursor += w + 0.08;
    return { ...b, x, w };
  });
  const total = cursor - 0.08;
  return (
    <group position={[position[0] - total / 2, position[1], position[2]]}>
      {items.map((b) => (
        <ToolButton key={b.label} x={b.x} label={b.label} onClick={b.act} wide={b.wide} />
      ))}
    </group>
  );
}

export default SpatialJsonTree3D;

import dagre from "dagre";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type NodeType = "object" | "array" | "primitive" | "root";

/** A node in the parsed JSON hierarchy. Branch nodes keep one child per key. */
export interface SpatialNode {
  /** Unique id = JSON path joined by dots, e.g. "root.componentes.comp_mecanico_01" */
  id: string;
  /** Key of this node inside its parent (display label on the incoming edge) */
  key: string;
  /** Full path segments, useful for debugging */
  path: string[];
  depth: number;
  type: NodeType;
  /** Raw value for primitives, undefined for branches */
  value?: string | number | boolean | null;
  children: SpatialNode[];
  /** Total key count of this subtree (branch badge: "{n keys}" / "[n]") */
  subtreeSize: number;
  parentId: string | null;
}

/** A visible parent -> child connection. `label` is the child key. */
export interface SpatialEdge {
  from: string;
  to: string;
  label: string;
}

/** Dagre-computed placement in metres, R3F coordinate space (y-up). */
export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export interface TreeLayout {
  nodes: Map<string, PlacedNode>;
  edges: SpatialEdge[];
  /** Visible card count (after collapse filtering) */
  visibleCount: number;
  /** Total node count in the full tree (incl. folded primitives) */
  totalCount: number;
}

/* ------------------------------------------------------------------ */
/* Card metrics (metres) — shared with SpatialCard3D so dagre reserves */
/* the exact space the mesh cards occupy.                               */
/* ------------------------------------------------------------------ */

export const CARD_WIDTH = 1.9;
export const CARD_HEADER_H = 0.3;
export const CARD_ROW_H = 0.21;
export const CARD_PAD = 0.18;
/** Max rows rendered on a card; deeper content is summarised ("+N more"). */
export const MAX_CARD_ROWS = 10;

export type RowDescriptor =
  | { kind: "branch"; child: SpatialNode }
  | { kind: "leaf"; key: string; value: string | number | boolean | null }
  | { kind: "more"; count: number };

/**
 * Rows rendered on a card. Primitive children are folded into the parent
 * card as `key: value` rows (JSON Crack style) — only branches get their
 * own floating cards and connector edges.
 */
export function displayRows(node: SpatialNode): RowDescriptor[] {
  const branch = node.children.filter((c) => c.children.length > 0);
  const leaves = node.children.filter((c) => c.children.length === 0);
  const rows: RowDescriptor[] = [
    ...branch.map((child) => ({ kind: "branch" as const, child })),
    ...leaves.map((c) => ({ kind: "leaf" as const, key: c.key, value: c.value ?? "null" })),
  ];
  if (rows.length <= MAX_CARD_ROWS) return rows;
  const shown = rows.slice(0, MAX_CARD_ROWS - 1);
  shown.push({ kind: "more", count: rows.length - shown.length });
  return shown;
}

export function cardHeightFor(node: SpatialNode): number {
  return CARD_HEADER_H + displayRows(node).length * CARD_ROW_H + CARD_PAD;
}

/* ------------------------------------------------------------------ */
/* JSON -> tree                                                          */
/* ------------------------------------------------------------------ */

function typeOf(value: unknown): NodeType {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return "primitive";
}

function previewValue(value: unknown): string | number | boolean | null {
  if (value === null) return "null";
  if (typeof value === "string") return value.length > 28 ? value.slice(0, 27) + "…" : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

/**
 * Recursively convert raw JSON into a SpatialNode tree.
 * Every object key / array index becomes a child node so that each branch
 * can be expanded or collapsed independently in 3D space.
 */
export function parseJsonToTree(data: unknown, key = "root", path: string[] = ["root"], depth = 0): SpatialNode {
  const t = typeOf(data);
  const id = path.join(".");

  if (t === "primitive") {
    return {
      id,
      key,
      path,
      depth,
      type: "primitive",
      value: previewValue(data),
      children: [],
      subtreeSize: 1,
      parentId: path.length > 1 ? path.slice(0, -1).join(".") : null,
    };
  }

  const entries: [string, unknown][] = Array.isArray(data)
    ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>);

  const children = entries.map(([k, v]) => parseJsonToTree(v, k, [...path, k], depth + 1));
  const subtreeSize = children.reduce((acc, c) => acc + c.subtreeSize, 0) + children.length;

  return {
    id,
    key,
    path,
    depth,
    type: depth === 0 ? "root" : t,
    children,
    subtreeSize,
    parentId: path.length > 1 ? path.slice(0, -1).join(".") : null,
  };
}

/** Collapse every branch at depth >= `depth` (used for the initial view). */
export function defaultCollapsedSet(root: SpatialNode, depth = 3): Set<string> {
  const out = new Set<string>();
  const walk = (n: SpatialNode) => {
    if (n.children.length > 0 && n.depth >= depth) out.add(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/* ------------------------------------------------------------------ */
/* Visibility filtering                                                  */
/* ------------------------------------------------------------------ */

export function flattenTree(root: SpatialNode, out: SpatialNode[] = []): SpatialNode[] {
  out.push(root);
  root.children.forEach((c) => flattenTree(c, out));
  return out;
}

export function findNode(root: SpatialNode, id: string): SpatialNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/**
 * Cards + edges visible given the collapsed set. Primitive children are
 * folded into their parent card (no card/edge of their own). The synthetic
 * `root` wrapper is hidden so top-level keys become the leftmost column,
 * matching the JSON Crack look.
 */
export function getVisibleNodesAndEdges(
  root: SpatialNode,
  collapsed: Set<string>
): { nodes: SpatialNode[]; edges: SpatialEdge[] } {
  const nodes: SpatialNode[] = [];
  const edges: SpatialEdge[] = [];

  const pushBranch = (n: SpatialNode) => {
    nodes.push(n);
    if (collapsed.has(n.id)) return;
    for (const child of n.children) {
      if (child.children.length === 0) continue; // folded leaf row
      edges.push({ from: n.id, to: child.id, label: child.key });
      pushBranch(child);
    }
  };

  if (root.children.length > 0 && root.depth === 0) {
    // Hide the synthetic wrapper: top-level branches are the leftmost cards.
    for (const child of root.children) {
      if (child.children.length === 0) continue;
      pushBranch(child);
    }
    // Edge case: root holds ONLY primitives -> show one card for the root.
    if (nodes.length === 0) nodes.push(root);
  } else {
    pushBranch(root);
  }
  return { nodes, edges };
}

/* ------------------------------------------------------------------ */
/* Dagre spatial layout (left -> right tree, metres, y-up)               */
/* ------------------------------------------------------------------ */

export interface LayoutOptions {
  /** Horizontal gap between depth ranks (m). */
  rankSep?: number;
  /** Vertical gap between sibling cards (m). */
  nodeSep?: number;
  /** Slight z push per depth level for VR depth perception (m). */
  depthZ?: number;
}

export function layoutTree(root: SpatialNode, collapsed: Set<string>, opts: LayoutOptions = {}): TreeLayout {
  const { rankSep = 1.5, nodeSep = 0.55, depthZ = 0.32 } = opts;
  const { nodes, edges } = getVisibleNodesAndEdges(root, collapsed);
  const totalCount = flattenTree(root).length;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", ranksep: rankSep * 100, nodesep: nodeSep * 100, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const sizes = new Map<string, { w: number; h: number }>();
  for (const n of nodes) {
    const w = CARD_WIDTH;
    const h = cardHeightFor(n);
    sizes.set(n.id, { w, h });
    // dagre works in arbitrary units — use centimetres for numeric stability.
    g.setNode(n.id, { width: w * 100, height: h * 100 });
  }
  for (const e of edges) g.setEdge(e.from, e.to);

  dagre.layout(g);

  // Centre the graph on its bounding-box centre so the world group can sit
  // at eye height in front of the user.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const n of nodes) {
    const p = g.node(n.id);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cx = Number.isFinite(minX) ? (minX + maxX) / 2 : 0;
  const cy = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;

  const placed = new Map<string, PlacedNode>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const p = g.node(n.id);
    const s = sizes.get(n.id)!;
    placed.set(n.id, {
      id: n.id,
      // dagre x (cm, left->right) -> R3F x (m); dagre y (down) -> R3F y (up)
      x: (p.x - cx) / 100,
      y: -(p.y - cy) / 100,
      z: -(byId.get(n.id)?.depth ?? 0) * depthZ,
      width: s.w,
      height: s.h,
    });
  }

  return { nodes: placed, edges, visibleCount: nodes.length, totalCount };
}

/* ------------------------------------------------------------------ */
/* Depth accent palette — minimalist hierarchy colour-coding shared by   */
/* cards, connector lines and badges.                                    */
/* ------------------------------------------------------------------ */

const DEPTH_ACCENTS = ["#6cb2f5", "#b794f6", "#5fd4c0", "#e5b567", "#ef8fa3"] as const;

/** Accent colour for a tree depth (cycles past the palette length). */
export function depthAccent(depth: number): string {
  if (depth < 0) return "#8e8e93";
  return DEPTH_ACCENTS[depth % DEPTH_ACCENTS.length];
}

/* ------------------------------------------------------------------ */
/* Sample data (mirrors the reference screenshot)                        */
/* ------------------------------------------------------------------ */

export const SAMPLE_JSON = {
  componentes: {
    comp_mecanico_01: { celda: "DISS", tag: "RMB_Mech_001", posX: 80.59, posY: 33.23, posZ: 2.54 },
    comp_mecanico_02: { celda: "DISS", tag: "RMB_Mech_002", posX: 83.95, posY: 65.53, posZ: 6.33 },
    comp_mecanico_03: { celda: "DISS", tag: "RMB_Mech_003", posX: 83.95, posY: 65.53, posZ: 6.33 },
  },
};

export function safeParseJson(text: string): { data?: unknown; error?: string } {
  if (!text.trim()) return { error: "JSON is empty." };
  try {
    return { data: JSON.parse(text) };
  } catch (e) {
    return { error: e instanceof Error ? `Invalid JSON: ${e.message}` : "Invalid JSON." };
  }
}

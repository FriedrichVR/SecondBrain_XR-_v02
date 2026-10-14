"use client";

import { memo, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { RoundedBox, Text } from "@react-three/drei";
import {
  CARD_HEADER_H,
  CARD_ROW_H,
  type SpatialNode,
  displayRows,
} from "@/utils/jsonToHierarchy";

/* ------------------------------------------------------------------ */
/* Minimalist palette                                                    */
/* ------------------------------------------------------------------ */

const C_BODY = "#141417";
const C_SHELL = "#2b2b31";
const C_KEY_BRANCH = "#6cb2f5";
const C_KEY_LEAF = "#a7a7b0";
const C_TITLE = "#f4f4f6";
const C_STRING = "#f0f0f2";
const C_NUMBER = "#e5b567";
const C_BOOL_T = "#7dd87d";
const C_BOOL_F = "#e57d7d";
const C_NULL = "#63636a";
const C_TOGGLE = "#232329";
const C_TOGGLE_HOVER = "#35353c";
const C_SEPARATOR = "#232329";

function valueColor(v: string | number | boolean | null): string {
  if (v === null || v === "null") return C_NULL;
  if (typeof v === "number") return C_NUMBER;
  if (typeof v === "boolean") return v ? C_BOOL_T : C_BOOL_F;
  return C_STRING;
}

function branchBadge(child: SpatialNode): string {
  if (child.type === "array") return `[${child.children.length}]`;
  return `{${child.children.length} keys}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/* ------------------------------------------------------------------ */
/* Props                                                                 */
/* ------------------------------------------------------------------ */

export interface SpatialCard3DProps {
  node: SpatialNode;
  width: number;
  height: number;
  /** Hierarchy accent colour (by depth). */
  accent: string;
  /** World-group ref: drag math is computed in this group's local space. */
  worldRef: React.RefObject<THREE.Group | null>;
  /** True when this node's children are collapsed. */
  collapsed: boolean;
  /** Collapsed state of branch children (for their +/- glyphs). */
  collapsedIds: Set<string>;
  onToggle: (id: string) => void;
  onDragMove: (id: string, local: [number, number, number]) => void;
  registerGroup: (id: string, g: THREE.Group | null) => void;
}

const DRAG_CLAMP = 14;

/* ------------------------------------------------------------------ */
/* Toggle pill ([+]/[-]) — oversized hit area for Quest controller rays  */
/* ------------------------------------------------------------------ */

function ToggleButton({
  glyph,
  position,
  onActivate,
  accent,
  size = 0.17,
}: {
  glyph: string;
  position: [number, number, number];
  onActivate: () => void;
  accent: string;
  size?: number;
}) {
  const [hover, setHover] = useState(false);
  return (
    <group position={position}>
      <mesh
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
        }}
        onPointerOut={() => setHover(false)}
      >
        <boxGeometry args={[size, size, 0.09]} />
        <meshStandardMaterial color={hover ? C_TOGGLE_HOVER : C_TOGGLE} roughness={0.6} />
      </mesh>
      <Text
        position={[0, 0, 0.051]}
        fontSize={size * 0.68}
        color={hover ? accent : "#ffffff"}
        anchorX="center"
        anchorY="middle"
      >
        {glyph}
      </Text>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Spatial card — minimalist floating panel                             */
/* ------------------------------------------------------------------ */

function SpatialCard3DInner({
  node,
  width,
  height,
  accent,
  worldRef,
  collapsed,
  collapsedIds,
  onToggle,
  onDragMove,
  registerGroup,
}: SpatialCard3DProps) {
  const group = useRef<THREE.Group>(null);
  const [hovered, setHovered] = useState(false);
  const dragOffset = useRef<THREE.Vector3 | null>(null);
  const dragging = useRef(false);

  const rows = useMemo(() => displayRows(node), [node]);
  const hasBranches = node.children.some((c) => c.children.length > 0);

  const top = height / 2;
  const left = -width / 2;
  const textX = left + 0.34; // key column (after accent bar + toggle gutter)
  const valueX = left + 1.06; // value / badge column — fixed gutter, never overlaps
  const KEY_MAX = 0.68;
  const VALUE_MAX = 0.72;
  const headerY = top - CARD_HEADER_H / 2;
  const rowTop = top - CARD_HEADER_H;

  /* --- drag handling (Trigger ray or mouse) --- */
  const toLocal = (point: THREE.Vector3): THREE.Vector3 | null => {
    const world = worldRef.current;
    if (!world || !group.current) return null;
    const local = world.worldToLocal(point.clone());
    if (dragOffset.current) local.add(dragOffset.current);
    local.x = THREE.MathUtils.clamp(local.x, -DRAG_CLAMP, DRAG_CLAMP);
    local.y = THREE.MathUtils.clamp(local.y, -DRAG_CLAMP, DRAG_CLAMP);
    local.z = THREE.MathUtils.clamp(local.z, -DRAG_CLAMP, DRAG_CLAMP);
    return local;
  };

  const handleDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const world = worldRef.current;
    if (!world || !group.current) return;
    dragging.current = true;
    dragOffset.current = group.current.position.clone().sub(world.worldToLocal(e.point.clone()));
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    e.stopPropagation();
    const local = toLocal(e.point);
    if (local) onDragMove(node.id, [local.x, local.y, local.z]);
  };

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!dragging.current) return;
    dragging.current = false;
    dragOffset.current = null;
    e.stopPropagation();
  };

  const headerBadge =
    node.type === "array"
      ? `[${node.children.length}]`
      : node.children.length > 0
        ? `{${node.children.length} keys}`
        : node.type === "root"
          ? ""
          : "primitive";

  return (
    <group
      ref={(g) => {
        (group as React.MutableRefObject<THREE.Group | null>).current = g;
        registerGroup(node.id, g);
      }}
    >
      {/* Border shell — subtle ring, glows with the depth accent on hover */}
      <RoundedBox args={[width + 0.03, height + 0.03, 0.045]} radius={0.035} smoothness={3} position={[0, 0, -0.008]}>
        <meshStandardMaterial color={hovered ? accent : C_SHELL} roughness={0.5} metalness={0.2} />
      </RoundedBox>

      {/* Card body */}
      <RoundedBox
        args={[width, height, 0.06]}
        radius={0.03}
        smoothness={3}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={endDrag}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = "grab";
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = "auto";
        }}
      >
        <meshStandardMaterial color={C_BODY} roughness={0.5} metalness={0.2} />
      </RoundedBox>

      {/* Depth accent bar */}
      <mesh position={[left + 0.1, 0, 0.005]}>
        <boxGeometry args={[0.045, Math.max(0.1, height - 0.2), 0.075]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.5} roughness={0.4} />
      </mesh>

      {/* Header: [-] key: {n keys} */}
      {hasBranches && (
        <ToggleButton
          glyph={collapsed ? "+" : "–"}
          position={[left + 0.26, headerY, 0.06]}
          onActivate={() => onToggle(node.id)}
          accent={accent}
        />
      )}
      <Text
        position={[textX, headerY, 0.035]}
        fontSize={0.092}
        color={C_TITLE}
        anchorX="left"
        anchorY="middle"
        maxWidth={KEY_MAX}
        whiteSpace="nowrap"
      >
        {truncate(node.key, 20)}
      </Text>
      <Text
        position={[valueX, headerY, 0.035]}
        fontSize={0.08}
        color={accent}
        anchorX="left"
        anchorY="middle"
        maxWidth={VALUE_MAX}
        whiteSpace="nowrap"
      >
        {headerBadge}
      </Text>

      {/* Rows */}
      {rows.length === 0 && (
        <Text position={[textX, rowTop - CARD_ROW_H / 2, 0.035]} fontSize={0.078} color={C_NULL} anchorX="left" anchorY="middle" whiteSpace="nowrap">
          {"{empty}"}
        </Text>
      )}
      {rows.map((row, i) => {
        const y = rowTop - i * CARD_ROW_H - CARD_ROW_H / 2;
        if (row.kind === "more") {
          return (
            <Text key={`more-${i}`} position={[textX, y, 0.035]} fontSize={0.076} color={C_NULL} anchorX="left" anchorY="middle" whiteSpace="nowrap">
              {`+${row.count} more…`}
            </Text>
          );
        }
        const isBranch = row.kind === "branch";
        const key = isBranch ? row.child.key : row.key;
        const childCollapsed = isBranch ? collapsedIds.has(row.child.id) : false;
        return (
          <group key={isBranch ? row.child.id : `leaf-${key}-${i}`} position={[0, y, 0]}>
            {/* separator */}
            <mesh position={[0.04, CARD_ROW_H / 2, 0.032]}>
              <planeGeometry args={[width - 0.34, 0.006]} />
              <meshBasicMaterial color={C_SEPARATOR} />
            </mesh>
            {isBranch && (
              <ToggleButton
                glyph={childCollapsed ? "+" : "–"}
                position={[left + 0.26, 0, 0.06]}
                onActivate={() => onToggle(row.child.id)}
                accent={accent}
                size={0.155}
              />
            )}
            <Text
              position={[textX, 0, 0.035]}
              fontSize={0.08}
              color={isBranch ? C_KEY_BRANCH : C_KEY_LEAF}
              anchorX="left"
              anchorY="middle"
              maxWidth={KEY_MAX}
              whiteSpace="nowrap"
            >
              {truncate(key, 14)}
            </Text>
            <Text
              position={[valueX, 0, 0.035]}
              fontSize={0.078}
              color={isBranch ? C_KEY_LEAF : valueColor(row.value)}
              anchorX="left"
              anchorY="middle"
              maxWidth={VALUE_MAX}
              whiteSpace="nowrap"
            >
              {isBranch ? branchBadge(row.child) : truncate(String(row.value), 18)}
            </Text>
          </group>
        );
      })}
    </group>
  );
}

const SpatialCard3D = memo(SpatialCard3DInner);
export default SpatialCard3D;

"use client";

import { memo } from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";

export interface ConnectorLineProps {
  edgeKey: string;
  label: string;
  /** Line colour — the parent's depth accent. */
  color: string;
  /** Child-end dot colour — the child's depth accent. */
  endColor: string;
  initialPoints: [number, number, number][];
  initialMid: [number, number, number];
  registerLine: (key: string, obj: THREE.Object3D | null) => void;
  registerLabel: (key: string, obj: THREE.Object3D | null) => void;
}

/**
 * Curved connector between two cards, anchored to the child's row inside
 * the parent card. The polyline is rewritten every frame by the parent's
 * animation loop (fixed point count so the Line2 buffers stay stable) —
 * lines stick to cards while dragged or reflowing.
 */
function ConnectorLineInner({
  edgeKey,
  label,
  color,
  endColor,
  initialPoints,
  initialMid,
  registerLine,
  registerLabel,
}: ConnectorLineProps) {
  const last = initialPoints[initialPoints.length - 1];
  return (
    <group>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Line
        ref={(o: any) => registerLine(edgeKey, o as unknown as THREE.Object3D | null)}
        points={initialPoints}
        color={color}
        lineWidth={2.5}
        transparent
        opacity={0.65}
      />
      {/* parent-end dot */}
      <mesh position={initialPoints[0]}>
        <sphereGeometry args={[0.02, 10, 10]} />
        <meshBasicMaterial color={color} />
      </mesh>
      {/* child-end dot */}
      <mesh position={last}>
        <sphereGeometry args={[0.024, 10, 10]} />
        <meshBasicMaterial color={endColor} />
      </mesh>
      <Text
        ref={(o) => registerLabel(edgeKey, (o as unknown as THREE.Object3D | null) ?? null)}
        position={initialMid}
        fontSize={0.085}
        color="#c6c6cd"
        anchorX="center"
        anchorY="middle"
        whiteSpace="nowrap"
      >
        {label}
      </Text>
    </group>
  );
}

const ConnectorLine = memo(ConnectorLineInner);
export default ConnectorLine;

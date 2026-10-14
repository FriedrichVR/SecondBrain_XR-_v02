"use client";

import { memo } from "react";
import * as THREE from "three";
import { Line, Text } from "@react-three/drei";

export interface ConnectorLineProps {
  edgeKey: string;
  label: string;
  initialPoints: [number, number, number][];
  initialMid: [number, number, number];
  registerLine: (key: string, obj: THREE.Object3D | null) => void;
  registerLabel: (key: string, obj: THREE.Object3D | null) => void;
}

/**
 * Glowing curved connector between two cards. The polyline is rewritten
 * every frame by the parent's animation loop (fixed point count so the
 * Line2 buffers stay stable) — this is what makes lines stick to cards
 * while they are dragged or reflowing.
 */
function ConnectorLineInner({ edgeKey, label, initialPoints, initialMid, registerLine, registerLabel }: ConnectorLineProps) {
  return (
    <group>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <Line
        ref={(o: any) => registerLine(edgeKey, o as unknown as THREE.Object3D | null)}
        points={initialPoints}
        color="#7d7d85"
        lineWidth={2}
        transparent
        opacity={0.9}
      />
      {/* endpoint dots */}
      <mesh position={initialPoints[0]}>
        <sphereGeometry args={[0.022, 10, 10]} />
        <meshBasicMaterial color="#9a9aa2" toneMapped={false} />
      </mesh>
      <Text
        ref={(o) => registerLabel(edgeKey, (o as unknown as THREE.Object3D | null) ?? null)}
        position={initialMid}
        fontSize={0.09}
        color="#a8a8ae"
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

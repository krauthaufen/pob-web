/**
 * Processes raw tree.json data into renderable node positions.
 *
 * Node positions in POE's tree are defined by:
 * - Group position (x, y)
 * - Orbit (which orbit ring the node is on, determines radius)
 * - OrbitIndex (position along that orbit ring, determines angle)
 *
 * POE2 tree.json provides explicit angles via orbitAnglesByOrbit.
 */
import type { TreeData, TreeNode, ProcessedNode } from "./tree-types";

export function processTree(data: TreeData): {
  nodes: Map<string, ProcessedNode>;
  connections: Array<{ from: string; to: string }>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
} {
  const nodes = new Map<string, ProcessedNode>();
  const connections: Array<{ from: string; to: string }> = [];
  const seenConnections = new Set<string>();

  const { orbitRadii, skillsPerOrbit, orbitAnglesByOrbit } = data.constants;

  function calcNodePos(node: TreeNode): { x: number; y: number } | null {
    if (node.group == null || node.orbit == null || node.orbitIndex == null) {
      return null;
    }

    // node.group is 1-based, groups array is 0-based
    const group = data.groups[node.group - 1];
    if (!group) return null;

    const radius = orbitRadii[node.orbit] ?? 0;

    if (radius === 0) {
      return { x: group.x, y: group.y };
    }

    // Use explicit angles from orbitAnglesByOrbit if available
    let angle: number;
    if (orbitAnglesByOrbit && orbitAnglesByOrbit[node.orbit]) {
      const angles = orbitAnglesByOrbit[node.orbit]!;
      // orbitAnglesByOrbit includes 0 and 2*PI (which are the same),
      // so the index directly maps
      angle = angles[node.orbitIndex] ?? 0;
    } else {
      const total = skillsPerOrbit[node.orbit] ?? 1;
      angle = (2 * Math.PI * node.orbitIndex) / total;
    }

    // POE tree convention: 0 angle = top (north), clockwise
    // angle is in radians, 0 = right in standard math
    // The tree data already uses standard math convention,
    // but we need to offset by -PI/2 to make 0 = top
    return {
      x: group.x + radius * Math.sin(angle),
      y: group.y - radius * Math.cos(angle),
    };
  }

  function getNodeType(node: TreeNode): ProcessedNode["type"] {
    if (node.isKeystone) return "keystone";
    if (node.isNotable) return "notable";
    if (node.isJewelSocket) return "jewel";
    if (node.isMastery) return "mastery";
    if (node.isAscendancyStart) return "ascendancyStart";
    if (node.classStartIndex != null) return "classStart";
    return "normal";
  }

  function getNodeSize(type: ProcessedNode["type"]): number {
    switch (type) {
      case "keystone": return 14;
      case "notable": return 10;
      case "jewel": return 10;
      case "mastery": return 12;
      case "classStart": return 16;
      case "ascendancyStart": return 12;
      case "normal": return 6;
    }
  }

  // Process all nodes
  for (const [id, node] of Object.entries(data.nodes)) {
    const pos = calcNodePos(node);
    if (!pos) continue;

    // Skip decorative-only nodes (mastery group centers, etc.)
    if (node.isOnlyImage) continue;
    // Skip nodes with no name (unless they are structural)
    if (!node.name && !node.isAscendancyStart && node.classStartIndex == null) continue;

    const type = getNodeType(node);

    nodes.set(id, {
      id,
      hash: node.skill,
      x: pos.x,
      y: pos.y,
      name: node.name,
      icon: node.icon ?? "",
      stats: node.stats ?? [],
      type,
      ascendancy: node.ascendancyName,
      connections: (node.connections ?? []).map(c => String(c.id)),
      size: getNodeSize(type),
    });
  }

  // Build connection list (deduplicated)
  for (const [id, node] of nodes) {
    for (const outId of node.connections) {
      const key = [id, outId].sort().join("-");
      if (!seenConnections.has(key) && nodes.has(outId)) {
        seenConnections.add(key);
        connections.push({ from: id, to: outId });
      }
    }
  }

  // Calculate bounds (exclude ascendancy nodes from main bounds)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes.values()) {
    if (node.ascendancy) continue;
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x);
    maxY = Math.max(maxY, node.y);
  }

  return { nodes, connections, bounds: { minX, minY, maxX, maxY } };
}

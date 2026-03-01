import { useEffect, useRef, useState, useCallback } from "react";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import { useBuildStore } from "@/store/build-store";
import type { ProcessedNode } from "./tree-types";
import type { TreeData } from "./tree-types";
import type { NodeImpact } from "@/worker/calc-api";
import type { CalcClient } from "@/worker/calc-client";
import { processTree } from "./tree-processor";
import { NodeDetailPanel } from "./NodeDetailPanel";
import {
  loadTreeAtlases,
  getFrameTexture,
  getIconTexture,
  getJewelTexture,
  type SpriteAtlas,
} from "./sprite-loader";

const COLORS = {
  bg: 0x0c0c0e,
  connection: 0x3a3a4e,
  connectionAllocated: 0xaf6025,
  connectionWS1: 0x2a8025,
  connectionWS2: 0x2560af,
  searchHighlight: 0xffff00,
  // Fallback colors when textures missing
  nodeNormal: 0x5a5a6e,
  nodeNormalAllocated: 0xc8a25c,
  nodeNotable: 0x7a7a5e,
  nodeNotableAllocated: 0xdbb64a,
  nodeKeystone: 0x8a6a4e,
  nodeKeystoneAllocated: 0xedc85a,
  nodeJewel: 0x4a8a6a,
  nodeClassStart: 0x8a8a9e,
  mastery: 0x6a4a8a,
};

const HEATMAP_COLORS = [
  0x0000ff, 0x00ffff, 0x00ff00, 0xffff00, 0xff8800, 0xff0000,
];

// Node sizes in tree coordinate units (from PassiveTree.lua GetNodeTargetSize × 2)
const FRAME_SIZE: Record<string, number> = {
  normal: 108,
  notable: 160,
  keystone: 240,
  jewel: 152,
  mastery: 108,
  classStart: 2,
  ascendancyStart: 100,
};

const ICON_SIZE: Record<string, number> = {
  normal: 74,
  notable: 108,
  keystone: 164,
  jewel: 152,
  mastery: 74,
  classStart: 74,
  ascendancyStart: 32,
};

interface Props {
  treeData: TreeData | null;
  heatmapData?: Record<number, number>;
  searchQuery?: string;
  calcClient?: CalcClient | null;
}

export function PassiveTree({ treeData, heatmapData, searchQuery, calcClient }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const nodesRef = useRef<Map<string, ProcessedNode>>(new Map());
  const nodeGfxRef = useRef<Map<string, Container>>(new Map());
  const atlasesRef = useRef<Record<string, SpriteAtlas> | null>(null);
  const connGfxRef = useRef<Graphics | null>(null);
  const searchGfxRef = useRef<Graphics | null>(null);
  const searchMatchesRef = useRef<Array<{ x: number; y: number; r: number }>>([]);
  const connectionsDataRef = useRef<Array<{ from: string; to: string }>>([]);
  const [appReady, setAppReady] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; node: ProcessedNode;
  } | null>(null);

  // Node detail panel state
  const [selectedNode, setSelectedNode] = useState<ProcessedNode | null>(null);
  const selectedNodeRef = useRef<ProcessedNode | null>(null);
  const [nodeImpact, setNodeImpact] = useState<NodeImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const nodeTappedRef = useRef(false);

  const allocatedNodes = useBuildStore((s) => s.allocatedNodes);
  const setAllocatedNodes = useBuildStore((s) => s.setAllocatedNodes);
  const setHoveredNode = useBuildStore((s) => s.setHoveredNode);
  const setCalcDisplay = useBuildStore((s) => s.setCalcDisplay);
  const jewelData = useBuildStore((s) => s.jewelData);
  const weaponSetNodes = useBuildStore((s) => s.weaponSetNodes);

  // Initialize PixiJS
  useEffect(() => {
    if (!canvasRef.current) return;
    const container = canvasRef.current;

    const app = new Application();
    let destroyed = false;

    app.init({
      resizeTo: container,
      background: COLORS.bg,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    }).then(() => {
      if (destroyed) { app.destroy(true); return; }
      container.appendChild(app.canvas as HTMLCanvasElement);
      appRef.current = app;

      const world = new Container();
      app.stage.addChild(world);
      worldRef.current = world;
      setAppReady(true);
    });

    return () => {
      destroyed = true;
      if (appRef.current) {
        appRef.current.destroy(true);
        appRef.current = null;
        worldRef.current = null;
        setAppReady(false);
      }
    };
  }, []);

  // Pan & zoom via mouse + touch
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    let isDragging = false;
    let lastX = 0, lastY = 0;
    let dragMoved = false;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const world = worldRef.current;
      if (!world) return;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldScale = world.scale.x;
      const newScale = Math.max(0.001, Math.min(10, oldScale * factor));

      world.x = mx - (mx - world.x) * (newScale / oldScale);
      world.y = my - (my - world.y) * (newScale / oldScale);
      world.scale.set(newScale);
      redrawSearchRef.current();
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button === 0 || e.button === 1) {
        isDragging = true;
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        el.setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (isDragging && worldRef.current) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMoved = true;
        worldRef.current.x += dx;
        worldRef.current.y += dy;
        lastX = e.clientX;
        lastY = e.clientY;
        el.style.cursor = "grabbing";
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      isDragging = false;
      el.style.cursor = "";
    };

    let lastTouches: Touch[] = [];
    let touchDragMoved = false;

    function getTouchCenter(touches: Touch[]): { x: number; y: number } {
      let x = 0, y = 0;
      for (const t of touches) { x += t.clientX; y += t.clientY; }
      return { x: x / touches.length, y: y / touches.length };
    }

    function getTouchDist(touches: Touch[]): number {
      if (touches.length < 2) return 0;
      const dx = touches[0]!.clientX - touches[1]!.clientX;
      const dy = touches[0]!.clientY - touches[1]!.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    }

    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      lastTouches = Array.from(e.touches);
      touchDragMoved = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const world = worldRef.current;
      if (!world) return;
      const touches = Array.from(e.touches);
      const rect = el.getBoundingClientRect();

      if (touches.length === 1 && lastTouches.length === 1) {
        const dx = touches[0]!.clientX - lastTouches[0]!.clientX;
        const dy = touches[0]!.clientY - lastTouches[0]!.clientY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) touchDragMoved = true;
        world.x += dx;
        world.y += dy;
      } else if (touches.length >= 2 && lastTouches.length >= 2) {
        touchDragMoved = true;
        const oldCenter = getTouchCenter(lastTouches);
        const newCenter = getTouchCenter(touches);
        const oldDist = getTouchDist(lastTouches);
        const newDist = getTouchDist(touches);

        world.x += newCenter.x - oldCenter.x;
        world.y += newCenter.y - oldCenter.y;

        if (oldDist > 0 && newDist > 0) {
          const zoomFactor = newDist / oldDist;
          const mx = newCenter.x - rect.left;
          const my = newCenter.y - rect.top;
          const oldScale = world.scale.x;
          const newScale = Math.max(0.001, Math.min(10, oldScale * zoomFactor));

          world.x = mx - (mx - world.x) * (newScale / oldScale);
          world.y = my - (my - world.y) * (newScale / oldScale);
          world.scale.set(newScale);
          redrawSearchRef.current();
        }
      }

      lastTouches = touches;
    };

    const onTouchEnd = (e: TouchEvent) => {
      lastTouches = Array.from(e.touches);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    (el as any).__dragMoved = () => dragMoved || touchDragMoved;

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // Create a node's visual representation
  const createNodeVisual = useCallback((
    node: ProcessedNode,
    isAllocated: boolean,
    atlases: Record<string, SpriteAtlas> | null,
    jewelInfo?: { name: string; baseName: string; rarity: string } | null,
  ): Container => {
    const container = new Container();
    const frameSize = FRAME_SIZE[node.type] ?? 26;
    const iconSize = ICON_SIZE[node.type] ?? 16;

    // 1. Icon (base artwork) — for non-jewel nodes, icon goes behind frame
    let jewelTex: ReturnType<typeof getJewelTexture> = null;
    if (node.type === "jewel" && jewelInfo && atlases) {
      jewelTex = getJewelTexture(atlases, jewelInfo.name, jewelInfo.baseName);
    } else if (node.icon) {
      const iconTex = atlases ? getIconTexture(atlases, node.icon, isAllocated) : null;
      if (iconTex) {
        const iconSprite = new Sprite(iconTex);
        iconSprite.anchor.set(0.5);
        iconSprite.width = iconSize;
        iconSprite.height = iconSize;
        container.addChild(iconSprite);
      }
    }

    // 2. Frame overlay
    const frameTex = atlases ? getFrameTexture(atlases, node.type, isAllocated) : null;

    if (frameTex) {
      const frameSprite = new Sprite(frameTex);
      frameSprite.anchor.set(0.5);
      frameSprite.width = frameSize;
      frameSprite.height = frameSize * (frameTex.height / frameTex.width);
      container.addChild(frameSprite);
    } else if (node.type !== "mastery") {
      const gfx = new Graphics();
      const r = frameSize / 2;
      let color: number;
      switch (node.type) {
        case "keystone":
          color = isAllocated ? COLORS.nodeKeystoneAllocated : COLORS.nodeKeystone;
          gfx.moveTo(0, -r); gfx.lineTo(r, 0); gfx.lineTo(0, r); gfx.lineTo(-r, 0); gfx.closePath();
          gfx.fill({ color, alpha: isAllocated ? 1 : 0.7 });
          break;
        case "notable":
          color = isAllocated ? COLORS.nodeNotableAllocated : COLORS.nodeNotable;
          gfx.circle(0, 0, r);
          gfx.fill({ color, alpha: isAllocated ? 1 : 0.7 });
          break;
        case "jewel":
          color = COLORS.nodeJewel;
          gfx.moveTo(0, -r); gfx.lineTo(r, 0); gfx.lineTo(0, r); gfx.lineTo(-r, 0); gfx.closePath();
          gfx.stroke({ width: 3, color, alpha: 0.9 });
          gfx.fill({ color, alpha: 0.15 });
          break;
        case "classStart":
          gfx.circle(0, 0, r);
          gfx.fill({ color: COLORS.nodeClassStart, alpha: 0.8 });
          break;
        default:
          color = isAllocated ? COLORS.nodeNormalAllocated : COLORS.nodeNormal;
          gfx.circle(0, 0, r);
          gfx.fill({ color, alpha: isAllocated ? 0.9 : 0.5 });
          break;
      }
      container.addChild(gfx);
    }

    // 3. Jewel icon ON TOP of frame (jewel-sockets sprites overlay the socket frame)
    if (jewelTex) {
      const jewelSprite = new Sprite(jewelTex);
      jewelSprite.anchor.set(0.5);
      jewelSprite.width = iconSize;
      jewelSprite.height = iconSize * (jewelTex.height / jewelTex.width);
      container.addChild(jewelSprite);
    }

    return container;
  }, []);

  // Render tree when app ready + data available
  useEffect(() => {
    if (!appReady || !treeData || !worldRef.current || !appRef.current) return;

    const app = appRef.current;
    const world = worldRef.current;
    let cancelled = false;

    async function render() {
      if (!atlasesRef.current) {
        atlasesRef.current = await loadTreeAtlases();
      }
      if (cancelled) return;

      const atlases = atlasesRef.current;
      const currentAllocated = useBuildStore.getState().allocatedNodes;
      const wsNodes = useBuildStore.getState().weaponSetNodes;

      world.removeChildren();
      nodeGfxRef.current.clear();

      const { nodes, connections, bounds } = processTree(treeData!);
      nodesRef.current = nodes;
      connectionsDataRef.current = connections;

      const treeWidth = bounds.maxX - bounds.minX;
      const treeHeight = bounds.maxY - bounds.minY;
      const screenW = app.screen.width;
      const screenH = app.screen.height;
      const padding = 50;

      const scaleX = (screenW - padding * 2) / treeWidth;
      const scaleY = (screenH - padding * 2) / treeHeight;
      const fitScale = Math.min(scaleX, scaleY);

      // Connection layer
      const connGfx = new Graphics();
      connGfxRef.current = connGfx;
      for (const conn of connections) {
        const from = nodes.get(conn.from);
        const to = nodes.get(conn.to);
        if (!from || !to) continue;
        if (from.ascendancy !== to.ascendancy) continue;

        const isConnAllocated = currentAllocated.has(from.hash) && currentAllocated.has(to.hash);
        let connColor = COLORS.connection;
        if (isConnAllocated) {
          const fromWs = wsNodes?.[from.hash];
          const toWs = wsNodes?.[to.hash];
          const ws = fromWs || toWs;
          connColor = ws === 1 ? COLORS.connectionWS1 : ws === 2 ? COLORS.connectionWS2 : COLORS.connectionAllocated;
        }

        connGfx.moveTo(from.x, from.y);
        connGfx.lineTo(to.x, to.y);
        connGfx.stroke({
          width: isConnAllocated ? 12 : 6,
          color: connColor,
          alpha: isConnAllocated ? 0.9 : 0.35,
        });
      }
      world.addChild(connGfx);

      // Node layer
      const nodeLayer = new Container();

      for (const [id, node] of nodes) {
        if (node.ascendancy) continue;

        const isAllocated = currentAllocated.has(node.hash);
        const curJewelData = useBuildStore.getState().jewelData;
        const ji = node.type === "jewel" ? curJewelData?.[String(node.hash)] ?? null : null;
        const nodeContainer = createNodeVisual(node, isAllocated, atlases, ji);

        nodeContainer.x = node.x;
        nodeContainer.y = node.y;
        nodeContainer.eventMode = "static";
        nodeContainer.cursor = "pointer";
        (nodeContainer as any).__allocated = isAllocated;
        (nodeContainer as any).__jewelInfo = ji ? `${ji.name}:${ji.baseName}` : "";

        const hitR = (FRAME_SIZE[node.type] ?? 26) / 2;
        nodeContainer.hitArea = {
          contains: (x: number, y: number) => x * x + y * y < hitR * hitR,
        };

        nodeContainer.on("pointerenter", () => {
          setHoveredNode(node.hash);
          if (!selectedNodeRef.current) {
            const globalPos = nodeContainer.getGlobalPosition();
            setTooltip({ x: globalPos.x, y: globalPos.y, node });
          }
        });
        nodeContainer.on("pointerleave", () => {
          setHoveredNode(null);
          setTooltip(null);
        });
        nodeContainer.on("pointertap", () => {
          const el = canvasRef.current;
          if (el && (el as any).__dragMoved?.()) return;
          nodeTappedRef.current = true;
          setTooltip(null);
          selectedNodeRef.current = node;
          setSelectedNode(node);
          setNodeImpact(null);
        });

        nodeLayer.addChild(nodeContainer);
        nodeGfxRef.current.set(id, nodeContainer);
      }
      world.addChild(nodeLayer);

      // Center and fit
      world.scale.set(fitScale);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      world.x = screenW / 2 - cx * fitScale;
      world.y = screenH / 2 - cy * fitScale;
    }

    render();

    return () => { cancelled = true; };
  }, [appReady, treeData, setHoveredNode, createNodeVisual]);

  // Calculate node impact when a node is selected
  useEffect(() => {
    if (!selectedNode || !calcClient) return;
    if (selectedNode.type === "classStart" || selectedNode.type === "mastery") return;

    let cancelled = false;
    setImpactLoading(true);
    setNodeImpact(null);

    calcClient.calcNodeImpact(selectedNode.hash)
      .then((impact) => {
        if (!cancelled) {
          setNodeImpact(impact);
          setImpactLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setImpactLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedNode, calcClient, allocatedNodes]);

  // Close detail panel on background tap
  useEffect(() => {
    const el = canvasRef.current;
    if (!el || !selectedNode) return;

    const onClick = () => {
      // If a node was just tapped, don't close
      if (nodeTappedRef.current) {
        nodeTappedRef.current = false;
        return;
      }
      selectedNodeRef.current = null;
      setSelectedNode(null);
      setNodeImpact(null);
    };

    // Use a slight delay so node tap fires first
    const handler = () => setTimeout(onClick, 0);
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [selectedNode]);

  // Update node visuals and connection colors when allocation changes
  useEffect(() => {
    const nodes = nodesRef.current;
    const connGfx = connGfxRef.current;
    const connections = connectionsDataRef.current;
    if (!connGfx || !nodes.size) return;

    connGfx.clear();
    for (const conn of connections) {
      const from = nodes.get(conn.from);
      const to = nodes.get(conn.to);
      if (!from || !to) continue;
      if (from.ascendancy !== to.ascendancy) continue;

      const isConnAllocated = allocatedNodes.has(from.hash) && allocatedNodes.has(to.hash);
      let connColor = COLORS.connection;
      if (isConnAllocated) {
        const fromWs = weaponSetNodes?.[from.hash];
        const toWs = weaponSetNodes?.[to.hash];
        const ws = fromWs || toWs;
        connColor = ws === 1 ? COLORS.connectionWS1 : ws === 2 ? COLORS.connectionWS2 : COLORS.connectionAllocated;
      }
      connGfx.moveTo(from.x, from.y);
      connGfx.lineTo(to.x, to.y);
      connGfx.stroke({
        width: isConnAllocated ? 12 : 6,
        color: connColor,
        alpha: isConnAllocated ? 0.9 : 0.35,
      });
    }

    const atlases = atlasesRef.current;
    for (const [id, container] of nodeGfxRef.current) {
      const node = nodes.get(id);
      if (!node || node.ascendancy) continue;
      const isAllocated = allocatedNodes.has(node.hash);
      const ji = node.type === "jewel" ? jewelData?.[String(node.hash)] ?? null : null;
      const prevJi = (container as any).__jewelInfo as string | undefined;
      const jiKey = ji ? `${ji.name}:${ji.baseName}` : "";
      const allocChanged = (container as any).__allocated !== isAllocated;
      const jewelChanged = node.type === "jewel" && prevJi !== jiKey;
      if (!allocChanged && !jewelChanged) continue;
      (container as any).__allocated = isAllocated;
      (container as any).__jewelInfo = jiKey;

      container.removeChildren();
      const newVisual = createNodeVisual(node, isAllocated, atlases, ji);
      while (newVisual.children.length > 0) {
        container.addChild(newVisual.children[0]!);
      }
    }
  }, [allocatedNodes, createNodeVisual, weaponSetNodes, jewelData]);

  // Heatmap overlay
  useEffect(() => {
    if (!heatmapData || !worldRef.current) return;
    const values = Object.values(heatmapData);
    if (values.length === 0) return;
    const maxVal = Math.max(...values);
    if (maxVal === 0) return;

    for (const [id, container] of nodeGfxRef.current) {
      const node = nodesRef.current.get(id);
      if (!node) continue;
      const power = heatmapData[node.hash] ?? 0;
      if (power <= 0) continue;

      const t = Math.min(power / maxVal, 1);
      const colorIdx = Math.min(Math.floor(t * (HEATMAP_COLORS.length - 1)), HEATMAP_COLORS.length - 1);
      const heatColor = HEATMAP_COLORS[colorIdx]!;

      const ring = new Graphics();
      const r = (FRAME_SIZE[node.type] ?? 26) / 2 + 4;
      ring.circle(0, 0, r);
      ring.stroke({ color: heatColor, width: 2, alpha: 0.3 + t * 0.7 });
      container.addChild(ring);
    }
  }, [heatmapData]);

  // Redraw search highlights at current zoom level
  const redrawSearchHighlights = useCallback(() => {
    const gfx = searchGfxRef.current;
    const world = worldRef.current;
    if (!gfx || !world) return;
    gfx.clear();
    const scale = world.scale.x || 1;
    const strokeWidth = 2 / scale;
    for (const m of searchMatchesRef.current) {
      gfx.circle(m.x, m.y, m.r);
      gfx.stroke({ color: COLORS.searchHighlight, width: strokeWidth, alpha: 0.8 });
    }
  }, []);
  const redrawSearchRef = useRef(redrawSearchHighlights);
  redrawSearchRef.current = redrawSearchHighlights;

  // Search highlight — uses a dedicated Graphics layer so stroke width can be zoom-independent
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    // Ensure search graphics layer exists
    if (!searchGfxRef.current) {
      const gfx = new Graphics();
      gfx.label = "__search_layer";
      world.addChild(gfx);
      searchGfxRef.current = gfx;
    }

    if (!searchQuery) {
      searchMatchesRef.current = [];
      searchGfxRef.current.clear();
      return;
    }

    const query = searchQuery.toLowerCase();
    const matches: Array<{ x: number; y: number; r: number }> = [];

    for (const [, node] of nodesRef.current) {
      if (node.ascendancy) continue;
      const hit = node.name.toLowerCase().includes(query) ||
        node.stats.some(s => s.toLowerCase().includes(query));
      if (hit) {
        matches.push({ x: node.x, y: node.y, r: (FRAME_SIZE[node.type] ?? 26) / 2 + 6 });
      }
    }

    searchMatchesRef.current = matches;
    redrawSearchHighlights();

    return () => {
      searchMatchesRef.current = [];
      if (searchGfxRef.current) searchGfxRef.current.clear();
    };
  }, [searchQuery, redrawSearchHighlights]);

  const [allocating, setAllocating] = useState(false);

  const handleAllocate = useCallback(async () => {
    if (!selectedNode || !calcClient || allocating) return;
    setAllocating(true);
    try {
      const result = await calcClient.allocNode(selectedNode.hash);
      if (result.success) {
        setAllocatedNodes(result.allocatedNodes);
        if (result.display) setCalcDisplay(result.display);
      }
    } catch (e) {
      console.error("[PoB] allocNode failed:", e);
    } finally {
      setAllocating(false);
      selectedNodeRef.current = null;
      setSelectedNode(null);
      setNodeImpact(null);
    }
  }, [selectedNode, calcClient, allocating, setAllocatedNodes, setCalcDisplay]);

  const handleDeallocate = useCallback(async () => {
    if (!selectedNode || !calcClient || allocating) return;
    setAllocating(true);
    try {
      const result = await calcClient.deallocNode(selectedNode.hash);
      if (result.success) {
        setAllocatedNodes(result.allocatedNodes);
        if (result.display) setCalcDisplay(result.display);
      }
    } catch (e) {
      console.error("[PoB] deallocNode failed:", e);
    } finally {
      setAllocating(false);
      selectedNodeRef.current = null;
      setSelectedNode(null);
      setNodeImpact(null);
    }
  }, [selectedNode, calcClient, allocating, setAllocatedNodes, setCalcDisplay]);

  return (
    <div className="relative h-full w-full">
      <div ref={canvasRef} className="h-full w-full touch-none" />

      {/* Tooltip (only when no detail panel) */}
      {tooltip && !selectedNode && (
        <div
          className="pointer-events-none absolute z-50 max-w-xs rounded border border-poe-border bg-poe-panel/95 p-3 shadow-lg backdrop-blur-sm"
          style={{
            left: Math.min(tooltip.x + 16, window.innerWidth - 280),
            top: tooltip.y - 10,
          }}
        >
          <p className={`mb-1 text-sm font-semibold ${
            tooltip.node.type === "keystone" ? "text-poe-accent" :
            tooltip.node.type === "notable" ? "text-yellow-300" :
            "text-poe-text"
          }`}>
            {tooltip.node.name}
          </p>
          {tooltip.node.stats.map((stat, i) => (
            <p key={i} className="text-xs text-gray-300">{stat}</p>
          ))}
        </div>
      )}

      {/* Node detail panel */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          isAllocated={allocatedNodes.has(selectedNode.hash)}
          impact={nodeImpact}
          impactLoading={impactLoading}
          allocating={allocating}
          jewelInfo={selectedNode.type === "jewel" ? jewelData?.[String(selectedNode.hash)] ?? null : null}
          onAllocate={handleAllocate}
          onDeallocate={handleDeallocate}
          onClose={() => { selectedNodeRef.current = null; setSelectedNode(null); setNodeImpact(null); }}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState, useCallback } from "react";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import { useBuildStore } from "@/store/build-store";
import type { ProcessedNode } from "./tree-types";
import type { TreeData } from "./tree-types";
import { processTree } from "./tree-processor";
import {
  loadTreeAtlases,
  getFrameTexture,
  getIconTexture,
  type SpriteAtlas,
} from "./sprite-loader";

const COLORS = {
  bg: 0x0c0c0e,
  connection: 0x3a3a4e,
  connectionAllocated: 0xaf6025,
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
// DrawAsset draws at width*2, height*2 so targetSize values are half-sizes
const FRAME_SIZE: Record<string, number> = {
  normal: 108,     // 54 * 2
  notable: 160,    // 80 * 2
  keystone: 240,   // 120 * 2
  jewel: 152,      // 76 * 2
  mastery: 108,    // same as normal
  classStart: 2,   // 1 * 2 (no visible overlay)
  ascendancyStart: 100, // 50 * 2
};

const ICON_SIZE: Record<string, number> = {
  normal: 74,      // 37 * 2
  notable: 108,    // 54 * 2
  keystone: 164,   // 82 * 2
  jewel: 152,      // 76 * 2
  mastery: 74,     // same as normal
  classStart: 74,  // 37 * 2
  ascendancyStart: 32, // 16 * 2
};

interface Props {
  treeData: TreeData | null;
  heatmapData?: Record<number, number>;
  searchQuery?: string;
}

export function PassiveTree({ treeData, heatmapData, searchQuery }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const worldRef = useRef<Container | null>(null);
  const nodesRef = useRef<Map<string, ProcessedNode>>(new Map());
  const nodeGfxRef = useRef<Map<string, Container>>(new Map());
  const atlasesRef = useRef<Record<string, SpriteAtlas> | null>(null);
  const [appReady, setAppReady] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; node: ProcessedNode;
  } | null>(null);

  const allocatedNodes = useBuildStore((s) => s.allocatedNodes);
  const toggleNode = useBuildStore((s) => s.toggleNode);
  const setHoveredNode = useBuildStore((s) => s.setHoveredNode);

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

    // --- Mouse wheel zoom ---
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
    };

    // --- Mouse drag pan ---
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return; // handled by touch events
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

    // --- Touch: 1-finger pan, 2-finger pinch-zoom ---
    let lastTouches: Touch[] = [];
    let touchDragMoved = false;

    function getTouchCenter(touches: Touch[]): { x: number; y: number } {
      let x = 0, y = 0;
      for (const t of touches) { x += t.clientX; y += t.clientY; }
      return { x: x / touches.length, y: y / touches.length };
    }

    function getTouchDist(touches: Touch[]): number {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
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
        // One-finger pan
        const dx = touches[0].clientX - lastTouches[0].clientX;
        const dy = touches[0].clientY - lastTouches[0].clientY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) touchDragMoved = true;
        world.x += dx;
        world.y += dy;
      } else if (touches.length >= 2 && lastTouches.length >= 2) {
        // Pinch zoom + pan
        touchDragMoved = true;
        const oldCenter = getTouchCenter(lastTouches);
        const newCenter = getTouchCenter(touches);
        const oldDist = getTouchDist(lastTouches);
        const newDist = getTouchDist(touches);

        // Pan
        world.x += newCenter.x - oldCenter.x;
        world.y += newCenter.y - oldCenter.y;

        // Zoom toward pinch center
        if (oldDist > 0 && newDist > 0) {
          const zoomFactor = newDist / oldDist;
          const mx = newCenter.x - rect.left;
          const my = newCenter.y - rect.top;
          const oldScale = world.scale.x;
          const newScale = Math.max(0.001, Math.min(10, oldScale * zoomFactor));

          world.x = mx - (mx - world.x) * (newScale / oldScale);
          world.y = my - (my - world.y) * (newScale / oldScale);
          world.scale.set(newScale);
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
  ): Container => {
    const container = new Container();
    const frameSize = FRAME_SIZE[node.type] ?? 26;
    const iconSize = ICON_SIZE[node.type] ?? 16;

    // PoB render order: icon (base) first, then frame (overlay) on top

    // 1. Icon (base artwork)
    if (node.icon) {
      const iconTex = atlases ? getIconTexture(atlases, node.icon, isAllocated) : null;
      if (iconTex) {
        const iconSprite = new Sprite(iconTex);
        iconSprite.anchor.set(0.5);
        iconSprite.width = iconSize;
        iconSprite.height = iconSize;
        container.addChild(iconSprite);
      }
    }

    // 2. Frame overlay (on top of icon)
    const frameTex = atlases ? getFrameTexture(atlases, node.type, isAllocated) : null;

    if (frameTex) {
      const frameSprite = new Sprite(frameTex);
      frameSprite.anchor.set(0.5);
      frameSprite.width = frameSize;
      frameSprite.height = frameSize * (frameTex.height / frameTex.width);
      container.addChild(frameSprite);
    } else if (node.type !== "mastery" && !frameTex) {
      // Fallback: draw a shape when no texture available
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

    return container;
  }, []);

  // Render tree when app ready + data available
  useEffect(() => {
    if (!appReady || !treeData || !worldRef.current || !appRef.current) return;

    const app = appRef.current;
    const world = worldRef.current;
    let cancelled = false;

    async function render() {
      // Load atlases if not already loaded
      if (!atlasesRef.current) {
        atlasesRef.current = await loadTreeAtlases();
      }
      if (cancelled) return;

      const atlases = atlasesRef.current;

      world.removeChildren();
      nodeGfxRef.current.clear();

      const { nodes, connections, bounds } = processTree(treeData!);
      nodesRef.current = nodes;

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
      for (const conn of connections) {
        const from = nodes.get(conn.from);
        const to = nodes.get(conn.to);
        if (!from || !to) continue;
        if (from.ascendancy !== to.ascendancy) continue;

        const isConnAllocated = allocatedNodes.has(from.hash) && allocatedNodes.has(to.hash);

        connGfx.moveTo(from.x, from.y);
        connGfx.lineTo(to.x, to.y);
        connGfx.stroke({
          width: isConnAllocated ? 12 : 6,
          color: isConnAllocated ? COLORS.connectionAllocated : COLORS.connection,
          alpha: isConnAllocated ? 0.9 : 0.35,
        });
      }
      world.addChild(connGfx);

      // Node layer
      const nodeLayer = new Container();

      for (const [id, node] of nodes) {
        if (node.ascendancy) continue;

        const isAllocated = allocatedNodes.has(node.hash);
        const nodeContainer = createNodeVisual(node, isAllocated, atlases);

        nodeContainer.x = node.x;
        nodeContainer.y = node.y;
        nodeContainer.eventMode = "static";
        nodeContainer.cursor = "pointer";

        const hitR = (FRAME_SIZE[node.type] ?? 26) / 2;
        nodeContainer.hitArea = {
          contains: (x: number, y: number) => x * x + y * y < hitR * hitR,
        };

        nodeContainer.on("pointerenter", () => {
          setHoveredNode(node.hash);
          const globalPos = nodeContainer.getGlobalPosition();
          setTooltip({ x: globalPos.x, y: globalPos.y, node });
        });
        nodeContainer.on("pointerleave", () => {
          setHoveredNode(null);
          setTooltip(null);
        });
        nodeContainer.on("pointertap", () => {
          const el = canvasRef.current;
          if (el && (el as any).__dragMoved?.()) return;
          if (node.type !== "classStart" && node.type !== "mastery") {
            toggleNode(node.hash);
          }
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
  }, [appReady, treeData, allocatedNodes, toggleNode, setHoveredNode, createNodeVisual]);

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

  // Search highlight
  useEffect(() => {
    if (!searchQuery) return;
    const query = searchQuery.toLowerCase();

    for (const [id, container] of nodeGfxRef.current) {
      const node = nodesRef.current.get(id);
      if (!node) continue;

      const matches = node.name.toLowerCase().includes(query) ||
        node.stats.some(s => s.toLowerCase().includes(query));

      if (matches) {
        const highlight = new Graphics();
        const r = (FRAME_SIZE[node.type] ?? 26) / 2 + 6;
        highlight.circle(0, 0, r);
        highlight.stroke({ color: COLORS.searchHighlight, width: 2, alpha: 0.8 });
        highlight.label = "__search_highlight";
        container.addChild(highlight);
      }
    }

    return () => {
      for (const container of nodeGfxRef.current.values()) {
        const toRemove = container.children.filter(c => c.label === "__search_highlight");
        toRemove.forEach(c => container.removeChild(c));
      }
    };
  }, [searchQuery]);

  return (
    <div className="relative h-full w-full">
      <div ref={canvasRef} className="h-full w-full touch-none" />

      {tooltip && (
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
    </div>
  );
}

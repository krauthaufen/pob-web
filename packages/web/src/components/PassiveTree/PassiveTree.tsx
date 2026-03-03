import { useEffect, useRef, useState, useCallback } from "react";
import { Application, Container, Graphics, Sprite, TilingSprite } from "pixi.js";
import { useBuildStore } from "@/store/build-store";
import type { ProcessedNode } from "./tree-types";
import type { TreeData } from "./tree-types";
import type { NodeImpact, NodePowerData } from "@/worker/calc-api";
import type { CalcClient } from "@/worker/calc-client";
import { processTree } from "./tree-processor";
import { encodeBuildCode } from "@/worker/build-decoder";
import { isTouchDevice } from "@/utils/is-touch";
import { NodeDetailPanel } from "./NodeDetailPanel";
import { JewelDetailBody } from "@/components/StatsPanel/InventoryPanel";
import {
  loadTreeAtlases,
  getFrameTexture,
  getAscFrameTexture,
  getIconTexture,
  getJewelTexture,
  getSpriteTexture,
  type SpriteAtlas,
} from "./sprite-loader";

// Save/restore viewport across iOS background kills
const VIEWPORT_KEY = "pob-viewport";
function saveViewport(world: { x: number; y: number; scale: { x: number } }) {
  try {
    localStorage.setItem(VIEWPORT_KEY, JSON.stringify({
      x: world.x, y: world.y, scale: world.scale.x,
    }));
  } catch {}
}
function loadViewport(): { x: number; y: number; scale: number } | null {
  try {
    const s = localStorage.getItem(VIEWPORT_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

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
  heatmapData?: NodePowerData | null;
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
  const ascConnGfxRef = useRef<Graphics | null>(null);
  const jewelRadiusGfxRef = useRef<Graphics | null>(null);
  const searchGfxRef = useRef<Graphics | null>(null);
  const pathHighlightGfxRef = useRef<Graphics | null>(null);
  const searchMatchesRef = useRef<Array<{ x: number; y: number; r: number }>>([]);
  const connectionsDataRef = useRef<Array<{ from: string; to: string }>>([]);
  const boundsRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [appReady, setAppReady] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; node: ProcessedNode;
    jewelInfo?: { name: string; baseName: string; rarity: string; implicitMods: string[]; explicitMods: string[]; enchantMods: string[]; runeMods: string[] } | null;
  } | null>(null);

  // Node detail panel state
  const [selectedNode, setSelectedNode] = useState<ProcessedNode | null>(null);
  const selectedNodeRef = useRef<ProcessedNode | null>(null);
  const [nodeImpact, setNodeImpact] = useState<NodeImpact | null>(null);
  const [nodeImpactSingle, setNodeImpactSingle] = useState<NodeImpact | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactSingleMode, setImpactSingleMode] = useState(false);
  const nodeTappedRef = useRef(false);
  const [powerListMinimized, setPowerListMinimized] = useState(false);

  const allocatedNodes = useBuildStore((s) => s.allocatedNodes);
  const setAllocatedNodes = useBuildStore((s) => s.setAllocatedNodes);
  const setHoveredNode = useBuildStore((s) => s.setHoveredNode);
  const setCalcDisplay = useBuildStore((s) => s.setCalcDisplay);
  const setDisplayStats = useBuildStore((s) => s.setDisplayStats);
  const setSkillsData = useBuildStore((s) => s.setSkillsData);
  const setImportCode = useBuildStore((s) => s.setImportCode);
  const jewelData = useBuildStore((s) => s.jewelData);
  const weaponSetNodes = useBuildStore((s) => s.weaponSetNodes);
  const buildAscendancy = useBuildStore((s) => s.build?.ascendancy);

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
      redrawHeatmapRef.current();
      saveViewport(world);
    };

    let activePointerId = -1;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button === 0 || e.button === 1) {
        isDragging = true;
        dragMoved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        activePointerId = e.pointerId;
        // Don't setPointerCapture here — it fires pointerout on PixiJS nodes
        // and prevents pointertap from working. Capture on first move instead.
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (isDragging && worldRef.current) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          dragMoved = true;
          try {
            if (activePointerId >= 0 && !el.hasPointerCapture(activePointerId)) {
              el.setPointerCapture(activePointerId);
            }
          } catch {}
        }
        worldRef.current.x += dx;
        worldRef.current.y += dy;
        lastX = e.clientX;
        lastY = e.clientY;
        el.style.cursor = "grabbing";
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (isDragging && worldRef.current) saveViewport(worldRef.current);
      isDragging = false;
      activePointerId = -1;
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
          redrawHeatmapRef.current();
        }
      }

      lastTouches = touches;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (worldRef.current) saveViewport(worldRef.current);
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

    // Save viewport when page goes to background (iOS kills shortly after)
    const onVisChange = () => {
      if (document.visibilityState === "hidden" && worldRef.current) {
        saveViewport(worldRef.current);
      }
    };
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
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

    // 1. Icon (base artwork) — for non-jewel nodes, icon goes behind frame, clipped to circle
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
        // Clip icon to circular frame bounds
        const clipR = frameSize * 0.33;
        const mask = new Graphics();
        mask.circle(0, 0, clipR);
        mask.fill({ color: 0xffffff });
        container.addChild(mask);
        iconSprite.mask = mask;
        container.addChild(iconSprite);
      }
    }

    // 2. Frame overlay (use ascendancy-specific frames when available)
    const frameTex = atlases
      ? (node.nodeOverlay ? getAscFrameTexture(atlases, node.nodeOverlay, isAllocated) : getFrameTexture(atlases, node.type, isAllocated))
      : null;

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
      const activeAsc = useBuildStore.getState().build?.ascendancy || undefined;

      world.removeChildren();
      nodeGfxRef.current.clear();

      const { nodes, connections, bounds } = processTree(treeData!, activeAsc);
      nodesRef.current = nodes;
      connectionsDataRef.current = connections;
      boundsRef.current = bounds;

      const treeWidth = bounds.maxX - bounds.minX;
      const treeHeight = bounds.maxY - bounds.minY;
      const screenW = app.screen.width;
      const screenH = app.screen.height;
      const padding = 50;

      const scaleX = (screenW - padding * 2) / treeWidth;
      const scaleY = (screenH - padding * 2) / treeHeight;
      const fitScale = Math.min(scaleX, scaleY);

      // Background layer — single TilingSprite instead of hundreds of tiles
      const bgAtlas = atlases["background_1024_1024_BC7"];
      if (bgAtlas) {
        const bgTex = getSpriteTexture(bgAtlas, "Background2");
        if (bgTex) {
          const pad = 2000;
          const bgW = treeWidth + pad * 2;
          const bgH = treeHeight + pad * 2;
          const tiling = new TilingSprite({ texture: bgTex, width: bgW, height: bgH });
          tiling.x = bounds.minX - pad;
          tiling.y = bounds.minY - pad;
          world.addChild(tiling);
        }
      }

      // Main tree connection layer (below ascendancy backgrounds)
      const connGfx = new Graphics();
      connGfxRef.current = connGfx;
      // Ascendancy connection layer (added after backgrounds)
      const ascConnGfx = new Graphics();
      ascConnGfxRef.current = ascConnGfx;

      function drawConn(gfx: Graphics, from: ProcessedNode, to: ProcessedNode, allocated: Set<number>, isAsc: boolean) {
        const isConnAllocated = allocated.has(from.hash) && allocated.has(to.hash);
        let connColor: number = isAsc ? 0xffffff : COLORS.connection;
        if (isConnAllocated) {
          const fromWs = wsNodes?.[from.hash];
          const toWs = wsNodes?.[to.hash];
          const ws = fromWs || toWs;
          connColor = ws === 1 ? COLORS.connectionWS1 : ws === 2 ? COLORS.connectionWS2 : COLORS.connectionAllocated;
        }
        gfx.moveTo(from.x, from.y);
        gfx.lineTo(to.x, to.y);
        gfx.stroke({
          width: isConnAllocated ? 12 : 8,
          color: connColor,
          alpha: isConnAllocated ? 0.9 : 0.7,
        });
      }

      // Check if a node's unlock constraint is satisfied
      const isUnlockedInit = (node: ProcessedNode) => {
        if (!node.unlockConstraint) return true;
        return node.unlockConstraint.nodes.every(nid => currentAllocated.has(nid));
      };

      for (const conn of connections) {
        const from = nodes.get(conn.from);
        const to = nodes.get(conn.to);
        if (!from || !to) continue;
        if (from.ascendancy !== to.ascendancy) continue;
        if (from.ascendancy && from.ascendancy !== activeAsc) continue;
        if (!isUnlockedInit(from) || !isUnlockedInit(to)) continue;

        if (from.ascendancy) {
          drawConn(ascConnGfx, from, to, currentAllocated, true);
        } else {
          drawConn(connGfx, from, to, currentAllocated, false);
        }
      }
      world.addChild(connGfx);

      // Ascendancy background layers
      if (activeAsc) {
        // Find the ascendancy background dimensions from tree data
        let ascBgSize = 1500;
        for (const cls of treeData!.classes) {
          for (const a of cls.ascendancies) {
            if (a.name === activeAsc && a.background) {
              ascBgSize = a.background.width;
              break;
            }
          }
        }
        const bgTreeSize = ascBgSize * 2.675;
        // Class-specific art behind the ring
        const classBgAtlas = atlases["ascendancy-background_250_250_BC7"];
        if (classBgAtlas) {
          const classArtTex = getSpriteTexture(classBgAtlas, `Classes${activeAsc}`);
          if (classArtTex) {
            const classArtSprite = new Sprite(classArtTex);
            classArtSprite.anchor.set(0.5);
            classArtSprite.scale.set((ascBgSize * 2.14) / classArtTex.width);
            classArtSprite.alpha = 0.6;
            world.addChild(classArtSprite);
          }
        }
        // BGTree ring on top
        const ascBgAtlas = atlases["ascendancy-background_1000_1000_BC7"];
        if (ascBgAtlas) {
          const bgTreeTex = getSpriteTexture(ascBgAtlas, "BGTree");
          if (bgTreeTex) {
            const bgTreeSprite = new Sprite(bgTreeTex);
            bgTreeSprite.anchor.set(0.5);
            bgTreeSprite.scale.set(bgTreeSize / bgTreeTex.width);
            bgTreeSprite.alpha = 0.8;
            world.addChild(bgTreeSprite);
          }
        }
      }

      // Ascendancy connections above backgrounds
      world.addChild(ascConnGfx);

      // Jewel radius circles (below nodes)
      const jewelRadiusGfx = new Graphics();
      jewelRadiusGfxRef.current = jewelRadiusGfx;
      world.addChild(jewelRadiusGfx);

      // Node layer
      const nodeLayer = new Container();
      nodeLayer.label = "__node_layer";

      for (const [id, node] of nodes) {
        if (node.ascendancy && node.ascendancy !== activeAsc) continue;

        const isAllocated = currentAllocated.has(node.hash);
        const curJewelData = useBuildStore.getState().jewelData;
        const ji = node.type === "jewel" ? curJewelData?.[String(node.hash)] ?? null : null;
        const nodeContainer = createNodeVisual(node, isAllocated, atlases, ji);

        nodeContainer.x = node.x;
        nodeContainer.y = node.y;
        nodeContainer.alpha = isAllocated ? 1 : 0.55;
        nodeContainer.visible = isUnlockedInit(node);
        nodeContainer.eventMode = "static";
        nodeContainer.cursor = "pointer";
        (nodeContainer as any).__allocated = isAllocated;
        (nodeContainer as any).__jewelInfo = ji ? `${ji.name}:${ji.baseName}` : "";

        const hitR = (FRAME_SIZE[node.type] ?? 26) / 2;
        nodeContainer.hitArea = {
          contains: (x: number, y: number) => x * x + y * y < hitR * hitR,
        };

        nodeContainer.on("pointerenter", (e: any) => {
          // No hover tooltip for touch input
          if (e.pointerType === "touch" || isTouchDevice()) return;
          // Check if pointer is occluded by an HTML panel above the canvas
          const ne = e.nativeEvent;
          if (ne && ne.clientX != null) {
            const topEl = document.elementFromPoint(ne.clientX, ne.clientY);
            const canvasEl = canvasRef.current?.querySelector("canvas");
            if (topEl && topEl !== canvasEl) return;
          }
          setHoveredNode(node.hash);
          if (!selectedNodeRef.current) {
            const globalPos = nodeContainer.getGlobalPosition();
            const curJewelDataHover = node.type === "jewel" ? useBuildStore.getState().jewelData?.[String(node.hash)] ?? null : null;
            setTooltip({ x: globalPos.x, y: globalPos.y, node, jewelInfo: curJewelDataHover });
          }
        });
        nodeContainer.on("pointerleave", (e: any) => {
          if (e.pointerType === "touch" || isTouchDevice()) return;
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
          setPowerListMinimized(true);
        });

        nodeLayer.addChild(nodeContainer);
        nodeGfxRef.current.set(id, nodeContainer);
      }
      world.addChild(nodeLayer);

      // Restore saved viewport or fit to screen
      const savedVp = loadViewport();
      if (savedVp) {
        world.scale.set(savedVp.scale);
        world.x = savedVp.x;
        world.y = savedVp.y;
      } else {
        world.scale.set(fitScale);
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        world.x = screenW / 2 - cx * fitScale;
        world.y = screenH / 2 - cy * fitScale;
      }
    }

    render();

    return () => { cancelled = true; };
  }, [appReady, treeData, setHoveredNode, createNodeVisual, buildAscendancy]);

  // Focus on a specific node when requested
  const focusNodeHash = useBuildStore((s) => s.focusNodeHash);
  useEffect(() => {
    if (focusNodeHash == null) return;
    const app = appRef.current;
    const world = worldRef.current;
    if (!app || !world) return;
    const node = [...nodesRef.current.values()].find(n => n.hash === focusNodeHash);
    if (!node) return;
    // Center the viewport on the node with a nice zoom level
    const targetScale = Math.max(world.scale.x, 0.3);
    world.scale.set(targetScale);
    world.x = app.screen.width / 2 - node.x * targetScale;
    world.y = app.screen.height / 2 - node.y * targetScale;
    saveViewport(world);
    // Clear the focus so it can be re-triggered
    useBuildStore.getState().focusNode(null as any);
  }, [focusNodeHash]);

  // Reset viewport when requested via store
  const viewportResetCounter = useBuildStore((s) => s.viewportResetCounter);
  useEffect(() => {
    if (viewportResetCounter === 0) return; // skip initial
    const app = appRef.current;
    const world = worldRef.current;
    const bounds = boundsRef.current;
    if (!app || !world || !bounds) return;
    const treeWidth = bounds.maxX - bounds.minX;
    const treeHeight = bounds.maxY - bounds.minY;
    const screenW = app.screen.width;
    const screenH = app.screen.height;
    const padding = 50;
    const fitScale = Math.min((screenW - padding * 2) / treeWidth, (screenH - padding * 2) / treeHeight);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    world.scale.set(fitScale);
    world.x = screenW / 2 - cx * fitScale;
    world.y = screenH / 2 - cy * fitScale;
  }, [viewportResetCounter]);

  // Calculate node impact when a node is selected (both full path and single node)
  useEffect(() => {
    if (!selectedNode || !calcClient) return;
    if (selectedNode.type === "classStart" || selectedNode.type === "mastery") return;

    let cancelled = false;
    setImpactLoading(true);
    setNodeImpact(null);
    setNodeImpactSingle(null);
    setImpactSingleMode(false);

    Promise.all([
      calcClient.calcNodeImpact(selectedNode.hash, false),
      calcClient.calcNodeImpact(selectedNode.hash, true),
    ])
      .then(([full, single]) => {
        if (!cancelled) {
          setNodeImpact(full);
          setNodeImpactSingle(single);
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

    // Check if a node's unlock constraint is satisfied
    const isUnlocked = (node: ProcessedNode) => {
      if (!node.unlockConstraint) return true;
      return node.unlockConstraint.nodes.every(nid => allocatedNodes.has(nid));
    };

    const activeAsc = useBuildStore.getState().build?.ascendancy || undefined;
    const ascConnGfx = ascConnGfxRef.current;
    connGfx.clear();
    if (ascConnGfx) ascConnGfx.clear();
    for (const conn of connections) {
      const from = nodes.get(conn.from);
      const to = nodes.get(conn.to);
      if (!from || !to) continue;
      if (from.ascendancy !== to.ascendancy) continue;
      if (from.ascendancy && from.ascendancy !== activeAsc) continue;
      // Hide connections to locked nodes
      if (!isUnlocked(from) || !isUnlocked(to)) continue;

      const isAsc = !!from.ascendancy;
      const gfx = isAsc && ascConnGfx ? ascConnGfx : connGfx;
      const isConnAllocated = allocatedNodes.has(from.hash) && allocatedNodes.has(to.hash);
      let connColor: number = isAsc ? 0xffffff : COLORS.connection;
      if (isConnAllocated) {
        const fromWs = weaponSetNodes?.[from.hash];
        const toWs = weaponSetNodes?.[to.hash];
        const ws = fromWs || toWs;
        connColor = ws === 1 ? COLORS.connectionWS1 : ws === 2 ? COLORS.connectionWS2 : COLORS.connectionAllocated;
      }
      gfx.moveTo(from.x, from.y);
      gfx.lineTo(to.x, to.y);
      gfx.stroke({
        width: isConnAllocated ? 12 : 8,
        color: connColor,
        alpha: isConnAllocated ? 0.9 : 0.7,
      });
    }

    const atlases = atlasesRef.current;
    for (const [id, container] of nodeGfxRef.current) {
      const node = nodes.get(id);
      if (!node) continue;
      if (node.ascendancy && node.ascendancy !== activeAsc) continue;
      // Hide nodes with unsatisfied unlock constraints
      container.visible = isUnlocked(node);
      const isAllocated = allocatedNodes.has(node.hash);
      const ji = node.type === "jewel" ? jewelData?.[String(node.hash)] ?? null : null;
      const prevJi = (container as any).__jewelInfo as string | undefined;
      const jiKey = ji ? `${ji.name}:${ji.baseName}` : "";
      const allocChanged = (container as any).__allocated !== isAllocated;
      const jewelChanged = node.type === "jewel" && prevJi !== jiKey;
      if (!allocChanged && !jewelChanged) continue;
      (container as any).__allocated = isAllocated;
      (container as any).__jewelInfo = jiKey;
      container.alpha = isAllocated ? 1 : 0.55;

      container.removeChildren();
      const newVisual = createNodeVisual(node, isAllocated, atlases, ji);
      while (newVisual.children.length > 0) {
        container.addChild(newVisual.children[0]!);
      }
    }

    // Draw jewel radius circles
    const jrGfx = jewelRadiusGfxRef.current;
    if (jrGfx) {
      jrGfx.clear();
      // Soft diffuse glow
      const glowRing = (cx: number, cy: number, r: number) => {
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 60, color: 0x1144aa, alpha: 0.02 });
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 40, color: 0x2266cc, alpha: 0.04 });
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 24, color: 0x3388dd, alpha: 0.07 });
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 14, color: 0x55aaff, alpha: 0.12 });
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 7, color: 0x88ccff, alpha: 0.25 });
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 3, color: 0xbbddff, alpha: 0.45 });
        jrGfx.circle(cx, cy, r);
        jrGfx.stroke({ width: 1, color: 0xddeeff, alpha: 0.6 });
      };
      for (const [, node] of nodes) {
        if (node.type !== "jewel") continue;
        const ji = jewelData?.[String(node.hash)];
        if (!ji?.radius || !allocatedNodes.has(node.hash)) continue;
        const { inner, outer } = ji.radius;

        if (ji.radiusCenters && ji.radiusCenters.length > 0) {
          for (const center of ji.radiusCenters) {
            glowRing(center.x, center.y, outer);
            if (inner > 0) glowRing(center.x, center.y, inner);
          }
        } else {
          glowRing(node.x, node.y, outer);
          if (inner > 0) glowRing(node.x, node.y, inner);
        }
      }
    }
  }, [allocatedNodes, createNodeVisual, weaponSetNodes, jewelData]);

  // Heatmap overlay — zoom-independent rings like search highlights
  const heatmapGfxRef = useRef<Graphics | null>(null);
  const heatmapNodesRef = useRef<{ x: number; y: number; r: number; color: number; intensity: number }[]>([]);

  // Precompute heatmap node data when heatmapData changes
  useEffect(() => {
    heatmapNodesRef.current = [];

    if (!heatmapData || Object.keys(heatmapData.nodes).length === 0) return;
    const { nodes: powerNodes, max } = heatmapData;
    if (max.off <= 0 && max.def <= 0) return;

    const entries: typeof heatmapNodesRef.current = [];
    for (const [id, container] of nodeGfxRef.current) {
      const node = nodesRef.current.get(id);
      if (!node) continue;
      if (allocatedNodes.has(node.hash)) continue;
      if (!container.visible) continue;
      if (node.type === "classStart" || node.type === "mastery") continue;

      const power = powerNodes[String(node.hash)];
      if (!power) continue;

      const off = Math.max(power.off, 0);
      const def = Math.max(power.def, 0);
      if (off === 0 && def === 0) continue;

      const dpsCol = max.off > 0 ? Math.min(Math.sqrt(off / max.off * 1.5), 1) : 0;
      const defCol = max.def > 0 ? Math.min(Math.sqrt(def / max.def * 1.5), 1) : 0;
      const mixCol = (Math.max(dpsCol - 0.5, 0) + Math.max(defCol - 0.5, 0)) / 2;

      const r = Math.round(dpsCol * 255);
      const g = Math.round(mixCol * 255);
      const b = Math.round(defCol * 255);

      entries.push({
        x: node.x,
        y: node.y,
        r: (FRAME_SIZE[node.type] ?? 26) / 2 + 12,
        color: (r << 16) | (g << 8) | b,
        intensity: Math.max(dpsCol, defCol),
      });
    }
    heatmapNodesRef.current = entries;
  }, [heatmapData, allocatedNodes]);

  const redrawHeatmap = useCallback(() => {
    const gfx = heatmapGfxRef.current;
    const world = worldRef.current;
    if (!gfx || !world) return;
    gfx.clear();
    const entries = heatmapNodesRef.current;
    if (entries.length === 0) return;
    const scale = world.scale.x || 1;
    const strokeWidth = 3 / scale;
    for (const m of entries) {
      gfx.circle(m.x, m.y, m.r);
      gfx.stroke({ color: m.color, width: strokeWidth, alpha: 0.7 + m.intensity * 0.3 });
    }
  }, []);
  const redrawHeatmapRef = useRef(redrawHeatmap);
  redrawHeatmapRef.current = redrawHeatmap;

  // Create/destroy heatmap layer and trigger initial draw
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    // Remove previous heatmap layer
    if (heatmapGfxRef.current) {
      heatmapGfxRef.current.clear();
      heatmapGfxRef.current.removeFromParent();
      heatmapGfxRef.current = null;
    }

    if (heatmapNodesRef.current.length === 0) return;

    const gfx = new Graphics();
    gfx.label = "__heatmap_layer";
    world.addChild(gfx);
    heatmapGfxRef.current = gfx;
    redrawHeatmapRef.current();
  }, [heatmapData, allocatedNodes]);

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

    const activeAscSearch = useBuildStore.getState().build?.ascendancy || undefined;
    for (const [, node] of nodesRef.current) {
      if (node.ascendancy && node.ascendancy !== activeAscSearch) continue;
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

  // Draw path highlight when a node is selected and impact is computed
  const activeImpact = impactSingleMode ? nodeImpactSingle : nodeImpact;
  useEffect(() => {
    const world = worldRef.current;
    if (!world) return;

    // Ensure graphics layer exists
    if (!pathHighlightGfxRef.current) {
      const gfx = new Graphics();
      gfx.label = "__path_highlight";
      world.addChild(gfx);
      pathHighlightGfxRef.current = gfx;
    }

    const gfx = pathHighlightGfxRef.current;
    gfx.clear();

    if (!selectedNode || !activeImpact || !activeImpact.pathNodes?.length) return;

    const pathSet = new Set(activeImpact.pathNodes);
    const nodes = nodesRef.current;
    const connections = connectionsDataRef.current;
    const isAlloc = allocatedNodes.has(selectedNode.hash);
    // Red for removal, green-blue for addition
    const highlightColor = isAlloc ? 0xff4444 : 0x44bbff;

    // Highlight connections between path nodes
    for (const conn of connections) {
      const from = nodes.get(conn.from);
      const to = nodes.get(conn.to);
      if (!from || !to) continue;
      if (!pathSet.has(from.hash) || !pathSet.has(to.hash)) continue;
      gfx.moveTo(from.x, from.y);
      gfx.lineTo(to.x, to.y);
      gfx.stroke({ width: 16, color: highlightColor, alpha: 0.5 });
    }

    // Highlight node outlines
    for (const [, node] of nodes) {
      if (!pathSet.has(node.hash)) continue;
      const r = (FRAME_SIZE[node.type] ?? 26) / 2 + 4;
      gfx.circle(node.x, node.y, r);
      gfx.stroke({ width: 3, color: highlightColor, alpha: 0.8 });
    }

    return () => { gfx.clear(); };
  }, [selectedNode, activeImpact, allocatedNodes]);

  const [allocating, setAllocating] = useState(false);

  const handleAllocate = useCallback(async () => {
    if (!selectedNode || !calcClient || allocating) return;
    setAllocating(true);
    try {
      const result = await calcClient.allocNode(selectedNode.hash);
      if (result.success) {
        setAllocatedNodes(result.allocatedNodes);
        if (result.display) setCalcDisplay(result.display);
        calcClient.getDisplayStats().then(setDisplayStats).catch(() => {});
        calcClient.getSkills().then(setSkillsData).catch(() => {});
        calcClient.exportBuild().then((xml) => { if (xml) setImportCode(encodeBuildCode(xml)); }).catch(() => {});
      }
    } catch (e) {
      console.error("[PoB] allocNode failed:", e);
    } finally {
      setAllocating(false);
      selectedNodeRef.current = null;
      setSelectedNode(null);
      setNodeImpact(null);
    }
  }, [selectedNode, calcClient, allocating, setAllocatedNodes, setCalcDisplay, setDisplayStats, setSkillsData, setImportCode]);

  const handleDeallocate = useCallback(async () => {
    if (!selectedNode || !calcClient || allocating) return;
    setAllocating(true);
    try {
      const result = await calcClient.deallocNode(selectedNode.hash);
      if (result.success) {
        setAllocatedNodes(result.allocatedNodes);
        if (result.display) setCalcDisplay(result.display);
        calcClient.getDisplayStats().then(setDisplayStats).catch(() => {});
        calcClient.getSkills().then(setSkillsData).catch(() => {});
        calcClient.exportBuild().then((xml) => { if (xml) setImportCode(encodeBuildCode(xml)); }).catch(() => {});
      }
    } catch (e) {
      console.error("[PoB] deallocNode failed:", e);
    } finally {
      setAllocating(false);
      selectedNodeRef.current = null;
      setSelectedNode(null);
      setNodeImpact(null);
    }
  }, [selectedNode, calcClient, allocating, setAllocatedNodes, setCalcDisplay, setDisplayStats, setSkillsData, setImportCode]);

  return (
    <div className="relative h-full w-full">
      <div ref={canvasRef} className="h-full w-full touch-none" />

      {/* Tooltip (only when no detail panel) */}
      {tooltip && !selectedNode && (
        tooltip.jewelInfo ? (
          /* Jewel tooltip — full item-style detail, fixed to escape any clipping */
          <div
            className="pointer-events-none fixed z-[9999] max-h-[80vh] w-[260px] overflow-y-auto rounded border border-poe-border shadow-2xl"
            style={{
              left: Math.min(tooltip.x + 16, window.innerWidth - 270),
              top: Math.max(8, Math.min(tooltip.y - 10, window.innerHeight - 300)),
              background: "#0d1014f8",
            }}
          >
            <JewelDetailBody jewel={tooltip.jewelInfo} />
          </div>
        ) : (
          /* Normal node tooltip */
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
        )
      )}

      {/* Power report list */}
      {heatmapData?.topNodes && heatmapData.topNodes.length > 0 && (
        powerListMinimized ? (
          <button
            className="absolute bottom-3 right-3 z-40 rounded border border-poe-border bg-poe-panel/90 px-3 py-1.5 text-xs text-poe-accent shadow-lg backdrop-blur-sm"
            onClick={() => setPowerListMinimized(false)}
          >
            Top Nodes ({heatmapData.topNodes.length})
          </button>
        ) : (
          <div
            className="absolute bottom-3 right-3 z-40 max-h-[50vh] w-56 overflow-y-auto rounded border border-poe-border bg-poe-panel/95 shadow-lg backdrop-blur-sm sm:w-64 sm:max-h-[60vh]"
          >
            <button
              className="sticky top-0 z-10 flex w-full items-center justify-between border-b border-poe-border bg-poe-panel px-2 py-1.5 sm:px-3 sm:py-2"
              onClick={() => setPowerListMinimized(true)}
            >
              <span className="text-[11px] font-bold text-poe-accent sm:text-xs">Top Nodes</span>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-gray-500">
                <path d="M2 4L5 7L8 4" />
              </svg>
            </button>
            <div className="divide-y divide-poe-border/30">
              {heatmapData.topNodes.map((entry, i) => {
                const off = Math.max(entry.off, 0);
                const def = Math.max(entry.def, 0);
                const total = off + def;
                const perPoint = total / Math.max(entry.pathDist, 1);
                const offRatio = total > 0 ? off / total : 0;
                const colorClass = offRatio > 0.7 ? "text-red-400" : offRatio < 0.3 ? "text-blue-400" : "text-yellow-400";
                const typeLabel = entry.type === "Notable" ? "N" : entry.type === "Keystone" ? "K" : "";
                return (
                  <button
                    key={entry.hash}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[11px] hover:bg-white/5 active:bg-white/10 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs"
                    onClick={() => {
                      useBuildStore.getState().focusNode(entry.hash);
                      setPowerListMinimized(true);
                    }}
                  >
                    <span className="w-3 shrink-0 text-center text-[9px] text-gray-600 sm:w-4 sm:text-[10px]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-200">
                      {typeLabel ? <span className="mr-1 text-yellow-500">{typeLabel}</span> : null}
                      {entry.name}
                      {entry.count > 1 && <span className="ml-1 text-[9px] text-gray-500 sm:text-[10px]">x{entry.count}</span>}
                    </span>
                    <span className={`shrink-0 font-mono ${colorClass}`}>
                      {perPoint >= 0.01 ? perPoint.toFixed(2) : "<.01"}
                    </span>
                    <span className="shrink-0 text-[9px] text-gray-600 sm:text-[10px]">{entry.pathDist}pt</span>
                  </button>
                );
              })}
            </div>
          </div>
        )
      )}

      {/* Node detail panel */}
      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          isAllocated={allocatedNodes.has(selectedNode.hash)}
          impact={impactSingleMode ? nodeImpactSingle : nodeImpact}
          impactFull={nodeImpact}
          impactLoading={impactLoading}
          singleMode={impactSingleMode}
          onToggleMode={() => setImpactSingleMode((v) => !v)}
          allocating={allocating}
          jewelInfo={selectedNode.type === "jewel" ? jewelData?.[String(selectedNode.hash)] ?? null : null}
          onAllocate={handleAllocate}
          onDeallocate={handleDeallocate}
          onClose={() => { selectedNodeRef.current = null; setSelectedNode(null); setNodeImpact(null); setNodeImpactSingle(null); }}
        />
      )}
    </div>
  );
}

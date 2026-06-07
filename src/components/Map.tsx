import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  loadRouteConfig,
  getRoutePosition,
  splitRoutePath,
  type RouteConfig,
} from "../lib/mapPosition";
import type { Group, GroupMember } from "../lib/supabase";

interface MapProps {
  members: GroupMember[];
  currentUserId: string;
  userGroups: Group[];
  activeGroupId: string | null;
  onActiveGroupChange: (groupId: string | null) => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const MAX_ZOOM_FACTOR = 4;

const WALKED_COLOR = "rgba(60, 190, 90, 0.80)";
const REMAINING_COLOR = "rgba(210, 55, 55, 0.65)";

export default function Map({
  members,
  currentUserId,
  userGroups,
  activeGroupId,
  onActiveGroupChange,
}: MapProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  // Canvas renders the map image AND the route path — everything is rasterized
  // at viewport resolution every frame, so GPU texture memory is constant and
  // bounded regardless of zoom. No large scaled compositor layer exists, so the
  // compositor never evicts the header/dropdown textures (the source of flicker).
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Hidden <img> is the decode source for drawImage; never composited.
  const imageRef = useRef<HTMLImageElement>(null);
  // Markers live in a viewport-sized, NON-scaled container and are positioned
  // individually in screen pixels — each is a tiny fixed-size layer.
  const markersRef = useRef<HTMLDivElement>(null);

  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [routeConfig, setRouteConfig] = useState<RouteConfig>(loadRouteConfig);

  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const draggingRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const fitScaleRef = useRef(1);
  const coverScaleRef = useRef(1);
  const activePointers = useRef(new Set<number>());
  const hasCenteredRef = useRef(false);

  const membersRef = useRef(members);
  membersRef.current = members;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const routeConfigRef = useRef(routeConfig);
  routeConfigRef.current = routeConfig;

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "route-config") setRouteConfig(loadRouteConfig());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  // Draw the visible slice of the map + the route path onto the canvas at
  // viewport resolution. Path strokes use the current transform so they stay
  // pinned to map features while remaining crisp at any zoom.
  const drawMap = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const t = transformRef.current;
    const dpr = window.devicePixelRatio || 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      img,
      t.x * dpr,
      t.y * dpr,
      img.naturalWidth * t.scale * dpr,
      img.naturalHeight * t.scale * dpr,
    );

    // Route path — Path2D is built in image-pixel coords; the ctx transform maps
    // image space → device space, so we draw the same coords the SVG used.
    const member = membersRef.current.find((m) => m.id === currentUserIdRef.current);
    const steps = member?.group_steps ?? 0;
    const { walked, remaining } = splitRoutePath(
      steps,
      routeConfigRef.current,
      img.naturalWidth,
      img.naturalHeight,
    );

    ctx.setTransform(t.scale * dpr, 0, 0, t.scale * dpr, t.x * dpr, t.y * dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // lineWidth/dash are in image units; multiplying by 1/scale keeps the on-screen
    // stroke a constant ~3 CSS px at any zoom.
    const sw = 3 / t.scale;

    if (remaining) {
      ctx.setLineDash([sw * 4, sw * 2.5]);
      ctx.lineWidth = sw;
      ctx.strokeStyle = REMAINING_COLOR;
      ctx.stroke(new Path2D(remaining));
    }
    if (walked) {
      ctx.setLineDash([]);
      ctx.lineWidth = sw;
      ctx.strokeStyle = WALKED_COLOR;
      ctx.stroke(new Path2D(walked));
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  // Position each marker in screen pixels. The container is never scaled, so the
  // marker chips stay a fixed visual size with no counter-scaling needed.
  const repositionMarkers = useCallback(() => {
    const container = markersRef.current;
    if (!container) return;
    const t = transformRef.current;
    for (const child of Array.from(container.children) as HTMLElement[]) {
      const ix = Number(child.dataset.ix);
      const iy = Number(child.dataset.iy);
      if (Number.isNaN(ix) || Number.isNaN(iy)) continue;
      child.style.left = `${t.x + ix * t.scale}px`;
      child.style.top = `${t.y + iy * t.scale}px`;
    }
  }, []);

  const applyTransform = useCallback(
    (t: Transform) => {
      transformRef.current = t;
      drawMap();
      repositionMarkers();
    },
    [drawMap, repositionMarkers],
  );

  // Redraw path and reposition markers when data/route/size changes (transform unchanged).
  useLayoutEffect(() => {
    if (imageSize.width === 0) return;
    drawMap();
    repositionMarkers();
  }, [members, routeConfig, imageSize, currentUserId, drawMap, repositionMarkers]);

  const getScaleLimits = useCallback(() => {
    return { min: fitScaleRef.current, max: coverScaleRef.current * MAX_ZOOM_FACTOR };
  }, []);

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!viewport || !canvas || !img || !img.naturalWidth) return;

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    // Canvas is sized to the viewport in physical pixels — never to the image.
    // This is what keeps GPU memory constant across all zoom levels.
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`;
    canvas.style.height = `${vh}px`;

    const containScale = Math.min(vw / img.naturalWidth, vh / img.naturalHeight);
    const coverScale = Math.max(vw / img.naturalWidth, vh / img.naturalHeight);

    fitScaleRef.current = containScale;
    coverScaleRef.current = coverScale;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });

    const currentMember = membersRef.current.find((m) => m.id === currentUserIdRef.current);
    let x: number;
    let y: number;

    if (currentMember) {
      hasCenteredRef.current = true;
      const pos = getRoutePosition(currentMember.group_steps ?? 0, routeConfigRef.current);
      x = vw / 2 - (pos.x / 100) * img.naturalWidth * coverScale;
      y = vh / 2 - (pos.y / 100) * img.naturalHeight * coverScale;
    } else {
      x = (vw - img.naturalWidth * coverScale) / 2;
      y = (vh - img.naturalHeight * coverScale) / 2;
    }

    applyTransform({ x, y, scale: coverScale });
  }, [applyTransform]);

  useEffect(() => {
    if (hasCenteredRef.current || imageSize.width === 0) return;
    const currentMember = members.find((m) => m.id === currentUserId);
    if (!currentMember) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    hasCenteredRef.current = true;
    const t = transformRef.current;
    const pos = getRoutePosition(currentMember.group_steps ?? 0, routeConfig);
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    applyTransform({
      ...t,
      x: vw / 2 - (pos.x / 100) * imageSize.width * t.scale,
      y: vh / 2 - (pos.y / 100) * imageSize.height * t.scale,
    });
  }, [members, currentUserId, imageSize, routeConfig, applyTransform]);

  useEffect(() => {
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, [fitToViewport]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType !== "touch") return;
    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    activePointers.current.add(e.pointerId);

    if (activePointers.current.size === 1) {
      const t = transformRef.current;
      draggingRef.current = true;
      viewportRef.current?.classList.add("dragging");
      dragStart.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    } else {
      draggingRef.current = false;
      viewportRef.current?.classList.remove("dragging");
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || activePointers.current.size > 1) return;
    e.preventDefault();
    const t = transformRef.current;
    applyTransform({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size === 0) {
      draggingRef.current = false;
      viewportRef.current?.classList.remove("dragging");
    }
    viewportRef.current?.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.002);

    const t = transformRef.current;
    const { min, max } = getScaleLimits();
    const nextScale = Math.min(max, Math.max(min, t.scale * factor));
    const ratio = nextScale / t.scale;
    applyTransform({
      scale: nextScale,
      x: mx - (mx - t.x) * ratio,
      y: my - (my - t.y) * ratio,
    });
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStart.current = { distance, scale: transformRef.current.scale };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchStart.current) return;
    e.preventDefault();

    const [a, b] = [e.touches[0], e.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = distance / pinchStart.current.distance;
    const { min, max } = getScaleLimits();
    const nextScale = Math.min(max, Math.max(min, pinchStart.current.scale * ratio));

    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const mx = (a.clientX + b.clientX) / 2 - rect.left;
    const my = (a.clientY + b.clientY) / 2 - rect.top;

    const t = transformRef.current;
    const scaleRatio = nextScale / t.scale;
    applyTransform({
      scale: nextScale,
      x: mx - (mx - t.x) * scaleRatio,
      y: my - (my - t.y) * scaleRatio,
    });
  };

  const onTouchEnd = () => {
    pinchStart.current = null;
  };

  return (
    <div
      ref={viewportRef}
      className="map-viewport"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Map + path: viewport-sized canvas. GPU memory = viewport × DPR, constant. */}
      <canvas ref={canvasRef} className="map-canvas" />

      {/* Hidden decode source for drawImage; never composited. */}
      <img
        ref={imageRef}
        src="/map.jpg"
        alt=""
        style={{ display: "none" }}
        onLoad={fitToViewport}
      />

      {/* Markers: viewport-sized, NON-scaled container. Each chip is positioned in
          screen pixels via repositionMarkers() and stays a fixed visual size. */}
      {imageSize.width > 0 && (
        <div ref={markersRef} className="map-markers">
          {members.map((member) => {
            const pos = getRoutePosition(member.group_steps, routeConfig);
            return (
              <div
                key={member.id}
                className="map-marker"
                data-ix={(pos.x / 100) * imageSize.width}
                data-iy={(pos.y / 100) * imageSize.height}
              >
                <span className={`marker-dot${member.id === currentUserId ? " self" : ""}`} />
                <span className="marker-label">
                  {member.display_name || t("map.traveler")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {userGroups.length > 1 && (
        <div className="map-group-selector" onPointerDown={(e) => e.stopPropagation()}>
          <select
            value={activeGroupId ?? ""}
            onChange={(e) => onActiveGroupChange(e.target.value || null)}
          >
            {userGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {members.length === 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            color: "#fff",
            fontSize: "0.875rem",
            padding: "16px",
            textAlign: "center",
          }}
        >
          {userGroups.length === 0
            ? t("map.joinGroupPrompt")
            : t("map.noTravelers")}
        </div>
      )}
    </div>
  );
}

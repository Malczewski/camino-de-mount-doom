import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

export default function Map({
  members,
  currentUserId,
  userGroups,
  activeGroupId,
  onActiveGroupChange,
}: MapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // Canvas renders only the visible slice of the map image — constant viewport-sized
  // GPU memory regardless of zoom, eliminating the tile-memory-exceeded black squares.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Hidden <img> is the decode source for drawImage; never in the compositor layer.
  const imageRef = useRef<HTMLImageElement>(null);
  // Lightweight overlay (SVG path + markers only, no large bitmap).
  const overlayRef = useRef<HTMLDivElement>(null);
  const walkedPathRef = useRef<SVGPathElement>(null);
  const remainingPathRef = useRef<SVGPathElement>(null);

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

  const drawMap = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !img.naturalWidth) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t = transformRef.current;
    const dpr = window.devicePixelRatio || 1;
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
  }, []);

  const applyTransform = useCallback((t: Transform) => {
    transformRef.current = t;
    const viewport = viewportRef.current;
    const overlay = overlayRef.current;
    if (!viewport) return;

    drawMap();

    if (overlay) {
      overlay.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    }
    viewport.style.setProperty("--map-scale", String(t.scale));

    const sw = 3 / t.scale;
    const walked = walkedPathRef.current;
    const remaining = remainingPathRef.current;
    if (walked) walked.style.strokeWidth = String(sw);
    if (remaining) {
      remaining.style.strokeWidth = String(sw);
      remaining.style.strokeDasharray = `${sw * 4} ${sw * 2.5}`;
    }
  }, [drawMap]);

  // After imageSize is set the overlay and SVG paths are mounted for the first time.
  // Apply the current transform and stroke widths so the first paint is correct.
  useLayoutEffect(() => {
    if (imageSize.width === 0) return;
    const t = transformRef.current;
    const overlay = overlayRef.current;
    if (overlay) overlay.style.transform = `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
    const sw = 3 / t.scale;
    const walked = walkedPathRef.current;
    const remaining = remainingPathRef.current;
    if (walked) walked.style.strokeWidth = String(sw);
    if (remaining) {
      remaining.style.strokeWidth = String(sw);
      remaining.style.strokeDasharray = `${sw * 4} ${sw * 2.5}`;
    }
  }, [imageSize]);

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

    // Size canvas to the viewport in physical pixels for crisp rendering.
    // This never changes regardless of zoom — the key to no GPU memory overflow.
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

  // ─── Path rendering ───────────────────────────────────────────────────────
  const currentMember = members.find((m) => m.id === currentUserId);
  const currentSteps = currentMember?.group_steps ?? 0;

  const { walked: walkedPath, remaining: remainingPath } =
    imageSize.width > 0
      ? splitRoutePath(currentSteps, routeConfig, imageSize.width, imageSize.height)
      : { walked: "", remaining: "" };

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
      {/* Canvas: always viewport-sized, draws the visible slice of the image.
          GPU memory = viewport × DPR, not image × zoom × DPR. */}
      <canvas ref={canvasRef} className="map-canvas" />

      {/* Hidden image is the decode source for drawImage; never composited. */}
      <img
        ref={imageRef}
        src="/map.jpg"
        alt=""
        style={{ display: "none" }}
        onLoad={fitToViewport}
      />

      {/* Lightweight overlay: only SVG strokes + marker dots — no large bitmap.
          Separate compositor layer means no quality re-rasterization of image pixels. */}
      {imageSize.width > 0 && (
        <div
          ref={overlayRef}
          className="map-overlay"
          style={{ width: imageSize.width, height: imageSize.height }}
        >
          <svg
            className="map-path-svg"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            style={{
              position: "absolute",
              inset: 0,
              width: imageSize.width,
              height: imageSize.height,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            <path ref={walkedPathRef} fill="none" d={walkedPath || "M 0 0"} className="path-walked" />
            <path ref={remainingPathRef} fill="none" d={remainingPath || "M 0 0"} className="path-remaining" />
          </svg>

          {members.map((member) => {
            const pos = getRoutePosition(member.group_steps, routeConfig);
            return (
              <div
                key={member.id}
                className="map-marker"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                <span className={`marker-dot${member.id === currentUserId ? " self" : ""}`} />
                <span className="marker-label">
                  {member.display_name || "Traveler"}
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
            ? "Join a group to see fellow travelers on the map"
            : "No travelers in this fellowship yet"}
        </div>
      )}
    </div>
  );
}

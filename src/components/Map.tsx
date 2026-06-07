import { useCallback, useEffect, useRef, useState } from "react";
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
  const imageRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const fitScaleRef = useRef(1);
  const [routeConfig, setRouteConfig] = useState<RouteConfig>(loadRouteConfig);

  // Reload route config when editor updates it in another tab
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === "route-config") setRouteConfig(loadRouteConfig());
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  const getScaleLimits = useCallback(() => {
    const fit = fitScaleRef.current;
    return { min: fit, max: fit * MAX_ZOOM_FACTOR };
  }, []);

  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image || !image.naturalWidth) return;

    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const scale = Math.min(vw / image.naturalWidth, vh / image.naturalHeight);
    const x = (vw - image.naturalWidth * scale) / 2;
    const y = (vh - image.naturalHeight * scale) / 2;

    fitScaleRef.current = scale;
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    setTransform({ x, y, scale });
  }, []);

  useEffect(() => {
    fitToViewport();
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, [fitToViewport]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType !== "touch") return;
    e.preventDefault();
    viewportRef.current?.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    setTransform((t) => {
      dragStart.current = {
        x: e.clientX,
        y: e.clientY,
        tx: t.x,
        ty: t.y,
      };
      return t;
    });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();
    setTransform((t) => ({
      ...t,
      x: dragStart.current.tx + (e.clientX - dragStart.current.x),
      y: dragStart.current.ty + (e.clientY - dragStart.current.y),
    }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    setDragging(false);
    viewportRef.current?.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    // Normalize wheel deltas (pixels, lines, pages) and trackpad pinch (ctrl+wheel).
    const unit =
      e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.002);

    setTransform((t) => {
      const { min, max } = getScaleLimits();
      const nextScale = Math.min(max, Math.max(min, t.scale * factor));
      const ratio = nextScale / t.scale;
      return {
        scale: nextScale,
        x: mx - (mx - t.x) * ratio,
        y: my - (my - t.y) * ratio,
      };
    });
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchStart.current = { distance, scale: transform.scale };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchStart.current) return;
    e.preventDefault();

    const [a, b] = [e.touches[0], e.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const ratio = distance / pinchStart.current.distance;
    const { min, max } = getScaleLimits();
    const nextScale = Math.min(
      max,
      Math.max(min, pinchStart.current.scale * ratio),
    );

    const viewport = viewportRef.current;
    if (!viewport) return;

    const rect = viewport.getBoundingClientRect();
    const mx = (a.clientX + b.clientX) / 2 - rect.left;
    const my = (a.clientY + b.clientY) / 2 - rect.top;

    setTransform((t) => {
      const scaleRatio = nextScale / t.scale;
      return {
        scale: nextScale,
        x: mx - (mx - t.x) * scaleRatio,
        y: my - (my - t.y) * scaleRatio,
      };
    });
  };

  const onTouchEnd = () => {
    pinchStart.current = null;
  };

  const stageStyle = {
    transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
  };

  // ─── Path rendering ───────────────────────────────────────────────────────
  const currentMember = members.find((m) => m.id === currentUserId);
  const currentSteps = currentMember?.group_steps ?? 0;

  const { walked: walkedPath, remaining: remainingPath } =
    imageSize.width > 0
      ? splitRoutePath(currentSteps, routeConfig, imageSize.width, imageSize.height)
      : { walked: "", remaining: "" };

  // Keep stroke visually constant regardless of zoom — divide by scale
  const sw = 3 / transform.scale;
  const dashArray = `${sw * 4} ${sw * 2.5}`;

  return (
    <div
      ref={viewportRef}
      className={`map-viewport${dragging ? " dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <div className="map-stage" style={stageStyle}>
        <img
          ref={imageRef}
          src="/map.jpg"
          alt="Middle-earth map"
          className="map-image"
          draggable={false}
          onDragStart={(e) => e.preventDefault()}
          onLoad={fitToViewport}
        />
        {imageSize.width > 0 && (
          <div
            className="map-markers"
            style={{ width: imageSize.width, height: imageSize.height }}
          >
            {/* Route path */}
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
                // Isolate path repaints onto their own GPU layer so updating the
                // route never forces the large image layer to re-rasterize (which
                // briefly paints black tiles).
                transform: "translateZ(0)",
                backfaceVisibility: "hidden",
              }}
            >
              <path fill="none" d={walkedPath || "M 0 0"} className="path-walked" style={{ strokeWidth: sw }} />
              <path fill="none" d={remainingPath || "M 0 0"} className="path-remaining" style={{ strokeWidth: sw, strokeDasharray: dashArray }} />
            </svg>

            {/* Member markers */}
            {members.map((member) => {
              const pos = getRoutePosition(member.group_steps, routeConfig);
              return (
                <div
                  key={member.id}
                  className="map-marker"
                  style={{
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
                    // Counter-scale so dot + label stay visually constant regardless of zoom
                    transform: `translate(-50%, -50%) scale(${1 / transform.scale})`,
                  }}
                >
                  <span
                    className={`marker-dot${member.id === currentUserId ? " self" : ""}`}
                  />
                  <span className="marker-label">
                    {member.display_name || "Traveler"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Group selector — only shown when user is in more than one group */}
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

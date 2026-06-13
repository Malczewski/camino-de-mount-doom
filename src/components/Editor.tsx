import { useCallback, useEffect, useRef, useState } from "react";
import mapImageUrl from "../assets/map.jpg";
import {
  DEFAULT_ROUTE_CONFIG,
  getFractionalIndex,
  getRouteCheckpoints,
  getRoutePosition,
  getTotalRouteSteps,
  routePointsToSvgPath,
  splitRoutePath,
  type RouteConfig,
  type RoutePoint,
} from "../lib/mapPosition";

interface Transform {
  x: number;
  y: number;
  scale: number;
}

type ContextMenu =
  | { kind: "point"; screenX: number; screenY: number; pointIdx: number }
  | { kind: "line"; screenX: number; screenY: number; insertAfter: number; x: number; y: number };

const MAX_ZOOM_FACTOR = 5;

function loadSavedConfig(): RoutePoint[] {
  try {
    const raw = localStorage.getItem("route-config");
    if (raw) {
      const parsed = JSON.parse(raw) as RouteConfig;
      if (Array.isArray(parsed?.points) && parsed.points.length > 0) return parsed.points;
    }
  } catch {
    // ignore
  }
  return DEFAULT_ROUTE_CONFIG.points;
}

function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function nearestSegmentIndex(x: number, y: number, pts: RoutePoint[]): number {
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

export default function Editor() {
  // ─── Route state ─────────────────────────────────────────────────────────
  const [points, setPoints] = useState<RoutePoint[]>(loadSavedConfig);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [previewSteps, setPreviewSteps] = useState(0);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState("");
  const [draggingPointIdx, setDraggingPointIdx] = useState<number | null>(null);
  const pointDragStart = useRef({ clientX: 0, clientY: 0, px: 0, py: 0 });
  const pointHasDraggedRef = useRef(false);

  // ─── Context menu ─────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof MouseEvent && contextMenuRef.current?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [contextMenu]);

  // ─── Map viewport state ───────────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [mapDragging, setMapDragging] = useState(false);
  const mapDragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const pinchStart = useRef<{ distance: number; scale: number } | null>(null);
  const fitScaleRef = useRef(1);
  const hasDraggedRef = useRef(false);

  const transformRef = useRef(transform);
  useEffect(() => { transformRef.current = transform; }, [transform]);
  const imageSizeRef = useRef(imageSize);
  useEffect(() => { imageSizeRef.current = imageSize; }, [imageSize]);

  // ─── Sync JSON ────────────────────────────────────────────────────────────
  useEffect(() => {
    const config: RouteConfig = { points };
    const json = JSON.stringify(config, null, 2);
    setJsonText(json);
    localStorage.setItem("route-config", json);
  }, [points]);

  // ─── Map pan/zoom ─────────────────────────────────────────────────────────
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

  // ─── Map pointer handlers ─────────────────────────────────────────────────
  // Note: point markers call e.stopPropagation() on pointerdown, so onMapPointerDown
  // never fires during point interactions. The mapDragging guard in onMapPointerUp
  // prevents the bubbled pointerup from point interactions from doing anything.
  const onMapPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType !== "touch") return;
    viewportRef.current?.setPointerCapture(e.pointerId);
    setMapDragging(true);
    hasDraggedRef.current = false;
    mapDragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
  };

  const onMapPointerMove = (e: React.PointerEvent) => {
    if (!mapDragging) return;
    const dx = e.clientX - mapDragStart.current.x;
    const dy = e.clientY - mapDragStart.current.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) hasDraggedRef.current = true;
    if (hasDraggedRef.current) {
      setTransform((t) => ({ ...t, x: mapDragStart.current.tx + dx, y: mapDragStart.current.ty + dy }));
    }
  };

  const onMapPointerUp = (e: React.PointerEvent) => {
    // Guard: if map drag was never started, this is a bubbled event from a point
    // interaction — ignore it entirely to avoid corrupting selectedIdx.
    if (!mapDragging) return;
    viewportRef.current?.releasePointerCapture(e.pointerId);
    const wasDrag = hasDraggedRef.current;
    setMapDragging(false);
    if (!wasDrag) setSelectedIdx(null); // plain click on map background = deselect
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? viewport.clientHeight : 1;
    const factor = Math.exp(-e.deltaY * unit * 0.002);
    setTransform((t) => {
      const { min, max } = getScaleLimits();
      const nextScale = Math.min(max, Math.max(min, t.scale * factor));
      const ratio = nextScale / t.scale;
      return { scale: nextScale, x: mx - (mx - t.x) * ratio, y: my - (my - t.y) * ratio };
    });
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      pinchStart.current = {
        distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        scale: transform.scale,
      };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchStart.current) return;
    e.preventDefault();
    const [a, b] = [e.touches[0], e.touches[1]];
    const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const { min, max } = getScaleLimits();
    const nextScale = Math.min(max, Math.max(min, pinchStart.current.scale * (distance / pinchStart.current.distance)));
    const viewport = viewportRef.current;
    if (!viewport) return;
    const rect = viewport.getBoundingClientRect();
    const mx = (a.clientX + b.clientX) / 2 - rect.left;
    const my = (a.clientY + b.clientY) / 2 - rect.top;
    setTransform((t) => {
      const r = nextScale / t.scale;
      return { scale: nextScale, x: mx - (mx - t.x) * r, y: my - (my - t.y) * r };
    });
  };

  const onTouchEnd = () => { pinchStart.current = null; };

  // ─── Point drag handlers ──────────────────────────────────────────────────
  const onPointPointerDown = (e: React.PointerEvent, idx: number) => {
    if (e.button !== 0) return;
    e.stopPropagation(); // prevent map from starting a pan
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingPointIdx(idx);
    pointHasDraggedRef.current = false;
    pointDragStart.current = { clientX: e.clientX, clientY: e.clientY, px: points[idx].x, py: points[idx].y };
  };

  const onPointPointerMove = (e: React.PointerEvent, idx: number) => {
    if (draggingPointIdx !== idx) return;
    const rawDx = e.clientX - pointDragStart.current.clientX;
    const rawDy = e.clientY - pointDragStart.current.clientY;
    if (!pointHasDraggedRef.current && Math.hypot(rawDx, rawDy) < 6) return;
    pointHasDraggedRef.current = true;
    const t = transformRef.current;
    const sz = imageSizeRef.current;
    const newX = +Math.max(0, Math.min(100, pointDragStart.current.px + (rawDx / t.scale / sz.width) * 100)).toFixed(2);
    const newY = +Math.max(0, Math.min(100, pointDragStart.current.py + (rawDy / t.scale / sz.height) * 100)).toFixed(2);
    setPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, x: newX, y: newY } : p)));
  };

  const onPointPointerUp = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation(); // prevent bubbled pointerup from reaching map handlers
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!pointHasDraggedRef.current) setSelectedIdx(idx);
    setDraggingPointIdx(null);
  };

  // ─── Path right-click → add point ────────────────────────────────────────
  const onPathContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (points.length < 2) return;
    const rect = viewportRef.current!.getBoundingClientRect();
    const t = transformRef.current;
    const sz = imageSizeRef.current;
    const imgX = (e.clientX - rect.left - t.x) / t.scale;
    const imgY = (e.clientY - rect.top - t.y) / t.scale;
    const x = +Math.max(0, Math.min(100, (imgX / sz.width) * 100)).toFixed(2);
    const y = +Math.max(0, Math.min(100, (imgY / sz.height) * 100)).toFixed(2);
    setContextMenu({
      kind: "line",
      screenX: e.clientX,
      screenY: e.clientY,
      insertAfter: nearestSegmentIndex(x, y, points),
      x,
      y,
    });
  };

  // ─── Point editing ────────────────────────────────────────────────────────
  const updatePoint = (idx: number, patch: Partial<RoutePoint>) => {
    setPoints((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const deletePoint = (idx: number) => {
    setPoints((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIdx(null);
  };

  const toggleCheckpoint = (idx: number) => {
    const pt = points[idx];
    if (pt.steps !== undefined) {
      const { steps: _s, name: _n, ...rest } = pt;
      setPoints((prev) => prev.map((p, i) => (i === idx ? rest : p)));
    } else {
      const maxSteps = points.reduce((m, p) => (p.steps !== undefined ? Math.max(m, p.steps) : m), 0);
      updatePoint(idx, { steps: points.some((p) => p.steps !== undefined) ? maxSteps + 50_000 : 0 });
    }
  };

  const insertMidpoint = (idx: number) => {
    setPoints((prev) => {
      if (idx >= prev.length - 1) return prev;
      const A = prev[idx], B = prev[idx + 1];
      const mid: RoutePoint = {
        x: +((A.x + B.x) / 2).toFixed(2),
        y: +((A.y + B.y) / 2).toFixed(2),
        smooth: A.smooth,
      };
      const next = [...prev];
      next.splice(idx + 1, 0, mid);
      return next;
    });
    setSelectedIdx(idx + 1);
  };

  const movePointUp = (idx: number) => {
    if (idx === 0) return;
    setPoints((prev) => { const n = [...prev]; [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]]; return n; });
    setSelectedIdx(idx - 1);
  };

  const movePointDown = (idx: number) => {
    if (idx >= points.length - 1) return;
    setPoints((prev) => { const n = [...prev]; [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]]; return n; });
    setSelectedIdx(idx + 1);
  };

  // ─── JSON import ──────────────────────────────────────────────────────────
  const applyJson = () => {
    try {
      const parsed = JSON.parse(jsonText) as RouteConfig;
      if (!Array.isArray(parsed?.points)) throw new Error("Missing points array");
      setPoints(parsed.points);
      setJsonError("");
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  const resetToDefault = () => { setPoints(DEFAULT_ROUTE_CONFIG.points); setSelectedIdx(null); setJsonError(""); };
  const copyJson = () => { void navigator.clipboard.writeText(jsonText); };

  // ─── Derived values ───────────────────────────────────────────────────────
  const config: RouteConfig = { points };
  const totalSteps = getTotalRouteSteps(config);
  const maxPreview = totalSteps || 1_300_000;
  const checkpoints = getRouteCheckpoints(config);

  const fullPathSvg = imageSize.width > 0 ? routePointsToSvgPath(points, imageSize.width, imageSize.height) : "";
  const showPreviewSplit = previewSteps > 0 && totalSteps > 0;
  const { walked: previewWalked, remaining: previewRemaining } =
    showPreviewSplit && imageSize.width > 0
      ? splitRoutePath(previewSteps, config, imageSize.width, imageSize.height)
      : { walked: "", remaining: "" };

  const previewPos = showPreviewSplit ? getRoutePosition(previewSteps, config) : null;
  const previewFi = showPreviewSplit ? getFractionalIndex(previewSteps, config) : -1;
  const selectedPt = selectedIdx !== null ? points[selectedIdx] : null;

  const stageStyle = { transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` };
  const sw = 2.5 / transform.scale;
  const dashArray = `${sw * 4} ${sw * 2.5}`;

  return (
    <div className="editor-shell">
      {/* ─── Header ─────────────────────────────────────── */}
      <header className="editor-header">
        <a href="/" className="link-btn editor-back">← App</a>
        <span className="editor-title">Path Editor</span>
        <div className="editor-toolbar">
          <button type="button" className="btn btn-sm btn-secondary" onClick={resetToDefault} title="Reset to default Frodo path">
            Reset
          </button>
        </div>
      </header>

      {/* ─── Body ───────────────────────────────────────── */}
      <div className="editor-body">
        <div
          ref={viewportRef}
          className={`map-viewport editor-map${mapDragging ? " dragging" : ""}`}
          onPointerDown={onMapPointerDown}
          onPointerMove={onMapPointerMove}
          onPointerUp={onMapPointerUp}
          onPointerCancel={onMapPointerUp}
          onWheel={onWheel}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onContextMenu={(e) => e.preventDefault()}
          style={{ cursor: mapDragging ? "grabbing" : "grab" }}
        >
          <div className="map-stage" style={stageStyle}>
            <img
              ref={imageRef}
              src={mapImageUrl}
              alt="Middle-earth map"
              className="map-image"
              draggable={false}
              onLoad={fitToViewport}
            />

            {imageSize.width > 0 && (
              <div className="map-markers" style={{ width: imageSize.width, height: imageSize.height }}>
                {/* SVG path overlay — SVG itself has no pointer-events; only the hit-area path does */}
                <svg
                  className="map-path-svg"
                  viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: imageSize.width,
                    height: imageSize.height,
                    overflow: "hidden",
                    // Own GPU layer: path edits don't force the image layer to re-raster (no black-tile flashes)
                    transform: "translateZ(0)",
                    backfaceVisibility: "hidden",
                  }}
                >
                  {/* Invisible wide stroke for right-click hit testing */}
                  {points.length >= 2 && (
                    <path
                      d={fullPathSvg}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={20 / transform.scale}
                      style={{ pointerEvents: "stroke", cursor: "crosshair" }}
                      onContextMenu={onPathContextMenu}
                    />
                  )}
                  {/* Visual paths — no pointer events so they don't block pan */}
                  <path
                    fill="none"
                    d={fullPathSvg || "M 0 0"}
                    className="editor-path-neutral"
                    style={{
                      strokeWidth: sw,
                      strokeDasharray: `${sw * 3} ${sw * 2}`,
                      display: showPreviewSplit ? "none" : undefined,
                      pointerEvents: "none",
                    }}
                  />
                  <path
                    fill="none"
                    d={previewWalked || "M 0 0"}
                    className="path-walked"
                    style={{ strokeWidth: sw, display: showPreviewSplit ? undefined : "none", pointerEvents: "none" }}
                  />
                  <path
                    fill="none"
                    d={previewRemaining || "M 0 0"}
                    className="path-remaining"
                    style={{
                      strokeWidth: sw,
                      strokeDasharray: dashArray,
                      display: showPreviewSplit ? undefined : "none",
                      pointerEvents: "none",
                    }}
                  />
                </svg>

                {/* Point markers */}
                {points.map((pt, i) => {
                  const isCheckpoint = pt.steps !== undefined;
                  const isDragging = draggingPointIdx === i;
                  return (
                    <div
                      key={i}
                      className={[
                        "editor-point-marker",
                        isCheckpoint ? "checkpoint" : "waypoint",
                        selectedIdx === i ? "selected" : "",
                        showPreviewSplit && Math.floor(previewFi) === i ? "on-preview" : "",
                        isDragging ? "dragging" : "",
                      ].filter(Boolean).join(" ")}
                      style={{
                        left: `${pt.x}%`,
                        top: `${pt.y}%`,
                        pointerEvents: "all",
                        transform: `translate(-50%, -50%) scale(${1 / transform.scale})`,
                        cursor: isDragging ? "grabbing" : "grab",
                      }}
                      onPointerDown={(e) => onPointPointerDown(e, i)}
                      onPointerMove={(e) => onPointPointerMove(e, i)}
                      onPointerUp={(e) => onPointPointerUp(e, i)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextMenu({ kind: "point", screenX: e.clientX, screenY: e.clientY, pointIdx: i });
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isCheckpoint && pt.name && <span className="editor-point-label">{pt.name}</span>}
                    </div>
                  );
                })}

                {previewPos && (
                  <div
                    className="editor-preview-dot"
                    style={{
                      left: `${previewPos.x}%`,
                      top: `${previewPos.y}%`,
                      pointerEvents: "none",
                      transform: `translate(-50%, -50%) scale(${1 / transform.scale})`,
                    }}
                  />
                )}
              </div>
            )}
          </div>

          <div className="editor-mode-badge">
            Drag to pan · Drag markers to move · Right-click path to add
          </div>
          <div className="editor-stats-badge">
            {points.length} pts · {checkpoints.length} checkpoints
          </div>
        </div>

        {/* ─── Right sidebar ───────────────────────────── */}
        {selectedPt && selectedIdx !== null && (
          <div className="editor-sidebar">
            <div className="editor-sidebar-header">
              <span className="editor-sidebar-title">Point #{selectedIdx + 1}</span>
              <div className="editor-sidebar-order">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => movePointUp(selectedIdx)} disabled={selectedIdx === 0} title="Move up">↑</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => movePointDown(selectedIdx)} disabled={selectedIdx === points.length - 1} title="Move down">↓</button>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => deletePoint(selectedIdx)} title="Delete">✕</button>
              </div>
            </div>

            <label className="editor-checkbox-row">
              <input type="checkbox" checked={selectedPt.steps !== undefined} onChange={() => toggleCheckpoint(selectedIdx)} />
              Checkpoint
            </label>

            {selectedPt.steps !== undefined && (
              <>
                <label className="editor-field-label">
                  Name
                  <input
                    type="text"
                    className="editor-field-input-wide"
                    value={selectedPt.name ?? ""}
                    placeholder="e.g. Rivendell"
                    onChange={(e) => updatePoint(selectedIdx, { name: e.target.value || undefined })}
                  />
                </label>
                <label className="editor-field-label">
                  Steps
                  <input
                    type="number"
                    className="editor-field-input-wide"
                    value={selectedPt.steps}
                    min={0}
                    step={1000}
                    onChange={(e) => updatePoint(selectedIdx, { steps: parseInt(e.target.value, 10) || 0 })}
                  />
                </label>
              </>
            )}

            <label className="editor-checkbox-row">
              <input
                type="checkbox"
                checked={!!selectedPt.smooth}
                disabled={selectedIdx === points.length - 1}
                onChange={(e) => updatePoint(selectedIdx, { smooth: e.target.checked || undefined })}
              />
              Smooth to next
            </label>

            <button
              type="button"
              className="btn btn-sm btn-secondary editor-midpoint-btn"
              onClick={() => insertMidpoint(selectedIdx)}
              disabled={selectedIdx === points.length - 1}
            >
              Insert break after
            </button>
          </div>
        )}
      </div>

      {/* ─── Bottom panel ─────────────────────────────── */}
      <div className="editor-bottom">
        <div className="editor-preview-row">
          <label className="editor-preview-label">
            Preview: <strong>{previewSteps.toLocaleString()}</strong> steps
            <input
              type="range"
              className="editor-preview-slider"
              min={0}
              max={maxPreview}
              step={1000}
              value={previewSteps}
              onChange={(e) => setPreviewSteps(+e.target.value)}
            />
          </label>
          {showPreviewSplit && (
            <span className="editor-preview-info">
              {(() => {
                const cp = checkpoints.filter((c) => c.steps <= previewSteps).at(-1);
                return cp ? `After ${cp.name ?? "checkpoint"}` : "Before start";
              })()}
            </span>
          )}
        </div>

        <div className="editor-json-section">
          <button type="button" className="btn btn-sm btn-secondary" onClick={() => setShowJson((v) => !v)}>
            {showJson ? "▲ Hide" : "▼ Show"} Config JSON ({points.length} points)
          </button>
          {showJson && (
            <div className="editor-json-panel">
              <textarea
                className="editor-json-textarea"
                value={jsonText}
                onChange={(e) => { setJsonText(e.target.value); setJsonError(""); }}
                spellCheck={false}
              />
              <div className="editor-json-actions">
                <button type="button" className="btn btn-sm btn-primary" onClick={applyJson}>Apply JSON</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={copyJson}>Copy</button>
                <button type="button" className="btn btn-sm btn-secondary" onClick={resetToDefault}>Reset to default</button>
              </div>
              {jsonError && <div className="message error">{jsonError}</div>}
            </div>
          )}
        </div>
      </div>

      {/* ─── Context menu ─────────────────────────────── */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="editor-context-menu"
          style={{ top: contextMenu.screenY, left: contextMenu.screenX }}
        >
          {contextMenu.kind === "point" && (
            <>
              <button
                type="button"
                className="editor-context-item"
                onClick={() => {
                  toggleCheckpoint(contextMenu.pointIdx);
                  setSelectedIdx(contextMenu.pointIdx);
                  setContextMenu(null);
                }}
              >
                {points[contextMenu.pointIdx]?.steps !== undefined ? "Remove checkpoint" : "Define checkpoint"}
              </button>
              <button
                type="button"
                className="editor-context-item editor-context-item-danger"
                onClick={() => { deletePoint(contextMenu.pointIdx); setContextMenu(null); }}
              >
                Delete point
              </button>
            </>
          )}
          {contextMenu.kind === "line" && (
            <button
              type="button"
              className="editor-context-item"
              onClick={() => {
                const { insertAfter, x, y } = contextMenu;
                const newPt: RoutePoint = { x, y, smooth: true };
                setPoints((prev) => {
                  const next = [...prev];
                  next.splice(insertAfter + 1, 0, newPt);
                  return next;
                });
                setSelectedIdx(insertAfter + 1);
                setContextMenu(null);
              }}
            >
              Add point here
            </button>
          )}
        </div>
      )}
    </div>
  );
}

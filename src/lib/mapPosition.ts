export interface Landmark {
  name: string;
  steps: number;
  x: number;
  y: number;
}

// Total journey: Bag End → Crack of Doom ≈ 1,779 miles (Tolkien geography).
// Step conversion: 2,000 steps/mile (standard pedometer approximation).
// Intermediate distances from the Atlas of Middle-earth and Eowyn Challenge references.

/** Landmarks along Frodo's route; x/y are percentages on map.jpg. */
export const LANDMARKS: Landmark[] = [
  { name: "Bag End",      steps:         0, x: 14, y: 36 }, //    0 mi
  { name: "Bree",         steps:   260_000, x: 21, y: 33 }, //  130 mi
  { name: "Rivendell",    steps:   916_000, x: 29, y: 28 }, //  458 mi
  { name: "Moria",        steps: 1_250_000, x: 36, y: 38 }, //  625 mi
  { name: "Lothlórien",   steps: 1_350_000, x: 43, y: 43 }, //  675 mi
  { name: "Anduin",       steps: 1_620_000, x: 50, y: 50 }, //  810 mi
  { name: "Emyn Muil",    steps: 1_720_000, x: 58, y: 56 }, //  860 mi
  { name: "Mordor Gate",  steps: 2_300_000, x: 68, y: 64 }, // 1150 mi (via Dead Marshes + Cirith Ungol approach)
  { name: "Mount Doom",   steps: 3_558_000, x: 74, y: 69 }, // 1779 mi
];

export const TOTAL_JOURNEY_STEPS = LANDMARKS[LANDMARKS.length - 1].steps;

// ─── Route config format ─────────────────────────────────────────────────────

export interface RoutePoint {
  x: number;        // percentage of map width (0–100)
  y: number;        // percentage of map height (0–100)
  steps?: number;   // cumulative steps — makes this a checkpoint
  name?: string;    // display name for checkpoints
  smooth?: boolean; // if true, segment FROM this point to the next uses Catmull-Rom
}

export interface RouteConfig {
  points: RoutePoint[];
}

/** Default route — the original LANDMARKS expressed in the new format. */
export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  points: LANDMARKS.map((l) => ({ x: l.x, y: l.y, steps: l.steps, name: l.name })),
};

/** Load route config from localStorage, falling back to DEFAULT_ROUTE_CONFIG. */
export function loadRouteConfig(): RouteConfig {
  try {
    const raw = localStorage.getItem("route-config");
    if (raw) {
      const parsed = JSON.parse(raw) as RouteConfig;
      if (Array.isArray(parsed?.points) && parsed.points.length > 0) return parsed;
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_ROUTE_CONFIG;
}

// Internal type for checkpoints with their array index
type CheckpointPt = RoutePoint & { index: number; steps: number };

export function getRouteCheckpoints(config: RouteConfig): CheckpointPt[] {
  return config.points
    .map((p, i) => ({ ...p, index: i }))
    .filter((p): p is CheckpointPt => p.steps !== undefined);
}

export function getTotalRouteSteps(config: RouteConfig): number {
  const cps = getRouteCheckpoints(config);
  return cps.length > 0 ? cps[cps.length - 1].steps : 0;
}

/**
 * Returns a fractional index into config.points for the given step count.
 * Between two checkpoints A (index ia, steps sa) and B (index ib, steps sb),
 * t = (steps - sa) / (sb - sa) and fractional index = ia + t * (ib - ia).
 */
export function getFractionalIndex(steps: number, config: RouteConfig): number {
  const cps = getRouteCheckpoints(config);
  if (cps.length === 0) return 0;

  const minSteps = cps[0].steps;
  const maxSteps = cps[cps.length - 1].steps;
  const clamped = Math.max(minSteps, Math.min(steps, maxSteps));

  if (clamped <= minSteps) return cps[0].index;

  for (let i = 1; i < cps.length; i++) {
    const A = cps[i - 1];
    const B = cps[i];
    if (clamped <= B.steps) {
      const t = (clamped - A.steps) / (B.steps - A.steps);
      return A.index + t * (B.index - A.index);
    }
  }

  return cps[cps.length - 1].index;
}

/** Get the x,y position on the route for a step count, interpolating sub-points. */
export function getRoutePosition(
  steps: number,
  config: RouteConfig,
): { x: number; y: number } {
  const pts = config.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  if (pts.length === 1) return { x: pts[0].x, y: pts[0].y };

  const fi = getFractionalIndex(steps, config);
  const i = Math.min(Math.floor(fi), pts.length - 2);
  const frac = fi - i;
  const p1 = pts[i];
  const p2 = pts[i + 1];

  return {
    x: p1.x + (p2.x - p1.x) * frac,
    y: p1.y + (p2.y - p1.y) * frac,
  };
}

export function getRouteProgressPercent(
  steps: number,
  config: RouteConfig,
): number {
  const total = getTotalRouteSteps(config);
  if (total === 0) return 0;
  const cps = getRouteCheckpoints(config);
  if (cps.length === 0) return 0;
  const minSteps = cps[0].steps;
  const clamped = Math.max(minSteps, Math.min(steps, total));
  return Math.round(((clamped - minSteps) / (total - minSteps)) * 1000) / 10;
}

export function getNearestRouteCheckpoint(
  steps: number,
  config: RouteConfig,
): CheckpointPt | null {
  const cps = getRouteCheckpoints(config);
  if (cps.length === 0) return null;
  let nearest = cps[0];
  for (const cp of cps) {
    if (cp.steps <= steps) nearest = cp;
    else break;
  }
  return nearest;
}

/**
 * Build an SVG path `d` string from an array of RoutePoints.
 * Smooth segments use a Catmull-Rom → cubic-bezier approximation.
 */
export function routePointsToSvgPath(
  points: RoutePoint[],
  imageW: number,
  imageH: number,
): string {
  if (points.length < 2) return "";

  const px = (p: RoutePoint) => ((p.x / 100) * imageW).toFixed(2);
  const py = (p: RoutePoint) => ((p.y / 100) * imageH).toFixed(2);
  const pxn = (p: RoutePoint) => (p.x / 100) * imageW;
  const pyn = (p: RoutePoint) => (p.y / 100) * imageH;

  let d = `M ${px(points[0])} ${py(points[0])}`;

  for (let i = 1; i < points.length; i++) {
    if (points[i - 1].smooth) {
      const p0 = points[Math.max(0, i - 2)];
      const p1 = points[i - 1];
      const p2 = points[i];
      const p3 = points[Math.min(points.length - 1, i + 1)];

      const cp1x = pxn(p1) + (pxn(p2) - pxn(p0)) / 6;
      const cp1y = pyn(p1) + (pyn(p2) - pyn(p0)) / 6;
      const cp2x = pxn(p2) - (pxn(p3) - pxn(p1)) / 6;
      const cp2y = pyn(p2) - (pyn(p3) - pyn(p1)) / 6;

      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${px(p2)} ${py(p2)}`;
    } else {
      d += ` L ${px(points[i])} ${py(points[i])}`;
    }
  }

  return d;
}

/**
 * Split the route SVG path into walked (green) and remaining (red) portions
 * at the current user's step position.
 */
export function splitRoutePath(
  steps: number,
  config: RouteConfig,
  imageW: number,
  imageH: number,
): { walked: string; remaining: string } {
  const pts = config.points;
  if (pts.length < 2) return { walked: "", remaining: "" };

  const fi = getFractionalIndex(steps, config);
  const floorIdx = Math.min(Math.floor(fi), pts.length - 2);
  const frac = fi - floorIdx;

  const splitX = +(pts[floorIdx].x + (pts[floorIdx + 1].x - pts[floorIdx].x) * frac).toFixed(3);
  const splitY = +(pts[floorIdx].y + (pts[floorIdx + 1].y - pts[floorIdx].y) * frac).toFixed(3);

  const splitPt: RoutePoint = { x: splitX, y: splitY, smooth: pts[floorIdx].smooth };

  const walkedPts = [...pts.slice(0, floorIdx + 1), splitPt];
  const remainingPts = [{ ...splitPt, smooth: false }, ...pts.slice(floorIdx + 1)];

  return {
    walked: routePointsToSvgPath(walkedPts, imageW, imageH),
    remaining: routePointsToSvgPath(remainingPts, imageW, imageH),
  };
}

// ─── Legacy functions (kept for backward compat) ─────────────────────────────

export function getProgressPercent(steps: number): number {
  const clamped = Math.max(0, Math.min(steps, TOTAL_JOURNEY_STEPS));
  return Math.round((clamped / TOTAL_JOURNEY_STEPS) * 1000) / 10;
}

export function getMapPosition(steps: number): { x: number; y: number } {
  const clamped = Math.max(0, Math.min(steps, TOTAL_JOURNEY_STEPS));

  if (clamped <= LANDMARKS[0].steps) {
    return { x: LANDMARKS[0].x, y: LANDMARKS[0].y };
  }

  for (let i = 1; i < LANDMARKS.length; i++) {
    const prev = LANDMARKS[i - 1];
    const next = LANDMARKS[i];
    if (clamped <= next.steps) {
      const span = next.steps - prev.steps;
      const t = span === 0 ? 1 : (clamped - prev.steps) / span;
      return {
        x: prev.x + (next.x - prev.x) * t,
        y: prev.y + (next.y - prev.y) * t,
      };
    }
  }

  const last = LANDMARKS[LANDMARKS.length - 1];
  return { x: last.x, y: last.y };
}

export function getNearestLandmark(steps: number): Landmark {
  const clamped = Math.max(0, steps);
  let nearest = LANDMARKS[0];

  for (const landmark of LANDMARKS) {
    if (landmark.steps <= clamped) {
      nearest = landmark;
    } else {
      break;
    }
  }

  return nearest;
}

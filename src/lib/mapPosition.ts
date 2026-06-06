export interface Landmark {
  name: string;
  steps: number;
  x: number;
  y: number;
}

/** Landmarks along Frodo's route; x/y are percentages on map.jpg. */
export const LANDMARKS: Landmark[] = [
  { name: "Bag End", steps: 0, x: 14, y: 36 },
  { name: "Bree", steps: 60_000, x: 21, y: 33 },
  { name: "Rivendell", steps: 280_000, x: 29, y: 28 },
  { name: "Moria", steps: 420_000, x: 36, y: 38 },
  { name: "Lothlórien", steps: 560_000, x: 43, y: 43 },
  { name: "Anduin", steps: 720_000, x: 50, y: 50 },
  { name: "Emyn Muil", steps: 900_000, x: 58, y: 56 },
  { name: "Mordor Gate", steps: 1_100_000, x: 68, y: 64 },
  { name: "Mount Doom", steps: 1_300_000, x: 74, y: 69 },
];

export const TOTAL_JOURNEY_STEPS = LANDMARKS[LANDMARKS.length - 1].steps;

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

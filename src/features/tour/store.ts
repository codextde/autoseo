import { TOUR_EVENT, type TourState } from "./steps";

/**
 * Client-side tour state store shared by the TourRunner (app shell) and the tour page. The server
 * (`users.preferences.tour`) stays the source of truth; sessionStorage makes the runner render
 * instantly after switching between the global and project layouts.
 */
const KEY = "autoseo.tour";
let current: TourState | null | undefined;
const listeners = new Set<() => void>();

function readCachedTourState(): TourState | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TourState) : null;
  } catch {
    return null;
  }
}

export function getTourSnapshot(): TourState | null {
  if (current === undefined) current = typeof window === "undefined" ? null : readCachedTourState();
  return current;
}

export function getServerTourSnapshot(): TourState | null {
  return null;
}

export function subscribeTour(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Updates the shared state (cache + subscribers + a DOM event for anything else listening). */
export function publishTourState(state: TourState) {
  current = state;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l();
  window.dispatchEvent(new CustomEvent<TourState>(TOUR_EVENT, { detail: state }));
}

import type { Ad, Impression } from "./types"

// Kv is the minimal key/value store the plugin needs. OpenCode's `api.kv`
// satisfies it; tests pass an in-memory fake. Values round-trip through JSON.
export interface Kv {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

// AdState is the cached current ad plus its display bookkeeping. `servedAt` is the
// epoch-ms the ad started showing (the footer renders it immediately on serve);
// `recorded` prevents double-counting one ad across the busy/idle transitions.
// `needsLogin` is set when the device token was rejected (401/403) so the footer
// shows a sign-in notice instead of an ad. `tryAgainAt` is the ISO-8601 UTC time an
// active earning-cap resets: while it is in the future there is no ad, serving is
// paused, and the footer shows a countdown.
export interface AdState {
  ad: Ad | null
  servedAt: number
  recorded: boolean
  needsLogin?: boolean
  needsLoginReason?: string
  tryAgainAt?: string
}

const STATE_KEY = "vibeperks:state"
const QUEUE_KEY = "vibeperks:queue"

const EMPTY_STATE: AdState = { ad: null, servedAt: 0, recorded: false }

function isAdState(v: unknown): v is AdState {
  return typeof v === "object" && v !== null && "recorded" in v && "servedAt" in v
}

// loadState reads the cached state; anything missing or malformed yields the empty
// state (no ad).
export async function loadState(kv: Kv): Promise<AdState> {
  const v = await kv.get(STATE_KEY)
  return isAdState(v) ? v : { ...EMPTY_STATE }
}

export async function saveState(kv: Kv, s: AdState): Promise<void> {
  await kv.set(STATE_KEY, s)
}

export async function clearState(kv: Kv): Promise<void> {
  await kv.set(STATE_KEY, { ...EMPTY_STATE })
}

export async function loadQueue(kv: Kv): Promise<Impression[]> {
  const v = await kv.get(QUEUE_KEY)
  return Array.isArray(v) ? (v as Impression[]) : []
}

export async function saveQueue(kv: Kv, q: Impression[]): Promise<void> {
  await kv.set(QUEUE_KEY, q)
}

// enqueue appends an impression, deduped by impression token so a record repeated
// across the busy + idle hooks for the same ad is stored once.
export async function enqueue(kv: Kv, imp: Impression): Promise<void> {
  const q = await loadQueue(kv)
  if (q.some((e) => e.impression_token === imp.impression_token)) return
  await saveQueue(kv, [...q, imp])
}

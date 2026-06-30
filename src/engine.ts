import { VibePerksClient } from "./client"
import type { PluginConfig } from "./config"
import { RejectedError } from "./errors"
import {
  type AdState,
  type Kv,
  clearState,
  enqueue,
  loadQueue,
  loadState,
  saveQueue,
  saveState,
} from "./store"
import type { Ad, Impression } from "./types"

// Meta is the per-session adapter metadata attached to every impression.
export interface Meta {
  cli: string
  cliVersion: string
  pluginVersion: string
  sessionId: string
}

const DEFAULT_ROTATE_SECONDS = 20
const FLUSH_RETRY_DELAY_MS = 200
// Auto-rotations are capped per prompt: an idle terminal must not keep serving
// (and billing) ads forever. A new prompt resets the budget.
const MAX_AUTO_ROTATIONS = 3

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function rotateMs(ad: Ad | null): number {
  const seconds = ad && ad.rotate_seconds > 0 ? ad.rotate_seconds : DEFAULT_ROTATE_SECONDS
  return seconds * 1000
}

// recordCurrent enqueues an impression for the currently displayed ad exactly
// once. It is a no-op when there is no ad or it was already recorded. All times
// are epoch-ms integers (no floats).
async function recordCurrent(kv: Kv, s: AdState, meta: Meta, now: number): Promise<AdState> {
  if (!s.ad || s.recorded) return s
  const displayedMs = Math.max(0, now - s.servedAt)
  const imp: Impression = {
    impression_token: s.ad.impression_token,
    displayed_ms: displayedMs,
    session_id: meta.sessionId || undefined,
    session_duration_ms: displayedMs || undefined,
    plugin_version: meta.pluginVersion || undefined,
    cli: meta.cli || undefined,
    cli_version: meta.cliVersion || undefined,
  }
  await enqueue(kv, imp)
  return { ...s, recorded: true }
}

// postWithRetry attempts a single impression post with at most one bounded retry,
// and only for transient failures. Permanent outcomes (success, RejectedError,
// UnauthorizedError) return/throw immediately without retrying.
async function postWithRetry(client: VibePerksClient, imp: Impression): Promise<void> {
  try {
    await client.postImpression(imp)
  } catch (e) {
    if (e instanceof RejectedError) throw e
    if (e instanceof Error && e.name === "UnauthorizedError") throw e
    await delay(FLUSH_RETRY_DELAY_MS)
    await client.postImpression(imp)
  }
}

// flush posts every buffered impression. Delivered and permanently rejected
// impressions are dropped; transient failures are kept for the next flush. The
// first transient error (if any) propagates after the buffer is rewritten so the
// boundary can log it.
export async function flush(kv: Kv, client: VibePerksClient): Promise<void> {
  const queue = await loadQueue(kv)
  if (queue.length === 0) return
  const remaining: Impression[] = []
  let firstErr: unknown = null
  for (const imp of queue) {
    try {
      await postWithRetry(client, imp)
    } catch (e) {
      if (e instanceof RejectedError) continue
      remaining.push(imp)
      if (firstErr === null) firstErr = e
    }
  }
  await saveQueue(kv, remaining)
  if (firstErr) throw firstErr
}

// onBusy is the prompt / rotation worker. It records the current ad's impression
// and serves the next ad when there is no ad, or when rotate_seconds has elapsed
// and fewer than MAX_AUTO_ROTATIONS have happened since the last prompt, then
// flushes the buffer. `force` (a real prompt submission) resets the rotation
// budget so each prompt gets a fresh ad. Opt-out clears the cached ad and does no
// network I/O.
export async function onBusy(
  kv: Kv,
  client: VibePerksClient,
  cfg: PluginConfig,
  meta: Meta,
  now: number,
  force = true,
): Promise<void> {
  if (cfg.optOut) {
    await clearState(kv)
    return
  }
  let s = await loadState(kv)
  const windowElapsed = !s.ad || now - s.servedAt >= rotateMs(s.ad)
  const budgetLeft = force || s.rotateCount < MAX_AUTO_ROTATIONS
  const due = windowElapsed && budgetLeft
  if (!due) {
    await flush(kv, client)
    return
  }
  const nextCount = force ? 0 : s.rotateCount + 1
  s = await recordCurrent(kv, s, meta, now)
  let ad: Ad | null
  try {
    ad = await client.serve()
  } catch (e) {
    // A rejected device token is terminal: clear the cached ad and flag the slot so
    // the footer shows a sign-in notice. This is a handled outcome, not an error to
    // surface, so the footer can repaint from the saved state.
    if (e instanceof Error && e.name === "UnauthorizedError") {
      const reason = (e as { reason?: string }).reason ?? ""
      await saveState(kv, {
        ad: null,
        servedAt: 0,
        recorded: false,
        rotateCount: 0,
        needsLogin: true,
        needsLoginReason: reason,
      })
      await flush(kv, client)
      return
    }
    // Keep the buffered impression and the recorded flag; surface the serve error
    // (the plugin entry boundary swallows it so OpenCode is unaffected).
    await saveState(kv, s)
    await flush(kv, client)
    throw e
  }
  await saveState(
    kv,
    ad
      ? { ad, servedAt: now, recorded: false, rotateCount: nextCount }
      : { ad: null, servedAt: 0, recorded: false, rotateCount: 0 },
  )
  await flush(kv, client)
}

// onIdle is the thinking-end worker: it records the current ad's impression (if
// not yet recorded) and flushes the buffer. Opt-out is a no-op.
export async function onIdle(
  kv: Kv,
  client: VibePerksClient,
  cfg: PluginConfig,
  meta: Meta,
  now: number,
): Promise<void> {
  if (cfg.optOut) return
  let s = await loadState(kv)
  s = await recordCurrent(kv, s, meta, now)
  await saveState(kv, s)
  await flush(kv, client)
}

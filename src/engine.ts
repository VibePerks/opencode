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
import type { Impression, ServeResult } from "./types"
import { isEarningCapped } from "./types"

// Meta is the per-session adapter metadata attached to every impression.
export interface Meta {
  cli: string
  cliVersion: string
  pluginVersion: string
  sessionId: string
}

const FLUSH_RETRY_DELAY_MS = 200
// Billable serve cadence: at most one new ad (one impression) every 5 minutes while
// active, so even a continuously busy session earns at most 12 ads/hour - matching
// the backend's per-hour earning cap. Between serves the footer keeps showing the
// cached ad; an idle terminal stops serving entirely (no auto-rotations).
export const MIN_BILLABLE_INTERVAL_MS = 5 * 60 * 1000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// recordCurrent enqueues an impression for the currently displayed ad exactly
// once. It is a no-op when there is no ad or it was already recorded. The house
// ad (served when there is no paid inventory) has no impression token and is
// display-only, so it is never reported. All times are epoch-ms integers.
async function recordCurrent(kv: Kv, s: AdState, meta: Meta, now: number): Promise<AdState> {
  if (!s.ad || !s.ad.impression_token || s.recorded) return s
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

// onBusy is the prompt / activity worker. It serves the next billable ad only when
// there is no ad, or when at least MIN_BILLABLE_INTERVAL_MS has elapsed since the
// last serve (so serving is paced to <=12/hour). It records the current ad's
// impression before serving the next, then flushes the buffer. While an earning cap
// is active it serves nothing until `try_again_at`. Opt-out clears the cached ad and
// does no network I/O.
export async function onBusy(
  kv: Kv,
  client: VibePerksClient,
  cfg: PluginConfig,
  meta: Meta,
  now: number,
): Promise<void> {
  if (cfg.optOut) {
    await clearState(kv)
    return
  }
  let s = await loadState(kv)
  // Earning-cap backoff: while capped, do not serve until the reset time passes.
  if (s.tryAgainAt && now < Date.parse(s.tryAgainAt)) {
    await flush(kv, client)
    return
  }
  const due = !s.ad || now - s.servedAt >= MIN_BILLABLE_INTERVAL_MS
  if (!due) {
    await flush(kv, client)
    return
  }
  s = await recordCurrent(kv, s, meta, now)
  let result: ServeResult
  try {
    result = await client.serve()
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
  if (isEarningCapped(result)) {
    // Publisher hit their earning cap: no ad, pause serving until try_again_at.
    await saveState(kv, { ad: null, servedAt: 0, recorded: false, tryAgainAt: result.try_again_at })
    await flush(kv, client)
    return
  }
  await saveState(
    kv,
    result
      ? { ad: result, servedAt: now, recorded: false }
      : { ad: null, servedAt: 0, recorded: false },
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

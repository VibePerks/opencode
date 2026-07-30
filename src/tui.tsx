/** @jsxImportSource @opentui/solid */
//
// VibePerks sponsor unit for OpenCode.
//
// Renders ONE quiet line pinned to the bottom of the OpenCode TUI (the
// `app_bottom` slot, visible on every screen):
//
//   <sentence ending in the advertiser's domain>
//
// Protocol (the same backend contract every VibePerks adapter uses):
//   - GET  /v1/ads/serve   (X-Device-Token) -> { ad_id, sentence, domain,
//                                                impression_token, rotate_seconds }
//   - POST /v1/impressions (X-Device-Token) <- display facts only
//
// Economics: a serve is the billable event, so we only serve on a REAL prompt -
// the `session.status` -> "busy" transition - at most once per rotate window. The
// footer always renders from the local KV cache (instant, offline-safe); a serve
// only updates that cache.
//
// Privacy: NOTHING about the user's code, prompts, files, or paths leaves the
// machine. Only the backend contract fields (device token; display timings; CLI +
// plugin version) are ever sent. See README.md for the full leaves/never-leaves
// table.
//
// Distributed two ways:
//   - npm:   "plugin": ["@vibeperks/opencode"]      in tui.json
//   - local: "plugin": ["./plugins/vibeperks.tsx"]  in tui.json
//
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { createSignal, Show, type Accessor } from "solid-js"
import { VibePerksClient } from "./client"
import { loadConfig } from "./config"
import { onBusy, onIdle, type Meta } from "./engine"
import { loginNotice, renderLine } from "./sanitize"
import { loadState, type Kv } from "./store"

const id = "vibeperks.sponsor"
const PLUGIN_VERSION = "0.1.0"

function nowMs(): number {
  return Date.now()
}

// ---- view ----------------------------------------------------------------

function SponsorLine(props: {
  api: TuiPluginApi
  line: Accessor<string | undefined>
  needsLogin: Accessor<boolean>
  needsLoginReason: Accessor<string>
  paused: Accessor<boolean>
  pausedText: Accessor<string>
}) {
  const theme = () => props.api.theme.current
  return (
    <box width="100%" paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={1}>
      <Show
        when={props.needsLogin()}
        fallback={
          <Show
            when={props.line()}
            fallback={
              <text fg={theme().textMuted}>
                {props.paused() ? props.pausedText() : "vibeperks"}
              </text>
            }
          >
            {(l) => (
              <box flexDirection="row" flexShrink={1} gap={1}>
                <text fg={theme().text}>{l()}</text>
              </box>
            )}
          </Show>
        }
      >
        {/* Sign-in notice: plain, non-bold theme text - distinct from a paid ad. */}
        <text fg={theme().text}>{loginNotice(props.needsLoginReason())}</text>
      </Show>
    </box>
  )
}

// ---- plugin --------------------------------------------------------------

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as { api?: string }
  const env = process.env as Record<string, string | undefined>
  if (opts.api) env.VIBEPERKS_API = opts.api // the `api` option maps onto the env override

  const cfg = loadConfig(env)
  const kv = api.kv as unknown as Kv
  const client = new VibePerksClient(cfg.apiBase, cfg.deviceToken)
  const hasToken = cfg.deviceToken !== ""

  const [line, setLine] = createSignal<string | undefined>(undefined)
  const [needsLogin, setNeedsLogin] = createSignal(false)
  const [needsLoginReason, setNeedsLoginReason] = createSignal("")
  const [paused, setPaused] = createSignal(false)
  const [pausedText, setPausedText] = createSignal("vibeperks")

  async function syncLine() {
    const s = await loadState(kv)
    setNeedsLogin(s.needsLogin === true)
    setNeedsLoginReason(s.needsLoginReason ?? "")
    const resetAt = s.tryAgainAt ? Date.parse(s.tryAgainAt) : Number.NaN
    if (!Number.isNaN(resetAt) && resetAt > nowMs()) {
      // Earning cap active: show a subtle paused line instead of an ad.
      const mins = Math.max(1, Math.ceil((resetAt - nowMs()) / 60000))
      setPaused(true)
      setPausedText(`vibeperks - limit reached, more ads in ~${mins}m`)
      setLine(undefined)
    } else {
      setPaused(false)
      setLine(s.ad ? renderLine(s.ad) : undefined)
    }
  }

  function meta(sessionID: string): Meta {
    return {
      cli: "opencode",
      cliVersion: env.OPENCODE_VERSION ?? "",
      pluginVersion: PLUGIN_VERSION,
      sessionId: sessionID,
    }
  }

  // 1. Hydrate the footer from cache first - instant, works offline.
  try {
    await api.kv.ready
    await syncLine()
  } catch {
    // fail silent (the single swallow boundary)
  }

  // 2. Drive ad serving + impression reporting off the session lifecycle. Every
  //    handler body runs inside this single fail-silent boundary: any client
  //    error is swallowed so OpenCode is never broken or slowed. No swallowing
  //    happens deeper than this point.
  const active = new Set<string>()
  // While a session is active the ad refreshes on a fixed billable cadence (a new
  // serve = one impression) at most every 5 minutes, so a busy session earns at
  // most 12 ads/hour. The timer is cleared the moment the session goes idle, so an
  // idle terminal never serves.
  const BILLABLE_MS = 5 * 60_000
  let rotateTimer: ReturnType<typeof setInterval> | undefined
  function stopRotation() {
    if (rotateTimer) {
      clearInterval(rotateTimer)
      rotateTimer = undefined
    }
  }
  api.event.on("session.status", (event) => {
    const sessionID = event.properties.sessionID
    const type = event.properties.status.type
    if (type === "busy") {
      if (active.has(sessionID)) return
      const session = api.state.session.get?.(sessionID)
      if (session?.parentID) return // subagent work belongs to the parent's prompt
      active.add(sessionID)
      void (async () => {
        try {
          if (hasToken) {
            await onBusy(kv, client, cfg, meta(sessionID), nowMs())
            await syncLine()
          }
        } catch {
          // fail silent
        }
      })()
      stopRotation()
      rotateTimer = setInterval(() => {
        void (async () => {
          try {
            if (hasToken) {
              await onBusy(kv, client, cfg, meta(sessionID), nowMs())
              await syncLine()
            }
          } catch {
            // fail silent
          }
        })()
      }, BILLABLE_MS)
    } else if (type === "idle") {
      active.delete(sessionID)
      stopRotation()
      void (async () => {
        try {
          if (hasToken) {
            await onIdle(kv, client, cfg, meta(sessionID), nowMs())
            await syncLine()
          }
        } catch {
          // fail silent
        }
      })()
    }
  })

  // 3. Render the unit pinned to the bottom on every screen.
  api.slots.register({
    order: 1000,
    slots: {
      app_bottom() {
        return (
          <SponsorLine
            api={api}
            line={line}
            needsLogin={needsLogin}
            needsLoginReason={needsLoginReason}
            paused={paused}
            pausedText={pausedText}
          />
        )
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }
export default plugin

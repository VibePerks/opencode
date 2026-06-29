/** @jsxImportSource @opentui/solid */
//
// VibePerks sponsor unit for OpenCode.
//
// Renders ONE quiet line pinned to the bottom of the OpenCode TUI (the
// `app_bottom` slot, visible on every screen):
//
//   sponsored  <sentence ending in the advertiser's domain>
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
import { renderLine } from "./sanitize"
import { loadState, type Kv } from "./store"

const id = "vibeperks.sponsor"
const PLUGIN_VERSION = "0.1.0"

function nowMs(): number {
  return Date.now()
}

// ---- view ----------------------------------------------------------------

function SponsorLine(props: { api: TuiPluginApi; line: Accessor<string | undefined> }) {
  const theme = () => props.api.theme.current
  return (
    <box width="100%" paddingLeft={2} paddingRight={2} flexDirection="row" flexShrink={0} gap={1}>
      <Show when={props.line()} fallback={<text fg={theme().textMuted}>vibeperks</text>}>
        {(l) => (
          <box flexDirection="row" flexShrink={1} gap={1}>
            <text fg={theme().textMuted}>sponsored</text>
            <text fg={theme().text}>{l()}</text>
          </box>
        )}
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

  async function syncLine() {
    const s = await loadState(kv)
    setLine(s.ad ? renderLine(s.ad) : undefined)
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
  // While a prompt runs the ad rotates a few times (capped in the engine at three
  // since the prompt resets the budget), then stops - an idle terminal must never
  // poll the server forever. The timer is cleared the moment the session goes idle.
  const ROTATE_MS = 20_000
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
            await onBusy(kv, client, cfg, meta(sessionID), nowMs(), true) // prompt: fresh ad + reset budget
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
              await onBusy(kv, client, cfg, meta(sessionID), nowMs(), false) // capped auto-rotation
              await syncLine()
            }
          } catch {
            // fail silent
          }
        })()
      }, ROTATE_MS)
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
        return <SponsorLine api={api} line={line} />
      },
    },
  })
}

const plugin: TuiPluginModule & { id: string } = { id, tui }
export default plugin

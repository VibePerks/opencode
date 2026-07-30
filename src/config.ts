import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// defaultAPIBase targets the dev backend; override with $VIBEPERKS_API (or the
// plugin `api` option, which is mapped onto $VIBEPERKS_API before loading). No domain
// beyond this dev default is hard-coded into the published plugin.
export const DEFAULT_API_BASE = "https://api-dev.vibeperks.ai"

// PluginConfig is the resolved local configuration the plugin runs on.
export interface PluginConfig {
  apiBase: string
  deviceToken: string
  optOut: boolean
}

// ConfigEnv is the subset of process.env the config layer reads. It is passed in
// explicitly so the loader stays pure and testable.
export interface ConfigEnv {
  VIBEPERKS_HOME?: string
  VIBEPERKS_API?: string
  VIBEPERKS_DEVICE_TOKEN?: string
}

// FileConfig is the on-disk shape shared with the Go adapters' config.json, so a
// single `login` (from any VibePerks CLI) configures every adapter on the machine.
interface FileConfig {
  api_base?: string
  device_token?: string
  opt_out?: boolean
}

function configDir(env: ConfigEnv): string {
  if (env.VIBEPERKS_HOME) return env.VIBEPERKS_HOME
  return join(homedir(), ".vibeperks")
}

// readFileConfig reads ~/.vibeperks/config.json. A missing file is the normal "not
// yet configured" state and yields an empty config; any other read error or
// malformed JSON propagates (the plugin entry boundary swallows it).
function readFileConfig(env: ConfigEnv): FileConfig {
  let raw: string
  try {
    raw = readFileSync(join(configDir(env), "config.json"), "utf8")
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return {}
    throw e
  }
  return JSON.parse(raw) as FileConfig
}

// loadConfig resolves the effective config from env overrides + the shared config
// file. Env wins over the file; the file wins over the built-in default base.
export function loadConfig(env: ConfigEnv): PluginConfig {
  const file = readFileConfig(env)
  const apiBase = (env.VIBEPERKS_API || file.api_base || DEFAULT_API_BASE).replace(/\/+$/, "")
  const deviceToken = env.VIBEPERKS_DEVICE_TOKEN || file.device_token || ""
  return { apiBase, deviceToken, optOut: file.opt_out === true }
}

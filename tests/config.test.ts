import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_API_BASE, loadConfig } from "../src/config"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "vibeperks-cfg-"))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function writeConfig(contents: string): void {
  writeFileSync(join(dir, "config.json"), contents, "utf8")
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", () => {
    const cfg = loadConfig({ VIBEPERKS_HOME: dir })
    expect(cfg).toEqual({ apiBase: DEFAULT_API_BASE, deviceToken: "", optOut: false })
  })

  it("reads api_base, device_token and opt_out from the shared config file", () => {
    writeConfig(
      JSON.stringify({ api_base: "https://api.example.com", device_token: "tok", opt_out: true }),
    )
    const cfg = loadConfig({ VIBEPERKS_HOME: dir })
    expect(cfg).toEqual({ apiBase: "https://api.example.com", deviceToken: "tok", optOut: true })
  })

  it("lets env overrides win over the file", () => {
    writeConfig(JSON.stringify({ api_base: "https://file.example.com", device_token: "file-tok" }))
    const cfg = loadConfig({
      VIBEPERKS_HOME: dir,
      VIBEPERKS_API: "https://env.example.com",
      VIBEPERKS_DEVICE_TOKEN: "env-tok",
    })
    expect(cfg.apiBase).toBe("https://env.example.com")
    expect(cfg.deviceToken).toBe("env-tok")
  })

  it("strips a trailing slash from the api base", () => {
    const cfg = loadConfig({ VIBEPERKS_HOME: dir, VIBEPERKS_API: "https://api.example.com/" })
    expect(cfg.apiBase).toBe("https://api.example.com")
  })

  it("treats opt_out absent or non-true as false", () => {
    writeConfig(JSON.stringify({ opt_out: "yes" }))
    expect(loadConfig({ VIBEPERKS_HOME: dir }).optOut).toBe(false)
  })

  it("propagates malformed config JSON (no silent swallow)", () => {
    writeConfig("{ not json")
    expect(() => loadConfig({ VIBEPERKS_HOME: dir })).toThrow()
  })
})

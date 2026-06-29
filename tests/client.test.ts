import { describe, expect, it } from "vitest"
import { VibePerksClient, type FetchFn } from "../src/client"
import { RejectedError, UnauthorizedError } from "../src/errors"
import type { Ad, Impression } from "../src/types"

interface Call {
  url: string
  init: RequestInit | undefined
}

// recordingFetch returns a FetchFn that replies with `status`/`body` and records
// each request so tests can assert headers + payloads (the contract).
function recordingFetch(status: number, body: unknown): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = []
  const fetch: FetchFn = async (input, init) => {
    calls.push({ url: String(input), init })
    if (status === 204) return new Response(null, { status })
    return new Response(JSON.stringify(body), { status })
  }
  return { fetch, calls }
}

function header(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>
  return headers[name]
}

const sampleAd: Ad = {
  ad_id: "a1",
  sentence: "Fast APIs\u001b for every chain - alchemy.com",
  domain: "alchemy.com\u0000",
  impression_token: "imp1",
  rotate_seconds: 30,
}

describe("VibePerksClient.serve", () => {
  it("returns a sanitized ad on 200 and attaches the device token", async () => {
    const { fetch, calls } = recordingFetch(200, sampleAd)
    const client = new VibePerksClient("https://api.example.com/", "dev-token", fetch)
    const ad = await client.serve()
    expect(ad?.sentence).toBe("Fast APIs for every chain - alchemy.com")
    expect(ad?.domain).toBe("alchemy.com")
    expect(calls[0].url).toBe("https://api.example.com/v1/ads/serve")
    expect(header(calls[0].init, "X-Device-Token")).toBe("dev-token")
    expect(calls[0].init?.method).toBe("GET")
  })

  it("returns null on 204 (empty inventory)", async () => {
    const { fetch } = recordingFetch(204, null)
    expect(await new VibePerksClient("https://api.example.com", "t", fetch).serve()).toBeNull()
  })

  it("throws UnauthorizedError on 401 and 403", async () => {
    for (const status of [401, 403]) {
      const { fetch } = recordingFetch(status, {})
      await expect(new VibePerksClient("https://x", "t", fetch).serve()).rejects.toBeInstanceOf(
        UnauthorizedError,
      )
    }
  })

  it("propagates an error on an unexpected status", async () => {
    const { fetch } = recordingFetch(500, {})
    await expect(new VibePerksClient("https://x", "t", fetch).serve()).rejects.toThrow(
      /unexpected status 500/,
    )
  })
})

describe("VibePerksClient.postImpression", () => {
  const imp: Impression = {
    impression_token: "imp1",
    displayed_ms: 1200,
    session_id: "s1",
    cli: "opencode",
    cli_version: "1.0.0",
    plugin_version: "0.1.0",
  }

  it("succeeds on 200 and 201 and sends the contract payload + token", async () => {
    for (const status of [200, 201]) {
      const { fetch, calls } = recordingFetch(status, {})
      await new VibePerksClient("https://api.example.com", "dev-token", fetch).postImpression(imp)
      expect(calls[0].url).toBe("https://api.example.com/v1/impressions")
      expect(header(calls[0].init, "X-Device-Token")).toBe("dev-token")
      expect(JSON.parse(String(calls[0].init?.body))).toEqual(imp)
    }
  })

  it("throws UnauthorizedError on 401/403", async () => {
    for (const status of [401, 403]) {
      const { fetch } = recordingFetch(status, {})
      await expect(
        new VibePerksClient("https://x", "t", fetch).postImpression(imp),
      ).rejects.toBeInstanceOf(UnauthorizedError)
    }
  })

  it("throws RejectedError on a non-auth 4xx", async () => {
    const { fetch } = recordingFetch(422, {})
    await expect(
      new VibePerksClient("https://x", "t", fetch).postImpression(imp),
    ).rejects.toBeInstanceOf(RejectedError)
  })

  it("propagates an error on 5xx", async () => {
    const { fetch } = recordingFetch(503, {})
    await expect(new VibePerksClient("https://x", "t", fetch).postImpression(imp)).rejects.toThrow(
      /unexpected status 503/,
    )
  })

  it("only sends contract fields - no code, prompt or path content", async () => {
    const { fetch, calls } = recordingFetch(201, {})
    await new VibePerksClient("https://x", "t", fetch).postImpression(imp)
    const sent = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>
    const allowed = new Set([
      "impression_token",
      "displayed_ms",
      "session_id",
      "session_duration_ms",
      "plugin_version",
      "cli",
      "cli_version",
    ])
    for (const key of Object.keys(sent)) expect(allowed.has(key)).toBe(true)
  })
})

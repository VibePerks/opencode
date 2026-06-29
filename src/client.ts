import { UnauthorizedError, RejectedError } from "./errors"
import { sanitize } from "./sanitize"
import type { Ad, Impression } from "./types"

// A hard per-request timeout so a slow or hung backend can never stall OpenCode.
const HTTP_TIMEOUT_MS = 5000

// FetchFn is the fetch contract; injected so tests run with no real network.
export type FetchFn = typeof fetch

// VibePerksClient talks to the backend with the device token attached to every
// request. It performs no retries itself - bounded retry lives in one place
// (the engine's flush) per the repo's no-retry-nest rule.
export class VibePerksClient {
  private readonly base: string
  private readonly token: string
  private readonly fetchImpl: FetchFn

  constructor(apiBase: string, token: string, fetchImpl: FetchFn = fetch) {
    this.base = apiBase.replace(/\/+$/, "")
    this.token = token
    this.fetchImpl = fetchImpl
  }

  // serve fetches the next eligible ad. A 204 (empty inventory) returns null.
  async serve(): Promise<Ad | null> {
    const res = await this.fetchImpl(this.base + "/v1/ads/serve", {
      method: "GET",
      headers: { "X-Device-Token": this.token },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 204) return null
    if (res.status === 200) {
      const ad = (await res.json()) as Ad
      ad.sentence = sanitize(ad.sentence)
      ad.domain = sanitize(ad.domain)
      return ad
    }
    if (res.status === 401 || res.status === 403) throw new UnauthorizedError()
    throw new Error(`serve: unexpected status ${res.status}`)
  }

  // postImpression reports one impression. 200/201 is success; 401/403 is
  // UnauthorizedError; any other 4xx is a permanent RejectedError; 5xx/transport
  // errors propagate so the caller can retry once.
  async postImpression(imp: Impression): Promise<void> {
    const res = await this.fetchImpl(this.base + "/v1/impressions", {
      method: "POST",
      headers: { "X-Device-Token": this.token, "Content-Type": "application/json" },
      body: JSON.stringify(imp),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 200 || res.status === 201) return
    if (res.status === 401 || res.status === 403) throw new UnauthorizedError()
    if (res.status >= 400 && res.status < 500) throw new RejectedError()
    throw new Error(`impression: unexpected status ${res.status}`)
  }
}

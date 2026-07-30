import { UnauthorizedError, RejectedError } from "./errors"
import { sanitize } from "./sanitize"
import type { Ad, Impression, ServeResult } from "./types"

// A hard per-request timeout so a slow or hung backend can never stall OpenCode.
const HTTP_TIMEOUT_MS = 5000

// authReason maps a rejection status to a short, user-facing reason. The backend
// returns 403 only for a suspended account and 401 for an invalid/revoked/unknown
// token, so the status alone is an accurate reason (no guessing).
function authReason(status: number): string {
  return status === 403 ? "account suspended" : "device token invalid or revoked"
}

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

  // serve fetches the next eligible ad. A 204 (empty inventory) returns null. A 200
  // with status "earning_capped" means the publisher hit their hourly/daily earning
  // limit: no ad, only an EarningCapped signal carrying try_again_at so the caller
  // stops polling until the cap resets.
  async serve(): Promise<ServeResult> {
    const res = await this.fetchImpl(this.base + "/v1/ads/serve", {
      method: "GET",
      headers: { "X-Device-Token": this.token },
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
    if (res.status === 204) return null
    if (res.status === 200) {
      const body = (await res.json()) as Record<string, unknown>
      if (body.status === "earning_capped") {
        return { earning_capped: true, try_again_at: String(body.try_again_at ?? "") }
      }
      const ad = body as unknown as Ad
      ad.sentence = sanitize(ad.sentence)
      ad.domain = sanitize(ad.domain)
      ad.website_url = sanitize(ad.website_url ?? "")
      return ad
    }
    if (res.status === 401 || res.status === 403)
      throw new UnauthorizedError(authReason(res.status))
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
    if (res.status === 401 || res.status === 403)
      throw new UnauthorizedError(authReason(res.status))
    if (res.status >= 400 && res.status < 500) throw new RejectedError()
    throw new Error(`impression: unexpected status ${res.status}`)
  }
}

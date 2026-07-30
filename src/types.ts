// Shared wire types for the VibePerks OpenCode plugin. These mirror the backend
// API contract exactly (GET /v1/ads/serve, POST /v1/impressions) so the plugin
// stays a thin client over the same contract the other adapters use.

// Ad is the served creative returned by GET /v1/ads/serve.
export interface Ad {
  ad_id: string
  sentence: string
  domain: string
  // Full advertiser destination URL (path + query preserved, e.g. UTM tags).
  // Optional so an older backend that omits it still deserializes.
  website_url?: string
  impression_token: string
  rotate_seconds: number
}

// EarningCapped is returned by GET /v1/ads/serve (200) when the publisher has hit
// their hourly/daily earning limit. No ad is served; `try_again_at` is the ISO-8601
// UTC time the cap resets, so the client stops calling serve until then. Nothing is
// rendered, billed, or credited.
export interface EarningCapped {
  earning_capped: true
  try_again_at: string
}

// ServeResult is what the client's serve() resolves to: an ad to show, an
// earning-capped signal, or null (empty inventory).
export type ServeResult = Ad | EarningCapped | null

// isEarningCapped narrows a ServeResult to the earning-capped signal.
export function isEarningCapped(r: ServeResult): r is EarningCapped {
  return r !== null && (r as EarningCapped).earning_capped === true
}

// Impression is the payload posted to POST /v1/impressions. Money/credit is
// decided server-side; the client only reports display facts. Optional fields are
// omitted when empty so the backend treats them as absent.
export interface Impression {
  impression_token: string
  displayed_ms: number
  session_id?: string
  session_duration_ms?: number
  plugin_version?: string
  cli?: string
  cli_version?: string
}

// Shared wire types for the VibePerks OpenCode plugin. These mirror the backend
// API contract exactly (GET /v1/ads/serve, POST /v1/impressions) so the plugin
// stays a thin client over the same contract the other adapters use.

// Ad is the served creative returned by GET /v1/ads/serve.
export interface Ad {
  ad_id: string
  sentence: string
  domain: string
  impression_token: string
  rotate_seconds: number
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

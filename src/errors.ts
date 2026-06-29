// UnauthorizedError means the device token was rejected (401/403). Retrying with
// the same token will not help; the user must re-link the device.
export class UnauthorizedError extends Error {
  constructor() {
    super("device token unauthorized")
    this.name = "UnauthorizedError"
  }
}

// RejectedError means the backend permanently refused an impression (a 4xx other
// than auth, e.g. an expired or malformed token). Such impressions are dropped,
// not retried.
export class RejectedError extends Error {
  constructor() {
    super("impression rejected")
    this.name = "RejectedError"
  }
}

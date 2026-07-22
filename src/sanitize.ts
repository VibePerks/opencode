import type { Ad } from "./types"

// Server ad copy is untrusted at the terminal boundary: every C0 control byte
// (incl. ESC, tab, newline) and DEL is stripped so it can never emit escape
// sequences when rendered into the OpenCode TUI footer.
const CONTROL = /[\u0000-\u001f\u007f]/g

// sanitize strips control bytes and trims whitespace from untrusted server copy
// before it is ever cached or rendered.
export function sanitize(s: string): string {
  return s.replace(CONTROL, "").trim()
}

// renderLine formats an ad as a single plain-text line. The advertiser domain leads
// the line, followed by the sentence ("<domain> - <sentence>"); when the sentence
// already contains the domain it is rendered as-is.
export function renderLine(ad: Ad): string {
  const sentence = sanitize(ad.sentence)
  const domain = sanitize(ad.domain)
  if (domain && !sentence.includes(domain)) {
    return `${domain} - ${sentence}`.trim()
  }
  return sentence
}

// loginNotice is the sign-in line shown in place of an ad when the device token was
// rejected. It tells the user that authentication failed (with the reason, when known)
// and how to fix it. loginCmd is the CLI login command that writes the shared config
// the plugin reads (default "vibeperks login").
export function loginNotice(reason = "", loginCmd = "vibeperks login"): string {
  const cleanReason = sanitize(reason)
  const cmd = sanitize(loginCmd)
  const notice = cleanReason ? `VibePerks: ${cleanReason}` : "VibePerks: sign-in required"
  return cmd ? `${notice} - run: ${cmd}` : notice
}

import { describe, expect, it } from "vitest"
import { loginNotice, renderLine, sanitize } from "../src/sanitize"
import type { Ad } from "../src/types"

function ad(over: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Get paid while vibe coding - VibePerks.ai",
    domain: "VibePerks.ai",
    impression_token: "t1",
    rotate_seconds: 20,
    ...over,
  }
}

describe("sanitize", () => {
  it("strips C0 control bytes and DEL", () => {
    expect(sanitize("a\u0000b\u001bc\u007fd\te")).toBe("abcde")
  })

  it("strips newlines and trims surrounding whitespace", () => {
    expect(sanitize("  hello\nworld  ")).toBe("helloworld")
  })

  it("leaves clean text unchanged", () => {
    expect(sanitize("clean text")).toBe("clean text")
  })

  it("preserves legitimate unicode (accents)", () => {
    expect(sanitize("APIs rápidas")).toBe("APIs rápidas")
  })
})

describe("renderLine", () => {
  it("returns the sentence when it already ends in the domain", () => {
    expect(renderLine(ad())).toBe("Get paid while vibe coding - VibePerks.ai")
  })

  it("appends the domain defensively when missing from the sentence", () => {
    expect(renderLine(ad({ sentence: "Get paid while vibe coding", domain: "VibePerks.ai" }))).toBe(
      "VibePerks.ai - Get paid while vibe coding",
    )
  })

  it("returns just the sentence when the domain is empty", () => {
    expect(renderLine(ad({ sentence: "Just a sentence", domain: "" }))).toBe("Just a sentence")
  })

  it("sanitizes control bytes injected into the sentence or domain", () => {
    expect(renderLine(ad({ sentence: "evil\u001b[31m", domain: "x.com" }))).toBe("x.com - evil[31m")
  })
})

describe("loginNotice", () => {
  it("includes the sign-in prompt and the default login command", () => {
    const got = loginNotice()
    expect(got).toContain("VibePerks")
    expect(got).toContain("vibeperks login")
  })

  it("surfaces the rejection reason when given", () => {
    const got = loginNotice("account suspended")
    expect(got).toContain("account suspended")
    expect(got).toContain("vibeperks login")
  })

  it("uses a custom login command when given", () => {
    expect(loginNotice("", "vibeperks-x login")).toContain("run: vibeperks-x login")
  })

  it("omits the run hint when the command is empty", () => {
    expect(loginNotice("", "")).not.toContain("run:")
  })
})

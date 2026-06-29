import { describe, expect, it } from "vitest"
import { renderLine, sanitize } from "../src/sanitize"
import type { Ad } from "../src/types"

function ad(over: Partial<Ad> = {}): Ad {
  return {
    ad_id: "a1",
    sentence: "Fast APIs for every chain - alchemy.com",
    domain: "alchemy.com",
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
    expect(renderLine(ad())).toBe("Fast APIs for every chain - alchemy.com")
  })

  it("appends the domain defensively when missing from the sentence", () => {
    expect(renderLine(ad({ sentence: "Fast APIs for every chain", domain: "alchemy.com" }))).toBe(
      "Fast APIs for every chain - alchemy.com",
    )
  })

  it("returns just the sentence when the domain is empty", () => {
    expect(renderLine(ad({ sentence: "Just a sentence", domain: "" }))).toBe("Just a sentence")
  })

  it("sanitizes control bytes injected into the sentence or domain", () => {
    expect(renderLine(ad({ sentence: "evil\u001b[31m", domain: "x.com" }))).toBe("evil[31m - x.com")
  })
})

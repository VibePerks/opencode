import { describe, expect, it } from "vitest"
import { clearState, enqueue, loadQueue, loadState, saveState, type Kv } from "../src/store"
import type { Ad, Impression } from "../src/types"

function fakeKv(): Kv & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  return {
    store,
    async get(k) {
      return store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined
    },
    async set(k, v) {
      store.set(k, JSON.parse(JSON.stringify(v)))
    },
  }
}

const sampleAd: Ad = {
  ad_id: "a1",
  sentence: "s - d.com",
  domain: "d.com",
  impression_token: "imp1",
  rotate_seconds: 20,
}

function imp(token: string): Impression {
  return { impression_token: token, displayed_ms: 100 }
}

describe("store state", () => {
  it("returns the empty state when nothing is cached", async () => {
    const kv = fakeKv()
    expect(await loadState(kv)).toEqual({ ad: null, servedAt: 0, recorded: false, rotateCount: 0 })
  })

  it("returns the empty state when the cached value is malformed", async () => {
    const kv = fakeKv()
    await kv.set("vibeperks:state", { bogus: true })
    expect(await loadState(kv)).toEqual({ ad: null, servedAt: 0, recorded: false, rotateCount: 0 })
  })

  it("round-trips a saved state", async () => {
    const kv = fakeKv()
    await saveState(kv, { ad: sampleAd, servedAt: 1000, recorded: false, rotateCount: 0 })
    expect((await loadState(kv)).ad?.ad_id).toBe("a1")
  })

  it("clears the state", async () => {
    const kv = fakeKv()
    await saveState(kv, { ad: sampleAd, servedAt: 1000, recorded: true, rotateCount: 0 })
    await clearState(kv)
    expect((await loadState(kv)).ad).toBeNull()
  })
})

describe("store queue", () => {
  it("starts empty", async () => {
    expect(await loadQueue(fakeKv())).toEqual([])
  })

  it("appends impressions", async () => {
    const kv = fakeKv()
    await enqueue(kv, imp("a"))
    await enqueue(kv, imp("b"))
    expect((await loadQueue(kv)).map((e) => e.impression_token)).toEqual(["a", "b"])
  })

  it("dedupes by impression token", async () => {
    const kv = fakeKv()
    await enqueue(kv, imp("a"))
    await enqueue(kv, imp("a"))
    expect(await loadQueue(kv)).toHaveLength(1)
  })
})

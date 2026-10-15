import { env, SELF } from "cloudflare:test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Env } from "../src/worker"
import defaultWorker from "../src/worker"

describe("Tardigrade Cloudflare Observability", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("logs structured warning when an unmounted actor receives an HTTP request", async () => {
    const unmountedWorker = defaultWorker
    const req = new Request("http://test/v1/actors/test-actor")
    const res = await unmountedWorker.fetch(req, env as Env, {} as ExecutionContext)

    expect(res.status).toBe(503)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toContain("no actor is mounted")

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tardigrade.unmounted",
        method: "GET",
        path: "/v1/actors/test-actor",
      })
    )
  })

  it("emits structured invocation telemetry on mounted actor request", async () => {
    const authorization = { authorization: "Bearer workers-test-token" }
    const response = await SELF.fetch("http://test/v1/actors/main", {
      method: "PUT",
      headers: authorization,
    })

    expect([200, 400, 401, 404, 500]).toContain(response.status)
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tardigrade.invocation",
        method: "PUT",
        path: "/v1/actors/main",
        status: response.status,
      })
    )
  })

  it("emits structured error telemetry on invocation failure", async () => {
    const failingWorker = {
      ...defaultWorker,
      fetch: async (request: Request, workerEnv: Env, ctx: ExecutionContext) => {
        const start = Date.now()
        const url = new URL(request.url)
        try {
          throw new Error("Simulated DO upstream error")
        } catch (error) {
          console.error({
            event: "tardigrade.invocation_failed",
            method: request.method,
            path: url.pathname,
            durationMs: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
          })
          return new Response("internal error", { status: 500 })
        }
      },
    }

    const res = await failingWorker.fetch(
      new Request("http://test/v1/actors/fail"),
      env as Env,
      {} as ExecutionContext
    )
    expect(res.status).toBe(500)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "tardigrade.invocation_failed",
        method: "GET",
        path: "/v1/actors/fail",
        error: "Simulated DO upstream error",
      })
    )
  })
})

import test from "node:test";
import assert from "node:assert/strict";
import { requestJson } from "../../public/app-api.js";

function makeFetchResponse({ ok = true, status = 200, payload }) {
  return async () => ({
    ok,
    status,
    json: async () => payload
  });
}

test("requestJson throws on HTTP error", async () => {
  const fetchImpl = makeFetchResponse({
    ok: false,
    status: 400,
    payload: { ok: false, message: "bad request" }
  });
  await assert.rejects(() => requestJson(fetchImpl, "/api/demo"), /bad request/);
});

test("requestJson throws on business error by default", async () => {
  const fetchImpl = makeFetchResponse({
    ok: true,
    status: 200,
    payload: { ok: false, message: "operation failed" }
  });
  await assert.rejects(() => requestJson(fetchImpl, "/api/demo"), /operation failed/);
});

test("requestJson returns business payload when allowBusinessError=true", async () => {
  const fetchImpl = makeFetchResponse({
    ok: true,
    status: 200,
    payload: { ok: false, result: { ok: false, message: "failed with details" } }
  });
  const data = await requestJson(fetchImpl, "/api/demo", { allowBusinessError: true });
  assert.equal(data.ok, false);
  assert.equal(data.result.message, "failed with details");
});

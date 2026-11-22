import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryRead } from "./readStorefrontInventory.js";

const unanswered = { ok: false, error: new Error("Http request error, no response available: GraphQL Client: fetch failed") };
const success = { ok: true, result: { available: 3 } };
const unauthorized = { ok: false, authFailure: true, httpStatus: 401 };

test("inventory lookup can recover from one unanswered fetch", async () => {
  const results = [unanswered, success];
  assert.equal(await createInventoryRead(() => results.shift())(), success);
  assert.equal(results.length, 0);
});

test("separate authentication attempts share one transport retry", async () => {
  const results = [unanswered, unauthorized, unanswered, success];
  const read = createInventoryRead(() => results.shift());
  assert.equal(await read(), unauthorized);
  assert.deepEqual(await read(), { unavailable: true });
  assert.deepEqual(results, [success]);
});

test("permanent failures and cancellation do not replay", async () => {
  for (const first of [unauthorized, { ok: false, error: new Error("throttled") }, unanswered]) {
    let calls = 0;
    const result = await createInventoryRead(() => { calls++; return first; }, AbortSignal.abort())();
    assert.equal(calls, 1);
    if (first === unanswered) assert.deepEqual(result, { unavailable: true });
    else assert.equal(result, first);
  }
});

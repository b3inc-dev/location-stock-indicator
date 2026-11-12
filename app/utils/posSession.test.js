/* eslint-env node */
import {test} from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import {verifySessionToken} from "./posSession.server.js";

function token(payload, secret) {
  const header = Buffer.from(JSON.stringify({alg: "HS256", typ: "JWT"})).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

test("session tokens are accepted only for the configured app and shop", () => {
  const now = Date.parse("2026-11-11T00:00:00.000Z");
  const payload = {
    aud: "key",
    dest: "https://ciara.myshopify.com",
    exp: Math.floor(now / 1000) + 60,
    nbf: Math.floor(now / 1000) - 10,
  };
  const result = verifySessionToken(token(payload, "secret"), "key", "secret", now);
  assert.equal(result.shop, "ciara.myshopify.com");
  assert.throws(() => verifySessionToken(token(payload, "other"), "key", "secret", now), /認証/);
  assert.throws(() => verifySessionToken(token({...payload, exp: Math.floor(now / 1000) - 1}, "secret"), "key", "secret", now), /認証/);
});

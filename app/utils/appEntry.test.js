import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appEntryRedirectPath } from "./appEntry.js";

describe("appEntryRedirectPath", () => {
  it("sends Shopify admin launches to /app with the same query", () => {
    assert.equal(
      appEntryRedirectPath(new URL("https://x.test/?shop=a.myshopify.com&host=abc")),
      "/app?shop=a.myshopify.com&host=abc",
    );
    assert.equal(appEntryRedirectPath(new URL("https://x.test/?host=abc")), "/app?host=abc");
    assert.equal(appEntryRedirectPath(new URL("https://x.test/?embedded=1")), "/app?embedded=1");
  });

  it("returns null when the shop is unknown", () => {
    assert.equal(appEntryRedirectPath(new URL("https://x.test/")), null);
    assert.equal(appEntryRedirectPath(new URL("https://x.test/?shop=")), null);
    assert.equal(appEntryRedirectPath(new URL("https://x.test/?utm_source=x")), null);
  });
});

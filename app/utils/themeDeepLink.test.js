import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildThemeAppBlockDeepLink } from "./themeDeepLink.js";

describe("buildThemeAppBlockDeepLink", () => {
  it("opens the product template with the app block in a new apps section", () => {
    const url = new URL(buildThemeAppBlockDeepLink("sample-store.myshopify.com", "abc123"));
    assert.equal(url.origin, "https://sample-store.myshopify.com");
    assert.equal(url.pathname, "/admin/themes/current/editor");
    assert.equal(url.searchParams.get("template"), "product");
    assert.equal(url.searchParams.get("addAppBlockId"), "abc123/location-stock-indicator");
    assert.equal(url.searchParams.get("target"), "newAppsSection");
  });

  it("returns null without an API key so the page shows the manual steps only", () => {
    assert.equal(buildThemeAppBlockDeepLink("sample-store.myshopify.com", ""), null);
    assert.equal(buildThemeAppBlockDeepLink("sample-store.myshopify.com", undefined), null);
  });

  it("does not build a link to a host that is not a myshopify.com shop", () => {
    assert.equal(buildThemeAppBlockDeepLink("evil.example.com", "abc123"), null);
    assert.equal(buildThemeAppBlockDeepLink("sample-store.myshopify.com.evil.example", "abc123"), null);
    assert.equal(buildThemeAppBlockDeepLink("", "abc123"), null);
  });
});

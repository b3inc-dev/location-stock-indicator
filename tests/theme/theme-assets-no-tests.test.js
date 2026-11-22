import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// テーマ拡張の assets は `shopify app deploy` で CDN に公開されるので、
// テスト用のファイルを置かない（テストは tests/ に置く）。
const EXTENSIONS_DIR = fileURLToPath(
  new URL("../../extensions/", import.meta.url)
);

describe("theme extension assets", () => {
  it("does not contain test files", () => {
    const found = [];
    for (const ext of readdirSync(EXTENSIONS_DIR, { withFileTypes: true })) {
      if (!ext.isDirectory()) continue;
      let names = [];
      try {
        names = readdirSync(`${EXTENSIONS_DIR}${ext.name}/assets`);
      } catch {
        continue;
      }
      for (const name of names) {
        if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) {
          found.push(`${ext.name}/assets/${name}`);
        }
      }
    }
    assert.deepEqual(found, []);
  });
});

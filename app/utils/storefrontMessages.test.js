import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { STOREFRONT_UNAVAILABLE_MESSAGE } from "./storefrontMessages.js";

const route = readFileSync(new URL("../routes/apps.location-stock.js", import.meta.url), "utf8");

// errorJson("code", "文") の文だけを拾う（ログの文は対象外）
function storefrontLiteralMessages(src) {
  const out = [];
  const re = /errorJson\(\s*("[^"]+"|[A-Z_]+)\s*,\s*("([^"]*)"|[A-Z_.a-z]+)/g;
  let m;
  while ((m = re.exec(src))) if (m[3] !== undefined) out.push(m[3]);
  return out;
}

describe("storefront failure messages", () => {
  it("is a plain display error", () => {
    assert.equal(STOREFRONT_UNAVAILABLE_MESSAGE, "在庫情報を表示できません。");
  });

  it("never tells shoppers about plans, settings, the admin or re-authorization", () => {
    const literals = storefrontLiteralMessages(route);
    assert.ok(literals.length > 0);
    for (const text of literals) {
      assert.doesNotMatch(text, /プラン|管理画面|再認可|設定|API|Pro|Lite/, text);
    }
  });

  it("uses the shared message for plan_required and re-authorization", () => {
    for (const code of ["plan_required", "session_reauth_required", "missing_admin_client"]) {
      const re = new RegExp(`errorJson\\(\\s*"${code}",\\s*STOREFRONT_UNAVAILABLE_MESSAGE`);
      assert.match(route, re, code);
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyAppProxyThrown } from "./appProxyThrown.js";

const SECRET_BODY =
  "shop=synthetic.example&signature=deadbeef&logged_in_customer_id=9&variant_id=1001";

describe("classifyAppProxyThrown", () => {
  it("keeps a thrown Response as the expected response and logs status only", async () => {
    const response = new Response(SECRET_BODY, {
      status: 400,
      statusText: "Bad Request",
    });

    const classified = classifyAppProxyThrown(response);

    assert.equal(classified.kind, "expected_response");
    assert.equal(classified.response, response);
    assert.deepEqual(classified.log, { status: 400 });
    const logged = JSON.stringify(classified.log);
    assert.equal(logged.includes("signature"), false);
    assert.equal(logged.includes("deadbeef"), false);
    assert.equal(logged.includes("shop"), false);
    assert.equal(logged.includes("variant_id"), false);
    assert.equal(logged.includes("logged_in_customer_id"), false);
    assert.equal(await classified.response.text(), SECRET_BODY);
  });

  it("treats an Error as an unexpected failure and keeps its message", () => {
    const classified = classifyAppProxyThrown(new Error("database unavailable"));

    assert.equal(classified.kind, "unexpected");
    assert.equal(classified.message, "database unavailable");
    assert.equal(classified.logMessage, "database unavailable");
  });

  it("does not stringify a non-Error throw into the customer or log message", () => {
    const classified = classifyAppProxyThrown({
      url: "https://app.example/apps/location-stock?signature=deadbeef",
      shop: "synthetic.example",
    });

    assert.equal(classified.kind, "unexpected");
    assert.equal(classified.message, "在庫情報の取得中にエラーが発生しました。");
    assert.equal(classified.logMessage, "non_error");
    const logged = JSON.stringify({
      message: classified.message,
      logMessage: classified.logMessage,
    });
    assert.equal(logged.includes("signature"), false);
    assert.equal(logged.includes("deadbeef"), false);
    assert.equal(logged.includes("synthetic.example"), false);
    assert.equal(logged.includes("[object Object]"), false);
  });
});

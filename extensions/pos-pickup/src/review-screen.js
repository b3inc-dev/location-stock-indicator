import {reprocessSale, sameId} from "./logic.js";
import {adminRequest, button, screen, text} from "./admin.js";

const REVIEW_ORDERS = `query PosReviewOrders($query: String!) {
  orders(first: 25, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes { id name retailLocation { id } metafield(namespace: "location_stock", key: "review_reason") { value } }
  }
}`;

export function renderReview() {
  const list = screen("要確認");
  const status = text("読み込み中…", list);
  const results = document.createElement("s-stack");
  list.append(results);
  const reload = button("更新", list);
  const load = () => { void refresh(results, status); };
  reload.addEventListener("click", load);
  load();
}

async function refresh(results, status) {
  status.textContent = "読み込み中…";
  results.replaceChildren();
  try {
    const locationId = shopify.session.currentSession.locationId;
    const data = await adminRequest(REVIEW_ORDERS, {query: "tag:location-stock-review"});
    const rows = (data.orders?.nodes || []).filter((order) => sameId(order.retailLocation?.id, locationId));
    status.textContent = rows.length ? "" : "この店舗の要確認はありません。";
    for (const order of rows) {
      text(`${order.name} / ${order.metafield?.value || "再処理してください。"}`, results);
      const retry = button("再処理", results);
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        try {
          const result = await reprocessSale(adminRequest, order.id);
          text(result.message || "再処理しました。", results);
        } catch (error) {
          text(error.message || "再処理に失敗しました。", results);
        } finally {
          retry.disabled = false;
        }
      });
    }
  } catch (error) {
    status.textContent = error.message || "要確認を取得できませんでした。";
  }
}

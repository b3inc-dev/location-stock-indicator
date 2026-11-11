import {backendUrl, listReviewOrders, loadConfig} from "./logic.js";
import {adminRequest, button, screen, text} from "./admin.js";

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

async function retryOnServer(orderId) {
  const loaded = await loadConfig(adminRequest);
  const token = await shopify.session.getSessionToken();
  const response = await fetch(`${backendUrl(loaded.config)}/pos/operations`, {
    method: "POST",
    headers: {"Content-Type": "application/json", Authorization: `Bearer ${token}`},
    body: JSON.stringify({orderId}),
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 409 || payload.busy) {
    throw new Error(payload.message || "別の処理が進行中です。少し待って再処理してください。");
  }
  if (!response.ok) throw new Error(payload.message || "再処理に失敗しました。");
  return payload;
}

async function refresh(results, status) {
  status.textContent = "読み込み中…";
  results.replaceChildren();
  try {
    const locationId = shopify.session.currentSession.locationId;
    const {rows, complete} = await listReviewOrders(adminRequest, locationId);
    if (!rows.length && complete) status.textContent = "この店舗の要確認はありません。";
    else if (!rows.length) status.textContent = "要確認が多く、この店舗の一覧を最後まで確認できませんでした。更新してください。";
    else status.textContent = complete ? "" : "一部だけ表示しています。更新して続きを確認してください。";
    for (const order of rows) {
      text(`${order.name} / ${order.metafield?.value || "再処理してください。"}`, results);
      const retry = button("再処理", results);
      retry.addEventListener("click", async () => {
        retry.disabled = true;
        try {
          const result = await retryOnServer(order.id);
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

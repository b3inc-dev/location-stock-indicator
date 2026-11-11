import {pickupOrders, pickupDetails, preparePickup, completePickup} from "./pickup.js";
import {renderDelivery} from "./delivery-screen.js";
import {renderReview} from "./review-screen.js";

async function request(query, variables) {
  const response = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  if (!response.ok) throw new Error("注文の取得に失敗しました。");
  const payload = await response.json();
  if (payload.errors?.length || !payload.data) throw new Error("受取注文の参照権限と通信状態をご確認ください。");
  return payload.data;
}

export function renderPickup() {
  const page = document.createElement("s-page");
  page.setAttribute("heading", "店舗受取");
  const scroll = document.createElement("s-scroll-box");
  const list = document.createElement("s-stack");
  const button = document.createElement("s-button");
  button.textContent = "更新";
  scroll.append(list, button);
  page.append(scroll);
  document.body.replaceChildren(page);
  function line(message, parent = list) {
    const item = document.createElement("s-text");
    item.textContent = message;
    parent.append(item);
  }
  async function refresh() {
    if (button.disabled) return;
    button.disabled = true;
    list.replaceChildren();
    line("読み込み中…");
    try {
      const location = shopify.session.currentSession.locationId;
      const rows = await pickupOrders(location, request);
      if (location !== shopify.session.currentSession.locationId) throw new Error("店舗が切り替わりました。更新してください。");
      list.replaceChildren();
      if (!rows.length) line("この店舗の未完了の受取注文はありません。");
      const label = {OPEN: "準備待ち", IN_PROGRESS: "引渡待ち", ON_HOLD: "保留", SCHEDULED: "予定"};
      for (const row of rows) {
        const show = document.createElement("s-button");
        const detail = document.createElement("s-stack");
        show.textContent = row.orderName + "　" + label[row.status] + "　明細";
        show.addEventListener("click", async () => {
          show.disabled = true;
          detail.replaceChildren();
          line("明細を読み込み中…", detail);
          try {
            const items = await pickupDetails(row.id, location, request);
            if (location !== shopify.session.currentSession.locationId) throw new Error("店舗が変わりました。一覧を更新してください。");
            detail.replaceChildren();
            if (!items.length) line("残りの商品はありません。", detail);
            for (const item of items) {
              const name = [item.productTitle, item.variantTitle, item.sku].filter(Boolean).join(" / ");
              line(name + "　" + item.remainingQuantity + "点", detail);
            }
            if (row.status === "ON_HOLD" || row.status === "SCHEDULED") {
              line("この状態では操作できません。", detail);
            } else if (row.status === "OPEN" || row.status === "IN_PROGRESS") {
              const action = document.createElement("s-button");
              action.textContent = row.status === "OPEN" ? "準備完了" : "引渡完了";
              action.addEventListener("click", async () => {
                action.disabled = true;
                try {
                  const result = row.status === "OPEN"
                    ? await preparePickup(row.id, location, request)
                    : await completePickup(row.id, location, request);
                  detail.replaceChildren();
                  line(result.already ? "最新の状態を確認しました。再送信はしていません。" : (row.status === "OPEN" ? "準備完了の通知を送りました。" : "引渡完了を記録しました。"), detail);
                  await refresh();
                } catch (error) {
                  line(error.message || "更新できませんでした。もう一度操作してください。", detail);
                } finally {
                  action.disabled = false;
                }
              });
              detail.append(action);
            }
          } catch (error) {
            detail.replaceChildren();
            line(error.message || "明細を取得できませんでした。", detail);
          } finally {
            show.disabled = false;
          }
        });
        list.append(show, detail);
      }
    } catch (error) {
      list.replaceChildren();
      line(error.message || "受取注文を取得できませんでした。");
    } finally {
      button.disabled = false;
    }
  }
  button.addEventListener("click", refresh);
  void refresh();
}

export default async function () {
  let mode = "pickup";
  try {
    mode = (await shopify.storage.get("lsi-mode")) || "pickup";
  } catch {
    mode = "pickup";
  }
  if (mode === "delivery") renderDelivery();
  else if (mode === "review") renderReview();
  else renderPickup();
}

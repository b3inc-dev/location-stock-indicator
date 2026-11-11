import {pickupOrders} from "./pickup.js";

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

export default function () {
  const page = document.createElement("s-page");
  page.setAttribute("heading", "店舗受取");
  const scroll = document.createElement("s-scroll-box");
  const list = document.createElement("s-stack");
  const button = document.createElement("s-button");
  button.textContent = "更新";
  scroll.append(list, button);
  page.append(scroll);
  document.body.replaceChildren(page);
  function line(message) {
    const item = document.createElement("s-text");
    item.textContent = message;
    list.append(item);
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
      const label = {OPEN: "未完了", IN_PROGRESS: "処理中", ON_HOLD: "保留", SCHEDULED: "予定"};
      for (const row of rows) line(row.orderName + "　" + label[row.status]);
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

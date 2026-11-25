// ホームのタイル。押すと受取待ちと配送の分けの画面（modal.js）を開く。
// カートに配送の指定があるときは、配送の点数を出す（会計の前の確かめ用）。
import { loadState } from "./api.js";
import { cartShipCount } from "./logic.js";

export default async function () {
  const tile = document.createElement("s-tile");
  tile.setAttribute("heading", "店頭受取・配送");
  tile.setAttribute("subheading", "受取待ちと配送の分け");
  tile.addEventListener("click", () => shopify.action.presentModal());
  document.body.replaceChildren(tile);
  let allowed = true;
  try {
    const { access, config } = await loadState();
    allowed = access.allowed;
    if (!access.allowed) tile.setAttribute("subheading", "Pro プランで使えます");
    else if (!config.pickupEnabled && !config.deliveryEnabled) tile.setAttribute("subheading", "管理画面でオフになっています");
  } catch {
    tile.setAttribute("subheading", "通信を確かめてください");
  }
  if (!allowed) return;
  try {
    const show = (cart) => {
      const count = cartShipCount(cart);
      if (count > 0) tile.setAttribute("subheading", `このカートは配送 ${count} 点`);
    };
    show(shopify.cart.current.value);
    shopify.cart.current.subscribe(show);
  } catch {
    // カートを読めない POS の版では、点数を出さない
  }
}

import {
  RECEPTION_ATTRIBUTE,
  deliveryAvailable,
  feeSync,
  loadConfig,
  loadPlan,
  recalculatePlan,
  sameId,
  savePlan,
} from "./logic.js";
import {adminRequest} from "./admin.js";

let syncing = false;

async function applyFee(action) {
  for (const uuid of action.remove) {
    if (uuid) await shopify.cart.removeLineItem(uuid);
  }
  if (action.add) await shopify.cart.addCustomSale(action.add);
}

async function syncFromCart() {
  if (syncing) return;
  let lock = 0;
  try {
    lock = Number(await shopify.storage.get("lsi-fee-lock") || 0);
  } catch {
    lock = 0;
  }
  if (lock > Date.now()) return;
  const cart = shopify.cart.current.value;
  const id = cart.properties?.[RECEPTION_ATTRIBUTE];
  if (!id) return;
  syncing = true;
  try {
    const loaded = await loadConfig(adminRequest);
    const plan = await loadPlan(adminRequest, id);
    if (!plan || plan.status === "cancelled") {
      if (plan?.status === "cancelled") {
        const action = feeSync(cart.lineItems, plan.shippingTitle, 0);
        if (action.remove.length || action.add) await applyFee(action);
      }
      return;
    }
    const next = recalculatePlan(plan, (cart.lineItems || []).filter((line) => line.variantId));
    const changed = JSON.stringify(next.lines) !== JSON.stringify(plan.lines) || next.feeAmount !== plan.feeAmount || next.status !== plan.status;
    if (changed) await savePlan(adminRequest, loaded.shopId, next);
    const action = feeSync(shopify.cart.current.value.lineItems, next.shippingTitle, next.feeAmount);
    if (action.remove.length || action.add) await applyFee(action);
  } catch {
    // 通信が戻ったあとのカート変更で再計算する。
  } finally {
    syncing = false;
  }
}

export default async function () {
  const tile = document.createElement("s-tile");
  tile.setAttribute("heading", "店舗配送");
  tile.setAttribute("subheading", "会計前に配送を確定");
  tile.addEventListener("click", async () => {
    try { await shopify.storage.set("lsi-mode", "delivery"); } catch { /* モーダルはモードを読めない場合、受取を開く */ }
    shopify.action.presentModal();
  });
  document.body.replaceChildren(tile);
  try {
    const loaded = await loadConfig(adminRequest);
    const row = (loaded.config.locations || []).find((item) => sameId(item.locationId, shopify.session.currentSession.locationId));
    if (!deliveryAvailable(row, new Date().toISOString())) tile.setAttribute("subheading", "この店舗では使いません");
  } catch {
    tile.setAttribute("subheading", "設定を確認してください");
  }
  try {
    shopify.cart.current.subscribe(() => { void syncFromCart(); });
  } catch {
    // カートの購読が無いPOSでは、確定時の送料だけを反映する。
  }
}

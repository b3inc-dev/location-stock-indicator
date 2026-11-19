import {
  RECEPTION_ATTRIBUTE,
  createCartSync,
  deliveryAvailable,
  feeSync,
  loadConfig,
  loadPlan,
  recalculatePlan,
  sameId,
  savePlan,
} from "./logic.js";
import {loadPosAccess, requirePosAccess} from "./access.js";
import {adminRequest} from "./admin.js";

async function applyFee(action) {
  for (const uuid of action.remove) {
    if (uuid) await shopify.cart.removeLineItem(uuid);
  }
  if (action.add) await shopify.cart.addCustomSale(action.add);
}

async function syncOnce() {
  let lock = 0;
  try {
    lock = Number(await shopify.storage.get("lsi-fee-lock") || 0);
  } catch {
    lock = 0;
  }
  if (lock > Date.now()) return;
  try {
    await requirePosAccess();
  } catch {
    return;
  }
  const cart = shopify.cart.current.value;
  const id = cart.properties?.[RECEPTION_ATTRIBUTE];
  if (!id) return;
  try {
    const loaded = await loadConfig(adminRequest);
    const plan = await loadPlan(adminRequest, id);
    const latest = shopify.cart.current.value;
    if (!plan || plan.status === "cancelled") {
      if (plan?.status === "cancelled") {
        const action = feeSync(latest.lineItems, plan.shippingTitle, 0);
        if (action.remove.length || action.add) await applyFee(action);
      }
      return;
    }
    const next = recalculatePlan(plan, (latest.lineItems || []).filter((line) => line.variantId));
    const changed = JSON.stringify(next.lines) !== JSON.stringify(plan.lines) || next.feeAmount !== plan.feeAmount || next.status !== plan.status;
    if (changed) await savePlan(adminRequest, loaded.shopId, next);
    const action = feeSync(shopify.cart.current.value.lineItems, next.shippingTitle, next.feeAmount);
    if (action.remove.length || action.add) await applyFee(action);
  } catch {
    // 通信が戻ったあとのカート変更で再計算する。
  }
}

const scheduleSync = createCartSync(syncOnce);

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
    const access = await loadPosAccess();
    if (!access.allowed) {
      tile.setAttribute("subheading", "Proプランで利用できます");
      return;
    }
    const loaded = await loadConfig(adminRequest);
    const row = (loaded.config.locations || []).find((item) => sameId(item.locationId, shopify.session.currentSession.locationId));
    if (!deliveryAvailable(row, new Date().toISOString())) tile.setAttribute("subheading", "この店舗では使いません");
  } catch {
    tile.setAttribute("subheading", "設定を確認してください");
  }
  try {
    shopify.cart.current.subscribe(() => { void scheduleSync(); });
  } catch {
    // カートの購読が無いPOSでは、確定時の送料だけを反映する。
  }
}

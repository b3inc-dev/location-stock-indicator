import {
  RECEPTION_ATTRIBUTE,
  createPlan,
  deliveryAvailable,
  feeSync,
  loadConfig,
  loadPlan,
  newReceptionId,
  sameId,
  savePlan,
} from "./logic.js";
import {adminRequest, button, field, readField, screen, text} from "./admin.js";

async function applyFee(action) {
  for (const uuid of action.remove) {
    if (uuid) await shopify.cart.removeLineItem(uuid);
  }
  if (action.add) await shopify.cart.addCustomSale(action.add);
}

export function renderDelivery() {
  const list = screen("店舗配送");
  const status = text("読み込み中…", list);
  void open(list, status);
}

async function open(list, status) {
  try {
    if (shopify.connectivity?.current?.value?.internetConnected === false) {
      status.textContent = "通信できないため、配送を確定できません。";
      return;
    }
    const loaded = await loadConfig(adminRequest);
    const locationId = shopify.session.currentSession.locationId;
    const row = (loaded.config.locations || []).find((item) => sameId(item.locationId, locationId));
    if (!deliveryAvailable(row, new Date().toISOString())) {
      status.textContent = "この店舗では配送を使わない設定です。通常の会計を続けてください。";
      return;
    }
    const cart = shopify.cart.current.value;
    const products = (cart.lineItems || []).filter((line) => line.variantId);
    if (!products.length) {
      status.textContent = "カートに商品がありません。";
      return;
    }
    list.replaceChildren();
    text("同じ商品でも、持ち帰る数量と配送する数量を分けられます。", list);
    const quantities = new Map(products.map((line) => [line.uuid, 0]));
    const fee = text("", list);
    const refreshFee = () => {
      const total = [...quantities.values()].reduce((sum, value) => sum + value, 0);
      fee.textContent = `送料 ${total > 0 ? row.shippingFee : 0}円`;
    };
    for (const line of products) {
      const name = [line.title, line.sku].filter(Boolean).join(" / ");
      const label = text(`${name} / カート${line.quantity} / 配送0`, list);
      const minus = button("配送を減らす", list);
      const plus = button("配送を増やす", list);
      const update = (delta) => {
        const next = Math.min(line.quantity, Math.max(0, (quantities.get(line.uuid) || 0) + delta));
        quantities.set(line.uuid, next);
        label.textContent = `${name} / カート${line.quantity} / 配送${next}`;
        refreshFee();
      };
      minus.addEventListener("click", () => update(-1));
      plus.addEventListener("click", () => update(1));
    }
    refreshFee();
    const address = {
      lastName: field("姓", list),
      firstName: field("名", list),
      zip: field("郵便番号", list),
      province: field("都道府県", list),
      city: field("市区町村", list),
      address1: field("住所", list),
      address2: field("建物名", list),
      phone: field("電話番号", list),
    };
    const confirm = button("配送を確定", list);
    confirm.addEventListener("click", async () => {
      confirm.disabled = true;
      try {
        const latest = shopify.cart.current.value;
        const created = createPlan({
          id: newReceptionId(),
          address: {
            lastName: readField(address.lastName),
            firstName: readField(address.firstName),
            zip: readField(address.zip),
            province: readField(address.province),
            city: readField(address.city),
            address1: readField(address.address1),
            address2: readField(address.address2),
            phone: readField(address.phone),
            countryCode: "JP",
          },
          lines: (latest.lineItems || []).filter((line) => line.variantId).map((line) => ({
            uuid: line.uuid,
            variantId: line.variantId,
            sku: line.sku || "",
            title: line.title || "",
            quantity: line.quantity,
            deliveryQuantity: quantities.get(line.uuid) || 0,
          })),
        }, row);
        if (created.error) throw new Error(created.error);
        await savePlan(adminRequest, loaded.shopId, created.plan);
        await shopify.cart.addCartProperties({[RECEPTION_ATTRIBUTE]: created.plan.id});
        if (latest.customer) {
          try {
            await shopify.cart.addAddress({
              address1: created.plan.address.address1,
              address2: created.plan.address.address2,
              city: created.plan.address.city,
              zip: created.plan.address.zip,
              firstName: created.plan.address.firstName,
              lastName: created.plan.address.lastName,
              phone: created.plan.address.phone,
              countryCode: created.plan.address.countryCode,
              provinceCode: created.plan.address.provinceCode,
            });
          } catch {
            // 顧客住所へ追加できなくても、会計後に出荷先として保存する。
          }
        }
        await shopify.storage.set("lsi-fee-lock", String(Date.now() + 5000));
        await applyFee(feeSync(shopify.cart.current.value.lineItems, created.plan.shippingTitle, created.plan.feeAmount));
        await shopify.storage.set("lsi-fee-lock", "0");
        text("配送を確定しました。数量を変えた場合は送料を計算し直します。", list);
      } catch (error) {
        text(error.message || "配送を確定できませんでした。", list);
      } finally {
        confirm.disabled = false;
      }
    });
    const cancel = button("配送を取り消す", list);
    cancel.addEventListener("click", async () => {
      cancel.disabled = true;
      try {
        const current = shopify.cart.current.value;
        const id = current.properties?.[RECEPTION_ATTRIBUTE];
        const plan = id ? await loadPlan(adminRequest, id) : null;
        if (plan) {
          await savePlan(adminRequest, loaded.shopId, {...plan, status: "cancelled", lines: [], feeAmount: 0});
        }
        if (id) await shopify.cart.removeCartProperties([RECEPTION_ATTRIBUTE]);
        await applyFee(feeSync(shopify.cart.current.value.lineItems, row.shippingTitle, 0));
        text("配送を取り消しました。", list);
      } catch (error) {
        text(error.message || "配送を取り消せませんでした。", list);
      } finally {
        cancel.disabled = false;
      }
    });
  } catch (error) {
    status.textContent = error.message || "配送設定を取得できませんでした。";
  }
}

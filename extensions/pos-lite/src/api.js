// POS の拡張から Admin GraphQL を呼ぶ（Direct API access。POS 10.6 以降・拡張の api_version 2025-07 以降）。
// 権限はアプリの toml の scopes。通信が無いときは動かない。
import { POS_ACCESS_QUERY, CONFIG_NAMESPACE, CONFIG_KEY, accessFromInstallation, parseConfig } from "./logic.js";

export async function adminRequest(query, variables = {}) {
  let response;
  try {
    response = await fetch("shopify:admin/api/graphql.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
  } catch {
    throw new Error("通信できませんでした。ネットにつながっているか確かめてください。");
  }
  if (!response.ok) throw new Error(`Shopify に断られました（${response.status}）。もう一度押してください。`);
  const payload = await response.json();
  if (payload?.errors?.length || !payload?.data) {
    const reason = String(payload?.errors?.[0]?.message || "応答が空").slice(0, 80);
    throw new Error(`Shopify の API で失敗しました（${reason}）。アプリの権限が更新されているか確かめてください。`);
  }
  return payload.data;
}

const CONFIG_QUERY = `query PosLiteConfig { shop { metafield(namespace: "${CONFIG_NAMESPACE}", key: "${CONFIG_KEY}") { value } } }`;

/** プランと設定をまとめて読む。 */
export async function loadState() {
  const [accessData, configData] = await Promise.all([adminRequest(POS_ACCESS_QUERY), adminRequest(CONFIG_QUERY)]);
  const access = accessFromInstallation({
    apiKey: accessData.currentAppInstallation?.app?.apiKey,
    partnerDevelopment: accessData.shop?.plan?.partnerDevelopment,
    subscriptions: accessData.currentAppInstallation?.activeSubscriptions,
  });
  return { access, config: parseConfig(configData.shop?.metafield?.value) };
}

export function currentLocationId() {
  return String(shopify.session.currentSession.locationId || "");
}

// ---- 画面の部品（POS の s- 部品。本文は標準の余白で囲む。UI ルール 11章） ----

export function screen(heading) {
  const page = document.createElement("s-page");
  page.setAttribute("heading", heading);
  const scroll = document.createElement("s-scroll-box");
  const box = document.createElement("s-box");
  box.setAttribute("padding", "base");
  const stack = document.createElement("s-stack");
  stack.setAttribute("gap", "base");
  box.append(stack);
  scroll.append(box);
  page.append(scroll);
  document.body.replaceChildren(page);
  return stack;
}

export function text(message, parent, tone) {
  const item = document.createElement("s-text");
  if (tone === "subdued") item.setAttribute("color", "subdued");
  else if (tone) item.setAttribute("tone", tone);
  item.textContent = message;
  parent.append(item);
  return item;
}

export function button(label, parent, variant) {
  const item = document.createElement("s-button");
  if (variant) item.setAttribute("variant", variant);
  item.textContent = label;
  parent.append(item);
  return item;
}

export function field(label, parent, value = "") {
  const item = document.createElement("s-text-field");
  item.setAttribute("label", label);
  item.value = value;
  parent.append(item);
  return item;
}

/** 押してから終わるまで「処理中…」にし、二重に押せないようにする。 */
export async function busy(target, work) {
  if (target.disabled) return;
  const label = target.textContent;
  target.disabled = true;
  target.textContent = "処理中…";
  try {
    await work();
  } finally {
    target.disabled = false;
    target.textContent = label;
  }
}

export async function adminRequest(query, variables) {
  const response = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({query, variables}),
  });
  if (!response.ok) throw new Error("通信に失敗しました。もう一度操作してください。");
  const payload = await response.json();
  if (payload.errors?.length || !payload.data) throw new Error("参照権限と通信状態をご確認ください。");
  return payload.data;
}

export function text(message, parent) {
  const item = document.createElement("s-text");
  item.textContent = message;
  parent.append(item);
  return item;
}

export function button(label, parent) {
  const item = document.createElement("s-button");
  item.textContent = label;
  parent.append(item);
  return item;
}

export function field(label, parent) {
  const item = document.createElement("s-text-field");
  item.label = label;
  parent.append(item);
  return item;
}

export function readField(item) {
  return String(item.value ?? "").trim();
}

export function screen(heading) {
  const root = document.createElement("s-page");
  root.setAttribute("heading", heading);
  const scroll = document.createElement("s-scroll-box");
  const list = document.createElement("s-stack");
  scroll.append(list);
  root.append(scroll);
  document.body.replaceChildren(root);
  return list;
}

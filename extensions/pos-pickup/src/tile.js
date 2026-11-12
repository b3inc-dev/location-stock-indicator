import {loadPosAccess} from "./access.js";

export default async function () {
  const tile = document.createElement("s-tile");
  tile.setAttribute("heading", "店舗受取");
  tile.setAttribute("subheading", "受取注文を確認");
  tile.addEventListener("click", async () => {
    try { await shopify.storage.set("lsi-mode", "pickup"); } catch { /* モーダル側は受取を既定にする */ }
    shopify.action.presentModal();
  });
  document.body.replaceChildren(tile);
  try {
    const access = await loadPosAccess();
    if (!access.allowed) tile.setAttribute("subheading", "Proプランで利用できます");
  } catch {
    tile.setAttribute("subheading", "プランを確認してください");
  }
}

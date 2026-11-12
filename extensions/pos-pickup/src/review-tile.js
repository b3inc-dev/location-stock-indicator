import {loadPosAccess} from "./access.js";

export default async function () {
  const tile = document.createElement("s-tile");
  tile.setAttribute("heading", "要確認");
  tile.setAttribute("subheading", "失敗した会計を再処理");
  tile.addEventListener("click", async () => {
    try { await shopify.storage.set("lsi-mode", "review"); } catch { /* モーダルはモードを読めない場合、受取を開く */ }
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

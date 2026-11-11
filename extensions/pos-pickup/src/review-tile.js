export default async function () {
  const tile = document.createElement("s-tile");
  tile.setAttribute("heading", "要確認");
  tile.setAttribute("subheading", "失敗した会計を再処理");
  tile.addEventListener("click", async () => {
    try { await shopify.storage.set("lsi-mode", "review"); } catch { /* モーダルはモードを読めない場合、受取を開く */ }
    shopify.action.presentModal();
  });
  document.body.replaceChildren(tile);
}

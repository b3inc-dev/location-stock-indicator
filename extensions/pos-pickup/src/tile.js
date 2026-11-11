export default function () {
  const tile = document.createElement("s-tile");
  tile.setAttribute("heading", "店舗受取");
  tile.setAttribute("subheading", "受取注文を確認");
  tile.addEventListener("click", () => shopify.action.presentModal());
  document.body.replaceChildren(tile);
}

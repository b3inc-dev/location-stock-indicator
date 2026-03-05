# テーマとのカート連携（cart:refresh / location-stock:cart-added）

「この店舗で受け取る」ボタンでカートに追加したあと、**リダイレクト OFF** のとき、スニペットは次の 2 つのカスタムイベントを発火します。

| イベント名 | 用途 |
|------------|------|
| `cart:refresh` | カートが更新されたことを通知（汎用）。テーマ側の既存カート更新処理と合わせやすい名前。 |
| `location-stock:cart-added` | 同上（在庫表示アプリ由来であることを明示したいとき用）。 |

どちらも `e.detail.cart` に **最新のカート JSON**（`/cart.js` の返り値）が入ります。

---

## テーマの JavaScript でリッスンする方法

### 1. イベントをリッスンして `e.detail.cart` を使う

```javascript
function updateCartUI(cart) {
  if (!cart) return;
  // 例: ヘッダーのカート個数表示を更新
  var countEl = document.querySelector(".cart-count, [data-cart-count], .header__icon--cart .count");
  if (countEl) countEl.textContent = cart.item_count;
  // 必要に応じて小計・合計なども更新
}

document.addEventListener("cart:refresh", function (e) {
  updateCartUI(e.detail && e.detail.cart);
});

// アプリ由来だけ処理したい場合はこちら
document.addEventListener("location-stock:cart-added", function (e) {
  updateCartUI(e.detail && e.detail.cart);
});
```

### 2. 既存の「カート追加後の処理」に組み込む

テーマですでに「カートに追加 → 個数更新・ドロワー更新」をしている場合は、**同じ更新処理**を `cart:refresh` のリスナーから呼ぶと、店舗受け取りボタンから追加したときも同じ見た目で反映されます。

```javascript
// テーマがもともと持っている「カート更新」関数がある場合
function refreshCartDrawer() {
  // 例: Section Rendering API で cart-drawer を再取得して差し替え
  fetch("/?sections=cart-drawer,cart-icon-bubble")
    .then(function (r) { return r.json(); })
    .then(function (sections) {
      Object.keys(sections).forEach(function (id) {
        var el = document.getElementById("shopify-section-" + id);
        if (el && sections[id]) el.innerHTML = sections[id].trim();
      });
    });
}

// 通常の「カートに追加」フォーム送信後に refreshCartDrawer() を呼んでいるなら、
// 店舗受け取りボタンから追加されたときも同じ処理を呼ぶ
document.addEventListener("cart:refresh", function (e) {
  refreshCartDrawer();
});
```

### 3. Dawn テーマで Section Rendering を使ってドロワーを差し替える例

Dawn ではカートドロワーやカートアイコンのセクション ID がテーマによって異なります（例: `cart-drawer`, `theme-cart-drawer`）。テーマの HTML で `id="shopify-section-〇〇"` を確認し、その `〇〇` を `?sections=` に指定します。

```javascript
document.addEventListener("cart:refresh", function (e) {
  var cart = e.detail && e.detail.cart;
  if (!cart) return;

  // カート個数バッジの更新（Dawn のクラス例）
  var countEl = document.querySelector(".cart-count-bubble, .count-bubble");
  if (countEl) countEl.textContent = cart.item_count;

  // Section Rendering でドロワーとアイコンを差し替え（セクション ID はテーマに合わせて変更）
  var sectionIds = ["cart-drawer", "cart-icon-bubble"];
  fetch("/?sections=" + sectionIds.join(","))
    .then(function (r) { return r.json(); })
    .then(function (sections) {
      Object.keys(sections).forEach(function (id) {
        var el = document.getElementById("shopify-section-" + id);
        if (el && typeof sections[id] === "string") {
          el.innerHTML = sections[id].trim();
        }
      });
    })
    .catch(function () {});
});
```

### 4. `e.detail.cart` の中身（参考）

`/cart.js` と同じ形式です。

- `cart.item_count` … 商品種類数（行数）
- `cart.total_price` … 合計金額（セント）
- `cart.items` … ラインアイテムの配列
- その他、Shopify の Cart オブジェクトのプロパティ

テーマの既存コードが「カート追加後に `/cart.js` を fetch して DOM を更新している」場合は、その更新処理の引数に `e.detail.cart` を渡して再利用できます。

---

## スニペット側の自動更新について

スニペットは、カート追加成功後に **Section Rendering API** で次のセクション ID を取得・差し替えを試みます。

- `cart-drawer`
- `cart-icon-bubble`
- `cart-drawer-wrapper`
- `main-cart-items`

テーマでこれらの ID の要素（`#shopify-section-〇〇`）が存在する場合、**ページをリロードしなくても**カートドロワーやアイコンが更新される可能性があります。  
ID が違うテーマでは更新されないため、その場合は上記のとおり **テーマの JavaScript で `cart:refresh` をリッスン**し、`e.detail.cart` や Section Rendering で既存のカート更新処理を呼んでください。

---

## まとめ

| やりたいこと | 方法 |
|--------------|------|
| カート個数だけ更新する | `cart:refresh` をリッスンし、`e.detail.cart.item_count` で表示を更新。 |
| ドロワーを差し替える | `cart:refresh` をリッスンし、`/?sections=セクションID` を fetch して該当 `#shopify-section-〇〇` の innerHTML を差し替え。 |
| 既存のカート更新処理を流用する | `cart:refresh` のコールバックで、既存の「カート更新」関数に `e.detail.cart` を渡して呼ぶ。 |

イベントは `document` で発火し、`bubbles: true` のため、必要な要素にだけリスナーを付けても受け取れます。

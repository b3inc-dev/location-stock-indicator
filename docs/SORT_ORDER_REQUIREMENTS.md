# 並び順の仕様（Location Stock Indicator）

`REQUIREMENTS.md` の「2.3 並び順・上部固定」を補足するドキュメントです。

---

## 1. 設定の保存先

- **管理画面**: ロケーション設定（`app.locations.jsx`）
  - 並び順セレクトで `config.sort.mode` を選択
  - ロケーション一覧の「上部固定」列で 1 件だけラジオ選択 → `config.pinnedLocationId`
- **メタフィールド**: `location_stock.config`（JSON）の `sort.mode` と `pinnedLocationId`
- **App Proxy**: `buildGlobalConfig` で `config.sort` と `config.pinnedLocationId` をそのまま返す

---

## 2. 並び順モード（`config.sort.mode`）

| 値 | 意味 | 備考 |
|----|------|------|
| `none` | 一覧の並び順を使う | 管理画面のロケーション一覧で決めた順（並び順の数値・上下ボタン）をそのまま使用 |
| `location_name_asc` | ロケーション名 昇順（A→Z） | 表示名（公開名 or ロケーション名）でソート |
| `quantity_desc` | 在庫数の多い順 | 数量の降順 |
| `quantity_asc` | 在庫数の少ない順 | 数量の昇順 |
| `in_stock_first` | 在庫ありのロケーションを優先 | 閾値（outOfStockMax / inStockMin）で在庫あり＞残りわずか＞在庫なしの順 |
| `store_pickup_first` | 店舗受け取りのロケーションを優先 | `storePickupEnabled`（localPickupSettingsV2 の有無）でソート |
| `shipping_first` | 配送対応のロケーションを優先 | `hasShipping`（配送プロファイルから取得）でソート |
| `local_delivery_first` | ローカルデリバリー対応のロケーションを優先 | `hasLocalDelivery`（配送プロファイルのゾーン名・方法名から判定）でソート |

---

## 3. 上部固定（`config.pinnedLocationId`）

- **1 ロケーションだけ**を常にリストの**先頭**に表示する。
- 管理画面で「上部固定」列のラジオで選択したロケーションの `locationId`（GID）が保存される。
- **スニペット側の処理**:
  1. `pinnedLocationId` に一致するロケーションをリストから抜き出す
  2. その 1 件を先頭にし、残りを `sort.mode` に従ってソートした結果をその後に並べる
- 解除する場合は管理画面で「解除」ボタンを押し、保存する。

---

## 4. データの流れ

1. 管理画面で並び順・上部固定を保存 → メタフィールド更新
2. 商品ページで App Proxy がメタフィールドを読み、`config.sort` と `config.pinnedLocationId` をレスポンスに含める
3. スニペット（`location-stock-indicator.liquid`）の `sortLocations` が以下を実行:
   - `settings.sortBy` ← `config.sort.mode`
   - `settings.pinnedLocationId` ← `config.pinnedLocationId`
   - 上部固定ロケーションを先頭にし、残りを `sortBy` でソート

---

## 5. 補足

- 配送対応・ローカルデリバリー・店舗受け取りのフラグは、App Proxy が `deliveryProfiles` と `Location.localPickupSettingsV2` から取得し、各 stock に `hasShipping` / `hasLocalDelivery` / `storePickupEnabled` として付与している。
- 並び順の「一覧の並び順を使う」の場合、App Proxy の `applyConfigToStocks` がメタフィールドの `config.locations` の `sortOrder` で既にソートした配列を返すため、スニペットはその順序を維持する（`config_order` / `none` として扱う）。

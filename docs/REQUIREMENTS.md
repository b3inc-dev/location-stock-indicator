# Location Stock Indicator 要件・実装メモ

## 1. データの流れ（サイト経路）

- **管理画面**で保存した内容は、ショップのメタフィールド `location_stock.config`（JSON）に保存される。
- **商品ページ**では、テーマの App Block が **App Proxy**（`/apps/location-stock?variant_id=xxx`）を呼び出す。
- App Proxy はメタフィールドを読み、在庫リスト（`stocks`）とグローバル設定（`config`）を JSON で返す。
- テーマ拡張の **スニペット**（`location-stock-indicator.liquid`）が `config` と `stocks` を受け取り、表示・絞り込み・並び順を適用する。

---

## 2. 実装済み機能と経路の対応

### 2.1 閾値（在庫なし／残りわずか／在庫ありの境界）

| 項目 | 内容 |
|------|------|
| 設定場所 | **在庫表示設定**（一番上） |
| 保存 | `config.thresholds.outOfStockMax` / `config.thresholds.inStockMin` |
| App Proxy | `buildGlobalConfig` で `config.thresholds` を返す |
| サイト | スニペットが `appConfig.thresholds` で `settings.outOfStockMax` / `settings.inStockMin` を更新し、`getStatusSymbolAndLabel` で在庫あり／残りわずか／在庫なしを判定 |

**経路**: 在庫表示設定 → メタフィールド → App Proxy → config → スニペット ✅

---

### 2.2 ロケーション表示ルール

| 項目 | 内容 |
|------|------|
| 設定場所 | **ロケーション設定**（ロケーション一覧の「表示」チェックと「公開名」） |
| 保存 | `config.locations` 配列（各要素: `locationId`, `enabled`, `publicName`, `sortOrder`） |
| 表示ルール | 「チェックが入っているロケーションだけ表示」「公開名があれば公開名、なければロケーション名」 |
| App Proxy | `applyConfigToStocks` で `displayName`（公開名 or ロケーション名）、`fromConfig`、`enabled` を付与。`config.locations.mode` は `buildGlobalConfig` で `config.locations` に含めて返す |
| サイト | スニペットの `filterLocations` で `locationsMode` に応じて絞り込み。`custom_from_app` のときは `fromConfig === true` のみ表示 |

**経路**: ロケーション設定 → メタフィールド → App Proxy（stocks + config.locations） → スニペット ✅

---

### 2.3 並び順・上部固定

| 項目 | 内容 |
|------|------|
| 設定場所 | **ロケーション設定**（並び順セクション ＋ ロケーション一覧の「上部固定」列で 1 件だけラジオ選択） |
| 保存 | `config.sort.mode`（none / location_name_asc / quantity_desc / quantity_asc / in_stock_first / store_pickup_first / shipping_first / local_delivery_first）、`config.pinnedLocationId` |
| App Proxy | `buildGlobalConfig` で `config.sort` と `config.pinnedLocationId` を返す |
| サイト | スニペットが `settings.sortBy` と `settings.pinnedLocationId` を更新。`sortLocations` で上部固定ロケーションを先頭にし、残りを `sortBy` でソート |

**経路**: ロケーション設定 → メタフィールド → App Proxy → config → スニペット ✅

**補足**: スニペットでは現在、`location_name_asc` / `quantity_desc` / `quantity_asc` と**上部固定**を実装。`in_stock_first` / `store_pickup_first` / `shipping_first` / `local_delivery_first` をサイトで反映するには、App Proxy で各ロケーションに `hasShipping` / `hasLocalDelivery` / `storePickupEnabled` を付与し、スニペット側で対応するソート分岐を追加する必要がある（管理画面での保存は済んでいる）。

---

### 2.4 在庫表示設定のその他

- **在庫マーク**（◯△✕）、**在庫数ラベル・前後の文字**、**ステータスラベル**、**メッセージ文言**、**注意書き**、**クリック設定**  
  → いずれもメタフィールド → `buildGlobalConfig` → スニペットで `appConfig` から `settings` に反映。  
- **並び順**はロケーション設定に集約してあり、在庫表示設定には並び順の項目はない。

---

## 3. 管理画面の構成

- **在庫表示設定**（`app.settings.jsx`）  
  閾値（一番上）、在庫マーク、在庫数テキスト、ステータスラベル、メッセージ、注意書き、クリック設定のみ。並び順はなし。
- **ロケーション設定**（`app.locations.jsx`）  
  表示ルール（ロケーション一覧のチェック＋公開名）、並び順（セレクト）、上部固定（ラジオ 1 件）、ロケーション一覧テーブル（表示・公開名・並び順・上部固定・表示）。配送対応／ローカルデリバリー対応／店舗受け取り対応は、API（`localPickupSettingsV2`・`deliveryProfiles`）から取得して行ごとに表示。スマホ時はテーブルを横スクロール可能にし、ロケーション名列に最小幅を指定。

---

## 4. エラーログ

- App Proxy 内で `logAppProxyError(shop, variantId, code, message, err)` を呼び出し、エラー時にショップ・variant_id・コード・メッセージを JSON で `console.error` する。
- 管理画面の `deliveryProfiles` 取得失敗時は `[location-stock]` プレフィックスでワーニングを出力。

---

## 5. スコープ・API

- **read_shipping**: 配送プロファイル（`deliveryProfiles`）と `Location.localPickupSettingsV2` の取得に使用。未付与だと配送対応・ローカルデリバリー対応は取得されない。
- 店舗受け取り対応は `Location.localPickupSettingsV2` の有無で判定。

---

## 6. 参照ドキュメント

- 並び順の詳細: `docs/SORT_ORDER_REQUIREMENTS.md`（存在する場合）
- 管理画面 UI ルール: `docs/ADMIN_UI_DESIGN_RULES.md`（存在する場合）

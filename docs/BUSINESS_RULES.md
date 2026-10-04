# BUSINESS_RULES.md — 業務仕様（コード・docs 確認範囲）

**原則**: ここにはソースまたは既存 docs で確認できたことだけを書く。管理画面 UI に項目が無いがコード上のみ存在する挙動は「コード上の挙動」として区別する。

## 1. 在庫閾値と ◯ / △ / ✕

### 設定

| キー | デフォルト（`buildGlobalConfig`） | 設定 UI |
|------|-----------------------------------|---------|
| `thresholds.outOfStockMax` | `0` | 在庫表示設定（`app.settings.jsx`） |
| `thresholds.inStockMin` | `5` | 同上 |
| `symbols.inStock` / `lowStock` / `outOfStock` | `◯` / `△` / `✕` | 同上 |
| `labels.*` | 在庫あり／残りわずか／在庫なし | 同上 |

### 判定（スニペット `getStatusSymbolAndLabel`）

- `qty <= outOfStockMax` → 在庫なし（✕）
- `qty >= inStockMin` → 在庫あり（◯）
- それ以外 → 残りわずか（△）

色はテーマスキーマ（`in_stock_color` 等）。マーク文字はアプリ設定。

## 2. 数量表示

- `config.quantity`（ラベル、前後 wrapper、`rowContentMode`）。
- `rowContentMode`（スニペット）: `symbol_only` / `symbol_and_quantity` / `symbol_quantity_label` / `quantity_only` / `quantity_label`（`REQUIREMENTS.md` / スニペット）。
- 行の見た目モードはテーマ側 `row_content_mode` 等とアプリ設定の組み合わせ（詳細は `SNIPPET_SETTINGS_REFERENCE.md`）。

## 3. ロケーションの表示名・フィルタ

### displayName

- App Proxy `applyConfigToStocks`: `displayName = cfg.publicName || stock.locationName`。
- config にエントリが無いロケーション: `displayName = locationName`、`fromConfig = false`。

### enabled

- `cfg.enabled === false` のロケーションは **App Proxy 段階で除外**（レスポンスの stocks に含めない）。
- 管理画面ロケーション一覧の「表示」チェックで保存（`enabledLocationId`）。

### locationsMode（スニペット `filterLocations`）

| mode | 挙動 |
|------|------|
| `all`（デフォルト） | 受け取った stocks をそのまま（server で enabled 除外済み） |
| `online_only` | `fulfillOnline` / `fulfillOnlineOrders` / `fulfillsOnlineOrders` のいずれか truthy |
| `custom_from_app` | `fromConfig === true` のみ |

**管理画面からの `locationsMode` 保存 UI は `app.locations.jsx` / `app.settings.jsx` に見当たらない。**
`buildGlobalConfig` はメタフィールドトップレベル `locationsMode` を読む。未設定時はデフォルト `all`。
→ 「オンラインのみ初期化」を管理画面から行う経路は**コード上未確認（未実装またはメタ手動）**。

## 4. 並び順・上部固定

- 保存: `config.sort.mode`、`config.pinnedLocationId`（ロケーション設定）。
- モード一覧と意味: **`docs/SORT_ORDER_REQUIREMENTS.md`**（正）。
- `none` / 相当: App Proxy が `sortOrder` で並べた配列をスニペットが維持。
- 上部固定: スニペットが該当 1 件を先頭へ。

配送・受取ソートに使うフラグ:

| フラグ | 取得元 |
|--------|--------|
| `hasShipping` / `hasLocalDelivery` | `deliveryProfiles`＋ゾーン／方法名キーワード（`isLocalDeliveryMethodName`） |
| `storePickupEnabled` | `location.localPickupSettingsV2` の有無 |

## 5. オンラインロケーション vs 店舗在庫

- GraphQL は当該 variant の **全 inventoryLevels**（最大 first: 250）を返す。オンライン専用ロケーションへの自動限定はデフォルトでは行わない。
- `fulfillsOnlineOrders` は各 stock に付与。`online_only` モード時のみフィルタに使用。
- 「店舗在庫」という別エンティティはなく、ロケーション別 available 数量が表示対象。

## 6. variant 変更

- 再取得トリガ: 初期表示、`variant:change`、カートフォーム `name="id"` の change（`ARCHITECTURE.md` §9）。
- バリアント切替のたびに App Proxy を呼び、分析の `area_display` も再送されうる（`REQUIREMENTS.md` §11）。

## 7. 凡例・色・注意書き

| 項目 | アプリ設定 | テーマ設定 |
|------|------------|------------|
| 凡例文言（記号＋ラベル連結） | 記号・ラベル | 表示 ON/OFF・位置・揃え・色 |
| ステータス色／マーク色 | — | スキーマの color |
| 注意書き文言 | `config.notice.text` | 表示・位置・色等 |
| メッセージ（loading/empty/error） | `config.messages` | — |

凡例テキスト生成: `updateLegendElements`（記号 + ラベルを `/` 区切り）。

## 8. クリック動作

優先順（`applyClickAction`）:

1. `showLocationLinks` かつ `linkUrl` 非空 → `<a href=linkUrl>`（http 始まりは `target=_blank`）。
2. 後方互換: `click.action === open_map` → `mapUrlTemplate`。
3. `click.action === open_url` → `urlTemplate`。
4. それ以外はテキスト。

`showLocationLinks` / 行ごと `linkUrl` はロケーション設定で保存（`REQUIREMENTS.md` §2.5）。

## 9. エリア・近隣・店舗受け取り（Pro / inhouse）

コード・docs 上 **実装済み**（「将来」ではなく現行機能）。フラグは `config.future.*`。詳細表は `REQUIREMENTS.md` §9。

| 機能 | 主なフラグ | Lite（公開） |
|------|------------|--------------|
| エリアグルーピング | `groupByRegion` 等 | App Proxy で false 強制 |
| 近隣店舗 | `nearbyFirstEnabled` 等、`excludeFromNearby` | 同上 |
| 店舗で受け取る | `showOrderPickButton` 等、`storePickupEnabled` | 同上 |
| 分析 | analytics イベント | 管理画面・機能フラグで制限 |

店舗受け取りのカート挙動の詳細は `STORE_PICKUP_BUTTON.md` / `THEME_CART_INTEGRATION.md`。

## 10. プラン関連ルール（要約）

- Lite: ロケーション最大 10。超過で `locationPlanMismatch` → `/app/plan` へ誘導（`app.jsx`）。
- 料金・機能表の正: `PLAN_SETTINGS_DESIGN.md` / `REQUIREMENTS.md` §13。
- `FORCE_PLAN_LITE=1` で Lite 強制（開発確認用）。

## 後方互換性の確認

Proxy成功時の `ok` / `variantId` / `variantTitle` / `stocks` / `config` と、stockのlocation識別子・名称・available数量・fulfillsOnlineOrdersをTheme側とのcontractとして確認する。HTTP200でも `ok:false` のエラーがある。既存形状・閾値・variantイベント・公開Lite/ProとCiara inhouseの表示差を無断で再設計しない。変更時の検証項目は [DEVELOPMENT.md](DEVELOPMENT.md)。

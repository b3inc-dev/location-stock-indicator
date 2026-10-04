# ARCHITECTURE.md — 構成とデータフロー

根拠: `app/`・`extensions/`・`shopify.app*.toml`・既存 docs。未確認事項は「未確認」と明記。

## 1. 全体構成

```
[Shopify Admin]
  └─ 埋め込みアプリ (React Router / Polaris Web Components)
       ├─ 設定保存 → Shop metafield location_stock.config
       └─ 分析表示 ← location_stock.analytics_YYYY_MM

[Shopify Storefront 商品ページ]
  └─ Theme App Extension block
       └─ snippet (Liquid + インライン JS)
            ├─ GET /apps/location-stock?variant_id=…  (App Proxy)
            └─ 分析: App Proxy action=analytics または POST

[App Proxy → Render 上の Node アプリ]
  └─ authenticate.public.appProxy
       ├─ Admin GraphQL: productVariant → inventoryItem → inventoryLevels
       ├─ Admin GraphQL: deliveryProfiles（任意・失敗時はフラグ false）
       ├─ Shop metafield config
       └─ getShopPlan（Lite 時は Pro future を強制 OFF）
```

## 2. 層ごとの責務

| 層 | 責務 | 主な実装 |
|----|------|----------|
| Shopify Admin API | 在庫・ロケーション・配送プロファイル・メタフィールド | App Proxy / 管理画面 loaders |
| Backend（React Router） | OAuth／セッション、管理 UI、App Proxy、Webhook、課金・プラン | `app/` |
| App Proxy | ストアフロント向け JSON（stocks + config）、分析イベント受信 | `apps.location-stock.js` |
| Theme Liquid | ブロック／スニペットのマークアップ・スキーマ設定の埋め込み | `blocks/` / `snippets/` |
| Theme JS（スニペット内） | fetch、閾値判定、フィルタ／ソート、描画、variant 変更、カート追加 | `location-stock-indicator.liquid` |

## 3. データフロー詳細（variant ID → UI）

### 3.1 識別子の扱い

| 概念 | Shopify / GraphQL | Backend 処理 | App Proxy レスポンス | Liquid/JS |
|------|-------------------|--------------|----------------------|-----------|
| **variant ID** | クエリは GID。入力は数値 ID（`variant_id`） | `gid://shopify/ProductVariant/${variantId}` に変換 | `variantId`（数値文字列） | `data-variant-id`、fetch クエリ、カート `items[].id` |
| **SKU** | 本アプリの GraphQL／レスポンス／スニペットで**未使用** | — | — | — |
| **inventoryItem** | `productVariant.inventoryItem { id, inventoryLevels }` | levels の親として参照（レスポンスには inventoryItem id を載せない） | なし | なし |
| **location** | `inventoryLevels.edges.node.location`（id, name, fulfillsOnlineOrders, address, localPickupSettingsV2） | stocks 要素にマッピング＋ config 装飾 | `locationId`, `locationName`, `displayName`, … | 表示名・リンク・近隣距離 |
| **available quantity** | `quantities(names: "available").quantity` | `quantity` に転記 | `quantity` | `getStatusSymbolAndLabel(qty)` |
| **online fulfillment** | `location.fulfillsOnlineOrders` | `fulfillsOnlineOrders` 布尔 | 同左 | `filterLocations` の `online_only` で参照（別名フォールバックあり） |

### 3.2 シーケンス（在庫表示）

1. Liquid が `product.selected_or_first_available_variant.id` を `data-variant-id` に出力。
2. JS が `/apps/location-stock?variant_id=<id>` を fetch。
3. `authenticate.public.appProxy` → 必要ならオフライントークン refresh（`ensureOfflineAccessTokenFresh`）。
4. GraphQL `VariantInventoryWithConfig` で variant + shop metafield。
5. 別途 `DeliveryProfilesForLocations`（失敗しても在庫返却は継続）。
6. levels → `baseStocks` → `applyConfigToStocks`（enabled 除外、displayName、sortOrder、regionKey、linkUrl 等）。
7. `buildGlobalConfig` → Lite 公開時は `future` の Pro フラグを false 化。
8. `{ ok: true, variantId, variantTitle, stocks, config }`。
9. スニペットが config で settings を上書き → `filterLocations` → `sortLocations` → DOM 描画。

### 3.3 管理設定の流れ

1. `app.settings.jsx` / `app.locations.jsx` がフォーム保存。
2. `metafieldsSet` で `namespace: location_stock`, `key: config`。
3. 次回 App Proxy が metafield を読み込み storefront に反映（キャッシュ層はコード上なし）。

### 3.4 分析の流れ

- スニペット → App Proxy（GET `action=analytics` または POST body）。
- `recordAnalyticsEvent` → 月キー `analytics_YYYY_MM` のメタフィールド更新。
- 管理画面 `app.analytics.jsx` で表示（Pro／inhouse）。

## 4. 管理 UI（有無）

**あり。** 埋め込みアプリとして実装済み。

| パス | 役割 |
|------|------|
| `/app` | ホーム（プラン・ロケーション数・導線） |
| `/app/locations` | ロケーション・並び・エリア／近隣／店舗受取・リンク |
| `/app/settings` | 閾値・マーク・ラベル・メッセージ・注意書き |
| `/app/analytics` | 分析（プラン制限あり） |
| `/app/plan` | Lite/Pro（公開時） |

ナビ: `app.jsx` の `s-app-nav` + `AppNavBar`。

## 5. Theme App Extension

- **有り**: `extensions/location-stock-theme/`（`type = "theme"`）。
- ブロック `Location stock indicator` → snippet に委譲。
- 見た目・レイアウトはブロックスキーマ、業務ルール文言は主にアプリ設定（`REQUIREMENTS.md` §3.2）。

## 6. 認証・セッション

- Admin: `authenticate.admin`（埋め込み）。
- App Proxy: `authenticate.public.appProxy`。
- セッション: Prisma `Session`（accessToken + refreshToken）。
- `shopifyApp` の `future.expiringOfflineAccessTokens: true`。
- distribution 設定値: コード上 `AppDistribution.AppStore`（`shopify.server.js`）。自社判定は実行時 `APP_DISTRIBUTION=inhouse` 等（`shopPlan.server.js`）。

## 7. デプロイ構成（要約）

| 環境 | toml | Render URL（toml 記載） |
|------|------|-------------------------|
| 公開 | `shopify.app.public.toml` | `location-stock-indicator.onrender.com` |
| 自社 | `shopify.app.toml` | `location-stock-indicator-ciara.onrender.com` |

- コンテナ: `Dockerfile`（`npm run build` → `docker-start` = prisma migrate + `react-router-serve`）。
- GitHub → Render: Ciaraはmain / On Commitを初期設定監査で確認済み。main mergeは本番backend release、公開用の実設定は未確認。環境別の証拠・停止条件は `APP_AND_RENDER_CONFIG.md` を正本とする。リポジトリ内に `.github/workflows` **なし**。

詳細: [`SHOPIFY.md`](./SHOPIFY.md)、`APP_AND_RENDER_CONFIG.md`。

## 8. GraphQL の所在（重複注意）

| クエリ用途 | App Proxy | 管理画面 |
|------------|-----------|----------|
| variant + inventoryLevels + config metafield | `apps.location-stock.js` | （設定画面は別クエリ） |
| deliveryProfiles → hasShipping / hasLocalDelivery | 同左（`isLocalDeliveryMethodName` 含む） | `app.locations.jsx` に**同様のクエリ／判定ロジックが重複** |
| shop plan / locations count | `getShopPlan` | 同 |
| analytics metafield | `analytics.server.js` | 同経由 |

## 9. variant 変更時の再取得

スニペット JS（確認済み）:

1. 初期: `data-variant-id` で `updateStocksByVariantId`。
2. `document` の `variant:change`（`event.detail.variant.id`）。
3. `form[action^="/cart/add"] [name="id"]` の `change`。
4. 同一 ID は `lastVariantId` でスキップ。

テーマ固有の他イベントはコードに無い。テーマが上記を発火しない場合は再取得されない。

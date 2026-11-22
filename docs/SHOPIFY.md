# SHOPIFY.md — Shopify 連携・設定・デプロイ

根拠: `shopify.app*.toml`、`app/shopify.server.js`、既存 deploy docs、関連ルート。

## 1. アプリ設定（toml）

| | 公開用 `shopify.app.public.toml` | 自社用 `shopify.app.toml` |
|--|----------------------------------|---------------------------|
| name | Location Stock | Location Stock - Ciara |
| client_id | `1758d63a004d7f7d99afe5bf334d1f48` | `61b474b801b754166b12f0b9cd07f450` |
| application_url | `https://location-stock-indicator.onrender.com` | `https://location-stock-indicator-ciara.onrender.com` |
| embedded | true | true |
| App Proxy | prefix `apps` / subpath `location-stock` → 各 Render の `/apps/location-stock` | 同左（URL のみ異なる） |

### スコープ（両 toml 共通）

```
read_inventory, read_locations, read_products, read_shipping, write_app_proxy
```

用途の説明: `REQUIREMENTS.md` §14.5、`APP_REVIEW_SUBMISSION.md`。
※ `write_products` は未使用のため両 toml から削除済み（Shop metafield のみ。Render `SCOPES` も承認後に合わせる）。

**マーケット主導配送（Option B・PR #12 マージ後）**: 両 toml に `read_markets` を追加。MDS 店は `Market.delivery`、legacy は `deliveryProfiles`。手順・自己申告は `docs/MARKET_DRIVEN_SHIPPING_ATTESTATION.md`（フォーム送信は人手）。

### Webhooks

- `app/uninstalled` → `/webhooks/app/uninstalled`
- `app/scopes_update` → `/webhooks/app/scopes_update`
- compliance: `customers/data_request`, `customers/redact`, `shop/redact` → `/webhooks/compliance`
- `api_version = "2026-07"`（両 toml。#44 で 2026-01 から上げた）

## 2. 認証

| 経路 | API |
|------|-----|
| 管理画面 | `authenticate.admin` |
| ログイン | `/auth/*`, `auth.login` |
| App Proxy | `authenticate.public.appProxy` |
| Webhook | `authenticate.webhook`（compliance 含む） |

- セッションストレージ: `@shopify/shopify-app-session-storage-prisma`
- 期限切れオフライントークン: `future.expiringOfflineAccessTokens` + `refresh-offline-session.js`（App Proxy で期限前 refresh・失敗時は握りつぶさず再認可エラー、GraphQL 認証失敗後に 1 回 refresh→再試行、refresh 無し非期限付きは token-exchange 移行）。手順: `docs/OFFLINE_SESSION_CIARA_REPRO.md`

### API の版（#44 から）

| どこ | 版 | 設定の場所 |
|------|----|------------|
| Admin GraphQL（アプリのコード全体） | `2026-07` | `app/shopify.server.js` の `ADMIN_API_VERSION`（`ApiVersion.July26 ?? "2026-07"`） |
| 配送設定の読み取り（MDS） | `2026-07` | `app/utils/deliveryProfiles.js` の `MARKET_DRIVEN_SHIPPING_API_VERSION`（前から 2026-07。今はアプリ全体と同じ） |
| Webhook の本文の形 | `2026-07` | `shopify.app.toml`・`shopify.app.public.toml` の `[webhooks] api_version` |
| 型の生成（`npm run graphql-codegen`） | `2026-07` | `.graphqlrc.js` |

- 事実: 入っているライブラリ（`@shopify/shopify-app-react-router` 1.0.x）の `ApiVersion` に `July26` が無いときも、文字列 `"2026-07"` がそのまま Admin API の URL に使われる（`shopify.server.js` のコメント）。
- 事実: Shopify は各版を少なくとも 12 か月支える（https://shopify.dev/docs/api/usage/versioning）。2026-07 は 2027-07 ごろまで使える見込み。
- 版を上げるときは、上の 4 か所を同じ PR でそろえる。webhook の版は toml を `shopify app deploy` したときに Shopify 側へ反映される（自社用・公開用の両方）。

#### 2025-10 → 2026-07 で見たこと（2026-11-23、Shopify の 2026-01・2026-04・2026-07 のリリースノートとコードを見比べた）

このアプリが使う GraphQL: `locations`・`nodes`・`productVariant`→`inventoryItem`→`inventoryLevels`/`quantities`・`shop.metafield`・`metafieldsSet`・`deliveryProfiles`・`markets`（`Market.delivery`）・`shop.features.marketDrivenShipping`。#48 より前のブランチでは `appSubscriptionCreate`・`appUsageRecordCreate` も。

| リリースノートの変更 | このアプリへの影響 |
|----|----|
| 2026-01: `InventoryItem.variant` が非推奨、`Shop.billingAddress` が非推奨、`compareQuantity` をやめる | 事実: どれも使っていない（`app/`・`extensions/` を検索） |
| 2026-04: 在庫を書く mutation に `changeFromQuantity`、冪等キーが必須 | 事実: 在庫は読むだけなので影響なし |
| 2026-04: `DeliveryProfile.legacyMode` が非推奨 | 事実: `legacyMode` は使っていない |
| 2026-07: マーケット主導配送（MDS）の店では `deliveryProfiles` が古い値を返すことがある | 事実: MDS の店は前から `Market.delivery.shipping`（2026-07）で読んでいる。legacy の店だけ `deliveryProfiles` |
| **2026-04: JSON のメタフィールドの書き込みは 128KB まで**（2026-04 以降の版。2026-04-01 より前から JSON を使っていたアプリは 2MB のまま） | **要確認**。下を見る |

**JSON メタフィールド 128KB の件**（出典: https://shopify.dev/changelog/posts/reduced-metafield-value-sizes ）

- 事実: このアプリは店のメタフィールドに JSON を書いている。設定 `location_stock.config`（`app.settings.jsx`・`app.locations.jsx`）と、分析の月ごとの記録 `location_stock.analytics_YYYY_MM`（`app/analytics.server.js`）。
- 事実: 2025-10 のときはこの上限の外だった。#44 で 2026-07 にすると上限の中に入る。
- 事実: 2MB のままになる「前から使っていたアプリ」を、アプリごと・店ごとのどちらで決めるかは、Shopify のページに書いていない。超えた書き込みがどう失敗するかも書いていない。
- 推測: 自社用（Location Stock - Ciara）は 2026-04 より前から JSON を書いているので 2MB のままの見込み。公開用は別のアプリ（別の client ID）なので、128KB になるかもしれない。
- 推測: 分析の 1 か月分は「日数 × ロケーション数 × 2 つの表」で増える。ロケーションの ID（`gid://shopify/Location/…`）1 件が 45 バイトほどとすると、毎日すべてのロケーションが出る店では **45 か所前後で 128KB を超える**。設定（`config`）は小さいので当面は届かない見込み。
- 次にすること（T さんが決める）: (1) 開発ストアで 2026-07 のまま分析の書き込みが通るか確かめる、(2) 多いロケーションの店のために、分析を月ではなく日ごと・週ごとのキーに分けるか、ロケーションの ID を短くする直しを別の PR で作る、(3) 必要なら Shopify のフォームで上限を上げてもらう。

## 3. App Proxy

- ルートファイル: `app/routes/apps.location-stock.js`（Remix/RR の `apps.` プレフィックス規約）。
- ストアフロント URL: `/apps/location-stock?variant_id=<numericId>`。
- 成功: HTTP 200 + `{ ok: true, ... }`。エラーも多くは HTTP 200 + `{ ok: false, error, message }`（Shopify のエラーページ回避コメントあり）。
- 分析: GET `action=analytics&event=...&date=YYYY-MM-DD` または POST JSON。

## 4. Theme App Extension

- ディレクトリ: `extensions/location-stock-theme/`
- `shopify.extension.toml`: `name = "location-stock-theme"`, `type = "theme"`
- ブロック → snippet。商品ページ以外では案内メッセージ（Liquid の `{% if product %}`）。

## 5. 環境変数（コード／docs で参照されるもの）

| 変数 | 用途 | 参照箇所 |
|------|------|----------|
| `SHOPIFY_API_KEY` | API キー | `shopify.server.js`, refresh, `app.jsx` |
| `SHOPIFY_API_SECRET` | シークレット | `shopify.server.js`, refresh |
| `SCOPES` | カンマ区切りスコープ | `shopify.server.js` |
| `SHOPIFY_APP_URL` | アプリ URL | `shopify.server.js`, Vite |
| `SHOP_CUSTOM_DOMAIN` | カスタムショッピドメイン（任意） | `shopify.server.js` |
| `APP_DISTRIBUTION` | `inhouse` で自社扱い | `shopPlan.server.js` / `APP_AND_RENDER_CONFIG.md` |
| `CUSTOM_APP_STORE_IDS` | カンマ区切りで inhouse 扱いショップ | `shopPlan.server.js` |
| `FORCE_PLAN_LITE` | `1` で Lite 強制 | `shopPlan.server.js` |
| `SHOPIFY_APP_HANDLE` | プラン画面等（デフォルト `app`） | `app.plan.jsx` |
| `DATABASE_URL` | docs 上 Prisma 用（スキーマ既定は `file:dev.sqlite`） | `DEPLOY_AND_SCOPES.md` |
| `NODE_ENV` | production 等 | `db.server.js`, Dockerfile |
| `PORT` / `FRONTEND_PORT` | サーバ／Vite | `vite.config.js` |
| `RENDER_EXTERNAL_URL` | docs 上 Render 向け（任意） | deploy docs |

シークレットをリポジトリに書かないこと（`APP_AND_RENDER_CONFIG.md`）。

## 6. GraphQL（ストアフロント経路で使う主なフィールド）

`VARIANT_INVENTORY_WITH_CONFIG_QUERY`（App Proxy）:

- `productVariant(id)` → `inventoryItem.inventoryLevels(first: 250)`
  - location: `id`, `name`, `fulfillsOnlineOrders`, `localPickupSettingsV2`, `address`（city/province/country/lat/lng）
  - `quantities(names: "available")`
- `shop.metafield(namespace: "location_stock", key: "config")`

配送: legacy は `deliveryProfiles(first: 50)` → location groups / zones / methodDefinitions。MDS（`ShopFeatures.marketDrivenShipping`）は `Market.delivery.shipping`（Admin API 2026-07、実装は PR #12）。

## 7. 開発・プレビュー

```bash
npm run dev          # 現在 config use 中の toml
npm run dev:public
npm run dev:custom
```

- `shopify app dev` がトンネル・拡張プレビューを提供（テンプレート README / 既存 docs）。
- Theme の見た目確認はテーマエディタでブロック追加（docs 記載の運用）。

## 8. ビルド・品質・テスト

| コマンド | 内容 |
|----------|------|
| `npm run lint` | ESLint |
| `npm run typecheck` | `react-router typegen` + `tsc --noEmit` |
| `npm run build` | `react-router build` |
| テスト | **test スクリプト・`*.test.*` / `*.spec.*` ファイルなし**（調査時点） |

## 9. デプロイ運用（GitHub → Render + Shopify）

owner・引き継ぎ・品質ゲート・承認条件と環境別の実設定は [`APP_AND_RENDER_CONFIG.md`](./APP_AND_RENDER_CONFIG.md) を正本とする。共通規則を本書に複製しない。

1. 専用branchをpushしてPRを作成する。mainへのdirect commit/pushは禁止。Ciaraのmain / On Commitは初期設定監査で確認済みで、main mergeはbackend production releaseとなる。公開用Renderの実設定は未確認。
2. 拡張・App Proxy設定のShopify反映は公開用／自社用それぞれの別release経路。旧deploy docsのコマンドは参照用で、本依頼ではmerge・deploy・publish・rollbackを停止する。
3. リポジトリ内GitHub Actionsワークフローなし。品質結果はPRに記録し、既存lint失敗をGreenと扱わない。本番DBへの接続・migrationを品質確認に使わない。

環境別コマンドの参照: `DEPLOY_STEPS.md`、`DEPLOY_AND_SCOPES.md`。実行可否は上記の共通運用・承認条件に従う。

## 10. Docker

`Dockerfile`: Node 20 Alpine、`npm ci --omit=dev`、`npm run build`、CMD `npm run docker-start`（`prisma generate` + `migrate deploy` + start）。

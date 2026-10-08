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
read_inventory, read_locations, read_products, read_shipping, write_app_proxy, write_products
```

用途の説明: `REQUIREMENTS.md` §14.5、`APP_REVIEW_SUBMISSION.md`。
※ `write_products` は現行で商品書き込み未使用との記載あり（審査時の説明用に保持、と同 docs）。

### Webhooks

- `app/uninstalled` → `/webhooks/app/uninstalled`
- `app/scopes_update` → `/webhooks/app/scopes_update`
- compliance: `customers/data_request`, `customers/redact`, `shop/redact` → `/webhooks/compliance`
- `api_version = "2026-01"`

## 2. 認証

| 経路 | API |
|------|-----|
| 管理画面 | `authenticate.admin` |
| ログイン | `/auth/*`, `auth.login` |
| App Proxy | `authenticate.public.appProxy` |
| Webhook | `authenticate.webhook`（compliance 含む） |

- セッションストレージ: `@shopify/shopify-app-session-storage-prisma`
- 期限切れオフライントークン: `future.expiringOfflineAccessTokens` + `refresh-offline-session.js`（App Proxy で期限前 refresh・失敗時は握りつぶさず再認可エラー、GraphQL 認証失敗後に 1 回 refresh→再試行、refresh 無し非期限付きは token-exchange 移行）。手順: `docs/OFFLINE_SESSION_CIARA_REPRO.md`

Admin GraphQL API バージョン（アプリコード）: `ApiVersion.October25`（`shopify.server.js`）。toml の webhooks `2026-01` とは別に設定されている。

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

配送: `deliveryProfiles(first: 50)` → location groups / zones / methodDefinitions。

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

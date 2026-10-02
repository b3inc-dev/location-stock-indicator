# PROJECT_CONTEXT.md — Location Stock Indicator

最終確認: リポジトリコードおよび既存 `docs/`（2026-10 調査）。推測による仕様補完は行っていない。

## 1. 何をするアプリか

商品ページ上で、選択中バリアントの**ロケーション別 available 在庫**を表示する Shopify アプリ。

- 管理画面で閾値・文言・ロケーション表示／公開名・並び順・（Pro）エリア／近隣／店舗受け取り／分析を設定
- 設定はショップメタフィールド `location_stock.config`（JSON）に保存
- ストアフロントは Theme App Extension のブロック経由で App Proxy を呼び、JSON（`stocks` + `config`）を描画

## 2. 技術スタック（確認済み）

| 項目 | 内容 | 根拠 |
|------|------|------|
| ランタイム | Node.js（engines: `>=20.19 <22 \|\| >=22.12`） | `package.json` |
| フレームワーク | React Router v7 + `@shopify/shopify-app-react-router` | `package.json`, `app/shopify.server.js` |
| 言語 | アプリ: JavaScript（JSX）、拡張: Liquid + インライン JS | `app/`, `extensions/` |
| DB | Prisma + SQLite（Session のみ。refreshToken カラムあり） | `prisma/schema.prisma` |
| Admin API | GraphQL。`ApiVersion.October25` | `app/shopify.server.js` |
| Webhooks API version | `2026-01`（toml） | `shopify.app*.toml` |
| ホスト | Render（Docker）。公開用／自社用で別サービス | `Dockerfile`, `docs/APP_AND_RENDER_CONFIG.md` |
| 埋め込み | Theme App Extension `location-stock-theme` | `extensions/location-stock-theme/` |

**Express は使用していない。** Shopify React Router テンプレート構成。

## 3. ディレクトリ概観

```
app/                      # 埋め込み管理アプリ + App Proxy + webhooks
  routes/apps.location-stock.js   # App Proxy 本体
  routes/app.*.jsx                # 管理画面
  utils/shopPlan.server.js        # Lite/Pro・distribution
  utils/billing.js                # 課金
  analytics.server.js             # 分析メタフィールド
extensions/location-stock-theme/  # Theme App Extension
prisma/                           # Session ストレージ
docs/                             # 要件・運用・設計メモ（多数）
shopify.app.toml                  # 自社用
shopify.app.public.toml           # 公開用
```

## 4. 用語

| 用語 | 意味（本リポジトリでの用法） |
|------|------------------------------|
| stocks | App Proxy が返すロケーション別在庫配列 |
| displayName | 公開名（`publicName`）またはロケーション名 |
| available quantity | Inventory Level の `quantities(names: "available")` |
| fulfillsOnlineOrders | Shopify Location のオンライン履行フラグ |
| locationsMode | `all` / `online_only` / `custom_from_app`（スニペットの絞り込み） |
| config.future | エリア・近隣・店舗受け取り・リンク表示などの機能フラグ群 |
| Lite / Pro | 公開アプリのプラン。自社（inhouse）・開発ストアは Pro 相当 |

## 5. 既存ドキュメントマップ（重複を避けるための案内）

本ファイル群（PROJECT_CONTEXT / ARCHITECTURE / BUSINESS_RULES / SHOPIFY / DECISIONS / AGENTS）は**横断的な調査サマリ**。詳細は以下を正とする。

| 既存 docs | 主題 |
|-----------|------|
| `REQUIREMENTS.md` | 要件・経路・管理画面／スキーマ分担・future・分析・プラン・実装スナップショット |
| `IMPLEMENTATION_STATUS.md` | 要件照合（時点スナップショット） |
| `SORT_ORDER_REQUIREMENTS.md` | 並び順モード詳細 |
| `PLAN_SETTINGS_DESIGN.md` | Lite/Pro 設計・FORCE_PLAN_LITE |
| `APP_AND_RENDER_CONFIG.md` | 公開／自社 toml と Render 対応 |
| `DEPLOY_AND_SCOPES.md` | スコープ・環境変数・配送トラブルシュート |
| `DEPLOY_STEPS.md` | push / shopify deploy 手順 |
| `STORE_PICKUP_BUTTON.md` | 店舗受け取りボタン挙動 |
| `THEME_CART_INTEGRATION.md` | カート連携イベント |
| `SNIPPET_SETTINGS_REFERENCE.md` | 設定のジャンル・指定方法 |
| `SCHEMA_AND_SETTINGS_DEFINITION.md` | スキーマ項目定義 |
| `SETTINGS_SPLIT_SUMMARY.md` | 管理画面 vs カスタマイザー |
| `APP_REVIEW_SUBMISSION.md` | 審査提出情報 |
| `FINAL_ADJUSTMENTS.md` | リリース前チェックリスト |
| その他 | `CONSOLE_ERROR_ANALYSIS.md`, `NEARBY_ACCORDION_DEBUG.md` |

※ `REQUIREMENTS.md` が参照する `docs/ADMIN_UI_DESIGN_RULES.md` は**本リポジトリ内に存在しない**（2026-10 調査時点）。

## 6. 関連ドキュメント（本整備セット）

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`BUSINESS_RULES.md`](./BUSINESS_RULES.md)
- [`SHOPIFY.md`](./SHOPIFY.md)
- [`DECISIONS.md`](./DECISIONS.md)
- ルート [`AGENTS.md`](../AGENTS.md)

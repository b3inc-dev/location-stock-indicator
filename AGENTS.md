# AGENTS.md — Location Stock Indicator

エージェント・開発者がこのリポジトリで作業するときの入口。**推測で仕様を補完せず**、コードと `docs/` の記載範囲のみを根拠にする。

## プロジェクト概要

Shopify ストアフロントの商品ページに、**ロケーション別在庫**（◯/△/✕・数量・並び順・エリア/近隣・店舗受け取り等）を表示する埋め込みアプリ。

- 公開名: Location Stock（`shopify.app.public.toml`）
- 自社用: Location Stock - Ciara（`shopify.app.toml`）
- 詳細コンテキスト: [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md)

## 必読ドキュメント（優先順）

| 優先 | ファイル | 内容 |
|------|----------|------|
| 1 | [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) | 目的・構成・用語・既存 docs マップ |
| 2 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | 層構成・データフロー・責務 |
| 3 | [`docs/BUSINESS_RULES.md`](docs/BUSINESS_RULES.md) | 在庫表示・並び・フィルタ等の業務ルール（コード確認済み） |
| 4 | [`docs/SHOPIFY.md`](docs/SHOPIFY.md) | 認証・スコープ・App Proxy・Theme Extension・環境変数・デプロイ |
| 5 | [`docs/DECISIONS.md`](docs/DECISIONS.md) | 観測できる設計判断・負債・将来拡張の整合性 |

詳細・運用手順は既存 docs（`REQUIREMENTS.md`、`APP_AND_RENDER_CONFIG.md` 等）を参照。一覧は PROJECT_CONTEXT 内。

## 変更時の制約（本リポジトリの慣行）

- **アプリコード変更**と **docs のみ変更**を混ぜない（docs-only PR 可）。
- 仕様の断定は、該当ソースまたは既存 docs に根拠がある場合のみ。
- Theme App Extension の Liquid 合計は **100 KB** 制限あり（`REQUIREMENTS.md` §12）。
- テーマスキーマの interactive 設定は公式目安 **25** に対し現状超過の記載あり（`REQUIREMENTS.md` §3.1）。

## 主要コード入口

| 領域 | パス |
|------|------|
| Shopify アプリ初期化 | `app/shopify.server.js` |
| App Proxy（在庫＋config） | `app/routes/apps.location-stock.js` |
| 管理 UI | `app/routes/app.*.jsx` |
| プラン判定 | `app/utils/shopPlan.server.js` |
| 分析保存 | `app/analytics.server.js` |
| Theme Extension | `extensions/location-stock-theme/` |
| ストアフロント UI/JS | `extensions/.../snippets/location-stock-indicator.liquid` |

## ローカル開発・品質コマンド

```bash
npm run dev          # shopify app dev（現在の toml）
npm run dev:public   # 公開用 toml
npm run dev:custom   # 自社用 toml
npm run lint
npm run typecheck
npm run build
```

- **ユニット／統合テストのスクリプト・テストファイルはリポジトリに存在しない**（2026-10 調査時点）。
- デプロイ: GitHub `main` push → Render 自動デプロイ（想定）＋ `shopify app deploy`（公開用／自社用で toml 切替）。手順は `docs/DEPLOY_STEPS.md` / `docs/APP_AND_RENDER_CONFIG.md`。

## やってはいけないこと

- 未確認の仕様を docs やコードコメントに「仕様」として書くこと。
- App Proxy の認証をバイパスする経路を追加すること。
- 公開用と自社用の `SHOPIFY_API_KEY` / `SECRET` を取り違えること（別 Partners アプリ・別 Render）。

# 分析 RMW と管理 UI 英文化 — 方針（Phase 3）

巨大改修は分割する。本ドキュメントは方針のみ（実装は後続 PR）。

## 1. 分析 metafield の Read-Modify-Write 限界

現状（`app/analytics.server.js`）:

- イベントごとに月キー metafield を読み、JSON を加算して `metafieldsSet` で書き戻す。
- 同時書き込みでロストアップデートしうる。App Proxy からの高頻度呼び出しで Admin API を消費する。

方針（段階）:

1. **短期**: App Proxy GET の在庫経路から分析・課金副作用を外す（本 Phase で usage 報告は分離）。分析は既存の analytics クエリ／POST に限定。
2. **中期**: プロセス内バッファ（短い flush 間隔）または外部ストア（Postgres 等）へイベントを積み、集約書き込みにする。
3. **長期**: metafield を集計の正本にしない場合は、管理 UI が外部ストアを読む。

未実施: バッファ／外部ストア実装。本番 DB 追加は承認後。

## 2. 管理 UI 英文化（App Store 向け）

現状: 管理画面文言は日本語ハードコード。Theme `locales/en.default.json` はテンプレ残骸。

方針:

- App Store 公開アプリの管理 UI は **英語を既定**とし、日本語は後続で locale 化を検討する。
- Theme ブロックのマーチャント向け schema ラベルも英語化を検討（既存店舗の日本語ラベル変更は破壊的なので、公開アプリバージョンで切替）。
- Ciara（inhouse）は当面日本語のままでよい（同一コードのため、英語化時は両環境に影響 → 段階リリース）。

未実施: 文言置換 PR。本 Phase では方針のみ。

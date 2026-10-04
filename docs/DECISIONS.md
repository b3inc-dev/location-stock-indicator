# DECISIONS.md — 設計判断・負債・将来拡張の整合性

コードと既存 docs から**観測できる事実**と、それに基づく評価のみ。新規機能の実装方針を決め打ちしない。日付は本調査時点（2026-10）。

---

## A. 観測できる設計判断（現行）

| ID | 判断 | 根拠 |
|----|------|------|
| D1 | 設定の正本は Shop メタフィールド `location_stock.config` | 管理画面保存・App Proxy 読取 |
| D2 | ストアフロントは App Proxy JSON 駆動（SSR で在庫を描画しない） | スニペットが fetch |
| D3 | 表示ロジック（閾値・ソート・フィルタ・描画）は Theme スニペット JS 側 | `location-stock-indicator.liquid` |
| D4 | 見た目は Theme スキーマ、業務文言・閾値はアプリ管理画面 | `REQUIREMENTS.md` §3.2 |
| D5 | 公開／自社は別 Partners アプリ・別 Render。実行時は `APP_DISTRIBUTION` 等 | `APP_AND_RENDER_CONFIG.md` |
| D6 | Lite 制限は管理 UI に加え App Proxy で `future` を強制 OFF | `apps.location-stock.js` |
| D7 | 分析はメタフィールド月分割（外部 DB なし） | `analytics.server.js`, REQUIREMENTS §11 |
| D8 | Theme Extension の Liquid 容量対策としてクラス短縮・JS 圧縮済み | REQUIREMENTS §12 |
| D9 | App Proxy エラーは HTTP 200 + `ok: false` を多用 | `errorJson` コメント |

---

## B. 将来拡張との整合性評価（実装しない・評価のみ）

調査依頼で挙げられた拡張候補と、**現行コード／docs 上の状態**。

| 候補 | 現状 | 整合性・課題 |
|------|------|----------------|
| **App 管理 UI** | **実装済み**（locations / settings / analytics / plan） | 「追加で管理 UI を作る」フェーズではない。課題は UI ルール準拠確認（`FINAL_ADJUSTMENTS.md`）と、参照欠落の `ADMIN_UI_DESIGN_RULES.md` |
| **オンラインのみ初期化** | スニペット／`buildGlobalConfig` に `online_only` モードあり。**管理画面から `locationsMode` を保存する UI・action は未確認** | メタを手動設定すれば動く可能性はあるが、オンボーディングとしての「初期化」導線は未整備。デフォルトは `all` |
| **地域グループ化** | **Pro 機能として実装済み**（`groupByRegion`, `regionGroups`, アコーディオン） | 追加実装より、Lite 強制 OFF・テーマ見出しデザイン・Liquid 容量との両立が運用課題 |
| **店頭受取** | **Pro 機能として実装済み**（ボタン・Sold Out・カート・モーダル） | Shopify チェックアウト側の受取選択はテーマ／店舗設定依存（`STORE_PICKUP_BUTTON.md`）。アプリはカート追加まで |
| **Theme App Extension 化** | **既に Theme App Extension** | 「化」は完了済み。残課題はスキーマ interactive 数目安超過、Liquid 100KB、プリセット集約案（REQUIREMENTS §3.3） |

---

## C. 技術的負債・リスク（確認できたもの）

| 領域 | 観測 | 影響 |
|------|------|------|
| **Shopify 固有処理と表示ロジック** | 配送フラグ構築はサーバ、閾値・ソート・HTML 生成はスニペット。同一ドメイン知識が分散 | 変更時に両側確認が必要 |
| **Liquid / JS 責務** | 1 巨大 snippet に CSS+JS+マークアップ。ブロックは薄いラッパ | テスト困難・容量逼迫 |
| **App Proxy 責務の肥大** | 在庫取得・config 整形・配送・プラン制限・分析 GET/POST が同一ルート | 障害切り分け・レート消費が集中 |
| **API レスポンス型** | 実行時 JSON のみ。共有 TypeScript 型やスキーマ検証なし | フロント／サーバのキー不一致リスク（例: fulfills 別名フォールバックがスニペット側に存在） |
| **GraphQL／判定ロジック重複** | `DELIVERY_PROFILES_QUERY` と `isLocalDeliveryMethodName` が App Proxy と `app.locations.jsx` に重複 | キーワード追加漏れの温床（DEPLOY_AND_SCOPES も両ファイル更新を指示） |
| **variant イベント** | `variant:change` と input `change` の二重購読。`lastVariantId` で抑止 | テーマによってはどちらか一方のみ／両方発火。カバレッジはテーマ依存 |
| **Theme 埋込の処理量** | 毎回 deliveryProfiles も取得（キャッシュなし） | ストアフロント表示のたびに Admin API 消費 |
| **エラーハンドリング** | `logAppProxyError` あり。delivery 失敗は warn して空フラグ | ユーザーには配送ソートが効かない状態になりうる |
| **rate limit** | バッファ／まとめて更新は分析 docs で言及。在庫 GET ごとのキャッシュ実装は**コード上なし** | 高トラフィック・バリアント連打で制限に当たりうる |
| **cache** | アプリ階層の在庫／config キャッシュなし | 常に最新だが API 負荷大 |
| **security** | App Proxy 認証に依存。分析イベントは認証付きだがボットによる area_display 増加を docs が言及 | 個人情報は集めない方針（審査 docs）。イベント連打対策は限定的 |
| **テスト欠如** | unit/integration なし | リグレッション検知が手動・本番依存 |
| **SQLite セッション** | 単一インスタンス前提のテンプレート注記（README） | 複数インスタンス化時はセッション共有が課題になりうる |
| **スキーマ項目数** | interactive が公式目安超過の記載 | 将来の deploy／CLI で失敗するリスク（FINAL_ADJUSTMENTS） |

---

## D. テスト・デプロイ運用（現状評価）

| 項目 | 現状 |
|------|------|
| unit / integration | なし |
| Shopify dev store / `shopify app dev` | スクリプトあり（運用は手動） |
| Theme preview | Extension + テーマエディタ（手順は既存 docs） |
| lint / typecheck / build | npm scripts あり。**CI ワークフローなし** |
| GitHub → Render | Ciara main / On Commit確認済み、公開用実設定は未確認。main mergeは本番backend release。Shopify releaseは別経路。運用・承認条件は `APP_AND_RENDER_CONFIG.md` を正本とする |

---

## E. 優先順位（ドキュメント整備視点での提案）

実装は本タスク対象外。調査結果に基づく**推奨優先度**のみ。

1. **高 — 観測可能性・安全運用**: App Proxy／分析の rate・エラー監視手順の徹底（既存ログを前提）。環境変数の公開／自社取り違え防止（既存 docs の周知）。
2. **高 — 重複排除の設計準備**: deliveryProfiles 判定の単一モジュール化（実装時）。キーワード追加の二重メンテ解消。
3. **中 — `locationsMode`（online_only）のプロダクト意図の明確化**: UI で出すか、デッドコード／未配線かを決める（現状はコードのみ）。
4. **中 — Theme スキーマのプリセット集約**: 25 制限リスクへの備え（REQUIREMENTS §3.3）。
5. **中 — 在庫 App Proxy のキャッシュ方針**: 必要性を計測してから（現状キャッシュなしは事実）。
6. **低〜中 — 自動テストの最小セット**: App Proxy の純関数（`buildGlobalConfig` / `applyConfigToStocks` / 配送フラグ）から。
7. **低 — 分析の外部 DB 移行**: トラフィック増時（REQUIREMENTS §11 の記載どおり将来選択肢）。

---

## F. 関連

- 全体像: [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md)
- フロー: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- 業務ルール: [`BUSINESS_RULES.md`](./BUSINESS_RULES.md)
- Shopify 設定: [`SHOPIFY.md`](./SHOPIFY.md)

# Location Stock Indicator 実装状況

`REQUIREMENTS.md` に基づく照合結果です（確認日: 2025年2月頃）。

---

## 1. データの流れ（要件 §1）

| 経路 | 状態 | 備考 |
|------|------|------|
| 管理画面 → メタフィールド `location_stock.config` | ✅ | `app.settings.jsx` / `app.locations.jsx` で保存 |
| 商品ページ App Block → App Proxy `/apps/location-stock?variant_id=xxx` | ✅ | `app/routes/apps.location-stock.js` |
| App Proxy → config + stocks（JSON）返却 | ✅ | `buildGlobalConfig` + `applyConfigToStocks` |
| スニペット `location-stock-indicator.liquid` で表示・絞り込み・並び順 | ✅ | `filterLocations` / `sortLocations` / `getStatusSymbolAndLabel` |

---

## 2. 実装済み機能と経路（要件 §2）

### 2.1 閾値（在庫なし／残りわずか／在庫あり）

- **在庫表示設定**で `config.thresholds.outOfStockMax` / `inStockMin` を保存。
- App Proxy の `buildGlobalConfig` で `config.thresholds` を返す。
- スニペットで `appConfig.thresholds` から `settings` を更新し、`getStatusSymbolAndLabel` で判定。  
→ **経路完了 ✅**

### 2.2 ロケーション表示ルール

- **ロケーション設定**で「表示」チェックと「公開名」を保存 → `config.locations` 配列。
- App Proxy の `applyConfigToStocks` で `displayName` / `fromConfig` / `enabled` を付与。
- `buildGlobalConfig` で `config.locations`（`mode` / `usePublicName`）を返す。
- スニペットの `filterLocations` で `locationsMode`（all / online_only / custom_from_app）に応じて絞り込み。  
→ **経路完了 ✅**

### 2.3 並び順・上部固定

- **ロケーション設定**で並び順セレクトと「上部固定」ラジオ 1 件を保存 → `config.sort.mode` / `config.pinnedLocationId`。
- App Proxy で `config.sort` と `config.pinnedLocationId` を返す。
- スニペットの `sortLocations` で上部固定を先頭にし、`sortBy` でソート（`location_name_asc` / `quantity_*` / `in_stock_first` / `store_pickup_first` / `shipping_first` / `local_delivery_first`）。  
→ **経路完了 ✅**

### 2.4 在庫表示設定のその他

- 在庫マーク・在庫数ラベル・ステータスラベル・メッセージ・注意書き・クリック設定はメタフィールド → `buildGlobalConfig` → スニペットの `settings` に反映。  
→ **完了 ✅**

---

## 3. 管理画面の構成（要件 §3）

| 画面 | ファイル | 状態 | 内容 |
|------|----------|------|------|
| ホーム | `app._index.jsx` | ✅ | このアプリについて、1. ロケーション設定 StepCard、配送プロファイル案内カード、2. 在庫表示設定 StepCard |
| 在庫表示設定 | `app.settings.jsx` | ✅ | 閾値・在庫マーク・在庫数テキスト・ステータスラベル・メッセージ・注意書き・クリック設定（並び順はなし） |
| ロケーション設定 | `app.locations.jsx` | ✅ | 表示ルール（チェック＋公開名）、並び順セレクト、上部固定ラジオ、一覧テーブル（配送／ローカルデリバリー／店舗受け取りは API から表示）。スマホ時はテーブル横スクロール。配送案内はホームに集約のためロケーション設定最上部にはなし。 |

---

## 4. エラーログ（要件 §4）

- App Proxy 内で `logAppProxyError(shop, variantId, code, message, err)` を呼び出し、`console.error` で JSON 出力。  
→ **実装済み ✅**

---

## 5. スコープ・API（要件 §5）

- `read_shipping` で `deliveryProfiles` と `Location.localPickupSettingsV2` を取得。
- 店舗受け取りは `localPickupSettingsV2` の有無で判定。
- 配送／ローカルデリバリーは `deliveryProfiles` のゾーン名・配送方法名から判定（`isLocalDeliveryMethodName`）。  
→ **実装済み ✅**

---

## 6. デバッグ・運用（要件 §6）

- ロケーション設定を `?debug=delivery` で開くと、サーバーログに `[location-stock] deliveryProfiles:` および `deliveryFlags map` を出力。  
→ **実装済み ✅**（`app.locations.jsx` loader 内）
- App Proxy の `locationGroupZones` / `methodDefinitions` / `locationGroup.locations` は、`nodes` が無い場合に `edges` から取り出すフォールバックを管理画面側で実装。App Proxy 側は `nodes` のみ参照しているため、必要に応じて App Proxy にも同様のフォールバックを追加可能。

---

## 7. 参照ドキュメント（要件 §7）

| ドキュメント | 場所 | 備考 |
|--------------|------|------|
| `SORT_ORDER_REQUIREMENTS.md` | **作成済み** | 並び順モード・上部固定・データの流れを記載。 |
| `ADMIN_UI_DESIGN_RULES.md` | ワークスペース直下 `docs/ADMIN_UI_DESIGN_RULES.md` | 管理画面 UI はこのルールに合わせる（.cursorrules の指示）。 |
| `DEPLOY_AND_SCOPES.md` | `location-stock-indicator/docs/` に存在 | デプロイ・スコープ・ローカルデリバリーのトラブルシュート用。 |

---

## 8. 今後の進行案

- **動作確認**: 管理画面で閾値・ロケーション表示・並び順・上部固定を変更し、商品ページの App Block で表示が変わるか確認。
- **App Proxy の edges フォールバック**: ✅ 実装済み。`getNodes(connection)` を追加し、`locationGroup.locations` / `locationGroupZones` / `methodDefinitions` で `nodes` が無い場合に `edges` から取得するようにした。
- **ドキュメント**: ✅ `docs/SORT_ORDER_REQUIREMENTS.md` を追加済み。

---

## 9. チャットサマリー（2025-12-21）要件の照合

`location-stock-indicator-chat-summary-2025-12-21.md` に記載された内容が満たされているかの確認結果です。

| セクション | 内容 | 状態 |
|------------|------|------|
| **1. 引き継ぎ（全体）** | App Proxy・config 構造・テーマの役割 | ✅ 現行実装と一致 |
| **2-1. rowContentMode** | 5 パターン（symbol_only / symbol_and_quantity / symbol_quantity_label / quantity_only / quantity_label）で在庫表示を統合。`buildQuantityHtml`・`buildStatusHtml` が `rowContentMode` のみで制御 | ✅ スニペットに実装済み |
| **2-2. App Proxy エラー** | `data.ok === false` のときエラー扱いにして error メッセージ表示（在庫ゼロと誤認しない） | ✅ スニペットの fetch 後でチェック済み |
| **2-3. 改行反映** | メッセージ文言・注意書きの改行（`\n`）を表示するため `white-space: pre-line` を `.location-stock-indicator__body` と `.location-stock-indicator__notice` に適用 | ✅ スニペットの CSS に追加済み |
| **2-4 / 2-5** | 編集場所・deploy フロー | ✅ ドキュメントどおり（extension 配下を編集・deploy） |
| **3. 今後の流れ** | バックエンド安定化・future 拡張・UX 微調整 | 将来 TODO（本ドキュメントの「満たす要件」の対象外） |

**結論**: チャットサマリーに書かれた「このチャットで進行した内容」および「次のチャットへの引き継ぎ」に含まれる要件は、いずれも満たされています。

以上が現時点の実装状況と、進行のためのメモです。

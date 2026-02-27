# Location Stock Indicator 要件・実装メモ

## 1. データの流れ（サイト経路）

- **管理画面**で保存した内容は、ショップのメタフィールド `location_stock.config`（JSON）に保存される。
- **商品ページ**では、テーマの App Block が **App Proxy**（`/apps/location-stock?variant_id=xxx`）を呼び出す。
- App Proxy はメタフィールドを読み、在庫リスト（`stocks`）とグローバル設定（`config`）を JSON で返す。各 stock には在庫数・表示名に加え、並び順用の `hasShipping` / `hasLocalDelivery` / `storePickupEnabled` を付与する（`deliveryProfiles` と `Location.localPickupSettingsV2` から取得）。
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

**補足（実装済み）**: App Proxy で各 stock に `hasShipping` / `hasLocalDelivery` / `storePickupEnabled` を付与（`deliveryProfiles` と `Location.localPickupSettingsV2` から取得）。スニペットの `sortLocations` で `location_name_asc` / `quantity_desc` / `quantity_asc` / **上部固定** に加え、`in_stock_first` / `store_pickup_first` / `shipping_first` / `local_delivery_first` の 4 種のソート分岐を実装済み。

---

### 2.4 在庫表示設定のその他

- **在庫マーク**（◯△✕）、**在庫数ラベル・前後の文字**、**ステータスラベル**、**メッセージ文言**、**注意書き**、**クリック設定**  
  → いずれもメタフィールド → `buildGlobalConfig` → スニペットで `appConfig` から `settings` に反映。  
- **並び順**はロケーション設定に集約してあり、在庫表示設定には並び順の項目はない。

---

## 3. 管理画面の構成

- **ホーム**（`app._index.jsx`）  
  「このアプリについて」、**1. ロケーション設定**（StepCard）、**「配送対応」「ローカルデリバリー対応」について**（案内カード：配送プロファイルの説明と「配送設定を開く」ボタン・別タブで Shopify の配送設定を開く）、**2. 在庫表示設定**（StepCard）。
- **在庫表示設定**（`app.settings.jsx`）  
  閾値（一番上）、在庫マーク、在庫数テキスト、ステータスラベル、メッセージ、注意書き、クリック設定のみ。並び順はなし。
- **ロケーション設定**（`app.locations.jsx`）  
  表示ルール（ロケーション一覧のチェック＋公開名）、並び順（セレクト）、上部固定（ラジオ 1 件）、ロケーション一覧テーブル（表示・公開名・並び順・上部固定・表示）。配送対応／ローカルデリバリー対応／店舗受け取り対応は、API（`localPickupSettingsV2`・`deliveryProfiles`）から取得して行ごとに表示。スマホ時はテーブルを横スクロール可能にし、ロケーション名列に最小幅を指定。配送プロファイルの案内バナーはホームに集約済みのため、ロケーション設定ページ最上部には置かない。

---

## 4. エラーログ

- App Proxy 内で `logAppProxyError(shop, variantId, code, message, err)` を呼び出し、エラー時にショップ・variant_id・コード・メッセージを JSON で `console.error` する。
- 管理画面の `deliveryProfiles` 取得失敗時は `[location-stock]` プレフィックスでワーニングを出力。

---

## 5. スコープ・API

- **read_shipping**: 配送プロファイル（`deliveryProfiles`）と `Location.localPickupSettingsV2` の取得に使用。未付与だと配送対応・ローカルデリバリー対応は取得されない。本アプリでは `read_shipping` をスコープに含めている。
- 店舗受け取り対応は `Location.localPickupSettingsV2` の有無で判定。
- **配送対応・ローカルデリバリー対応の判定**: `deliveryProfiles` の `profileLocationGroups` → `locationGroup.locations` と `locationGroupZones`（`zone.name` および `methodDefinitions` の名前）からロケーション単位でフラグを構築。ローカルデリバリーは API に methodType がないため、**ゾーン名・配送方法名**で判定（`isLocalDeliveryMethodName`）。キーワード例: `local` / `ローカル` / `local delivery` / `当日` / `近距離` / `半径` / `地域配達` など。ロケーションが配送プロファイルのロケーショングループに割り当てられていないと表示されないため、ホームの案内カードから「配送設定を開く」で Shopify の設定へ誘導している。

---

## 6. デバッグ・運用

- **配送プロファイルのデバッグ**: ロケーション設定ページを `?debug=delivery` 付きで開くと、サーバーログに `[location-stock] deliveryProfiles:`（プロファイル数・グループ数）、各グループのゾーン名・ロケーション ID、`deliveryFlags map` が出力される。ローカルデリバリーが表示されない場合は、該当ロケーションがプロファイルに含まれているか・ゾーン名がキーワードに合っているかを確認する。
- **API の edges/nodes**: `locationGroupZones`・`methodDefinitions`・`locationGroup.locations` は、接続型で `nodes` のない場合は `edges` から取り出すフォールバックを実装済み。

---

## 7. 参照ドキュメント

- 並び順の詳細: `docs/SORT_ORDER_REQUIREMENTS.md`（存在する場合）
- 管理画面 UI ルール: `docs/ADMIN_UI_DESIGN_RULES.md`（存在する場合）
- デプロイ確認・スコープ・ローカルデリバリーのトラブルシュート: `docs/DEPLOY_AND_SCOPES.md`
- 店舗受け取りボタンの挙動と Shopify の流れ: `docs/STORE_PICKUP_BUTTON.md`

---

## 8. バックエンド安定化（今回実装対象）

- **目的**: App Proxy の `missing_admin_client` 等のエラーを減らし、発生時にも原因を特定しやすくする。
- **対応内容**:
  - **環境変数の整備**: デプロイ先（例: Render）で、Shopify 管理画面 API クライアント初期化に必要な環境変数（`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES` / `SHOPIFY_API_SCOPES` など）が正しく設定されていることを確認する手順をドキュメント化する。販売用アプリとカスタムアプリで別サービス／別環境変数を使う場合は、それぞれの確認項目を明記する。
  - **エラーログの整理**: App 側（App Proxy および管理画面）で、エラー発生時に「どのルート・どのストア（shop）・どの variant_id（該当する場合）」でエラーが出たかをログに含める。既存の `logAppProxyError(shop, variantId, code, message, err)` を活用しつつ、管理画面の API エラー時も同様にショップや操作内容が分かるようにする。

---

## 9. config.future の拡張（今回実装対象）

- **目的**: メタフィールドの `config.future` に定義済みのフラグを、スニペット側で解釈し、表示や動線に反映する。
- **保存**: 既に `buildGlobalConfig` で `config.future` を返している。管理画面で編集する場合は、在庫表示設定または専用画面からメタフィールドの `config.future` を更新する。
- **実装対象のフラグと挙動**:

| フラグ | 意味 | スニペット側の挙動（実装する内容） |
|--------|------|-----------------------------------|
| `groupByRegion` | ロケーションをエリア（地域）単位でグルーピングする | ロケーションに地域情報（住所や region など）を紐づけ、同じ地域ごとにまとめて表示する。地域の定義はロケーションの住所／管理画面で設定する項目に依存する。 |
| `regionAccordionEnabled` | エリアごとに折りたたみ表示にする | `groupByRegion` が有効なとき、各地域をアコーディオン（開閉）で表示する。 |
| `nearbyFirstEnabled` | 近隣店舗を優先表示する | 利用者の位置情報（Geolocation API 等）または設定された「基準地点」に近いロケーションをリストの上位に表示する。 |
| `nearbyOtherCollapsible` | 近隣以外の店舗を折りたたみで表示する | `nearbyFirstEnabled` が有効なとき、近隣以外のロケーションを「その他の店舗」などでまとめて折りたたみ表示する。 |
| `showOrderPickButton` | 「この店舗で受け取る」ボタンを表示する | 行ごとまたはロケーションごとに、店舗受け取り用のボタンを表示する。 |
| `orderPickButtonLabel` | 上記ボタンのラベル文言 | ボタンに表示するテキスト（例:「この店舗で受け取る」）。 |

- **並び順のチューニング**: 既存の `config.sort.mode`（在庫あり優先・指定ロケーション優先など）に加え、必要に応じて「在庫がある店舗をより細かく優先」「指定ロケーションを常に先頭」などのルールをスニペットの `sortLocations` で一貫して扱う。詳細は `docs/SORT_ORDER_REQUIREMENTS.md` と整合させる。

---

## 10. テーマ側の UX 微調整（今回実装対象）

- **目的**: 商品ページ上の在庫表示ブロックの見やすさ・使いやすさを上げる。
- **対応内容**:
  - **スマホ時の表示**: スマホ時の表示バランス（行間・フォントサイズ・余白）を調整する。テーマ拡張のスニペット／ブロックの CSS で、メディアクエリ（`@media (max-width: 767px)`）を用いてモバイル向けのスタイルを定義する。※ 実装済み：スニペットの CSS にモバイル向けの行間・パディング・フォントサイズを追加済み。
  - **注意書きの可読性**: 複数行の注意書きが長い場合の余白・改行・最大高さ（必要ならスクロール）を調整し、読みやすくする。既存の `white-space: pre-line` を維持しつつ、余白やフォントサイズを調整する。※ 実装済み：`.location-stock-indicator__notice` に `max-height: 8em` と `overflow-y: auto` を指定済み。
  - **在庫ゼロ時のメッセージ**: 商品の性質（通常販売・受注生産・予約商品など）に合わせて、在庫ゼロ時に表示する文言を差し替え可能にする。**運用**：管理画面の **在庫表示設定** → **メッセージ文言** の「在庫なしメッセージ」（`messages.empty`）で設定する。ここで入力した文言が、商品ページで在庫が 0 件のときにそのまま表示される。商品ごとにメタフィールドで出し分ける必要がある場合は、今後の拡張で App Proxy またはスニペット側の分岐で対応する。

# Location Stock（店舗在庫表示アプリ）要件書

このドキュメントは、チャットまとめ（location-stock-indicator-chat-summary-2025-12-21.md）と現在の実装を照合し、**要件**として整理したものです。公開アプリ「Location Stock」および自社用カスタムアプリ「Location Stock - Ciara」の両方に共通して適用されます。

---

## 1. 概要

### 1.1 目的

- Shopify の**商品ページ**に、**ロケーション（店舗）ごとの在庫状況**を表示する機能を提供する。
- ストアオーナーはアプリ管理画面で閾値・マーク・文言などを設定し、テーマ側ではレイアウトや見た目を制御できるようにする。

### 1.2 アプリの種類と運用

| 種類 | 設定ファイル | アプリ名（表示） | 用途 |
|------|--------------|------------------|------|
| **公開用** | `shopify.app.public.toml` | Location Stock | App Store 販売・一般ストア向け |
| **自社用** | `shopify.app.toml` | Location Stock - Ciara | Ciara 店舗専用カスタムアプリ |

- **同じコードリポジトリ**を共有し、toml の切り替え（`shopify app config use ...`）で接続先アプリを切り替える。
- ルール：**ファイル名に `public` がつく toml ＝ 公開用**、デフォルトの `shopify.app.toml` ＝ 自社用。

### 1.3 技術構成

- **バックエンド**: Shopify アプリ（Node.js + React Router）
- **ストアフロント表示**: Theme App Extension（Liquid スニペット）＋ **App Proxy**
- **設定の保存**: ショップのメタフィールド `location_stock.config`（JSON）

---

## 2. アーキテクチャと責務の分離

### 2.1 アプリ側の役割

- バリアントIDに紐づく**在庫レベル**を GraphQL で取得する。
- ショップのメタフィールド `location_stock.config` を読み、**グローバル設定（閾値・マーク・文言・並び順など）** を組み立てる。
- App Proxy 経由で **JSON**（`config` と `stocks`）を返す。
- 管理画面で「設定」と「ロケーション一覧（表示ON/OFF・表示名・並び順）」を編集し、同じメタフィールドに保存する。

### 2.2 テーマ側（Theme Extension）の役割

- App Proxy から受け取った **`config`** を元に、**在庫マーク・ラベル・メッセージ文言**を決定して表示する。
- **レイアウト（table / list / stacked）**、凡例・注意書きの**位置**、**枠線・余白・色・フォントサイズ**など見た目はテーマのブロック設定で制御する。
- テーマを差し替えてもアプリを使い回せるよう、**アプリ＝データと設定**・**テーマ＝見た目**と責務を分離する。

### 2.3 編集・反映の流れ

- スニペットの編集は **アプリの Theme Extension** 内のファイル（`extensions/location-stock-theme/snippets/location-stock-indicator.liquid`）で行う。
- テーマに手動でコピーした別の snippet は **アプリ extension とは別物**のため、App Extension 経由で使う場合は必ず extension 配下を更新し、`shopify app deploy` で反映する。

---

## 3. 機能要件

### 3.1 App Proxy API

#### 3.1.1 エンドポイント

- **URL**: `/apps/location-stock?variant_id={variant_id}`
- **認証**: Shopify の App Proxy 認証（`shopify.authenticate.public.appProxy`）

#### 3.1.2 正常時のレスポンス構造

```json
{
  "ok": true,
  "variantId": "12345678",
  "variantTitle": "...",
  "config": { ... },
  "stocks": [
    {
      "locationId": "gid://shopify/Location/...",
      "locationName": "店舗名",
      "displayName": "表示名（メタで上書き可）",
      "fulfillsOnlineOrders": true,
      "quantity": 5,
      "sortOrder": 0,
      "fromConfig": true
    }
  ]
}
```

- **config**: グローバル設定（後述）。
- **stocks**: ロケーションごとの在庫配列。メタフィールドの `locations` 設定に基づき `displayName`・`sortOrder`・`enabled` が反映され、`sortOrder` および `locationName` でソートされた順で返す。

#### 3.1.3 エラー時のレスポンス

- `ok: false` とし、`error`（コード）と `message`（文言）を返す。
- 例: `missing_admin_client`、`missing_variant_id`、`graphql_error`、`internal_error`
- HTTP ステータスは 200 のままとし、Shopify のエラーページ表示を避ける。

#### 3.1.4 フロント（snippet）のエラー扱い

- `data.ok === false` のときは **在庫なし** ではなく **エラー** とみなし、`config.messages.error` を表示する。
- `!data || data.ok === false` をチェックし、`console.error` でログを出したうえでエラーメッセージに切り替える。

---

### 3.2 グローバル設定（config）

App がメタフィールドとデフォルトから組み立て、App Proxy のレスポンスで返す `config` の項目は以下のとおりとする。

#### 3.2.1 閾値（thresholds）

| キー | 説明 | デフォルト |
|-----|------|------------|
| `outOfStockMax` | この値以下を「在庫なし」とする | 0 |
| `inStockMin` | この値以上を「在庫あり」とする | 5 |

- その間は「残りわずか」。

#### 3.2.2 在庫マーク（symbols）

| キー | 説明 | デフォルト |
|-----|------|------------|
| `inStock` | 在庫ありのマーク | ◯ |
| `lowStock` | 残りわずかのマーク | △ |
| `outOfStock` | 在庫なしのマーク | ✕ |

#### 3.2.3 ステータスラベル（labels）

| キー | 説明 | デフォルト |
|-----|------|------------|
| `inStock` | 在庫ありのラベル | 在庫あり |
| `lowStock` | 残りわずかのラベル | 残りわずか |
| `outOfStock` | 在庫なしのラベル | 在庫なし |

#### 3.2.4 行内表示モード（quantity.rowContentMode）

1つのモードで「マーク・数量・ラベル」の出し分けを制御する。

| 値 | 表示内容 |
|----|----------|
| `symbol_only` | マークのみ（◯ / △ / ✕） |
| `symbol_and_quantity` | マーク ＋ 在庫数 |
| `symbol_quantity_label` | マーク ＋ 在庫数 ＋ ステータスラベル |
| `quantity_only` | 在庫数のみ |
| `quantity_label` | 「在庫」ラベル付き数字 ＋ ステータスラベル（例: (在庫 5) 在庫あり） |

- テーマ側は「在庫を表示する/しない」などの細かいフラグではなく、**rowContentMode のみ**で制御する。

#### 3.2.5 数量まわり（quantity）

- `quantityLabel`: 例「在庫」
- `wrapperBefore` / `wrapperAfter`: 数量の前後の文字（例 `(` と `)`）
- 上記 rowContentMode と組み合わせて表示を決定する。

#### 3.2.6 ロケーション表示ルール（locations）

- `mode`: `all`（全ロケーション）/ `online_only`（オンライン注文対応のみ）/ `custom_from_app`（メタフィールドで有効にしたもののみ）
- `usePublicName`: メタフィールドの `publicName` を表示名に使うか

#### 3.2.7 メッセージ・注意書き（messages / notice）

- **messages**: `loading` / `empty` / `error` の文言。改行（`\n`）を含め可能で、フロントでは `white-space: pre-line` により行分けして表示する。
- **notice**: 共通の注意書き。`notice.text`。同様に改行を反映する。

#### 3.2.8 並び順（sort）

- `sort.mode`: `none` / `location_name_asc` / `quantity_desc` / `quantity_asc` など（実装に合わせて利用）。

#### 3.2.9 クリック動作（click）

- `action`: `none` / `open_map` / `open_url`
- `mapUrlTemplate`: 地図URLテンプレート（例 `https://maps.google.com/?q={location_name}`）
- `urlTemplate`: 任意URLテンプレート（例 `/pages/store-{location_id}`）

#### 3.2.10 将来拡張用（future）

以下のフラグは将来の拡張用として config に含める。実装は未対応でもよい。

- `groupByRegion`: ロケーションをエリア単位でグルーピング
- `regionAccordionEnabled`: エリアごとに折りたたみ表示
- `nearbyFirstEnabled` / `nearbyOtherCollapsible`: 近隣店舗優先表示
- `showOrderPickButton` / `orderPickButtonLabel`: 「この店舗で受け取る」ボタン

---

### 3.3 メタフィールド（location_stock.config）

- **Namespace**: `location_stock`
- **Key**: `config`
- **型**: JSON

保存する主な構造（アプリ管理画面から編集）:

- `thresholds`, `symbols`, `labels`, `messages`, `notice`, `quantity`, `sort`, `click`, `future`, `locationsMode`, `usePublicName`
- **locations**: 配列。各要素に `locationId`, `enabled`, `publicName`, `sortOrder` を持たせ、ロケーションの表示ON/OFF・表示名・並び順を制御する。

---

### 3.4 管理画面

管理画面の UI は **docs/ADMIN_UI_DESIGN_RULES.md**（共通ルール）に準拠する。以下は Location Stock での実装内容。

#### 3.4.1 在庫表示設定（app.settings）

- **役割**: 閾値・マーク・ラベル・メッセージ・注意書き・並び順（sort.mode）・クリック設定・数量まわり・ステータスラベルを編集し、`location_stock.config` に保存する。
- **レイアウト**: 各セクションで**左にタイトル＋説明文のみ**（カードなし）、**右に設定用の白カード**を配置。セクション例：在庫マーク、並び順、在庫数のテキスト・単位、在庫ステータスのラベル、メッセージ文言、注意書き、ロケーション名クリック時の動作。
- **保存**: フォーム送信は行わず、state で編集内容を保持。**固定フッター**は**変更があるときだけ**表示し、左にステータス文言（保存中... / 未保存の変更があります / 保存しました（約3秒） / エラー時はメッセージ）、右に「破棄」「保存」ボタン。保存ボタンは送信中「保存中...」に変更。保存完了後は「保存しました」を約3秒表示してからフッターを非表示にする。
- **「在庫表示設定について」などの説明用カード**: 不要として表示しない（左側のタイトル＋説明で足りる）。

#### 3.4.2 ロケーション設定（app.locations）

- **役割**: 各ロケーションの「表示する/しない」「表示名（公開名）」「並び順」を編集し、同じメタフィールド内の `locations` に保存する。
- **レイアウト**: **左右カードではなく**、上段に**タイトル＋説明文のみ**（カードなし）、その下に**100%幅**の白カード1枚でテーブルを配置する（共通ルールのイレギュラー扱い）。
- **テーブル列**:
  - **ロケーション名**: Shopify のロケーション名（およびオンライン注文対応の注釈）。列名は「ロケーション名」とする。
  - **公開名（表示名）**: 入力欄。列は `minWidth: 240` で幅を確保。
  - **並び順**: **数値入力**と**上下ボタン（↑ / ↓）**を横並び。数値で直接変更した場合はリストを sortOrder でソートして更新。上下ボタンで行を入れ替え、sortOrder を 1, 2, 3... で振り直す。列幅は 120px 程度。
  - **表示**: チェックボックス（表示 ON/OFF）。
- **一覧の並び**: loader でロケーション一覧を取得したあと、**sortOrder の昇順でソート**してから返す。画面表示・再読み込み時も常に設定している並び順でリスト表示する。
- **保存**: 固定フッターは変更時のみ表示。保存成功は「保存しました」を約3秒表示。同じ保存レスポンスで二重にフッター表示・state 上書きが起きないよう ref で制御する。

---

### 3.5 Theme App Extension（ブロック・スニペット）

#### 3.5.1 ブロック設定（テーマエディタで編集可能な項目）

- タイトル（文言・揃え・マージン）
- レイアウト: **table** / **list** / **stacked**
- ロケーション名・在庫表示の揃え、文字サイズ、最大幅、ブロック全体の配置
- 凡例・注意書きの表示有無・位置・揃え
- **行内の表示内容**: `row_content_mode`（symbol_only / symbol_and_quantity / symbol_quantity_label / quantity_only / quantity_label）
- リスト区切り文字、行の余白、枠線（なし/行のみ/外枠+行）、枠線の太さ・色
- タイトル・凡例・注意書き・在庫ステータス・各マーク（◯△✕）の色
- テーブル時のロケーション列幅、追加CSS

#### 3.5.2 スニペットの挙動

- `config`（ブロック設定）と、App Proxy から取得した `data.config` / `data.stocks` を使って表示を組み立てる。
- ローディング中は `config.messages.loading`、在庫0件は `config.messages.empty`、エラー時は `data.ok === false` を検知して `config.messages.error` を表示する。
- メッセージ・注意書きは `white-space: pre-line` で改行を反映する。

---

## 4. 非機能・運用

### 4.1 デプロイ

- 自社用: `shopify app config use shopify.app.toml` のうえで `shopify app deploy`
- 公開用: `shopify app config use shopify.app.public.toml` のうえで `shopify app deploy`
- 拡張機能（theme extension）の更新は、デプロイ後に Shopify 管理画面のアプリ → 拡張機能からテーマへ適用する。

### 4.2 エラー・ログ

- App 側で `missing_admin_client` 等が発生した場合、Render 等の環境変数（`SHOPIFY_API_KEY` 等）を確認する。
- 公開用と自社用で別サービス・別環境変数を使う場合は、それぞれ正しく設定する。
- どのストア・どのバリアントでエラーが出たか特定しやすいよう、必要に応じてログを残す。

---

## 5. 残要件・将来要件（TODO）

### 5.1 残要件一覧

以下は要件として認識しているが、未実装または一部のみ実装のもの。公開アプリのリリースには必須ではない。

| 分類 | 項目 | 現状 | 備考 |
|------|------|------|------|
| **config.future の UI** | エリアグルーピング（groupByRegion） | 未実装 | config とスニペットの settings には値が渡っているが、グループ表示の UI なし |
| **config.future の UI** | エリアごと折りたたみ（regionAccordionEnabled） | 未実装 | 同上 |
| **config.future の UI** | 近隣店舗優先表示（nearbyFirstEnabled / nearbyOtherCollapsible） | 未実装 | 同上 |
| **config.future の UI** | 「この店舗で受け取る」ボタン（showOrderPickButton） | 未実装 | 同上。ボタン表示・クリック動線なし |
| **並び順** | 在庫ありの店舗を優先して表示 | 未実装 | 名前昇順・数量昇順/降順（sort.mode）はスニペット側で実装済み |
| **並び順** | 指定ロケーションを最優先で表示 | 未実装 | メタの sortOrder による並びは実装済み |
| **UX** | スマホ時の表示バランス・行間・フォント調整 | 未対応 | 要件として列挙のみ |
| **UX** | 在庫ゼロメッセージの商品種別別差し替え | 未対応 | 受注生産・予約商品など文言を差し替えたい場合 |
| **運用** | エラーログの整理 | 推奨 | どのストア・どのバリアントでエラーか特定しやすくする（4.2 参照） |

### 5.2 将来対応する機能（詳細）

以下の機能は要件として認識し、実装優先度に応じて対応する。

- **config.future** の各フラグの具体実装
  - `groupByRegion` … ロケーションをエリア単位でグルーピング
  - `regionAccordionEnabled` … エリアごとに折りたたみ表示
  - `nearbyFirstEnabled` / `nearbyOtherCollapsible` … 近隣店舗を優先表示
  - `showOrderPickButton` / `orderPickButtonLabel` … 「この店舗で受け取る」ボタンの表示とクリック動線
- **並び順**の細かい制御
  - 在庫ありの店舗を上位に表示するオプション
  - 指定ロケーション（例：本店）を常に最優先で表示するオプション
- **テーマ側の UX 微調整**
  - スマホ時の表示バランス・行間・フォントサイズ調整
  - 複数行の注意書きが長い場合の余白・可読性
- **メッセージの差し替え**
  - 在庫ゼロ時のメッセージを商品種別（受注生産品・予約商品など）に合わせて変更できるようにする

---

## 6. 参照

- チャットまとめ: `location-stock-indicator-chat-summary-2025-12-21.md`
- **共通 UI ルール**: `docs/ADMIN_UI_DESIGN_RULES.md`（ShopifyApps リポジトリ直下の `docs/`）
- 実装:  
  - App Proxy: `app/routes/apps.location-stock.js`  
  - 在庫表示設定: `app/routes/app.settings.jsx`（左説明・右カード、固定フッター、state + useFetcher、保存完了フィードバック）  
  - ロケーション設定: `app/routes/app.locations.jsx`（上説明・下100%カード、テーブル、並び順＝数値入力＋↑↓、loader で sortOrder ソート）  
  - スニペット: `extensions/location-stock-theme/snippets/location-stock-indicator.liquid`  
  - ブロック: `extensions/location-stock-theme/blocks/location-stock-indicator.liquid`

# Location Stock — Shopify アプリ審査提出用情報

このドキュメントは、Shopify App Store への審査申請時に Partner Dashboard や申請フォームへ入力する内容をまとめたものです。コピー＆ペーストや説明文の参照に利用してください。

---

## 1. アプリ概要

| 項目 | 内容 |
|------|------|
| **アプリ名** | Location Stock |
| **アプリの種類** | Embedded App（管理画面に組み込み）＋ Theme App Extension（商品ページにブロック表示）＋ App Proxy（ストアフロントからの在庫・設定取得） |

### 短い説明（リスト用・1〜2文）

商品ページに「ロケーション別の在庫状況」「近隣店舗」「店舗受け取りボタン」を表示するアプリです。管理画面で閾値・表示ルール・並び順・エリアグループ・分析を設定できます。Lite / Pro の料金プランがあります。

### 長い説明（審査・ストア掲載用）

Location Stock は、ショップの複数ロケーション（店舗・倉庫など）ごとの在庫を、商品ページでお客様に分かりやすく表示するアプリです。

**主な機能：**

- **ロケーション別在庫表示**  
  各ロケーションの在庫数や「在庫あり／残りわずか／在庫なし」を、閾値やマーク・ラベルで表示。表示するロケーションの選択、公開名・並び順・上部固定の設定が可能です。
- **エリアでのグルーピング（Pro）**  
  ロケーションをエリアでグループ化し、折りたたみ表示で見やすく整理できます。
- **近隣店舗表示（Pro）**  
  お客様の位置に基づき、近い店舗を優先して表示。近隣から除外するロケーションの指定が可能です。
- **店舗受け取りボタン（Pro）**  
  店舗受け取りが有効なロケーションの行に「この店舗で受け取る」ボタンを表示。クリックでカートに追加し、チェックアウトへ誘導するか、モーダルで案内するかを設定できます。
- **分析（Pro）**  
  ブロックの表示回数、近隣店舗クリック数、店舗受け取りボタンのクリック数などを日別で集計し、管理画面で確認できます。

設定はすべて管理画面で行い、商品ページの見た目はテーマのカスタマイザー（ブロック設定）で調整できます。Lite プランでは基本の在庫表示と並び順まで、Pro プランでは上記の全機能をご利用いただけます。

---

## 2. 権限（スコープ）と使用理由

申請画面の「Permission justification」などで、各スコープをなぜ使うかを説明する際の文案です。

| スコープ | 使用理由（英語で記載する場合の例） |
|----------|--------------------------------------|
| **read_inventory** | To display per-location stock levels for each product variant on the storefront. The app fetches inventory levels by location via the Admin API and returns them through the App Proxy to the theme block. |
| **read_locations** | To list locations (name, address, coordinates) and to determine which locations have local pickup enabled (`localPickupSettingsV2`). Used for the location table in the admin, for “nearby store” sorting by distance, and for showing the store pickup button only where pickup is available. |
| **read_products** | To fetch product variant and inventory item data when the storefront requests stock by variant (via App Proxy). Required to show per-location inventory for the selected variant on the product page. |
| **read_shipping** | To determine, per location, whether shipping and/or local delivery is configured (from delivery profiles). This is used to show “Shipping” / “Local delivery” indicators and to support sort options such as “Shipping first” or “Local delivery first” in the admin and on the storefront. |
| **write_app_proxy** | To register the App Proxy URL so that the theme block can request inventory and config from the app at `/apps/location-stock?variant_id=...`. The storefront does not have direct Admin API access; the proxy is the only way to return this data to the theme. |

**削除済みスコープ**: `write_products` — コード上商品の作成・更新は行わず、設定は Shop metafield（`metafieldsSet`）のみ。最小スコープのため両 toml から削除済み。Render の `SCOPES` 環境変数も合わせて更新すること（deploy 承認後）。

**日本語で記載する場合の例：**

- **read_inventory**：商品ページでロケーション別の在庫数を表示するため、Admin API で在庫レベルを取得し、App Proxy 経由でテーマに返しています。
- **read_locations**：ロケーション一覧（名前・住所・緯度経度）および店舗受け取りの有無（`localPickupSettingsV2`）を取得するため。管理画面のロケーション表・近隣店舗の距離ソート・店舗受け取りボタンの表示判定に使用しています。
- **read_products**：ストアフロントで選択中のバリアントの在庫を取得するため。App Proxy がバリアント ID を受け取り、商品・在庫情報を取得して返すために必要です。
- **read_shipping**：配送プロファイルから、ロケーションごとに「配送対応」「ローカルデリバリー対応」を判定するため。「配送対応」表示や「配送を先に」などの並び順に使用しています。
- **write_app_proxy**：テーマブロックが `/apps/location-stock?variant_id=...` で在庫・設定を取得できるよう、App Proxy URL を登録するために必要です。

---

## 3. データの取り扱い・プライバシー

| 項目 | 内容 |
|------|------|
| **保存するデータ** | ・ショップメタフィールド `location_stock.config`：在庫表示の閾値、ロケーション表示ルール、並び順、エリア・近隣・店舗受け取りの ON/OFF や文言など（すべて店主が管理画面で設定した内容）。<br>・ショップメタフィールド `location_stock.analytics_YYYY_MM`：Pro プランで分析を有効にしている場合、日別の「ブロック表示回数」「近隣店舗クリック数」「店舗受け取りボタンクリック数」などの集計値（数値のみ、月ごとのキーで保存）。 |
| **個人を特定するデータ** | 収集しません。分析は「表示回数」「クリック数」などの集計のみで、お客様の IP・氏名・メール等は取得・保存していません。 |
| **ストアフロントからの送信** | ・在庫取得：バリアント ID をクエリに含めて App Proxy を呼び出し、在庫と設定の JSON を受け取るだけ。<br>・分析（Pro）：`action=analytics&event=...&date=...` および必要に応じてロケーション ID をクエリで送信。サーバー側でメタフィールドに集計を加算するのみ。 |
| **第三者への提供** | しません。すべて Shopify のメタフィールドおよびアプリのセッション・DB（Prisma）内で完結します。 |

審査用の「プライバシー方針」や「データの使用」欄には、上記を要約して「設定と集計データのみを保存し、個人を特定する情報は収集しない」旨を記載するとよいです。

---

## 4. アプリの動作フロー（審査員向け簡易説明）

1. **インストール後**  
   管理画面のアプリから「ロケーション設定」「在庫表示設定」で閾値・表示ロケーション・並び順・文言等を設定。設定はショップのメタフィールド（`location_stock.config`）に保存されます。
2. **商品ページ**  
   テーマエディタで「Location stock indicator」ブロックを商品ページに追加。ブロックは App Proxy（`/apps/location-stock?variant_id=xxx`）を呼び出し、在庫と設定を JSON で受け取って表示します。
3. **ストアフロント**  
   お客様は商品ページで、ロケーション別の在庫・近隣店舗（Pro）・店舗受け取りボタン（Pro）を見て利用できます。分析が有効な場合は、表示やクリックのイベントが App Proxy 経由で送られ、メタフィールドに日別で集計されます。
4. **課金**  
   Lite（定額）／Pro（定額＋ロケーション数に応じた従量）を Billing API で管理。詳細は `docs/PLAN_SETTINGS_DESIGN.md` を参照。  
   **公開本番でプラン未選択（`plan === null`）のときはストアフロント在庫も出さない**（無料開放なし）。審査員には Lite または Pro を選択してから商品ページを確認するよう Test instructions に書く。

---

## 5. 審査員向けテスト手順（推奨）

申請前に、審査員が同じ流れで確認できるよう、以下の手順を「Test instructions」などに記載することを推奨します。

1. **インストール**  
   開発ストアにアプリをインストールし、管理画面でアプリを開く。
2. **ロケーション設定**  
   「ロケーション設定」で表示するロケーションにチェックを入れ、公開名・並び順を設定して保存。
3. **在庫表示設定**  
   「在庫表示設定」で閾値（在庫なし／在庫ありの境界）やマーク・ラベル・メッセージを設定して保存。
4. **テーマにブロック追加**  
   オンラインストアのテーマカスタマイザーを開き、商品ページに「Location stock indicator」ブロックを追加して保存。
5. **ストアフロント確認**  
   在庫を持つ商品のページを開き、ロケーション別の在庫が表示されることを確認。
6. **Pro 機能（任意）**  
   Pro プランを選択した場合、エリア設定・近隣店舗・店舗受け取りボタン・分析が有効になることを確認。

---

## 6. 申請前チェックリスト

以下は Shopify の審査要件に合わせた確認項目です。申請前に埋めておくと安心です。  
（リポジトリで確認できる項目は状態を更新。Partner Dashboard / 人手が必要な項目は未完のまま）

### リポジトリ／コードで確認済み

- [x] **Compliance Webhooks（コード）**  
  両 toml に `compliance_topics` と `uri = "/webhooks/compliance"`。`webhooks.compliance.jsx` で `authenticate.webhook` → 200。
- [x] **保護された顧客データ（方針）**  
  集計のみ・PII 非収集（本書 §3）。申請フォームでは「不要」でよい旨を維持。
- [x] **スコープ最小化解（コード）**  
  `write_products` を両 toml から削除済み。Permission justification は本書 §2（write_products なし）。
- [x] **課金ゲートと listing の一致（コード）**  
  公開・`plan === null` でストアフロント在庫を出さない（`planGate.js` / App Proxy `plan_required`）。詳細は `PLAN_SETTINGS_DESIGN.md` §3.3。

### Partner Dashboard / 運用（人手・承認後）

- [ ] **アプリ名・説明**  
  Partner Dashboard のリスト情報に、上記「短い説明」「長い説明」を反映した。
- [ ] **アプリアイコン**  
  1200×1200 px（JPEG または PNG）を用意し、申請画面で設定した。
- [ ] **デモ動画**  
  審査用の短い操作デモ（インストール→設定→商品ページ表示→プラン選択）を用意した。
- [ ] **URL・ブランド**  
  ドメインやアプリ名に「Shopify」「Example」を含めていない。
- [ ] **緊急連絡先**  
  審査・運用で使うメールアドレスと電話番号を登録した。
- [ ] **API 連絡先メール**  
  「Shopify」という語を含まないメールアドレスを設定した。
- [ ] **Render 公開側 SCOPES**  
  環境変数から `write_products` を外し、toml と一致させた（明示承認後の本番操作）。
- [ ] **オートメーションチェック**  
  Partner Dashboard の審査提出前チェック（認証・リダイレクト・アンインストール・App Bridge 等）を実行し、エラーを解消した。
- [ ] **スコープ理由の申請フォーム転記**  
  上記「2. 権限（スコープ）と使用理由」を Permission justification に記載した。
- [ ] **Test instructions**  
  審査員に Lite/Pro 選択後に商品ページを見る手順を書いた（未選択時は在庫非表示である旨を含む）。

---

## 7. 参照リンク（Shopify 公式）

- [Submit your app for review](https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review)
- [App Store requirements](https://shopify.dev/docs/apps/store/requirements)
- [About app quality checks](https://shopify.dev/docs/apps/launch/app-store-review/app-quality-checks)

---

## 8. 本アプリの技術参照

- 要件・データの流れ・実装メモ：`docs/REQUIREMENTS.md`
- プラン設計・料金・機能制御：`docs/PLAN_SETTINGS_DESIGN.md`
- 管理画面 UI ルール：`docs/ADMIN_UI_DESIGN_RULES.md`
- 店舗受け取りボタン・モーダル：`docs/STORE_PICKUP_BUTTON.md`
- デプロイ・スコープ・環境変数：`docs/DEPLOY_AND_SCOPES.md`

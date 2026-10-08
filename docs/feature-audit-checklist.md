# Location Stock — Phase 2 機能監査チェックリスト

| 項目 | 値 |
|------|-----|
| 監査対象 | `origin/main` @ `b73924474b0fb7ef3e64928153b2d181c3fbdcbd` |
| 方法 | docs ↔ コード静的突合（ストアフロント／管理画面の実操作は未実施） |
| 作成日 | 2026-10-08 |
| 方針 | Pass は推測禁止。根拠（パス＋短い注記）があるときのみ結果を付ける。挙動不一致・実装欠落は Fail。適用外は N/A。不明は Fail または 要確認 |

## サマリー

| Result | Count |
|--------|------:|
| Pass | 43 |
| Fail | 12 |
| 要確認 | 6 |
| N/A | 1 |
| **Total** | **62** |

**Fail の主な塊**: `plan === null` のストアフロント開放（G5・Phase1 PR 未マージ）、offline refresh の soft-fail（Phase0）、`open_url` の `location.id` バグ、`locationsMode` / `click.action` / `usePublicName` の管理 UI・配線欠落、App Proxy 分析のプラン未ゲート、Lite でも分析ナビ表示、未使用 `write_products`、docs の `deploy:public`/`deploy:inhouse` と `package.json` 不一致。

---

## 凡例

| 列 | 意味 |
|----|------|
| Spec source | 正本 docs（必要なら要件節） |
| Code evidence | `origin/main` 上のパスと観測 |
| Storefront/admin check | 想定確認手順。本監査は静的のため「未実施」と明記 |
| Severity | P0 提出／本番表示阻害 · P1 課金・プラン整合 · P2 機能欠落・バグ · P3 ドキュメント／DX |
| Fix PR candidate | 既存 draft PR または新規候補名 |

---

## 1. 在庫閾値・◯△✕・数量・並び・フィルタ・displayName

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| INV-01 | 閾値デフォルト `outOfStockMax=0` / `inStockMin=5` | `BUSINESS_RULES.md` §1 | `apps.location-stock.js` `buildGlobalConfig` デフォルト同値；`app.settings.jsx` loader/action が `thresholds.*` を metafield に保存 | 管理: 在庫表示設定で保存→商品ページで境界確認（未実施） | Pass | — | — |
| INV-02 | ◯ / △ / ✕ 判定順 | `BUSINESS_RULES.md` §1 | snippet `getStatusSymbolAndLabel`: `qty<=outMax`→✕、`qty>=inMin`→◯、他→△（`location-stock-indicator.liquid`） | ストア: 数量 0 / 中間 / ≥inStockMin の3点（未実施） | Pass | — | — |
| INV-03 | 記号・ラベルの管理保存と凡例反映 | `BUSINESS_RULES.md` §1, §7 | `app.settings.jsx` symbols/labels；snippet `updateLegendElements` が `記号 ラベル / …` | 管理保存→凡例文言（未実施） | Pass | — | — |
| INV-04 | 数量表示・`rowContentMode` | `BUSINESS_RULES.md` §2 | settings が `quantity.rowContentMode` 保存；snippet `buildQuantityHtml` / `buildStatusHtml` が5モード分岐 | 各 mode の行表示（未実施） | Pass | — | — |
| INV-05 | `displayName = publicName or locationName` | `BUSINESS_RULES.md` §3；`REQUIREMENTS.md` §2.2 | `applyConfigToStocks` が `displayName: cfg.publicName or stock.locationName`；未設定 loc は `locationName` | 公開名あり/なし行（未実施） | Pass | — | — |
| INV-06 | `enabled===false` を Proxy で除外 | `BUSINESS_RULES.md` §3 | `applyConfigToStocks` で `cfg.enabled === false` → `null` filter；`app.locations.jsx` `enabledLocationId` | 表示OFFの loc が商品ページに出ないこと（未実施） | Pass | — | — |
| INV-07 | `locationsMode` フィルタ（all / online_only / custom_from_app） | `BUSINESS_RULES.md` §3 | `buildGlobalConfig` → `config.locations.mode`（metafield トップ `locationsMode`）；snippet `filterLocations` | metafield 手動で mode 変更して絞り込み（未実施） | Pass | — | — |
| INV-08 | `locationsMode` 管理 UI | `BUSINESS_RULES.md` §3（UI 見当たらないと明記）；`REQUIREMENTS.md` §2.2 | `app.locations.jsx` / `app.settings.jsx` に `locationsMode` 保存フォームなし（rg 0件） | 管理から online_only 等を選べない | Fail | P2 | `cursor/locations-mode-admin-ui` |
| INV-09 | `usePublicName` / `usePublicLocationName` | `buildGlobalConfig` locations.usePublicName；SNIPPET ref | snippet は `settings.usePublicLocationName` を代入するのみで表示分岐に未使用。常に Proxy 側 `displayName` を使用 | フラグON/OFFで差が出るか（コード上差なし） | Fail | P3 | `cursor/use-public-name-wire` またはデッド設定削除 |
| SORT-01 | 並び順モード一式 | `SORT_ORDER_REQUIREMENTS.md`；`REQUIREMENTS.md` §2.3 | locations が `sort.mode` 保存；snippet `sortLocations` が none/config_order・name・qty・in_stock・pickup・shipping·local_delivery | 各 mode（未実施） | Pass | — | — |
| SORT-02 | 上部固定 `pinnedLocationId` | 同上 | Proxy が `regionKey=__pinned__`；snippet が先頭へ | 固定1件が先頭（未実施） | Pass | — | — |
| SORT-03 | 配送・受取フラグ付与 | `BUSINESS_RULES.md` §4 | Proxy: `deliveryProfiles`→`hasShipping`/`hasLocalDelivery`；`localPickupSettingsV2`→`storePickupEnabled` | 配送プロファイル有無でソート差（未実施） | Pass | — | — |
| SORT-04 | ローカルデリバリー名ヒューリスティック | `REQUIREMENTS.md` §6 系；コード `isLocalDeliveryMethodName` | キーワード（`local` / `ローカル` / `当日` 等）。誤検知・取りこぼしはストア依存 | 実ストアのゾーン名で要検証 | 要確認 | P2 | 誤判定が出たら判定モジュール共通化（Phase3） |

---

## 2. オンライン／店舗・エリア／近隣・店頭受取

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| LOC-01 | デフォルトは全 inventoryLevels（オンライン自動限定なし） | `BUSINESS_RULES.md` §5 | Proxy が levels を全件 map；online 限定は `online_only` 時のみ | 複数 loc 表示（未実施） | Pass | — | — |
| LOC-02 | `fulfillsOnlineOrders` 付与 | 同上 | baseStocks に `fulfillsOnlineOrders: !!location.fulfillsOnlineOrders`；filter が別名も受理 | online_only 時（未実施） | Pass | — | — |
| AREA-01 | エリア設定 UI（Pro）／Lite グレーアウト | `PLAN_SETTINGS_DESIGN.md` §3；`REQUIREMENTS.md` §9 | `app.locations.jsx` `ProSectionWrapper` + `isPro = inhouse or plan==="pro"`；Lite 保存時 future OFF | Lite/Pro 管理（未実施） | Pass | — | — |
| AREA-02 | Lite 時 Proxy で future Pro フラグ強制 OFF | `PLAN_SETTINGS_DESIGN.md` §5.2；`BUSINESS_RULES.md` §9 | `apps.location-stock.js` loader: `!isPro && distribution==="public"` で groupByRegion/nearby/showOrderPick 等 false | Lite ショップの商品ページ（未実施） | Pass | — | — |
| NEAR-01 | 近隣表示＋`excludeFromNearby` | `REQUIREMENTS.md` §2.4 / §9 | future.nearby*；snippet 近隣 accordion；`filter(!excludeFromNearby)` | geolocation ON（未実施） | Pass | — | — |
| PICK-01 | 店頭受取ボタン Pro ゲート | `STORE_PICKUP_BUTTON.md`；`PLAN_SETTINGS_DESIGN.md` | 管理 ProSection；Proxy Lite OFF；snippet `showOrderPickButton` | Lite でボタン非表示（未実施） | Pass | — | — |
| PICK-02 | 受取可能 loc のみボタン／在庫なしは Sold Out 文言 | `STORE_PICKUP_BUTTON.md` | `buildOrderPickButton`: `!storePickupEnabled`→""；`qty<=outMax`→out ラベル | 受取ON/OFF・在庫0（未実施） | Pass | — | — |
| PICK-03 | タップ→cart/add→任意 checkout | `STORE_PICKUP_BUTTON.md` | click handler: `fetch /cart/add.js` 後 `orderPickRedirectToCheckout` なら `/checkout`（`preventDefault` で `<a href>` 直遷移を抑止） | カート追加・モーダル（未実施） | Pass | — | — |

---

## 3. variant 変更・凡例・色・クリック

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| VAR-01 | variant 変更で再 fetch | `BUSINESS_RULES.md` §6；`ARCHITECTURE.md` §9 | `variant:change` と `form[action^="/cart/add"] [name=id]` change → `updateStocksByVariantId`；同一 id は `lastVariantId` で抑止 | テーマでバリアント切替（未実施） | Pass | — | — |
| VAR-02 | エラー後の同一 variant 再 fetch 抑止 | Phase0 プラン；fundamental-improvement-plan | 失敗時も `lastVariantId` をセット済みのため同一 variant の自動リトライなし | エラー後に再表示されない症状の再現 | Fail | P0 | Phase0 Theme 補助（PR #5 系 or Theme follow-up） |
| LEG-01 | 凡例 ON/OFF・位置・文言 | `BUSINESS_RULES.md` §7 | app `display.showLegend`；theme schema `legend_*`；`applyLegendNoticeVisibility` | カスタマイザー（未実施） | Pass | — | — |
| LEG-02 | ステータス色（テーマ） | 同上 | schema `in_stock_color` 等 → settings；`buildStatusHtml` が symbol に color | 色変更（未実施） | Pass | — | — |
| CLK-01 | `showLocationLinks` + 行 `linkUrl` | `REQUIREMENTS.md` §2.5；`BUSINESS_RULES.md` §8 | locations 保存；`applyClickAction` 最優先で `<a href=linkUrl>`（http→`_blank`） | リンク行（未実施） | Pass | — | — |
| CLK-02 | 後方互換 `click.action=open_map` | `BUSINESS_RULES.md` §8 | snippet `open_map` → `mapUrlTemplate`；`buildGlobalConfig` が click を返す | metafield 手動（未実施） | Pass | P3 | 管理 UI が無ければドキュメントのみでも可 |
| CLK-03 | `open_url` の `{location_id}` | `BUSINESS_RULES.md` §8 | `applyClickAction` が `location.id` を参照。stocks は `locationId` のみ → テンプレ置換が常に空 | open_url 利用時（未実施・コード上破綻） | Fail | P2 | `cursor/fix-open-url-location-id` |
| CLK-04 | `click.action` / map・url テンプレの管理 UI | `REQUIREMENTS.md` §2.5（主経路はリンク設定） | settings/locations に click 保存 UI なし。legacy は metafield 直編集のみ | 管理から open_map を選べない | Fail | P3 | 主経路は CLK-01 で足りるなら docs 明記／または UI 追加 |

---

## 4. 管理 UI（locations / settings / analytics / plan）

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| ADM-LOC | ロケーション設定画面 | `REQUIREMENTS.md` §13 近傍；`SETTINGS_SPLIT_SUMMARY.md` | `app.locations.jsx`: 並び・固定・公開名・表示・Pro エリア/近隣/受取・リンク | 画面操作（未実施） | Pass | — | — |
| ADM-SET | 在庫表示設定 | 同上 | `app.settings.jsx`: 閾値・記号・ラベル・数量・messages・notice・display | 画面操作（未実施） | Pass | — | — |
| ADM-AN | 分析画面（Pro） | `REQUIREMENTS.md` §11；`PLAN_SETTINGS_DESIGN.md` | `app.analytics.jsx`: `!isPro && public` で Pro 案内；Pro 時データ表示 | Lite/Pro（未実施） | Pass | — | — |
| ADM-PLAN | 料金プラン画面 | `PLAN_SETTINGS_DESIGN.md` §6 | `app.plan.jsx`: Lite/Pro カード、`createAppSubscription`、mismatch バナー | 公開アプリ（未実施） | Pass | — | — |
| ADM-HOME | ホームのプラン要約 | `REQUIREMENTS.md` | `app._index.jsx`: plan ラベル、null 時「料金プランを選択」、Lite アップセル | 公開・null（未実施） | Pass | — | — |
| ADM-NAV | ナビに分析が常時表示 | `PLAN_SETTINGS_DESIGN.md`（Lite は分析なし） | `app.jsx` s-app-nav と `AppNavBar.jsx` が Lite でも「分析」リンク固定（ページ内ゲートのみ） | Lite で分析リンクが見える | Fail | P3 | ナビを `features.analytics` で出し分け |

---

## 5. Lite/Pro 制限・10 ロケーション・`plan===null`

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| PLAN-01 | Lite で loc>10 → mismatch → `/app/plan` | `BUSINESS_RULES.md` §10；`PLAN_SETTINGS_DESIGN.md` | `shopPlan.server.js` `locationsCount>10 && plan==="lite"`；`app.jsx` redirect | Lite+11loc（未実施） | Pass | — | — |
| PLAN-02 | inhouse / 開発ストアは Pro 相当 | `PLAN_SETTINGS_DESIGN.md` §4 | `APP_DISTRIBUTION=inhouse` or `partnerDevelopment` → `plan="pro"`；features 全 true | Ciara / 開発ストア（未実施） | Pass | — | — |
| PLAN-03 | `FORCE_PLAN_LITE=1` | `BUSINESS_RULES.md` §10 | `shopPlan.server.js` 末尾で `plan="lite"` 強制 | env 付与時（未実施） | Pass | — | — |
| PLAN-04 | Pro usage 報告 | `PLAN_SETTINGS_DESIGN.md` §2.2 | `getShopPlan` 内 `reportUsageRecord`（public・非dev・pro） | 公開 Pro（未実施） | Pass | — | — |
| PLAN-05 | **`plan===null`（サブスク未）でもストアフロント在庫が出る（main）** | Phase1 G5；`planGate.js`（PR ブランチ）；`APP_REVIEW` / listing 整合 | main: Proxy は Pro future のみ OFF。基本 stocks は返す。`isPro` は `plan==="pro"` のみ。**null でも在庫 JSON 成功**。Phase1 `cursor/phase1-app-store-gates-3851` に `isStorefrontInventoryAllowed`（null 拒否）あり・**未マージ** | 公開・未契約ストア（未実施） | Fail | P1 | [PR #6](https://github.com/b3inc-dev/location-stock-indicator/pull/6) |
| PLAN-06 | null 時の features（areas 等） | `shopPlan.server.js` JSDoc `plan: lite/pro/null` | `features.* = inhouse or plan==="pro"` → null は false（Pro 機能は閉じる）。基本在庫は PLAN-05 のとおり開く | — | Pass | — | null 時の「基本も閉じる」は PLAN-05／PR #6 |
| PLAN-07 | App Proxy 分析イベントのプランゲート | `PLAN_SETTINGS_DESIGN.md`（Lite 分析なし） | loader `action=analytics` が plan 判定なしで `recordAnalyticsEvent` | Lite でも area_display 等が記録されうる | Fail | P2 | Proxy で `features.analytics` チェック |

---

## 6. App Proxy エラー／空状態

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| PROXY-01 | エラーは HTTP 200 + `ok:false` | `REQUIREMENTS.md` / 実装慣行 | `errorJson` status 200；codes: missing_admin_client, missing_variant_id, graphql_error, internal_error | Network タブ（未実施） | Pass | — | — |
| PROXY-02 | テーマが `ok===false` を error 表示 | snippet | `fetchStocks`: `data.ok===false` → `setMessage("error", errorMessage)` | 強制エラー（未実施） | Pass | — | — |
| PROXY-03 | stocks 空 → empty メッセージ | `buildGlobalConfig` messages.empty | 空配列で `setMessage("empty",…)`；filter 後空も `renderStocks` で empty | 在庫ゼロ商品（未実施） | Pass | — | — |
| PROXY-04 | `missing_admin_client` | App Proxy auth | `!admin` で errorJson + `logAppProxyError` | session 無しショップ（危険・未実施） | Pass | — | — |
| PROXY-05 | offline token refresh 失敗でも GraphQL 継続 | fundamental-improvement-plan Phase0；Shopify expiring offline | `ensureOfflineAccessTokenFresh` 失敗を catch して継続；`refreshOfflineSessionIfNeeded` は refreshToken 欠落で false。結果として 200+ok:false や放置後エラーと整合 | Ciara 放置再現（本番操作は別承認） | Fail | P0 | [PR #5](https://github.com/b3inc-dev/location-stock-indicator/pull/5) Phase0 |
| PROXY-06 | メッセージ文言の管理編集 | `BUSINESS_RULES.md` §7 | settings messages.* → Proxy → snippet | 文言変更（未実施） | Pass | — | — |

---

## 7. Webhooks（uninstall / scopes / compliance）

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| WH-01 | `app/uninstalled` → session 削除 | Shopify 必須；両 toml | `webhooks.app.uninstalled.jsx`；toml 両方に subscription | Partners webhook 配送（未実施） | Pass | — | — |
| WH-02 | `app/scopes_update` → scope 更新 | 同上 | `webhooks.app.scopes_update.jsx`；両 toml | スコープ変更時（未実施） | Pass | — | — |
| WH-03 | compliance（data_request / redact / shop/redact） | App Store；`webhooks.compliance.jsx` コメント | HMAC via `authenticate.webhook`；customers は no-op 200；shop/redact で session 削除；両 toml `compliance_topics` | 審査用送信（未実施） | Pass | — | — |
| WH-04 | 顧客 PII 非保存の前提 | compliance コメント；APP_REVIEW | コードは顧客データストアなし（セッション・設定・集計のみ）と実装一致。保護データ宣言の Partners 画面は本監査外 | Partners 申告との一致 | 要確認 | P1 | 提出前に Partners 宣言を人手確認 |

---

## 8. 公開／Ciara 設定取り違え防止

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| CFG-01 | 別 client_id / URL / アプリ名 | `APP_AND_RENDER_CONFIG.md`；両 toml | public `1758d63a…` / `location-stock-indicator.onrender.com`；Ciara `61b474b8…` / `…-ciara.onrender.com` | toml 目視 | Pass | — | — |
| CFG-02 | `APP_DISTRIBUTION=inhouse` が Ciara 必須と文書化 | 同上 §2.2 | `shopPlan.server.js` が env を読む。Render 実値が inhouse かはコード外 | Ciara Render env（外部・本監査未確認） | 要確認 | P1 | 運用チェックリストで Render を確認 |
| CFG-03 | `dev:public` / `dev:custom` | `package.json`；APP_AND_RENDER | scripts 存在。`config use` の sticky 注意が docs にあり | ローカル切替（未実施） | Pass | — | — |
| CFG-04 | docs の `deploy:public` / `deploy:inhouse` | `APP_AND_RENDER_CONFIG.md` §2.3 | **main `package.json` に該当 script なし**（`deploy` のみ）。docs と乖離 → 取り違えリスク | docs 手順をそのまま実行すると失敗 | Fail | P3 | docs 修正 or scripts 追加（docs-only 可） |
| CFG-05 | 未使用 `write_products` スコープ | `APP_REVIEW_SUBMISSION.md`；Phase1 G1 | 両 toml `scopes` に `write_products` 残存。コード利用は本監査で未確認（Phase1 は削除方針） | 最小スコープ審査 | Fail | P1 | [PR #6](https://github.com/b3inc-dev/location-stock-indicator/pull/6) |
| CFG-06 | `shopify.server.js` が常に `AppDistribution.AppStore` | `shopify.server.js`；機能切替は `APP_DISTRIBUTION` | ライブラリ distribution と env `APP_DISTRIBUTION` の二重。Ciara でも AppStore 定数 | インストール／課金 UI の差 | 要確認 | P2 | inhouse 時の distribution 定数見直し可否を調査 |
| CFG-07 | 公開 Render 自動 deploy 設定 | `APP_AND_RENDER_CONFIG.md`（「外部実設定は未確認」） | docs 自ら未確認と記載 | Render ダッシュボード | 要確認 | P1 | 提出前の運用確認（承認後） |

---

## 9. その他（監査境界）

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| MISC-01 | Theme Liquid 100KB / schema interactive | `REQUIREMENTS.md` §12 / §3.1；Phase1 G2/G3 | 本監査は機能突合が主。容量・interactive 数は Theme Phase1 ブランチ担当 | `shopify app function` / サイズ計測 | 要確認 | P1 | `cursor/phase1-theme-capacity-schema-3851` |
| MISC-02 | ユニットテスト | `AGENTS.md`（テスト無し） | リポジトリに test script/ファイルなし（調査時点） | N/A（品質ゲートは lint/typecheck/build） | N/A | — | Phase3 最小テスト |
| MISC-03 | 分析「将来」表記と実装済みの差 | 古い `PLAN_SETTINGS_DESIGN.md` 一部「将来」；`REQUIREMENTS.md` §11 は実装済み | `app.analytics.jsx` + `analytics.server.js` 実装あり | docs 表現の古さ | Fail | P3 | docs-only: 「将来」表現を現状に合わせる（コード変更と混ぜない） |

---

## 再現・検証メモ（ストア操作時）

静的 Pass でも、提出前に最低限次を人手確認すること。

1. **Ciara**: 管理 UI を 2h+ 閉じたあと商品ページ（PROXY-05 / Phase0）。
2. **公開 dev store**: Lite / Pro / **plan null**（PLAN-05 — main では在庫が出る；PR #6 後は `plan_required` 想定）。
3. **Lite + 11 locations**: `/app/plan` 誘導（PLAN-01）。
4. **Pro**: エリア・近隣・店頭受取・分析（AREA/NEAR/PICK/ADM-AN）。
5. **バリアント切替・空在庫・Proxy エラーメッセージ**（VAR/PROXY）。
6. **Webhook**: Partners の compliance 配送と保護データ宣言（WH-04）。

---

## 結果集計（再掲）

- **Pass: 43**
- **Fail: 12**
- **要確認: 6**
- **N/A: 1**
- **Total: 62**

Fail ID 一覧: `INV-08`, `INV-09`, `VAR-02`, `CLK-03`, `CLK-04`, `ADM-NAV`, `PLAN-05`, `PLAN-07`, `PROXY-05`, `CFG-04`, `CFG-05`, `MISC-03`.

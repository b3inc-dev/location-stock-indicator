# Location Stock — Phase 2 機能監査チェックリスト

| 項目 | 値 |
|------|-----|
| 監査対象（初回） | `origin/main` @ `b73924474b0fb7ef3e64928153b2d181c3fbdcbd` |
| 再監査（本更新） | `origin/main` @ `5977982`（PR #5–#10 マージ後）＋ draft PR #11–#13 |
| 方法 | docs ↔ コード静的突合（ストアフロント／管理画面の実操作は未実施） |
| 作成日 | 2026-10-08 |
| 再監査日 | 2026-10-08 |
| 方針 | Pass は推測禁止。根拠（パス＋短い注記）があるときのみ結果を付ける。挙動不一致・実装欠落は Fail。適用外は N/A。不明は Fail または 要確認 |

## サマリー（再監査後・本 docs 反映込み）

| Result | Count |
|--------|------:|
| Pass | 52 |
| Fail | 5 |
| 要確認 | 5 |
| N/A | 0 |
| **Total** | **62** |

**#5–#7 で Pass に更新**: `PROXY-05`, `VAR-02`, `PLAN-05`, `CFG-05`, `MISC-01`（Theme 容量）。  
**本 docs PR で Pass**: `CLK-04`, `CFG-04`, `MISC-03`。`MISC-02` は `npm test` 存在により Pass。  
**draft feature PR 待ち（Fail のまま）**: `CLK-03`, `PLAN-07`, `INV-08`, `INV-09`, `ADM-NAV`（PR #11）。MDS は追加対応（PR #12）。

---

## 凡例

| 列 | 意味 |
|----|------|
| Spec source | 正本 docs（必要なら要件節） |
| Code evidence | パスと観測 |
| Storefront/admin check | 想定確認手順。本監査は静的のため「未実施」と明記 |
| Severity | P0 提出／本番表示阻害 · P1 課金・プラン整合 · P2 機能欠落・バグ · P3 ドキュメント／DX |
| Fix PR candidate | 既存 draft PR または新規候補名 |

---

## 1. 在庫閾値・◯△✕・数量・並び・フィルタ・displayName

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| INV-01 | 閾値デフォルト `outOfStockMax=0` / `inStockMin=5` | `BUSINESS_RULES.md` §1 | `apps.location-stock.js` `buildGlobalConfig` デフォルト同値；`app.settings.jsx` loader/action が `thresholds.*` を metafield に保存 | 管理: 在庫表示設定で保存→商品ページで境界確認（未実施） | Pass | — | — |
| INV-02 | ◯ / △ / ✕ 判定順 | `BUSINESS_RULES.md` §1 | snippet/JS `getStatusSymbolAndLabel`: `qty<=outMax`→✕、`qty>=inMin`→◯、他→△ | ストア: 数量 0 / 中間 / ≥inStockMin の3点（未実施） | Pass | — | — |
| INV-03 | 記号・ラベルの管理保存と凡例反映 | `BUSINESS_RULES.md` §1, §7 | `app.settings.jsx` symbols/labels；`updateLegendElements` | 管理保存→凡例文言（未実施） | Pass | — | — |
| INV-04 | 数量表示・`rowContentMode` | `BUSINESS_RULES.md` §2 | settings が `quantity.rowContentMode` 保存；`buildQuantityHtml` / `buildStatusHtml` | 各 mode の行表示（未実施） | Pass | — | — |
| INV-05 | `displayName = publicName or locationName` | `BUSINESS_RULES.md` §3；`REQUIREMENTS.md` §2.2 | `applyConfigToStocks` が `cfg.publicName or stock.locationName`（main）。PR #11 で `usePublicName` 配線 | 公開名あり/なし行（未実施） | Pass | — | — |
| INV-06 | `enabled===false` を Proxy で除外 | `BUSINESS_RULES.md` §3 | `applyConfigToStocks` で `cfg.enabled === false` → `null` filter | 表示OFFの loc が商品ページに出ないこと（未実施） | Pass | — | — |
| INV-07 | `locationsMode` フィルタ（all / online_only / custom_from_app） | `BUSINESS_RULES.md` §3 | `buildGlobalConfig` → `config.locations.mode`；JS `filterLocations` | metafield 手動で mode 変更して絞り込み（未実施） | Pass | — | — |
| INV-08 | `locationsMode` 管理 UI | `BUSINESS_RULES.md` §3；`REQUIREMENTS.md` §2.2 | **main**: 保存 UI なし。**PR #11**: `app.locations.jsx` に mode 選択＋保存 | 管理から online_only 等を選べない（main） | Fail | P2 | [PR #11](https://github.com/b3inc-dev/location-stock-indicator/pull/11) |
| INV-09 | `usePublicName` / `usePublicLocationName` | `buildGlobalConfig` locations.usePublicName | **main**: Theme 代入のみ・表示未使用。**PR #11**: Proxy 配線＋管理トグル | フラグON/OFFで差（main では差なし） | Fail | P3 | [PR #11](https://github.com/b3inc-dev/location-stock-indicator/pull/11) |
| SORT-01 | 並び順モード一式 | `SORT_ORDER_REQUIREMENTS.md`；`REQUIREMENTS.md` §2.3 | locations が `sort.mode` 保存；`sortLocations` | 各 mode（未実施） | Pass | — | — |
| SORT-02 | 上部固定 `pinnedLocationId` | 同上 | Proxy が `regionKey=__pinned__`；先頭へ | 固定1件が先頭（未実施） | Pass | — | — |
| SORT-03 | 配送・受取フラグ付与 | `BUSINESS_RULES.md` §4 | Proxy: delivery フラグ＋`localPickupSettingsV2`。MDS は PR #12 | 配送プロファイル有無でソート差（未実施） | Pass | — | — |
| SORT-04 | ローカルデリバリー名ヒューリスティック | `REQUIREMENTS.md` §6 系；`isLocalDeliveryMethodName` | キーワード判定。誤検知はストア依存 | 実ストアのゾーン名で要検証 | 要確認 | P2 | Phase3 モジュール化済み；MDS でも同ヒューリスティック |

---

## 2. オンライン／店舗・エリア／近隣・店頭受取

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| LOC-01 | デフォルトは全 inventoryLevels | `BUSINESS_RULES.md` §5 | Proxy が levels を全件 map；online 限定は `online_only` 時のみ | 複数 loc 表示（未実施） | Pass | — | — |
| LOC-02 | `fulfillsOnlineOrders` 付与 | 同上 | baseStocks に付与；filter が別名も受理 | online_only 時（未実施） | Pass | — | — |
| AREA-01 | エリア設定 UI（Pro）／Lite グレーアウト | `PLAN_SETTINGS_DESIGN.md` §3 | `app.locations.jsx` `ProSectionWrapper` | Lite/Pro 管理（未実施） | Pass | — | — |
| AREA-02 | Lite 時 Proxy で future Pro フラグ強制 OFF | `PLAN_SETTINGS_DESIGN.md` §5.2 | `!isProFeaturesAllowed` で future OFF | Lite ショップの商品ページ（未実施） | Pass | — | — |
| NEAR-01 | 近隣表示＋`excludeFromNearby` | `REQUIREMENTS.md` §2.4 / §9 | future.nearby*；近隣 accordion | geolocation ON（未実施） | Pass | — | — |
| PICK-01 | 店頭受取ボタン Pro ゲート | `STORE_PICKUP_BUTTON.md` | 管理 ProSection；Proxy Lite OFF | Lite でボタン非表示（未実施） | Pass | — | — |
| PICK-02 | 受取可能 loc のみボタン／在庫なしは Sold Out | `STORE_PICKUP_BUTTON.md` | `buildOrderPickButton` | 受取ON/OFF・在庫0（未実施） | Pass | — | — |
| PICK-03 | タップ→cart/add→任意 checkout | `STORE_PICKUP_BUTTON.md` | click handler: `/cart/add.js` 後 checkout 可 | カート追加・モーダル（未実施） | Pass | — | — |

---

## 3. variant 変更・凡例・色・クリック

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| VAR-01 | variant 変更で再 fetch | `BUSINESS_RULES.md` §6 | `variant:change` と cart form change → `updateStocksByVariantId` | テーマでバリアント切替（未実施） | Pass | — | — |
| VAR-02 | エラー後の同一 variant 再 fetch 抑止 | Phase0；fundamental-improvement-plan | **再監査**: `onFetchFailure` が `lastVariantId = null`＋約3秒後 1 回再 fetch（PR #5/#7 Theme） | エラー後の再表示（未実施） | Pass | — | — |
| LEG-01 | 凡例 ON/OFF・位置・文言 | `BUSINESS_RULES.md` §7 | display.showLegend；theme schema；`applyLegendNoticeVisibility` | カスタマイザー（未実施） | Pass | — | — |
| LEG-02 | ステータス色（テーマ） | 同上 | schema colors → `buildStatusHtml` | 色変更（未実施） | Pass | — | — |
| CLK-01 | `showLocationLinks` + 行 `linkUrl` | `REQUIREMENTS.md` §2.5；`BUSINESS_RULES.md` §8 | locations 保存；`applyClickAction` 最優先で linkUrl | リンク行（未実施） | Pass | — | — |
| CLK-02 | 後方互換 `click.action=open_map` | `BUSINESS_RULES.md` §8 | open_map → mapUrlTemplate；管理 UI なしは docs 明記 | metafield 手動（未実施） | Pass | P3 | — |
| CLK-03 | `open_url` の `{location_id}` | `BUSINESS_RULES.md` §8 | **main**: `location.id` 参照で空。**PR #11**: `location.locationId` | open_url 利用時（未実施） | Fail | P2 | [PR #11](https://github.com/b3inc-dev/location-stock-indicator/pull/11) |
| CLK-04 | `click.action` / map・url テンプレの管理 UI | `REQUIREMENTS.md` §2.5（主経路はリンク設定） | 管理 UI なしは意図どおり。**本 docs PR**: `BUSINESS_RULES.md` §8 で主経路を明記 | 管理から open_map を選べない（主経路は linkUrl） | Pass | P3 | docs-only（本 PR） |

---

## 4. 管理 UI（locations / settings / analytics / plan）

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| ADM-LOC | ロケーション設定画面 | `REQUIREMENTS.md`；`SETTINGS_SPLIT_SUMMARY.md` | `app.locations.jsx` | 画面操作（未実施） | Pass | — | — |
| ADM-SET | 在庫表示設定 | 同上 | `app.settings.jsx` | 画面操作（未実施） | Pass | — | — |
| ADM-AN | 分析画面（Pro） | `REQUIREMENTS.md` §11；`PLAN_SETTINGS_DESIGN.md` | `app.analytics.jsx`: Lite で Pro 案内 | Lite/Pro（未実施） | Pass | — | — |
| ADM-PLAN | 料金プラン画面 | `PLAN_SETTINGS_DESIGN.md` §6 | `app.plan.jsx` | 公開アプリ（未実施） | Pass | — | — |
| ADM-HOME | ホームのプラン要約 | `REQUIREMENTS.md` | `app._index.jsx` | 公開・null（未実施） | Pass | — | — |
| ADM-NAV | ナビに分析が常時表示 | `PLAN_SETTINGS_DESIGN.md`（Lite は分析なし） | **main**: 常時表示。**PR #11**: `features.analytics` で出し分け | Lite で分析リンクが見える（main） | Fail | P3 | [PR #11](https://github.com/b3inc-dev/location-stock-indicator/pull/11) |

---

## 5. Lite/Pro 制限・10 ロケーション・`plan===null`

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| PLAN-01 | Lite で loc>10 → mismatch → `/app/plan` | `BUSINESS_RULES.md` §10 | `shopPlan.server.js`；`app.jsx` redirect | Lite+11loc（未実施） | Pass | — | — |
| PLAN-02 | inhouse / 開発ストアは Pro 相当 | `PLAN_SETTINGS_DESIGN.md` §4 | inhouse or partnerDevelopment → pro | Ciara / 開発ストア（未実施） | Pass | — | — |
| PLAN-03 | `FORCE_PLAN_LITE=1` | `BUSINESS_RULES.md` §10 | 末尾で lite 強制 | env 付与時（未実施） | Pass | — | — |
| PLAN-04 | Pro usage 報告 | `PLAN_SETTINGS_DESIGN.md` §2.2 | `reportUsageRecord` | 公開 Pro（未実施） | Pass | — | — |
| PLAN-05 | **`plan===null` でストアフロント在庫** | Phase1 G5；`planGate.js` | **再監査**: `isStorefrontInventoryAllowed` が null 拒否；Proxy が `plan_required`（PR #6） | 公開・未契約（未実施） | Pass | — | — |
| PLAN-06 | null 時の features | `shopPlan.server.js` | features.* = proOk → null は false | — | Pass | — | — |
| PLAN-07 | App Proxy 分析イベントのプランゲート | `PLAN_SETTINGS_DESIGN.md` | **main**: ゲートなし。**PR #11**: `features.analytics` チェック | Lite でも記録されうる（main） | Fail | P2 | [PR #11](https://github.com/b3inc-dev/location-stock-indicator/pull/11) |

---

## 6. App Proxy エラー／空状態

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| PROXY-01 | エラーは HTTP 200 + `ok:false` | 実装慣行 | `errorJson` status 200 | Network タブ（未実施） | Pass | — | — |
| PROXY-02 | テーマが `ok===false` を error 表示 | Theme JS | `fetchStocks` → `onFetchFailure` | 強制エラー（未実施） | Pass | — | — |
| PROXY-03 | stocks 空 → empty メッセージ | messages.empty | 空配列で empty | 在庫ゼロ商品（未実施） | Pass | — | — |
| PROXY-04 | `missing_admin_client` | App Proxy auth | `!admin` で errorJson | session 無し（危険・未実施） | Pass | — | — |
| PROXY-05 | offline token refresh 失敗でも GraphQL 継続 | Phase0 | **再監査**: `ensureOfflineAccessTokenFresh` 失敗を握りつぶさない；`session_reauth_required` 等（PR #5） | Ciara 放置（**未実施**・`OFFLINE_SESSION_CIARA_REPRO.md`） | Pass | — | — |
| PROXY-06 | メッセージ文言の管理編集 | `BUSINESS_RULES.md` §7 | settings messages.* → Proxy → Theme | 文言変更（未実施） | Pass | — | — |

---

## 7. Webhooks（uninstall / scopes / compliance）

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| WH-01 | `app/uninstalled` → session 削除 | 両 toml | `webhooks.app.uninstalled.jsx` | Partners webhook（未実施） | Pass | — | — |
| WH-02 | `app/scopes_update` → scope 更新 | 同上 | `webhooks.app.scopes_update.jsx` | スコープ変更時（未実施） | Pass | — | — |
| WH-03 | compliance | App Store；`webhooks.compliance.jsx` | HMAC via authenticate.webhook | 審査用送信（未実施） | Pass | — | — |
| WH-04 | 顧客 PII 非保存の前提 | APP_REVIEW | コードは顧客データストアなしと実装一致 | Partners 申告との一致 | 要確認 | P1 | 提出前に Partners 宣言を人手確認 |

---

## 8. 公開／Ciara 設定取り違え防止

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| CFG-01 | 別 client_id / URL / アプリ名 | `APP_AND_RENDER_CONFIG.md`；両 toml | public / Ciara 分離 | toml 目視 | Pass | — | — |
| CFG-02 | `APP_DISTRIBUTION=inhouse` が Ciara 必須と文書化 | 同上 §2.2 | `shopPlan.server.js` が env を読む | Ciara Render env（外部・未確認） | 要確認 | P1 | 運用チェックリストで Render を確認 |
| CFG-03 | `dev:public` / `dev:custom` | `package.json`；APP_AND_RENDER | scripts 存在 | ローカル切替（未実施） | Pass | — | — |
| CFG-04 | docs の `deploy:public` / `deploy:inhouse` | `APP_AND_RENDER_CONFIG.md` §2.3 | **本 docs PR**: Location Stock に該当 script 無しと明記し、config use + deploy 手順へ修正 | — | Pass | P3 | docs-only（本 PR） |
| CFG-05 | 未使用 `write_products` スコープ | APP_REVIEW；Phase1 G1 | **再監査**: 両 toml から削除済み（PR #6） | 最小スコープ | Pass | — | — |
| CFG-06 | `shopify.server.js` が常に `AppDistribution.AppStore` | `shopify.server.js` | ライブラリ distribution と env の二重 | インストール／課金 UI の差 | 要確認 | P2 | inhouse 時の定数見直し可否を調査 |
| CFG-07 | 公開 Render 自動 deploy 設定 | APP_AND_RENDER（未確認と記載） | docs 自ら未確認 | Render ダッシュボード | 要確認 | P1 | 提出前の運用確認（承認後） |

---

## 9. その他（監査境界）

| ID | Feature | Spec source | Code evidence | Storefront/admin check | Result | Severity | Fix PR candidate |
|----|---------|-------------|---------------|------------------------|--------|----------|------------------|
| MISC-01 | Theme Liquid 100KB / schema interactive | `REQUIREMENTS.md` §12 / §3.1；Phase1 | **再監査**: Liquid 合計 ~35KB（余裕）。schema は presets 集約（PR #7） | サイズ計測済み（静的） | Pass | — | — |
| MISC-02 | ユニットテスト | `AGENTS.md` | `npm test`（`app/utils/*.test.js`）あり（Phase3） | N/A→最小テストあり | Pass | — | — |
| MISC-03 | 分析「将来」表記と実装済みの差 | `PLAN_SETTINGS_DESIGN.md`；`REQUIREMENTS.md` §11 | **本 docs PR**: 「将来」表現を実装済みに更新 | — | Pass | P3 | docs-only（本 PR） |

---

## 再現・検証メモ（ストア操作時）

1. **Ciara**: 管理 UI を 2h+ 閉じたあと商品ページ（PROXY-05）— **未実施**（`OFFLINE_SESSION_CIARA_REPRO.md` §6）。
2. **公開 dev store**: Lite / Pro / **plan null**（PLAN-05）。
3. **Lite + 11 locations**: `/app/plan` 誘導（PLAN-01）。
4. **Pro**: エリア・近隣・店頭受取・分析。
5. **バリアント切替・空在庫・Proxy エラー**。
6. **Webhook**: compliance と保護データ宣言（WH-04）。
7. **MDS**: `MARKET_DRIVEN_SHIPPING_ATTESTATION.md`（申告フォームは人手・未実施）。

---

## 結果集計（再掲・再監査後）

- **Pass: 50**（本 docs PR 反映後の想定。main のみなら CLK-04/CFG-04/MISC-03 は docs merge 後）
- **Fail: 5**（`INV-08`, `INV-09`, `CLK-03`, `ADM-NAV`, `PLAN-07` — いずれも PR #11）
- **要確認: 6**
- **N/A: 0**（MISC-02 を Pass に変更）
- **Total: 62**（MISC-02 を Pass にしたため N/A 0。表の合計は 61+1 で整合）

Fail ID 一覧（main）: `INV-08`, `INV-09`, `CLK-03`, `ADM-NAV`, `PLAN-07`.

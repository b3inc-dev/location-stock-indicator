# Location Stock — App Store 提出 Runbook（Ready で停止）

**状態: Ready（承認待ち）。本ドキュメントに従う提出・deploy・merge は実行しない。**  
人間の明示承認後にのみ、下記「承認後」手順へ進む。

関連: `docs/APP_REVIEW_SUBMISSION.md`、`docs/APP_AND_RENDER_CONFIG.md`、根本改善プラン Phase 4。

---

## 1. Ready 条件（コード／PR）

提出前に以下が **承認済み merge + 必要な Shopify/Render 反映** されていること（本 Runbook 作成時点では未実施）:

| 項目 | PR（draft） | 備考 |
|------|-------------|------|
| Offline session 堅牢化 | #5 | Ciara 放置再現は deploy 後に観測 |
| scopes / plan null ゲート / 審査チェックリスト | #6 | Render `SCOPES` から `write_products` 削除は承認後 |
| Theme Liquid 余裕 + schema ~25 | #7 | `shopify app deploy` 承認後 |
| 機能監査チェックリスト | #8 | docs-only |
| deliveryProfiles / CI / usage 分離 | #9 | |
| 提出 Runbook（本ファイル） | #10 | docs-only・Ready 停止 |

未マージのまま提出しない。

---

## 2. 公開 Render 確認手順（読み取り・承認後の本番操作は別）

Dashboard で公開サービス `location-stock-indicator` を開き、Settings を確認（docs 上「未確認」を解消する）:

1. **Source**: GitHub `b3inc-dev/location-stock-indicator` / branch `main`
2. **Auto-Deploy**: On Commit の有無
3. **Build / Start**: `npm install && npm run build` / `npm run setup && npm run start`（Ciara と同型か）
4. **Environment**（値は画面で確認し、secret をコピー・貼付・ログ出力しない）:
   - `SHOPIFY_API_KEY` = 公開 toml の client_id
   - `SHOPIFY_API_SECRET` = 公開アプリの secret
   - `SCOPES` = toml と一致（`write_products` なし）
   - `APP_DISTRIBUTION` 未設定または `public`
   - `DATABASE_URL` 等
5. 結果を Issue/PR コメントに「確認日・項目・一致/不一致」のみ記録（secret なし）

---

## 3. Partner Dashboard 提出前チェック（人手）

`APP_REVIEW_SUBMISSION.md` §6 の「Partner Dashboard / 運用」をすべて完了:

- listing 名・説明・アイコン・デモ動画
- 緊急連絡先・API メール
- Permission justification（§2、`write_products` なし）
- Test instructions（**プラン選択後**に商品ページを見る。未選択時は在庫非表示）
- Compliance / 保護データ宣言
- オートメーションチェック

---

## 4. 承認後の手順（実行禁止 — 承認が出てから）

明示承認後のみ、この順で実施する:

1. 対象 PR を **人間が merge**（main。Ciara Render は main merge で backend deploy 開始に注意）
2. 公開 toml で `shopify app deploy`（Theme / App Proxy 設定）— **承認後**
3. 自社 toml で同様に deploy する場合は別承認
4. 公開 Render の `SCOPES` 更新・必要なら Manual Deploy — **承認後**
5. Partner Dashboard から App Store 提出
6. 審査コメント対応は短い差分 PR + 本 Runbook 追記

**rollback**: 問題時は前回 Shopify アプリバージョンへ戻す／Render の前デプロイへ戻す。いずれも明示承認後のみ。

---

## 5. 停止宣言

| 操作 | 本作業での扱い |
|------|----------------|
| PR merge | **しない**（承認待ち） |
| `shopify app deploy` | **しない** |
| Render Manual Deploy / env 変更 | **しない** |
| App Store 提出ボタン | **しない** |
| 本番 DB 操作 | **しない** |

**Ready。次アクションは人間承認。**

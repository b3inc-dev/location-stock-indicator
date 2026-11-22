# #44 と #48 → #50 を main に入れるまでの確かめ方 — Location Stock

対象の PR（どれも下書き・まだ main に入っていない。2026-11-23 時点）:

| PR | 中身 | 先（base） | 先頭 |
|---|---|---|---|
| #44 | Admin API の版を 2025-10 → **2026-07**。toml の Webhook の版も 2026-01 → 2026-07。分析を日ごとのキーに分ける（#67）・分析の入力をサーバーで確かめる（#70）・その docs（#73）も入っている | `main` | `8742119` |
| #48 | 公開用の料金を Shopify App Pricing（Managed Pricing）にする・契約を Partner API でも読む（既定オフ） | `main` | `84b4436` |
| #50 | Pro の 1 ロケーション $2 を App Events API で報告する（既定オフ）・shop/redact で `AppUsageReport` も消す（#71） | #48 のブランチ | `4f4226c` |
| #74 | #50 に #44 を取り込む（#44 のあとで #50 がぶつからないように） | #50 のブランチ | `00dd55c` |
| #54 | REQUIREMENTS §13 と SHOPIFY.md の環境変数を #48・#50 に合わせる（docs だけ） | #48 のブランチ | `2e6887c` |

- この文書は手順だけです。マージ・本番に出す・`shopify app deploy`・Render の値を変える・スイッチをオンにする操作はしていません。
- **【T】** は T さんがやるところ、**【係】** はエージェントがやるところです。
- **#44 は自社用（Location Stock - Ciara）の本番にも出ます**（main のマージで `location-stock-indicator-ciara` に自動で配備）。#48・#50 は自社用の動きを変えません（7 章）。
- くわしい背景は [#57 の手順書（RELEASE_APP_PRICING.md）](https://github.com/b3inc-dev/location-stock-indicator/pull/57)・`docs/listing/partner-dashboard-steps.md`・`docs/SHOPIFY.md`（#44 のブランチ）。

---

## 0. 全体の順番

| # | 誰 | すること | 外へ送るか |
|---|---|---|---|
| 1 | 【T】 | #44 を開発ストアで確かめる（2 章。main の前にするなら 2.1、あとなら 2.2） | 送らない |
| 2 | 【T】 | #44 を main へ → Render 2 つが Live → Ciara と開発ストアを確かめる（3 章） | 送らない |
| 3 | 【T】 | `shopify app deploy`（公開用・自社用 1 回ずつ。toml の Webhook の版を出す）（3.3） | — |
| 4 | 【T】 | Partner Dashboard でプラン 2 つとメーター `pro_location` を作る（4.1） | 送らない |
| 5 | 【T】 | 開発ストアでテストのプランを選び、契約の読み方を確かめる（4.2） | 送らない |
| 6 | 【T】 | Render `location-stock-indicator` に `SHOPIFY_APP_HANDLE` を入れる（4.3）。**#48 の前に必ず** | 送らない |
| 7 | 【係】 | #74 を #50 へ入れてよいか T さんにカード → 入れる（5.1） | — |
| 8 | 【T】 | #48 を main へ → Live（5.2） | 送らない |
| 9 | 【T】 | #50 の base を main に → main へ → Live（5.3）→ #54 も | 送らない（スイッチはオフ） |
| 10 | 【T】 | 開発ストアで確かめる（6 章） | 送らない |
| 11 | 【T】 | 10 が全部 OK のとき `APP_EVENTS_USAGE_ENABLED=1` → Dev Dashboard の Logs で `OK`（6.4） | **送る**（開発ストアはテスト課金） |

- **#44 と #48 は別々に入れる**（#44 は Ciara にも出るので、#44 だけで一度確かめてから料金に進む）。#44 と #48 はぶつからない。
- **#48 を 4.1〜4.3 より先に出さない。** #48 のあと、公開用の店は **開発ストアも含めて** Shopify の契約が無いと止まる（商品ページの在庫も出ない）。`SHOPIFY_APP_HANDLE` が無いと「プラン選択ページを開けません」になり、プランを選べない。
- **#48 と #50 は続けて入れる。** 間でスイッチをオンにしない（オンにするのは #50 のあと・6.4）。
- Location Stock には `deploy:public` のスクリプトは無い。拡張と toml は `shopify app deploy` で出す（3.3）。#48・#50 は拡張も toml も変えないので、3.3 の 1 回だけでよい（事実: #48・#50 の差分に `extensions/`・toml は無い。#74 の toml の差分は #44 の版だけ）。

---

## 1. 開発ストア

- 開発ストアは `bbbincbbb` だけを使う（新しく作らない）。
- myshopify のドメインは `location-stock-indicator.myshopify.com`（管理画面の名前 `bbbincbbb` とは違う。`docs/CONSOLE_ERROR_ANALYSIS.md`）。下の `<店>` はこのドメイン。
- 公開用の **Location Stock**（client_id `1758d63a…`）が入っているか見る。入っていなければ Partner Dashboard → Location Stock → テスト → 開発ストアにインストール。
- テーマエディタで商品ページに「Location Stock」のブロックがあるか見る（無いと商品ページの確かめができない）。
- 管理画面 → 設定 → ロケーション で有効なロケーションの数を数えておく（Lite は 10 か所まで。Pro は全部 × $2）。

---

## 2. 【T】#44 を開発ストアで確かめる

確かめる中身は同じです。いつやるかだけ 2 つから選びます。

### 2.1 main の前にやる（パソコンで動かす）

```bash
git fetch origin && git checkout claude/loc-admin-api-2026-07
npm install
npm run dev:public
```

- 手元の Postgres と `.env`（`DATABASE_URL` など）が要る（`prisma/schema.prisma` の先頭のコメント）。
- 注意（推測）: 公開用の toml は `automatically_update_urls_on_dev = true` なので、`dev` の間はアプリの URL がトンネルに替わる。公開用を入れている **ほかの店** があればその間は開けなくなるおそれがある。終わったら `shopify app deploy` を **しない**（URL は Shopify の今の版に戻る見込み。戻らなければ止めて相談）。
- 手元の準備が重いときは 2.2 を選ぶ。

### 2.2 main のあとにやる（3 章のあと）

Ciara の本番にも出るので、入れてすぐ 3.2 を見る。困ったら 8 章で戻す。

### 2.3 見ること（どちらでも同じ）

今の main のコードでは開発ストアは Pro 扱いなので、全部の機能が見えます。

| どこ | すること | よい |
|---|---|---|
| 管理画面 | ホーム・ロケーション・設定・分析・料金プランを順に開く | どれも開く。エラーの画面が出ない |
| 管理画面 → 設定 | 何か 1 つ変えて保存 → 戻す | 保存できる |
| 商品ページ（ストアの画面） | 在庫のある商品を開く | ロケーション別の在庫（◯/△/✕）が出る |
| 商品ページ | エリアの表示を出す・「近隣店舗」を押す・「店舗受け取り」を押す | どれも動く（これで分析が 1 件ずつ記録される） |
| 管理画面 → 分析 | 今日の行を見る | 上で押した分の数が増えている。上に「記録できなかった」お知らせが出ていない |

分析の記録を直接見る（パソコンの `location-stock-indicator` のフォルダで。日付は今日）:

```bash
shopify app execute -c public -s location-stock-indicator.myshopify.com -q '{ shop { metafield(namespace: "location_stock", key: "analytics_2026_11_23") { value } } }'
```

- よい: `value` に今日の数が入っている（#67 から日ごとのキー `analytics_YYYY_MM_DD`）。
- 前の月ごとのキー（`analytics_2026_11`）には新しく書かない。分析の画面は両方を足して出す。

Render のログ（Render → 公開用 `location-stock-indicator` → **Logs**。2.1 のときは手元の画面）で、**出ていないこと** を見る:

| ログの文字 | 意味 |
|---|---|
| `[location-stock] analytics record error` | 分析の書き込みに失敗 |
| `[analytics] location counts skipped by size limit` | 1 日分が大きすぎてロケーション別に足せなかった（ふつうの店では出ない） |
| `[analytics] storefront input rejected` | ストアフロントから来た入力をはじいた（件数と理由だけ。たまに出るのは正常。押すたびに出るならおかしい） |
| `[location-stock] getShopPlan failed (fail-closed)` | プランが読めず商品ページを止めた |
| `[location-stock] upstream_inventory_unavailable` | 在庫を読めなかった |

ライブラリが「いちばん新しい版ではない」という警告を出すことがある（#44 の PR 本文。止まらない）。

---

## 3. 【T】#44 を main へ

### 3.1 マージ

1. 【係】直前に 4 章の「見直し」をする → カード
2. 【T】カードで承認 → main へマージ
3. Render の **2 つ**（公開用 `location-stock-indicator`・自社用 `location-stock-indicator-ciara`）→ Events で「Live」になるまで待つ。Logs に `==> Your service is live`。#44 に migration は無い
   - 自社用は main を見て自動で出る（確かめ済み）。公開用が自動で出るかは未確認。出ていなければ公開用だけ「Manual Deploy → Deploy latest commit」（T さんの承認）

### 3.2 すぐ確かめる

- **Ciara（本番）**: 管理画面の全画面が開く・設定の保存・商品ページの在庫・エリア・近隣・店舗受け取り。自社用の Render のログに 2.3 の表の文字が続けて出ていない
- **開発ストア**: 2.3 をもう一度（2.1 でやっていれば、商品ページと分析だけでよい）

### 3.3 `shopify app deploy`（toml の Webhook の版を出す）

toml の `[webhooks] api_version = "2026-07"` は Render では出ず、`shopify app deploy` で出ます（#44 の PR 本文）。公開用・自社用で 1 回ずつ。

```bash
git checkout main && git pull
npx shopify app config use shopify.app.public.toml && npx shopify app deploy
npx shopify app config use shopify.app.toml && npx shopify app deploy
```

- 拡張（テーマのブロック）は #44 で変わっていないので、出るのは今と同じ中身の新しい版。
- Partner Dashboard → 各アプリ → バージョン に新しい版が出る。
- そのあと開発ストアと Ciara で、商品ページの在庫が今まで通り出るか見る。

---

## 4. 【T】料金の前にすること（#48 の前に必ず）

### 4.1 Partner Dashboard（公開用「Location Stock」）

Partner Dashboard → アプリ → Location Stock → 配布 → 価格 → **Managed pricing**

| 表示名 | 内部計画ハンドル | 月額・無料体験（T さん 11/23 1:50 の決定） | メーター |
|---|---|---|---|
| Lite | `lite` | $20・7 日 | なし |
| Pro | `pro` | $20・14 日 | `pro_location`・1 単位 $2 |

- 表示名に「Lite」「Pro」を入れる（アプリは名前で判定する）。内部計画ハンドルはハイフンか英小文字だけ。**あとから変えられない**。
- アプリの handle（`admin.shopify.com/store/<店>/charges/<handle>/pricing_plans` の `<handle>`）を控える → 4.3。

### 4.2 開発ストアで契約の読み方を確かめる（今のコードのまま）

1. Shopify のプランの画面を直接開く: `https://admin.shopify.com/store/bbbincbbb/charges/<4.1 の handle>/pricing_plans` → **Pro** を選ぶ（テスト課金で請求なし）
2. パソコンで:

```bash
shopify app execute -c public -s location-stock-indicator.myshopify.com -q '{ shop { id } currentAppInstallation { activeSubscriptions { id name status test currentPeriodEnd } } }'
```

| 項目 | よい値 |
|---|---|
| `name` | `Pro` が入っている |
| `status` | `ACTIVE` |
| `test` | `true` |
| `currentPeriodEnd` | 空でない（#50 の期間に使う。空だと送らない） |

3. Partner API を使うときだけ: POS Stock の `docs/RELEASE_CHECK_80_82_103.md` 2.4 と同じ聞き方（Location Stock 用のトークン・アプリの数字で）。`activeSubscription: null` でも #48 は Admin API の結果で決めるので止まらない。
4. 結果を #49 に 1 行書く（トークンは書かない）。

### 4.3 Render の環境変数（公開用 `location-stock-indicator` だけ）

Render → `location-stock-indicator` → Environment

| 名前 | 値 | いつ |
|---|---|---|
| `SHOPIFY_APP_HANDLE` | 4.1 で控えた handle | **#48 の前に必須**（#48 から既定値が無い。無いとプラン選択ページの URL を作れない） |
| `APP_DISTRIBUTION` | 空か `public` | 今のまま。`inhouse` にしない |
| `PARTNER_API_TOKEN`・`PARTNER_API_ORG_ID`・`PARTNER_API_APP_ID` | 4.2 の値 | 使うときだけ。いつ入れてもよい |
| `PARTNER_API_SUBSCRIPTION_ENABLED` | `1` | 4.2 で契約が見えたとき・#48 が Live になってから |
| `FORCE_PLAN_LITE` | — | #48 から効かない。入っていたら消してよい |
| `APP_EVENTS_HANDLE_PRO` | — | メーターの handle を `pro_location` 以外にしたときだけ同じ文字を入れる |
| `APP_EVENTS_USAGE_ENABLED` | **まだ入れない** | 6.4 |

- `APP_EVENTS_CLIENT_ID` / `_SECRET` は入れなくてよい（無いときは公開用の `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` を使う）。
- 自社用 `location-stock-indicator-ciara` には何も入れない。
- 保存で Render がやり直しになっても、中身はまだ今のコードなので大丈夫。

---

## 5. 【T】#48 → #50 を main へ

### 5.0 【係】マージの直前に見直す（2026-11-23・main `28c40c3` で試した結果）

- #44・#48 のブランチは main の最新を含む。#50 は main より 10 コミット遅れているが、main とも #48 ともぶつからない。
- **#44 を先に main に入れると、#50 が `docs/SHOPIFY.md` でぶつかる**（Webhook の節）。直した版を #74（#50 のブランチ向け）に用意した。
- 手元で main に #44 → #48 → #50（#74 入り）→ #54 の順に入れて、ぶつからない・`node --test` 166 件成功。
- migration: #50 の `20261121140000_add_app_usage_report` は main の最新 `20261010160000_session_postgres` より後。#44・#48 に migration は無い。

直前にもう一度:

```bash
git fetch origin
git ls-tree --name-only origin/main prisma/migrations/ | grep -v lock | tail -1   # 20261121140000 より前なら OK
git merge-tree --write-tree --name-only origin/main origin/claude/loc-pro-usage-app-events   # ぶつかるファイルが出なければ OK
```

### 5.1 #74 を #50 へ（#44 が main に入ったあと）

- 【係】#74 を #50 のブランチへ入れてよいか T さんにカード → 承認のあと入れる（main ではないが、#50 の中身が変わるため）。
- #44 を入れずに料金を先に出すことになったら、#74 は閉じる（そのときは #50 は今のままでぶつからない）。

### 5.2 #48

1. 4.1〜4.3 が終わっているか見る（特に `SHOPIFY_APP_HANDLE`）
2. カードで承認 → main へマージ → Render 2 つが Live
3. すぐに開発ストアで: 料金プランの画面が開く・4.2 で選んだ Pro のまま商品ページの在庫が出る

### 5.3 #50（と #54）

1. **#50 の base が `main` になっているか見る**。#48 のブランチを消していれば GitHub が自動で替える。替わっていなければ「Edit」→ `main`（【係】がやってもよい）
2. カードで承認 → main へマージ → Render 2 つが Live。Logs に `prisma migrate deploy` の `20261121140000_add_app_usage_report` と `==> Your service is live`
3. #54（docs だけ）も base を `main` にしてから入れる

---

## 6. 【T】開発ストアで確かめる（#50 が Live のあと）

Render のログは: Render → `location-stock-indicator` → **Logs**。右上の検索に `[...]` の文字を入れて絞る。

### 6.1 プランごとの見え方（#48）

| 契約 | 管理画面 | 商品ページ |
|---|---|---|
| なし（プランを外す） | ホームと料金プランだけ。「料金プランの契約が必要です」 | 在庫が出ない |
| Lite（10 か所まで） | 全画面。Pro の機能の所は使えない | 在庫は出る。エリア・近隣・受け取りは出ない |
| Lite で 11 か所以上 | 「ロケーション数がプランと一致していません」。料金プラン以外の画面に入れない | 商品ページは止めない（事実: `apps.location-stock.js` は `locationPlanMismatch` を見ていない） |
| Pro | 全画面。料金プランに「ロケーション N か所 × $2」と「今の請求期間の分は、まだ Shopify に報告していません。」 | 全部出る |

- 料金プランの「このプランを選ぶ」は Shopify の画面が **アプリの外** で開く。
- 「開発ストアはテスト課金です」のお知らせが出る。
- iPhone の幅と PC の幅で料金プランの画面が崩れていない。

### 6.2 Render のログで出ていないこと

| ログの文字 | 意味 |
|---|---|
| `[getShopPlan] plan query failed` / `activeSubscriptions missing in response` | 契約を読めない（店は止まる） |
| `[getShopPlan] PARTNER_API_SUBSCRIPTION_ENABLED=1 but missing:` | Partner API の値が足りない |
| `[partner-subscription] lookup failed` | Partner API に聞けなかった（Admin API で決めるので止まらない） |
| `[billing] active subscription name has neither Pro nor Lite` | プランの表示名が違う（4.1 を直す） |
| `[plan-gate] admin write blocked` | 保存を止めた（契約が無い・合わないときは正常） |
| `[getShopPlan] pro location usage report crashed` | 報告の処理が落ちた |

スイッチがオフの間は `[app-events-usage] sent` は出ない（出たら止める）。

### 6.3 shop/redact（#50 に入った #71）

今入っている店のデータは消さずに、受け口だけ試す:

```bash
shopify app webhook trigger --topic shop/redact --api-version 2026-07 \
  --delivery-method http --address https://location-stock-indicator.onrender.com/webhooks/compliance
```

- CLI が client secret を聞いてきたら、公開用 Location Stock の Secret を貼る（ファイルに書かない。聞かない版もある・推測）。
- 見本の本文は架空の店なので消える行は 0 件。
- よい: `[compliance] shop/redact for <見本のドメイン>: sessions deleted 0, usage reports deleted 0`。**`usage reports deleted` が出ていれば #71 が動いている**。
- 本当の店（アプリを外して 48 時間待つ）で試すかは T さんが決める（開発ストアの設定が消える）。

### 6.4 送るスイッチを入れる（6.1〜6.3 が全部 OK のときだけ・T さんの承認）

1. Render → `location-stock-indicator` → Environment → `APP_EVENTS_USAGE_ENABLED` = `1` → 保存 → Live を待つ
2. 開発ストア（Pro）で **管理画面** を開く（報告は管理画面を開いたときだけ。商品ページからは送らない）
3. Render のログ:
   - よい: `[app-events-usage] sent shop=location-stock-indicator.myshopify.com units=<ロケーション数> handle=pro_location key=…`
   - だめ: `[app-events-usage] send failed shop=… status=<数字>`（時間をおいてやり直す）
   - `over app-side limit` … ロケーション数がアプリの上限（`APP_EVENTS_USAGE_MAX_UNITS`・既定 100）を超えた。送っていない
   - `no billing period` … 期間が読めない。送っていない
4. **Dev Dashboard の Logs で請求に載ったかを見る**（API の 202 は「受け取った」だけ）
   - Dev Dashboard（dev.shopify.com）→ アプリ → **Location Stock** → **Logs** → Type を **App billing event** に絞る
   - `OK` ならよい。`NO_MATCHING_METER` はメーターの handle が違う（4.1 か `APP_EVENTS_HANDLE_PRO`）。`NO_SUBSCRIPTION` は契約が無い
5. 料金プランの画面が「今の請求期間の分は Shopify に報告済みです。」になる → #49 に 1 行書く

- 【未確認】開発ストアで使用量のイベントが通るか（コミュニティに 503 が続く報告あり）。
- 管理画面を 1 度も開かない請求期間は送られない（#50 の決まり）。

---

## 7. 自社用（Ciara）への影響

| PR | Ciara で変わること |
|---|---|
| #44 | **Admin API の版が 2026-07 になる**。分析の書き先が日ごとのキーになる。分析の入力の確かめが入る。3.2 で必ず見る |
| #48 | 変わらない（自社用は Shopify に契約を聞かず全機能。保存のときに GraphQL を呼ばない） |
| #50 | 空の `AppUsageReport` の表が増えるだけ。報告しない |

- 【T】#44・#48・#50 のそれぞれのあとで: Ciara の管理画面の全画面と保存、商品ページの在庫・エリア・近隣・店舗受け取りが今まで通り。

---

## 8. 困ったとき（上から順に）

1. 送るのを止める: 公開用の `APP_EVENTS_USAGE_ENABLED` を消す → 保存
2. Partner API をやめる: `PARTNER_API_SUBSCRIPTION_ENABLED` を消す
3. コードを戻す: Render → 該当サービス（公開用・自社用の両方）→ Events → 1 つ前の Live の版 → Rollback。【係】が revert の PR → 【T】がカードで承認してマージ
   - #44 を戻したときは、3.3 で出した toml の版も、Partner Dashboard → バージョン で 1 つ前の版を出す（【T】）
   - #48 まで戻すときは #57 の 8 章の注意（Managed pricing にしたあとは古いコードで契約を作れない）を先に読む
4. `AppUsageReport` の表は消さない。Partner Dashboard のプランは消さない（店の契約が切れる）

---

## 9. チェック表（本番）

- [ ] 【T】2. #44 を開発ストアで確かめた（2.1 か 2.2）
- [ ] 【係】5.0 の見直し → カード
- [ ] 【T】3.1 #44 → Render 2 つが Live
- [ ] 【T】3.2 Ciara と開発ストアがいつも通り・分析が日ごとのキーに入った
- [ ] 【T】3.3 `shopify app deploy`（公開用・自社用 1 回ずつ）
- [ ] 【T】4.1 Managed pricing・プラン 2 つ・メーター `pro_location`・handle を控えた
- [ ] 【T】4.2 開発ストアで Pro を選び `ACTIVE`・`test: true`・`currentPeriodEnd` あり
- [ ] 【T】4.3 `SHOPIFY_APP_HANDLE`（＋使うなら `PARTNER_API_*`）
- [ ] 【係】5.1 #74 を #50 へ（T さんの承認のあと）
- [ ] 【T】5.2 #48 → Live → 料金プランの画面が開く
- [ ] 【T】5.3 #50 の base を main → マージ → Live・migration のログ → #54
- [ ] 【T】6.1〜6.3 開発ストア・ログ・shop/redact の試し
- [ ] 【T】7. Ciara がいつも通り
- [ ] 【T】6.4 `APP_EVENTS_USAGE_ENABLED=1` → ログ `sent` → Dev Dashboard の Logs で `OK`

# Partner Dashboard と公開用 Render の手順 — Location Stock

T が上から順に押すための手順。**オンにする（外へ送る）のは、#48・#50 が main に入り、T が決めたあと**。1〜3 は先にやってよい（作るだけでは請求されない）。

根拠:
- 料金の決定: location-stock-indicator#49（2026-11-21 T）。作りは PR #48（App Pricing・Partner API）と PR #50（Pro の従量）
- メーターの作り方と決まり: https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing/subscription-billing/setup-usage-charges 【事実 2026-11-22 に読んだ】
- App Events API のトークン: https://shopify.dev/docs/apps/build/app-events/send-events 【事実】

画面の名前は Shopify が変えることがある。見つからないときは近い名前を探す。

---

## 1. 料金プランを 2 つ作る（Partner Dashboard）

1. https://partners.shopify.com → Apps → **Location Stock**（公開用。client_id `1758…1f48`）
2. Distribution → **Pricing** → 方式で **Shopify App Pricing（Managed pricing）** を選ぶ
3. Public plans → Add を 2 回

| | Lite | Pro |
|---|---|---|
| Plan handle（後から変えられない） | `lite` | `pro` |
| 表示名 | Lite | Pro |
| Billing | Monthly | Monthly |
| 月額（USD） | 20 | 20 |
| Free trial（日） | 7 | 14 |
| Redirect URL | `/app` | `/app` |
| 使用量のメーター | なし | `pro_location`（2 章） |

- **表示名と handle の両方に `lite` / `pro` を入れる**。アプリは契約名（Admin API）か handle（Partner API）に `Pro` / `Lite` が入っているかでプランを決める【事実: #48 の `getPlanFromActiveSubscriptions`、PLAN_SETTINGS_DESIGN 3.4】。
- 無料体験の日数は T さんの決定（2026-11-22、#49）。
- 各プランの「特徴」は ja.md 9 章の「使える機能」を貼る（最初は日本語だけで掲載する。英語の en.md 8 章は公開のあと。T さんの決定 2026-11-22、#49）。
- Partner の条件で「Merchant must have online store」を選ぶ（4.3.1）。

## 2. Pro に使用量のメーターを作る

1. Pricing で **Pro** を開く → usage meter を作る
   - event handle: `pro_location`
   - 料金の形: **Fixed**、1 単位 **US$2**
2. Lite には付けない

- アプリは Pro の店で **すべてのロケーション数** を 1 請求期間に 1 回送る（10 か所を引かない）【事実: #50 の `computeProLocationUsage`】。
- handle を変えたら Render の `APP_EVENTS_HANDLE_PRO` も同じにする。違うと請求されず、Logs に「App event」とだけ出る【事実: setup-usage-charges】。
- 使用量のあるプランは月額だけ。Shopify 側に上限（cap）は無い。アプリ側の上限は `APP_EVENTS_USAGE_MAX_UNITS`（既定 100 か所）【事実: #50 の `DEFAULT_MAX_UNITS`】。
- アンインストールのあと 24 時間で期間が閉じる（`PERIOD_CLOSED`）【事実: setup-usage-charges】。

## 3. アプリの handle を控える

- Partner Dashboard のアプリの handle（例 `location-stock`）。**#48 から既定値が無くなった**ので、`SHOPIFY_APP_HANDLE` が無いと料金プランの画面からプラン選択ページへ移れない【事実: #48 の `getPublicAppHandle` は未設定なら `null`】。

## 4. Partner API client を作る（#48 の Partner API を使うときだけ）

1. Dev Dashboard → 組織の設定（Organization settings）→ Users → Security → **Partner API clients** → Add Partner API client
2. 名前: `location-stock-subscription` など。権限は **Manage apps だけ**。POS Stock とは別の client にする（上限は client ごと 4 回/秒。App Proxy が商品ページのたびに呼ぶので特に大事）【事実: PLAN_SETTINGS_DESIGN 3.4】
3. トークンをすぐ控える
4. **Partner Dashboard の URL の数字**（`PARTNER_API_ORG_ID`）と公開用アプリの ID（`PARTNER_API_APP_ID`）を控える

## 5. 公開用 Render（`location-stock-indicator`）の環境変数

**自社用（Ciara）の Render には入れない。** 秘密の値はチャットやコミットに書かない。

### 5.1 まず確かめる

| 名前 | あるべき値 |
|---|---|
| `APP_DISTRIBUTION` | 空（または `public`） |
| `CUSTOM_APP_STORE_IDS` | 空 |
| `FORCE_PLAN_LITE` | 空（#48 から使わない。残っていれば消す） |
| `SCOPES` | 公開用 toml の `scopes` と同じ（`read_inventory,read_locations,read_products,read_shipping,read_markets,write_app_proxy`） |
| `SHOPIFY_APP_HANDLE` | 3 章の handle（#48 が入る前に入れておく） |

### 5.2 使用量（#50）— 入れるのは #50 が main に入ってから

| 名前 | 値 |
|---|---|
| `APP_EVENTS_CLIENT_ID` | **公開用アプリの client ID**（`SHOPIFY_API_KEY` と同じ値）【事実: send-events「アプリの client ID と secret でトークンを取る」】 |
| `APP_EVENTS_CLIENT_SECRET` | 公開用アプリの client secret（`SHOPIFY_API_SECRET` と同じ値） |
| `APP_EVENTS_HANDLE_PRO` | 省略可（既定 `pro_location`） |
| `APP_EVENTS_USAGE_MAX_UNITS` | 省略可（既定 100） |
| `APP_EVENTS_API_VERSION` | 省略可（既定 `2026-10`） |
| `APP_EVENTS_USAGE_ENABLED` | **最後に** `1`（T の承認のあと）。入れるまでは数だけ DB に `disabled` で残る |

### 5.3 Partner API（#48）— 入れるのは #48 が main に入ってから

| 名前 | 値 |
|---|---|
| `PARTNER_API_TOKEN` | 4 章のトークン |
| `PARTNER_API_ORG_ID` | Partner Dashboard の URL の数字 |
| `PARTNER_API_APP_ID` | 公開用アプリの ID |
| `PARTNER_API_VERSION` | 省略可（既定 `2026-10`） |
| `PARTNER_API_SUBSCRIPTION_ENABLED` | **最後に** `1`（T の承認のあと） |

## 6. 開発ストアで確かめる（`bbbincbbb`）

1. アプリ → 料金プラン → Shopify のプラン選択ページで Pro（テスト課金）
2. 商品ページに在庫が出る。Lite に変えると、エリア・近い店舗・受け取りボタンが消える
3. 料金プランの画面にロケーション数と Pro の使用量が出る（#50）
4. Dev Dashboard → アプリ → **Logs** → Type「App billing event」で `OK` か見る（`NO_MATCHING_METER` は handle の違い、`NO_SUBSCRIPTION` は契約なし）【事実: setup-usage-charges】
5. プランを外す → 商品ページに在庫が出ない（`plan_required`）

- 【未確認】開発ストアのテスト課金が Partner API に出るか（出なければ Admin API の結果を使う）。
- 【未確認】開発ストアで使用量のイベントが通るか（コミュニティに 503 が続く報告: https://community.shopify.dev/t/app-events-api-repeatedly-returns-http-503-for-metered-plan-marked-free-on-development-stores/36239）。

## 7. チェック

- [ ] 1. プラン 2 つ（handle `lite` / `pro`）・オンラインストアが必要
- [ ] 2. Pro にメーター `pro_location` $2
- [ ] 3. `SHOPIFY_APP_HANDLE`
- [ ] 4. Partner API client（使うなら・POS Stock と別）
- [ ] 5.1 今の値の確認
- [ ] 5.2 / 5.3 は #48・#50 のあと。`…_ENABLED=1` は T の承認のあと
- [ ] 6. 開発ストアで確かめた

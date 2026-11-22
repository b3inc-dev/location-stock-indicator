# 料金（Shopify App Pricing）を本番に出す手順 — Location Stock

対象: #48（公開用の料金を App Pricing にする・契約を Partner API でも読む）・#50（Pro の 1 ロケーション $2 を App Events API で報告。#48 の上に積んだ PR）

- この手順は下書きです。マージ・本番に出す操作・スイッチをオンにすることはしていません
- T がやるところは **【T】**、エージェントがやるところは **【係】**
- 公開用「Location Stock」だけの話です。自社用（Location Stock - Ciara）は変わりません（7. を参照）

---

## 0. 順番（これ以外の順にしない）

1. Partner Dashboard でプランとメーターを作る
2. 公開用の Render `location-stock-indicator` に環境変数を入れる（送るスイッチはまだ入れない）
3. migration の時刻を確かめる
4. #48 を main へ → #50 を main へ
5. 開発ストアで確かめる（`shopify app execute`）
6. **ここまで OK のときだけ** `APP_EVENTS_USAGE_ENABLED=1`

**大事:** #48 を先に出すと、公開用の店は **開発ストアも含めて全部止まります**（契約が無い扱い。商品ページの在庫も出ません）。必ず 1.・2. を先に。

---

## 1. 【T】Partner Dashboard（公開用「Location Stock」）

Partner Dashboard → アプリ → Location Stock（client_id `1758d63a…`）→ 配布 → 価格 → **Managed pricing** を選ぶ（Billing API のままだとプラン選択ページが出ません）

### プラン（月額）

| 表示名 | 内部計画ハンドル | メーター |
|---|---|---|
| Lite | `lite` | なし |
| Pro | `pro` | `pro_location`・Fixed・1 単位 $2 |

- 表示名に必ず「Lite」「Pro」を入れる（アプリは名前で判定します）
- 内部計画ハンドルは英小文字・数字・**ハイフン**だけ（`lite` / `pro`、分けるなら `lite-10` など）。アンダースコアは使わない。**あとから変えられない**
- メーターのあるプラン（Pro）は月額だけ（年額だけのプランには付けられない）
- 金額・無料期間は T が決めたものを入れる（今の画面の記載は Lite $20・7 日、Pro $20＋$2×ロケーション・14 日）
- メーターの handle を `pro_location` と違う文字にしたときは、2. で `APP_EVENTS_HANDLE_PRO` を同じ文字にする
- App Store のリスティングの料金の記載も合わせる

### Partner API client（使うときだけ）

Dev Dashboard → Organization settings → Users → Security → Partner API clients → Add

- 権限は **Manage apps** だけ。トークンはすぐ控える
- Location Stock 用に 1 つ（POS Stock・Review Q&A とは分ける）

### アプリの handle を控える

Partner Dashboard のアプリの URL や「App handle」に出る文字（`admin.shopify.com/store/<店>/charges/<handle>/pricing_plans` の `<handle>`）。

---

## 2. 【T】Render の環境変数（公開用 `location-stock-indicator` だけ）

Render → `location-stock-indicator` → Environment

| 名前 | 値 | 要るか |
|---|---|---|
| `SHOPIFY_APP_HANDLE` | 1. で控えた handle | **必須**（無いとプラン選択ページを開けない） |
| `APP_DISTRIBUTION` | 空か `public` | `inhouse` にしない |
| `PARTNER_API_SUBSCRIPTION_ENABLED` | `1` | 使うときだけ |
| `PARTNER_API_TOKEN` | 1. のトークン（秘密） | 使うときだけ |
| `PARTNER_API_ORG_ID` | Partner Dashboard の URL の数字 | 使うときだけ |
| `PARTNER_API_APP_ID` | 公開用アプリの ID | 使うときだけ |
| `APP_EVENTS_USAGE_ENABLED` | **まだ入れない** | 6. で入れる |

- `APP_EVENTS_CLIENT_ID` / `APP_EVENTS_CLIENT_SECRET` は入れなくてよい（無いときは公開用の `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` を使う）
- `FORCE_PLAN_LITE` はもう効きません（入っていたら消してよい）
- 自社用 `location-stock-indicator-ciara` には **何も入れない**
- 保存で Render がやり直しになっても、中身はまだ古いコードなので大丈夫です

---

## 3. 【係】migration の時刻を確かめる（マージの直前）

- #50 の migration: `prisma/migrations/20261121140000_add_app_usage_report`（#48 には migration なし）
- 2026-11-22 の main の最新: `20261010160000_session_postgres`（#50 のほうが後なので今は OK）
- マージの直前に、もう一度 main の最新と比べる。main に後の時刻のものが入っていたら、#50 の migration の時刻を main の最新より後へ付け直してから T にカード

```bash
git fetch origin
git ls-tree --name-only origin/main prisma/migrations/ | tail -3
```

---

## 4. 【T】#48 → #50 の順にマージ

### #48

1. カードで承認 → main へマージ
2. Render の **両方**（`location-stock-indicator` と `location-stock-indicator-ciara`）が「Live」になるまで待つ
   - 自社用は main を見て自動で出ることを確かめてあります。公開用が自動で出るかは未確認なので、出ていなければ Render で「Manual Deploy → Deploy latest commit」
3. すぐに公開用の開発ストアで、料金プランの画面が開くかだけ見る（くわしくは 5.）

### #50

1. **#50 の行き先（base）が `main` になっているか見る**
   - #48 のブランチを消していれば GitHub が自動で `main` に替えます
   - 替わっていなければ PR の「Edit」→ base を `main` にする（【係】がやってもよい）
   - `claude/loc-managed-pricing` のままマージすると、main に入りません
2. カードで承認 → main へマージ
3. Render 2 つが「Live」になるまで待つ
   - 起動のとき `npm run setup`（`prisma migrate deploy`）で、DB に `AppUsageReport` の表が 1 つ増えます。スイッチはオフなので外へは送りません

2026-11-22 の時点では #50 は main とぶつかりません。

---

## 5. 【T】開発ストアで確かめる

### 5.1 Shopify の契約を直接見る

パソコンの `location-stock-indicator` のフォルダで（`<開発ストア>` は公開用アプリを入れた開発ストア）:

```bash
shopify app execute -c public -s <開発ストア>.myshopify.com -q '{ shop { id } currentAppInstallation { activeSubscriptions { name status test currentPeriodEnd } } }'
```

| 項目 | よい値 |
|---|---|
| `name` | 選んだプランの名前（Lite か Pro が入っている） |
| `status` | `ACTIVE` |
| `test` | `true`（テスト課金で請求なし） |
| `currentPeriodEnd` | 空でない（Pro の従量の期間に使う） |

`activeSubscriptions` が空なら、まだプランを選んでいません。

### 5.2 画面で見る

1. 契約なし: 管理画面はホームと料金プランだけ。商品ページの在庫は出ない
2. 料金プラン →「このプランを選ぶ」で Shopify の画面が **アプリの外** で開く
3. テストの Lite を選ぶ → 商品ページに在庫が出る（エリアなど Pro の分は出ない）→ 5.1 をもう一度
4. Pro に替える → 全部出る。料金プラン画面に「ロケーション N か所 × $2」と「まだ報告していません」
5. iPhone 幅と PC 幅で料金プラン画面が崩れていない

---

## 6. 【T】送るスイッチを入れる（5. が全部 OK のときだけ）

1. Render `location-stock-indicator` → Environment → `APP_EVENTS_USAGE_ENABLED=1` → 保存
2. 開発ストア（Pro）で **管理画面** を開く（報告は管理画面を開いたときだけ。商品ページからは送らない）
3. Dev Dashboard → アプリ → **Logs**（Type: App billing event）に `OK` が出るのを見る
   - API の 202 は「受け取った」だけです

管理画面を 1 度も開かない請求期間は、従量が送られません（#50 の決まり）。

---

## 7. 自社用（Ciara）は変わらない

- `SHOPIFY_API_KEY` が Ciara の client_id、または `APP_DISTRIBUTION=inhouse` なら自社用。全機能・課金なし・報告なし
- 自社用は保存のときに GraphQL を呼ばないので、保存の速さも変わりません
- DB には空の `AppUsageReport` の表が増えるだけです
- 【T】マージのあと Ciara で: 管理画面の全画面と保存、商品ページの在庫・エリア・近隣・店舗受け取りが今まで通り

---

## 8. 前の版に戻す

困ったら、上から順に。

1. **送るのを止める**: Render `location-stock-indicator` → `APP_EVENTS_USAGE_ENABLED` を消す → 保存
2. **Partner API をやめる**: `PARTNER_API_SUBSCRIPTION_ENABLED` を消す → Admin API だけで読む
3. **#50 だけ戻す**: Render で 1 つ前の「Live」の版へ Rollback（公開用・自社用の両方）→ 【係】が revert の PR → 【T】カードで承認してマージ。`AppUsageReport` の表は残るが害はない。消さない
4. **#48 まで戻す**: 注意。#48 より前のコードは Billing API でアプリが契約を作るやり方です。Partner Dashboard を Managed pricing にしたあとは、**古いコードでは新しく契約を作れません**（すでにある契約は名前の Lite / Pro で読めます）。戻すなら Partner Dashboard の価格の設定も前に戻すかを T が決めてから
   - 店が止まって困るときの止血は、戻すより先に【係】に「契約が読めないときの止め方」を見せてもらう

Partner Dashboard のプランは消さないでください（店の契約が切れます）。

---

## 9. 一覧（チェック用）

- [ ] 【T】1. Managed pricing・プラン 2 つ（ハイフンの handle）・メーター `pro_location`
- [ ] 【T】1. Partner API client（使うときだけ）・アプリの handle を控える
- [ ] 【T】2. `location-stock-indicator` に `SHOPIFY_APP_HANDLE`（＋ `PARTNER_API_*`）
- [ ] 【係】3. migration の時刻
- [ ] 【T】4. #48 マージ → 2 つ Live
- [ ] 【T】4. #50 の base を main → マージ → Live
- [ ] 【T】5. `shopify app execute` と画面
- [ ] 【T】6. `APP_EVENTS_USAGE_ENABLED=1` → Logs で `OK`
- [ ] 【T】7. Ciara がいつも通り

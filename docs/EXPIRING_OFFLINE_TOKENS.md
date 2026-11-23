# 期限付きのオフライントークンへの移行（出し方の手順）

Dev Dashboard の知らせ「非推奨のオフライントークン」（公開用 Location Stock）への対応。
Shopify の案内: https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens

## 期日（Shopify の案内より）

| 日 | 起きること |
|----|------------|
| 2027-01-01 | 期限の無いトークンを使う公開アプリは、新しく入れられなくなる（掲載から外れる）。入っている店は動く |
| 2027-01-15 | 店の管理画面に注意が出る |
| 2027-04-01 | 期限の無いトークンでの Admin API の呼び出しが断られる |

カスタムアプリ（自社用の Location Stock - Ciara）は、この期日の対象外と案内に書かれている。ただしコードは同じなので、Ciara も同じ動きになる（下の「Ciara への影響」）。

## 原因（調べて分かったこと・事実）

- `app/shopify.server.js` には 2026-05 から `future.expiringOfflineAccessTokens: true` があり、`Session` の表にも `refreshToken`・`refreshTokenExpires` がある。
- しかし `package-lock.json` で固定していた `@shopify/shopify-app-react-router` は **1.0.3**（`@shopify/shopify-api` 12.1.2）。このフラグは **1.1.0**（shopify-api 12.2.0）で入ったもので、1.0.3 では読まれない。そのため管理画面のトークン交換は `expiring=1` を付けずに行われ、**期限の無いトークン**が保存されていた。
- App Proxy（`apps.location-stock.js`）では `ensureOfflineAccessTokenFresh` が古いトークンを交換して期限付きにしていた。けれど 1 時間ほどで切れると、管理画面を開いたときのトークン交換（1.0.3）で、また期限の無いトークンに戻っていた（推測: ログで確かめていない。`docs/OFFLINE_SESSION_CIARA_REPRO.md` の「約 60 分で期限切れ」と合う）。

## この PR で変えたこと

1. `@shopify/shopify-app-react-router` を `~1.1.1`（shopify-api 12.3.0・session-storage 4.0.5）にした。1.2.0 は `customShopDomains` が無くなるなど作りが変わるので入れない（`~` で 1.1 系に止める）。
   - これで新しく入れた店・トークン交換のたびに、期限付きのトークン（＋リフレッシュトークン）になる。切れたトークンはライブラリが自動で更新する（管理画面・Webhook・App Proxy・`unauthenticated.admin`）。
2. すでに入っている店の古いトークンは、ライブラリは移さない。管理画面を開いたときに 1 回、公式の交換で期限付きに移す（`app/routes/app.jsx` → `offlineTokenMigration.js`。交換の中身は前からある `refresh-offline-session.js`）。**スイッチ `EXPIRING_TOKEN_MIGRATION`（既定オフ）**。
3. まとめて移すスクリプト `scripts/migrate-offline-tokens.mjs`（既定は試しだけ。`--one` で 1 店・`--apply` で全部）。
4. 1.1 系には「アプリを外した店の Webhook で、トークンの更新に失敗して 500 になる」不具合がある（4.0.3 で直った）。Webhook の受け口 3 つ（app/uninstalled・app/scopes_update・compliance）を `authenticateWebhook`（`webhookAuth.js`）に替え、500 のときは HMAC を自分で確かめてセッション無しで受ける。app/uninstalled はセッションが無くてもその店のセッションを消す。
5. shop/redact の「まだ入っているか」の確かめで、トークンもリフレッシュトークンも切れている店は Admin API を呼ばずに「入っていない」とする（呼ぶと 500 で送り直しが続くため）。

## 出す順番（T さんの承認が要る所に ★）

1. ★ この PR を main に入れる（main に入れると公開用と Ciara の両方の Render が配備される）。
2. 配備のあと、どちらかの店で管理画面を開く。Render のログで、ライブラリの `Requesting offline access token` が出るときに期限付きになっているか（DB の `Session.expires` に日時・`refreshToken` が入る）を確かめる。
3. ★ 公開用の Render に `EXPIRING_TOKEN_MIGRATION=on` を入れる（入れると、古いトークンの店が管理画面を開いたときに移る。古いトークンはすぐ使えなくなり、元に戻せない）。
4. ★ 管理画面を開かない店のために、Render の Shell で `node scripts/migrate-offline-tokens.mjs`（試し）→ `--one` → `--apply` の順に動かす。
5. Dev Dashboard の「ログ」で、種類を GraphQL request、トークンの種類を「Offline, non-expiring」にして、何も出なくなったら終わり。
6. Ciara も同じ順で（Ciara の Render に別に `EXPIRING_TOKEN_MIGRATION` を入れる）。

## Ciara への影響

- 同じ `shopify.server.js` を使うので、Ciara も main に入れた時点で期限付きのトークンになる。Ciara の Render・Partners アプリは別（`SHOPIFY_API_KEY`・`SECRET` を取り違えない）。
- Ciara は App Proxy の更新（`ensureOfflineAccessTokenFresh`）がもともと動いていたので、ストアフロントの動きは変わらない見込み（推測）。

## 気をつけること・残り

- 古いトークンを移した瞬間、同じ時に動いていた別の読み込みが古いトークンで 1 回失敗することがある。管理画面はライブラリがトークン交換をやり直す。App Proxy は前からある「認証エラーなら更新して 1 回やり直す」で戻る。
- 1.1 系の App Proxy は、更新に失敗すると 500 の Response を投げる（前は `session_reauth_required` の JSON）。ストアフロントの表示は「取得に失敗」になる。管理画面を開けば戻る。
- Shopify の案内には「フラグを足したら `shopify app deploy`」とある。トークン交換の `expiring=1` はコードの側で付くので、アプリの設定の配備は要らない見込み（推測）。要るときは T さんが行う。

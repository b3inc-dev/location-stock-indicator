# Ciara: Offline session 放置再現とログ相関（本番操作なし）

目的: 管理画面でアプリを開かずに放置したあと、ストアフロントの在庫表示が失敗／回復するかを確認する。  
**本番 DB の直接操作・secret の出力・承認なし deploy／merge は行わない。**

関連実装: `app/utils/refresh-offline-session.js`、`app/routes/apps.location-stock.js`、Theme snippet の再 fetch。

---

## 1. 前提

| 項目 | 値 |
|------|-----|
| 自社アプリ | Location Stock - Ciara（`shopify.app.toml`） |
| Render | `location-stock-indicator-ciara.onrender.com` |
| 確認対象 | 商品ページの Location stock indicator ブロック |
| トークン | Offline access token は約 60 分で期限切れ（refresh token あり） |

この手順は **観測・ログ確認のみ**。セッション行の手編集や Render の手動 Deploy は含まない。

---

## 2. 再現手順（放置）

1. Ciara 対象ストアの管理画面でアプリを一度開き、OAuth／セッションが生きていることを確認する。
2. 商品ページを開き、ロケーション別在庫が通常表示されることを確認する。
3. **管理画面のアプリを閉じたまま** 60〜120 分以上放置する（ブラウザの埋め込みアプリを開かない）。
4. 同じ商品ページをリロード（または別バリアントに切り替えて戻す）。
5. 期待（本修正後）:
   - 在庫が表示される（proactive refresh または GraphQL 認証失敗後の 1 回 refresh→再試行）。
   - 失敗する場合は Theme が約 3 秒後に同一 variant を 1 回だけ再 fetch する。
6. それでも失敗し `error: session_reauth_required` のとき:
   - 管理画面からアプリを開く（再認可／token exchange）。
   - 再度商品ページを確認し、表示が回復するか見る。

---

## 3. ログ相関の見方（Render → ブラウザ）

Render（Ciara）のログとブラウザ Network / Console を同じ時刻で突き合わせる。

### 3.1 サーバー（`console.error` JSON）

| ログプレフィックス / code | 意味 |
|---------------------------|------|
| `[refresh-offline-session]` + `status` | refresh／migration の結果（`refreshed` / `migrated` / `refresh_failed` / `missing_refresh_token` / `refresh_token_expired` 等） |
| `[location-stock] App Proxy error` + `session_reauth_required` | refresh 不可。管理 UI 再オープンが必要 |
| 同 + `graphql_auth_failure` | GraphQL 認証エラー検知 → force refresh 後に再試行する直前 |
| 同 + `graphql_auth_failure_after_refresh` | refresh 後も認証失敗 |
| 同 + `missing_admin_client` | `admin` 未初期化（session 有無は `hasSession`） |
| 同 + `graphql_error` | 認証以外の GraphQL エラー（`retried` / `refreshStatus` 付きの場合あり） |
| 同 + `offline_token_unusable` | トークン更新失敗（再認可以外の理由含む） |

相関キー（秘密は含めない）:

- `shop`（`*.myshopify.com`）
- `variantId`
- `code` / `refreshStatus` / `route`（`loader` / `action` 等）
- 時刻（Render ログとブラウザの失敗時刻）

### 3.2 ブラウザ

- Network: `GET /apps/location-stock?variant_id=...` の JSON
  - 成功: `{ "ok": true, "stocks": [...], "config": {...} }`
  - 失敗例: `{ "ok": false, "error": "session_reauth_required", "message": "..." }`
- Console: `[location-stock] API error <code>`（画面文言には code を出さない）

---

## 4. 合格／不合格の目安

| 結果 | 判定 |
|------|------|
| 放置後も在庫表示、ログに `refreshed` または静かに成功 | 合格 |
| 初回失敗 → 数秒後の再 fetch で成功 | 合格（Theme 補助が効いている） |
| 継続的に `session_reauth_required` / `missing_admin_client` で、管理 UI オープン後のみ回復 | 不合格（refresh／migration 経路を要調査） |
| 管理 UI オープン後も回復しない | スコープ・API キー取り違え・別系統障害を疑う（`docs/DEPLOY_AND_SCOPES.md`） |

---

## 5. 既存ショップの refresh 無し session

`refreshToken` が無い offline session は、非期限付きトークンなら公式 token-exchange（`expiring=1`）で移行を試行する。失敗時は `session_reauth_required` を返し、商人に管理画面からのアプリ再オープンを促す。  
**DB を手で書き換えない。**

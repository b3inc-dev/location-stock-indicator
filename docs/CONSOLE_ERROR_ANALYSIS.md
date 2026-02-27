# コンソールエラー分析：bbb-logo-cap SyntaxError と 401

## エラー内容

### SyntaxError（Invalid or unexpected token）

```
bbb-logo-cap:2282 Uncaught SyntaxError: Invalid or unexpected token (at bbb-logo-cap:2282:143)
bbb-logo-cap:3770 Uncaught SyntaxError: Invalid or unexpected token (at bbb-logo-cap:3770:143)
bbb-logo-cap:5086 Uncaught SyntaxError: Invalid or unexpected token (at bbb-logo-cap:5086:143)
```

- **ファイル名**: `bbb-logo-cap` … テーマのセクション／結合されたアセット名の可能性が高いです（アプリの snippet 名とは一致しません）。
- **位置**: 2282行目・3770行目・5086行目、いずれも **143文字付近**。
- **同じエラーが3回** … アプリ表示を3箇所に入れているため、同じブロックが3回レンダリングされ、同じ問題が3回出ている可能性があります。

### 401 Unauthorized（在庫が「読み込めない」原因の候補）

```
GET https://bbbincbbb.myshopify.com/sf_private_access_tokens net::ERR_ABORTED 401 (Unauthorized)
（bbb-logo-cap:76 などで発生）
```

- **本アプリ（Location stock indicator）では** `/sf_private_access_tokens` は使用していません。在庫取得は `/apps/location-stock?variant_id=...` を fetch しています。
- 上記 401 は **テーマ（bbb-logo-cap）または他アプリ** が `sf_private_access_tokens` を呼び出している際の認証失敗です。
- ストアフロントでは「秘密アクセストークン」取得に失敗すると、その機能だけ動かなくなることがあります。在庫表示が「読み込めない」原因が **この 401 と無関係** なら、当アプリの App Proxy（`/apps/location-stock`）の設定・Cookie・署名を確認してください。

## 想定される要因

### 1. 「Invalid or unexpected token」のよくある原因

- **文字列内の未エスケープの引用符** … `"` や `'` がそのまま出力され、JSの文字列が壊れている。
- **不正な Unicode / 制御文字** … コピペやエディタでゼロ幅文字・スマート引用符が混ざっている。
- **`</script>` の直書き** … カスタムCSSや設定値に `</script>` が含まれると、その位置で `<script>` が閉じられ、後続が「トークン」として解釈されて SyntaxError になり得る。
- **改行の扱い** … 設定値に改行が入り、そのまま JS に埋め込まれて改行で文が分断されている。

### 2. エラーが出ているのが「bbb-logo-cap」の場合

- **テーマ側のセクション／アセット**（例: ロゴやキャップ用のセクション）のスクリプトで、  
  上記のような「143文字付近の不正なトークン」が発生している可能性があります。
- テーマで複数セクションを1ファイルにまとめている場合、  
  行番号 2279 / 3767 / 5083 は、その結合後のファイルの行であり、  
  Location stock indicator の snippet とは別のブロックのコードである可能性があります。

### 3. Location stock indicator 側でできる対策（実施済み）

- **custom_css の `</style>` エスケープ**  
  - 追加CSSに `</style>` が含まれていると、`<style>` が途中で閉じられ、  
    続く `</style>` や `<script>` が意図しない形で解釈され、  
    別の script ブロック内で「Invalid or unexpected token」につながる場合があります。  
  - スニペットで `{{ s.custom_css | replace: '</style>', '\3C \2F style \3E' }}` を適用し、  
    `</style>` を CSS 上の等価な表現に置き換えました（`<style>` の早期終了を防止）。

- **custom_css の `</script>` エスケープ**  
  - 追加CSSに `</script>` が含まれると、テーマがブロックを script 内に展開している場合に  
    `<script>` が途中で閉じられ、143文字付近で SyntaxError になり得ます。  
  - `{{ s.custom_css | replace: '</script>', '\3C \2F script \3E' }}` を追加し、  
    `</script>` を CSS 上の等価な表現に置き換えました。

- **script 内の root_id を JSON で安全に出力**  
  - `getElementById("location-stock-indicator-{{ root_id }}")` のように  
    `root_id`（block.id）をそのまま文字列に埋め込んでいると、  
    id に引用符や特殊文字が含まれた場合に 143 文字付近で SyntaxError になります。  
  - `var rootId = {{ "location-stock-indicator-" | append: root_id | json }};` とし、  
    `getElementById(rootId)` で参照するように変更しました（| json でエスケープ）。

### 4. 近隣店舗表示の組み込みが原因だった場合（実施済み）

- **要因**  
  近隣店舗用の HTML を組み立てている行（`html += '... colspan="' + colCount + '" ...'` など）が  
  **非常に長い 1 行** になっており、その行の **約 143 文字目** に  
  **単一引用符（`'`）** が含まれていました。  
  テーマ（bbb-logo-cap）がブロックの出力を **単一引用符で囲んだ文字列**（例: `var x = '...'`）として  
  別の `<script>` に埋め込んでいる場合、その `'` が「文字列の終わり」と解釈され、  
  続くコードが通常の JS として解釈されて **SyntaxError（Invalid or unexpected token）** になります。  
  近隣店舗を入れるまでエラーが出ていなかったのは、この長い行が増えたことで  
  問題の `'` がちょうど 143 文字目付近に来るようになったためです。

- **対応**  
  近隣店舗の「見出し行」「1 店舗表示行」を組み立てている **4 行** について、  
  単一引用符で囲んだ長い文字列をやめ、  
  **二重引用符で囲み、内部の `"` を `\"` でエスケープ** する形に変更しました。  
  これにより、該当行に単一引用符が現れず、テーマ側で単一引用符の文字列に埋め込まれても  
  誤って文字列が終了しなくなります。

  - 変更箇所: `location-stock-indicator.liquid` の  
    - テーブル用: 近隣店舗ヘッダー行・body 行の 2 行（`html +=` の長い行）  
    - リスト用: 近隣店舗ヘッダー行・body 行の 2 行（同上）

## 確認してほしいこと

1. **テーマに「bbb-logo-cap」というセクション／アセットがあるか**  
   - テーマエディタやファイル一覧で `bbb-logo-cap` を検索し、  
     該当する `.liquid` やアセットの中の **&lt;script&gt; ブロック** を開く。

2. **そのファイルの「問題の行」付近（143文字目付近）を見る**  
   - ブラウザの開発者ツールで `bbb-logo-cap` をクリックし、  
     2282行目（および 3770・5086行目）の **143文字付近** に、  
     未エスケープの `"` / `'` / 改行 / `</script>` などがないか確認する。

3. **Location stock indicator ブロックの「追加CSS」**  
   - テーマエディタで当該ブロックを開き、追加CSSに  
     `</style>` や `</script>` が含まれていないか確認する。  
     （上記の replace により `</style>` は無害化済みですが、  
     他のブロックやテーマ側に同様の記述がないか確認するとよいです。）

4. **エラーが出るページの構成**  
   - 商品ページで「Location stock indicator」ブロックが **3つ** 並んでいないか、  
     あるいは「bbb-logo-cap」系のブロックが複数ないか確認する。  
     （同じエラーが3回＝同じコードが3回評価されている可能性があります。）

## まとめ

- **SyntaxError**: **bbb-logo-cap** の **2282 / 3770 / 5086 行目、143文字付近** の「Invalid or unexpected token」です。  
  Location stock indicator では、**root_id の JSON 出力** と **custom_css の `</style>`・`</script>` エスケープ** を実施済みです。
- **401**: `sf_private_access_tokens` は本アプリでは未使用です。テーマまたは他アプリ側の認証問題です。在庫が読み込めない原因が当アプリの fetch の場合は、App Proxy（`/apps/location-stock`）の設定を確認してください。
- それでも SyntaxError が続く場合は、**テーマ側の bbb-logo-cap 内の script** で、143文字付近に未エスケープの引用符・`</script>`・改行などがないかを確認することをおすすめします。

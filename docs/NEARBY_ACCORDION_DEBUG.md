# 近隣店舗アコーディオン：クリックが効かない場合の要因と確認手順

## 想定される要因

### 1. 近隣の header/body が取得できていない（バインドされていない）

- **原因**: `bindNearbyAccordion` 内で `getElementById(root.id + "-nearby-header")` が `null` を返している。
- **起きうる理由**:
  - テーマや Shopify がブロックの HTML を別の document（iframe など）に描画している場合、`document.getElementById` では見つからない。
  - `root.id` が想定と異なる（別ブロックの root を参照している、id が書き換えられている）。
  - 近隣行を出す条件（`nearbyFirstEnabled` かつ緯度経度あり）を満たしておらず、そもそも近隣の行が出力されていない。
- **確認**: デプロイ後、商品ページで開発者ツールのコンソールを開く。  
  **`[location-stock] bindNearbyAccordion: header or body not found`** という警告が出ていれば、この要因。

### 2. クリックがテーマ側で先に処理されている

- **原因**: テーマや親要素に付いたクリックリスナーが、キャプチャフェーズまたはバブリングで先に実行され、`stopPropagation` などで止めている。
- **結果**: 近隣店舗の行までイベントが届かず、位置情報ダイアログや「取得中」も出ない。
- **今回の対応**: `document` に **キャプチャフェーズ**（`addEventListener(..., true)`）でリスナーを付け、クリック対象が「このブロックの近隣店舗行」のときだけ処理するようにした。多くのテーマより先に処理される可能性が高くなる。

### 3. 複数ブロックでの root/bodyEl のずれ

- **原因**: ブロックが複数あるとき、別ブロックの `root` や `bodyEl` を参照したまま `innerHTML` を設定・取得している。
- **今回の対応**: 近隣の「見出し行」「1行 body」に **root.id ベースの一意 id**（`root.id + "-nearby-header"` / `root.id + "-nearby-body"`）を付け、`getElementById` で取得するように変更。同じブロックの要素だけを確実に指定するようにした。

### 4. 位置情報が無効（非 HTTPS・権限など）

- ダイアログやエラーが「出ない」場合、**クリック処理が動いていない**可能性が高い（上記 1 または 2）。
- クリックは動いているが「許可しても何も起きない」場合は、`getCurrentPosition` のエラーコールバックで `showBodyError` が呼ばれているか、コンソールのエラーを確認する。

---

## 今回のコード変更まとめ

1. **近隣行に root.id ベースの id を付与**  
   テーブル/リストどちらも、近隣「見出し」と「body」に  
   `id="{root.id}-nearby-header"` / `id="{root.id}-nearby-body"` を付与。
2. **getElementById で取得**  
   `bindNearbyAccordion` 内で `doc.getElementById(root.id + "-nearby-header")` および `-nearby-body` で取得。  
   見つからない場合のみ `root.querySelector` にフォールバック。
3. **同一 document を明示**  
   `doc = root.ownerDocument || document` を使い、`root` が属する document で `getElementById` を実行。
4. **document のキャプチャでクリックを処理**  
   クリックは `document` にキャプチャで登録。`e.target.closest("[data-nearby-accordion]") === header` のときだけ `onNearbyHeaderClick` を実行し、テーマ側のクリック処理より先に扱うようにした。
5. **デバッグ用 console.warn**  
   header または body が取れなかった場合に `[location-stock] bindNearbyAccordion: header or body not found` を出力。要因 1 の確認用。

---

## 確認してほしいこと（デプロイ＋ハードリロード後）

1. **コンソールに上記の warn が出るか**  
   - 出る → header/body が取れていない（要因 1）。  
     - 商品ページの HTML で、該当ブロックの div の id と、その中に `id="...-nearby-header"` の要素があるかを確認。
   - 出ない → バインドはできている。クリックしても何も起きない場合は要因 2 の可能性が高い。
2. **「近隣店舗」の行をクリックしたとき**  
   - 「位置情報を取得中...」が一瞬でも出るか。  
   - 出る → クリックは届いている。その後の位置情報 or エラーメッセージの有無を確認。  
   - 一切出ない → クリックが別の要素で処理されているか、別の document の要素をクリックしている可能性。
3. **ブロックが複数ある場合**  
   - どのブロックの「近隣店舗」をクリックしたか（上・中・下など）を控え、そのブロックの root の id と、コンソールの warn の `rootId` が一致するか確認。

---

## テーマ側で確認するとよい点

- アプリブロックの出力が **iframe や別 document** に描画されていないか。
- 商品ページやセクションに **クリックを止める（stopPropagation など）** 処理が入っていないか。
- 同じセクションに **「アコーディオン」や「クリックで開閉」** の JavaScript がなく、近隣店舗の行をその対象にしていないか。

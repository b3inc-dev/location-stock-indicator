# スニペット設定リファレンス（ジャンル・指定方法の統一）

`location-stock-indicator.liquid` スニペットが参照する設定を、**ジャンル（カテゴリ）** と **指定方法** で整理した一覧です。  
新規項目を追加するときや、スキーマ・管理画面のどちらに置くか迷ったときの基準にしてください。

---

## 1. 用語の統一

### 1.1 ジャンル（カテゴリ）の定義

スニペットで扱う設定を、役割ごとに次の **6 ジャンル** に分類します。

| ジャンルID | 名前 | 説明 | 主な配置 |
|------------|------|------|----------|
| **layout** | タイトル・レイアウト | ブロックのタイトル、レイアウト種別、揃え、余白、幅など「どこにどう並べるか」 | テーマスキーマ |
| **appearance** | 見た目・スタイル | 色・枠線・フォントサイズ・凡例・注意書きの表示有無・位置・色など「どう見せるか」 | テーマスキーマ |
| **row_display** | 行の表示内容 | 行内の表示（マーク／在庫数／ラベル）、区切り文字、列幅など「1行に何を出すか」 | テーマ＋アプリ |
| **logic** | 在庫ルール・文言 | 閾値、マーク文字、ラベル、メッセージ、注意書きの文言など「意味・ルール」 | 管理画面（在庫表示設定） |
| **locations** | ロケーション・並び・機能 | 並び順、上部固定、表示モード、エリア・近隣・店舗受け取りのON/OFF・文言、リンク設定など | 管理画面（ロケーション設定） |
| **component_style** | コンポーネント別スタイル | エリア見出し・店舗受け取りボタンなど、特定UIパーツの色・余白・フォント | テーマスキーマ |

※ テーマブロックの「凡例・注意書き・行・枠線・色」は、ここでは **appearance** と **row_display** に分割して整理しています。

---

### 1.2 指定方法の定義

設定値が **どこから決まるか** を、次の 3 種類で統一します。

| 指定方法 | 略記 | 説明 |
|----------|------|------|
| **テーマのみ** | テーマ | ブロックのスキーマ（`block.settings`）だけ。App Proxy の config では変更しない。 |
| **アプリのみ** | アプリ | 管理画面で保存 → メタフィールド → App Proxy の `config` で返す。スニペットは JS で `appConfig` から読み、テーマの値は使わない。 |
| **テーマ初期値 → アプリで上書き** | テーマ→アプリ | スニペットの初期値はテーマ（`s.xxx`）。App Proxy から `config` が返ってきたら、該当項目だけアプリの値で上書きする。 |

- **スキーマの id**: テーマでは `snake_case`（例: `heading_text`, `row_content_mode`）。
- **JS の settings キー**: スニペット内では `camelCase`（例: `headingText`, `rowContentMode`）。  
  ※ 現在は `rowContentMode` のように一部のみ camelCase で、他は `symbolInStock` など混在。一覧では「JSで参照するキー」を記載。

---

## 2. 設定一覧（ジャンル・指定方法・出典）

### 2.1 layout（タイトル・レイアウト）

| 項目（スキーマ id または app のキー） | JSでの参照例 | 指定方法 | 説明 |
|--------------------------------------|--------------|----------|------|
| heading_text | （Liquid で直接表示） | テーマのみ | タイトル文言。空で非表示。 |
| heading_align | （CSS クラス） | テーマのみ | タイトルの揃え |
| heading_margin_bottom | （CSS） | テーマのみ | タイトル下マージン |
| heading_color | （CSS） | テーマのみ | タイトルの色 |
| layout_type | settings.layoutType | テーマのみ | 表 / リスト / 2行 |
| location_align | （CSS クラス） | テーマのみ | ロケーション名の揃え |
| status_align | （CSS クラス） | テーマのみ | 在庫表示の揃え |
| font_size | （CSS） | テーマのみ | 文字サイズ（small/medium/large） |
| margin_top, margin_bottom | （インライン style） | テーマのみ | ブロック上下マージン |
| content_max_width | （CSS） | テーマのみ | 最大幅（0 で 100%） |
| content_align | （CSS） | テーマのみ | ブロック全体の配置 |

---

### 2.2 appearance（見た目・スタイル）

| 項目 | JSでの参照例 | 指定方法 | 説明 |
|------|--------------|----------|------|
| show_legend | （Liquid で表示制御） | テーマのみ | 凡例を表示するか |
| legend_position | （Liquid） | テーマのみ | 凡例の位置（上/下） |
| legend_align | （CSS クラス） | テーマのみ | 凡例の揃え |
| legend_color | （CSS） | テーマのみ | 凡例の色 |
| show_notice | （Liquid） | テーマのみ | 注意書きを表示するか |
| notice_position | settings.noticePosition | テーマのみ | 注意書きの位置 |
| notice_align | settings.noticeAlign | テーマのみ | 注意書きの揃え |
| notice_margin | settings.noticeMargin | テーマのみ | 注意書きとリストの間隔 |
| notice_color | （CSS） | テーマのみ | 注意書きの色 |
| noticeText | settings.noticeText | アプリのみ | 注意書きの**文言**（在庫表示設定） |
| border_style | （data / CSS） | テーマのみ | 枠線スタイル（none/rows/full） |
| border_width | （data-*） | テーマのみ | 枠線の太さ |
| border_color | （data-*） | テーマのみ | 枠線の色 |
| status_text_color | （CSS） | テーマのみ | 行内テキストの色 |
| in_stock_color | settings.inStockColor | テーマのみ | 在庫ありマークの色 |
| low_stock_color | settings.lowStockColor | テーマのみ | 残りわずかマークの色 |
| out_of_stock_color | settings.outOfStockColor | テーマのみ | 在庫なしマークの色 |
| accordion_icon | settings.accordionIcon | テーマのみ | エリア折りたたみの開閉マーク |
| custom_css | （style タグ） | テーマのみ | 追加CSS |

---

### 2.3 row_display（行の表示内容）

| 項目 | JSでの参照例 | 指定方法 | 説明 |
|------|--------------|----------|------|
| row_content_mode | settings.rowContentMode | テーマのみ | 行内の表示内容（マークのみ／マーク＋在庫数 など） |
| list_separator | settings.listSeparator | テーマのみ | リスト表示時の区切り文字 |
| location_col_width | settings.locationColWidth | テーマのみ | テーブル時のロケーション列幅（%） |
| row_padding_y, row_padding_x | （data-* / CSS） | テーマのみ | 行の上下・左右余白 |
| quantityLabel, wrapperBefore, wrapperAfter | settings.* | テーマ→アプリ | 在庫数ラベル・前後の文字（在庫表示設定で上書き） |

※ マークの**文字**（◯△✕）は **logic** で、**色**は **appearance**。

---

### 2.4 logic（在庫ルール・文言）

いずれも **アプリのみ**。App Proxy の `config`（メタフィールド）から渡し、スニペットの JS で `appConfig` から読みます。

| 項目（appConfig 内のパス） | JSでの参照例 | 説明 |
|----------------------------|--------------|------|
| thresholds.outOfStockMax, inStockMin | settings.outOfStockMax, inStockMin | 在庫なし／在庫ありの境界値 |
| symbols.inStock, lowStock, outOfStock | settings.symbolInStock 等 | マークの文字（◯△✕） |
| labels.inStock, lowStock, outOfStock | settings.labelInStock 等 | ステータスラベル文言 |
| quantity.quantityLabel, wrapperBefore, wrapperAfter | settings.quantityLabel 等 | 在庫数ラベル・前後の文字 |
| messages.loading, empty, error | settings.loadingMessage 等 | 読み込み中・在庫なし・エラー時のメッセージ |
| notice.text | settings.noticeText | 注意書きの文言 |

---

### 2.5 locations（ロケーション・並び・機能）

いずれも **アプリのみ**（ロケーション設定または在庫表示まわり）。`config.sort`, `config.locations`, `config.future` などから渡します。

| 項目（appConfig 内） | JSでの参照例 | 説明 |
|----------------------|--------------|------|
| sort.mode | settings.sortBy | 並び順 |
| pinnedLocationId | settings.pinnedLocationId | 上部固定ロケーション ID |
| locations.mode | settings.locationsMode | 表示ロケーション（all / custom_from_app 等） |
| locations.usePublicName | settings.usePublicLocationName | 公開名を使うか |
| click.action, mapUrlTemplate, urlTemplate | settings.clickAction 等 | クリックアクション（後方互換） |
| future.showLocationLinks | settings.showLocationLinks | ロケーション名をリンク表示するか（一括） |
| regionGroups | settings.regionGroupOrder | エリアグループの並び |
| future.groupByRegion | settings.groupByRegion | エリアでグルーピングするか |
| future.regionAccordionEnabled | settings.regionAccordionEnabled | エリアごとに折りたたみするか |
| future.regionUnsetLabel | settings.regionUnsetLabel | エリア未設定の見出し文言 |
| future.nearbyFirstEnabled | settings.nearbyFirstEnabled | 近隣店舗を優先表示するか |
| future.nearbyOtherCollapsible | settings.nearbyOtherCollapsible | その他店舗を折りたたみするか |
| future.nearbyHeading | settings.nearbyHeading | 近隣店舗の見出し文言 |
| future.nearbyOtherHeading | settings.nearbyOtherHeading | その他ロケーションの見出し文言 |
| future.showOrderPickButton | settings.showOrderPickButton | 店舗受け取りボタンを表示するか |
| future.orderPickButtonLabel | settings.orderPickButtonLabel | ボタンラベル文言 |
| future.orderPickRedirectToCheckout | settings.orderPickRedirectToCheckout | ボタンでチェックアウトへ飛ばすか |
| stocks[].linkUrl | location.linkUrl | ロケーション別リンクURL（行ごと） |
| stocks[].excludeFromNearby | （filter で使用） | 近隣から除外するか |

---

### 2.6 component_style（コンポーネント別スタイル）

| 項目（スキーマ id） | JSでの参照例 | 指定方法 | 説明 |
|--------------------|--------------|----------|------|
| region_heading_* | settings.themeRegionHeadingStyle | テーマのみ | エリア見出しの背景色・文字色・サイズ・太さ・余白 |
| order_pick_btn_* | settings.themeOrderPickButtonStyle | テーマのみ | 店舗受け取りボタンの背景色・文字色・角丸・余白・文字サイズ |

※ ボタン・見出しの**文言**や ON/OFF は **locations**（アプリ）。

---

## 3. テーマスキーマの「グループ」とジャンルの対応

カスタマイザー上の見出し（header）と、このドキュメントのジャンルは次のように対応させると整理しやすいです。

| スキーマの header（現状） | 対応するジャンル |
|---------------------------|------------------|
| タイトルとレイアウト | layout |
| 凡例・注意書き・行・枠線・色 | appearance ＋ row_display（行の表示内容・区切り・枠線・色・凡例・注意書きの表示・位置・色） |
| エリア見出しのデザイン | component_style |
| 店舗受け取りボタンのデザイン | component_style |
| （追加CSSは「その他」として扱う） | appearance の一部として扱うか、その他 |

「凡例・注意書き・行・枠線・色」は 1 つの header のままでも、**内部で「凡例」「注意書き」「行・枠線」「色」** のようにサブで意識すると、指定方法（テーマのみ / アプリで上書き）の切り分けがしやすくなります。

---

## 4. 指定方法の運用ルール（統一方針）

- **「テーマのみ」**: テーマごと・ブロックごとに変えたい見た目・レイアウト。スキーマに項目を追加するときは interactive 25 個制限に注意。
- **「アプリのみ」**: 全商品・全ブロックで共通にしたいルール・文言・機能。管理画面（在庫表示設定 / ロケーション設定）で設定。
- **「テーマ初期値 → アプリで上書き」**: テーマでデフォルトを出しつつ、アプリで一元変更したいもの（例: 在庫数ラベル・前後の文字）。スニペット側では「まず `s.xxx`、あれば `appConfig.xxx` で上書き」の順で統一。

新規項目を追加するときは、このドキュメントの「ジャンル」と「指定方法」のどれに当てはまるか決めてから、スキーマまたは管理画面のどちらに置くか決めると、ぶれがなくなります。

---

## 5. 関連ドキュメント

- **SETTINGS_SPLIT_SUMMARY.md**（在庫表示設定にまとめるもの vs カスタマイザーで見て調整するものの振り分けまとめ。実装前の整理用）
- **REQUIREMENTS.md** セクション 2（データの流れ）、3.1〜3.3（スキーマ・配置・プリセット案）
- **ADMIN_UI_DESIGN_RULES.md**（管理画面のUIルール）

このリファレンスは、REQUIREMENTS.md の「現在のスキーマの項目一覧」「現在の管理画面の項目一覧」「何をどちらに配置するか」と対応しています。用語は「ジャンル」「指定方法」に合わせて統一することを推奨します。

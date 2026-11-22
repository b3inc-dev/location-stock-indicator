// 下の階層の画面（メニューから直接開けない画面）には、画面の中の左上に「←」（BackAction）を置く（UI ルール v1.1 3章）。
// 新しい下の階層の画面を足したときは SUB_PAGES に足し、付け忘れをこの試験で止める。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 足したらここに書く。2026/11/23: 「店頭受取・配送」の区分の編集の画面（T 11/23 5:10 の案 A）。
const SUB_PAGES = {
  "app/routes/app.pos-lite_.$section.jsx": "店頭受取・配送の区分の編集",
};

test("下の階層の画面は、どの s-page にも「←」がある", () => {
  for (const [file, name] of Object.entries(SUB_PAGES)) {
    const source = readFileSync(file, "utf8");
    const pages = source.split("<s-page").slice(1);
    assert.ok(pages.length > 0, `${name}（${file}）に s-page がない`);
    for (const page of pages) {
      const head = page.slice(0, page.search(/<(div|s-scroll-box|s-stack|s-section)\b/));
      assert.match(head, /<BackAction /, `${name}（${file}）のタイトル上に「←」がない`);
    }
  }
});

test("「←」はアプリの画面の中に出す（管理画面の上の帯の文字だけにしない）", () => {
  const source = readFileSync("app/components/admin-ui.tsx", "utf8");
  const body = source.slice(source.indexOf("export function BackAction"), source.indexOf("export function SecondaryLink"));
  assert.match(body, /className="Admin-back-button"/);
  assert.match(body, /<s-icon type="arrow-left" \/>/);
});

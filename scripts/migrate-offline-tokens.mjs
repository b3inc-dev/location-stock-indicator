// 期限の無いオフライントークンを、まとめて期限付きに移す（Shopify の案内の「Option 2」）。
//
// 使い方（Render の Shell など、DATABASE_URL・SHOPIFY_API_KEY・SHOPIFY_API_SECRET のある所で）:
//   node scripts/migrate-offline-tokens.mjs            … 試し。数えて店の名前を出すだけ。何も書かない
//   node scripts/migrate-offline-tokens.mjs --one      … 1 店だけ移す
//   node scripts/migrate-offline-tokens.mjs --apply    … 全部移す
//
// 移すと古いトークンはすぐ使えなくなる（取り消せない）。「試し → 1 店 → 全部」の順で、T が進める。
// トークンの値はログに出さない。

import prisma from "../app/db.server.js";
import { ensureOfflineAccessTokenFresh } from "../app/utils/refresh-offline-session.js";
import { needsExpiringMigration } from "../app/utils/offlineTokenMigration.js";

const args = new Set(process.argv.slice(2));
const mode = args.has("--apply") ? "apply" : args.has("--one") ? "one" : "dry-run";

const rows = await prisma.session.findMany({
  where: { isOnline: false, expires: null, refreshToken: null },
});
const targets = rows.filter((r) => needsExpiringMigration(r));
console.log(`[migrate-offline-tokens] mode=${mode} 期限の無いオフライントークン: ${targets.length} 店`);
for (const r of targets) console.log(`  - ${r.shop}`);

if (mode !== "dry-run") {
  const list = mode === "one" ? targets.slice(0, 1) : targets;
  const counts = { migrated: 0, failed: 0 };
  for (const row of list) {
    const session = { ...row, expires: undefined, refreshToken: undefined, refreshTokenExpires: undefined };
    const r = await ensureOfflineAccessTokenFresh(session);
    if (r.ok && r.status === "migrated") {
      counts.migrated += 1;
      console.log(`  ok   ${row.shop}`);
    } else {
      counts.failed += 1;
      // 400 invalid_subject_token は、アプリを外した店などで古いトークンがもう無効なとき
      console.log(`  失敗 ${row.shop} status=${r.status} http=${r.httpStatus ?? "-"} detail=${r.detail ?? "-"}`);
    }
  }
  console.log(`[migrate-offline-tokens] 移した ${counts.migrated} 店・移せなかった ${counts.failed} 店`);
}

await prisma.$disconnect();

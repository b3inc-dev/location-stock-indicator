// scripts/migrate-offline-tokens.mjs を「ふつうの node」で読み込めるかの試験。
// Render の Shell では vite を通さずに node で動かすので、import の拡張子が抜けていると
// ERR_MODULE_NOT_FOUND で止まる（#80 の見直しで見つかった）。
// @prisma/client だけは、何も書かないふりの物に差し替える（DB にはつながない）。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const script = path.join(root, "scripts/migrate-offline-tokens.mjs");

// findMany だけ答える PrismaClient のふり。書く処理（update など）は呼ばれたら止める。
const fakePrisma = `
export class PrismaClient {
  constructor() {
    this.session = {
      findMany: async () => JSON.parse(process.env.FAKE_SESSIONS || "[]"),
      update: async () => { throw new Error("試しなのに書こうとした"); },
      upsert: async () => { throw new Error("試しなのに書こうとした"); },
    };
  }
  async $disconnect() {}
}
export default { PrismaClient };
`;
const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === "@prisma/client") {
    return { url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(fakePrisma)}), shortCircuit: true };
  }
  return next(specifier, context);
}
`;
const register = `import { register } from "node:module"; register("data:text/javascript," + encodeURIComponent(${JSON.stringify(hooks)}));`;

function runScript(args = [], sessions = []) {
  return spawnSync(
    process.execPath,
    ["--import", "data:text/javascript," + encodeURIComponent(register), script, ...args],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "production",
        FAKE_SESSIONS: JSON.stringify(sessions),
        SHOPIFY_API_KEY: "",
        SHOPIFY_API_SECRET: "",
      },
      timeout: 30_000,
    },
  );
}

describe("scripts/migrate-offline-tokens.mjs（ふつうの node）", () => {
  it("読み込みで止まらず、試し（引数なし）が最後まで動く", () => {
    const r = runScript();
    assert.equal(r.status, 0, `exit=${r.status}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.doesNotMatch(r.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.match(r.stdout, /mode=dry-run/);
    assert.match(r.stdout, /0 店/);
  });

  it("試しは店の名前を出すだけで、書く処理を呼ばない", () => {
    const rows = [
      { id: "offline_a.myshopify.com", shop: "a.myshopify.com", isOnline: false, accessToken: "x", expires: null, refreshToken: null },
    ];
    const r = runScript([], rows);
    assert.equal(r.status, 0, `exit=${r.status}\nstderr:\n${r.stderr}`);
    assert.match(r.stdout, /mode=dry-run/);
    assert.doesNotMatch(r.stdout + r.stderr, /試しなのに書こうとした/);
    assert.match(r.stdout, /a\.myshopify\.com/);
  });
});

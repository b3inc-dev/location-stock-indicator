import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

// The official preset uses the public shopify.dev Admin schema, never a store.
assert.equal(process.env.CI, "true"); assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.SHOPIFY_API_SECRET, undefined);
assert.equal(process.env.SHOPIFY_ADMIN_TOKEN, undefined);
const source = await readFile(".graphqlrc.js", "utf8");
assert.ok(source.includes("apiVersion: ApiVersion.October25"));
assert.ok(source.includes('outputDir: "./app/types"'));
const work = await mkdtemp(join(tmpdir(), "location-public-schema-0358-"));
const results = [];
try {
  for (const version of ["2025-10", "2026-07"]) {
    const output = join(work, version);
    const config = source.replace("apiVersion: ApiVersion.October25", "apiVersion: " + JSON.stringify(version))
      .replace('outputDir: "./app/types"', "outputDir: " + JSON.stringify(output));
    await writeFile(".graphqlrc.js", config);
    const r = spawnSync("npm", ["run", "graphql-codegen", "--", "--project", "default"], {
      encoding: "utf8", timeout: 120000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: "1" },
    });
    const text = String(r.stdout ?? "") + String(r.stderr ?? "");
    const category = r.status === 0 ? "schema_and_documents_validated"
      : /GraphQL Document Validation|Cannot query field|Unknown type|Unknown argument|is never used/.test(text) ? "document_validation_failed"
      : /fetch|ENOTFOUND|ECONN|ETIMEDOUT|Failed to load schema|status code/i.test(text) ? "schema_retrieval_failed"
      : "codegen_invocation_failed";
    const diagnostics = text.split("\n").filter((s) => /Cannot query field|Unknown type|Unknown argument|GraphQL Document Validation|Failed to load schema/.test(s)).slice(0, 8)
      .map((s) => s.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 240));
    results.push({ version, exit: r.status, signal: r.signal, category, diagnostics,
      official_public_endpoint: "https://shopify.dev/admin-graphql-direct-proxy/" + version,
      credentials_used: false, real_store: false,
      error_excerpt: r.status === 0 ? [] : text.replace(/\u001b\[[0-9;]*m/g, "").split("\n").map((s) => s.trim()).filter(Boolean).slice(-10).map((s) => s.slice(0, 300)) });
  }
} finally {
  await writeFile(".graphqlrc.js", source); await rm(work, { recursive: true, force: true });
}
assert.equal(await readFile(".graphqlrc.js", "utf8"), source);
const unchanged = spawnSync("git", ["diff", "--exit-code", "--", ".graphqlrc.js", "app", "package.json", "package-lock.json"]);
assert.equal(unchanged.status, 0, "Product sources/config/lock must remain unchanged");
console.log(JSON.stringify({ checkpoint: "LOC-PUBLIC-SCHEMA-COMPAT-0358",
  config_sha256: createHash("sha256").update(source).digest("hex"), results,
  product_unchanged: true, real_store_compatibility: "not accepted", source_operation_execution: false }));
process.exitCode = results.every((x) => x.exit === 0) ? 0 : 1;

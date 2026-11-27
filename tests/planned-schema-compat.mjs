import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
assert.equal(process.env.CI,"true");assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(process.env.SHOPIFY_API_SECRET,undefined);assert.equal(process.env.SHOPIFY_ADMIN_TOKEN,undefined);
const source=await readFile(".graphqlrc.js","utf8");
assert.ok(source.includes('apiVersion: ApiVersion.July26 ?? "2026-07"'));
const runtime=await readFile("app/shopify.server.js","utf8");
assert.ok(runtime.includes('const ADMIN_API_VERSION = ApiVersion.July26 ?? "2026-07"'));
assert.ok(runtime.includes('apiVersion: ADMIN_API_VERSION'));assert.ok(runtime.includes('export const apiVersion = ADMIN_API_VERSION'));
for(const path of ["shopify.app.toml","shopify.app.public.toml"]){assert.match(await readFile(path,"utf8"),/\[webhooks\]\s+api_version = "2026-07"/);}
const work=await mkdtemp(join(tmpdir(),"loc-planned-schema-0528-"));let result;
try{
 await writeFile(".graphqlrc.js",source.replace('outputDir: "./app/types"','outputDir: '+JSON.stringify(work)));
 result=spawnSync("npm",["run","graphql-codegen","--","--project","default"],{encoding:"utf8",timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,NO_COLOR:"1"}});
 const output=String(result.stdout??"")+String(result.stderr??"");
 console.log(JSON.stringify({checkpoint:"LOC-PLANNED-SCHEMA-0528-001",version:"2026-07",exit:result.status,signal:result.signal,credentials_used:false,real_store:false,source_operation_execution:false,diagnostics:result.status===0?[]:output.replace(/\u001b\[[0-9;]*m/g,"").split("\n").filter(Boolean).slice(-10).map(s=>s.slice(0,300))}));
}finally{await writeFile(".graphqlrc.js",source);await rm(work,{recursive:true,force:true});}
assert.equal(await readFile(".graphqlrc.js","utf8"),source);
assert.equal(spawnSync("git",["diff","--exit-code","--",".graphqlrc.js","app","shopify.app.toml","shopify.app.public.toml","package.json","package-lock.json"]).status,0);
assert.equal(result.status,0,"Configured static GraphQL documents must validate against official public 2026-07 schema");
console.log("LOC_PLANNED_SCHEMA_CONFIG_ACCEPTED=1; store_compatibility=not_accepted; deploy=not_performed");

import assert from "node:assert/strict";
import {before,after,test} from "node:test";
import {createHmac} from "node:crypto";
import {PrismaClient} from "@prisma/client";
import {createServer} from "vite";
import "@shopify/shopify-api/adapters/node";
import {setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {isolatedPostgresUrl} from "./helpers/isolated-pg-guard.mjs";

const db=new PrismaClient({datasources:{db:{url:isolatedPostgresUrl()}}});
const SECRET="synthetic-proxy-session-secret";
const fixtures=[
 {shop:"proxy-alpha-2257.myshopify.com",token:"synthetic-alpha-token",location:"gid://shopify/Location/22571",quantity:7,label:"Synthetic Alpha"},
 {shop:"proxy-beta-2257.myshopify.com",token:"synthetic-beta-token",location:"gid://shopify/Location/22572",quantity:11,label:"Synthetic Beta"}
];
const end={hasNextPage:false,endCursor:null},calls=[];
let vite,route,oldFetch;
const envKeys=["SHOPIFY_API_KEY","SHOPIFY_API_SECRET","SHOPIFY_APP_URL","SCOPES","APP_DISTRIBUTION","FORCE_PLAN_LITE"];
const priorEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
function signedUrl(shop){
 const u=new URL("https://synthetic-app.invalid/apps/location-stock");
 u.searchParams.set("shop",shop);u.searchParams.set("timestamp",String(Math.floor(Date.now()/1000)));u.searchParams.set("variant_id","9002257");
 const canonical=[...u.searchParams].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+"="+v).join("");
 u.searchParams.set("signature",createHmac("sha256",SECRET).update(canonical).digest("hex"));return u;
}
async function syntheticFetch(input,init){
 const req=new Request(input,init),url=new URL(req.url),f=fixtures.find(x=>x.shop===url.hostname);
 assert.ok(f,"Only exact synthetic tenant endpoints are allowed");
 assert.equal(req.method,"POST");assert.match(url.pathname,/^\/admin\/api\/(2025-10|2026-07)\/graphql\.json$/);
 assert.equal(req.headers.get("x-shopify-access-token"),f.token,"SDK must use the signed tenant's PG token");
 const wire=JSON.parse(await req.text());assert.doesNotMatch(wire.query,/\bmutation\b/i);
 const operation=wire.query.match(/\bquery\s+(\w+)/)?.[1];calls.push({shop:f.shop,operation});
 let data;
 if(operation==="VariantInventoryWithConfig"){
  assert.deepEqual(wire.variables,{id:"gid://shopify/ProductVariant/9002257"});
  data={productVariant:{id:wire.variables.id,title:"Synthetic variant",inventoryItem:{id:"gid://shopify/InventoryItem/2257",inventoryLevels:{pageInfo:end,edges:[{node:{id:"level-"+f.shop,location:{id:f.location,name:"Original",fulfillsOnlineOrders:true,localPickupSettingsV2:null,address:{city:"Synthetic",countryCode:"JP"}},quantities:[{name:"available",quantity:f.quantity}]}}]}}},shop:{metafield:{value:JSON.stringify({locations:[{locationId:f.location,publicName:f.label,enabled:true,sortOrder:1}]})}}};
 }else if(operation==="ShopMarketDrivenShipping")data={shop:{features:{marketDrivenShipping:false}}};
 else if(operation==="DeliveryProfilesForLocations")data={deliveryProfiles:{nodes:[],pageInfo:end}};
 else if(operation==="ShopPlanAndLocations")data={shop:{plan:{partnerDevelopment:true}},locations:{nodes:[{id:f.location}]},currentAppInstallation:{activeSubscriptions:[]}};
 else assert.fail("Unexpected synthetic operation: "+operation);
 return Response.json({data},{headers:{"x-shopify-api-version":url.pathname.includes("2026-07")?"2026-07":"2025-10"}});
}
before(async()=>{
 Object.assign(process.env,{SHOPIFY_API_KEY:"0123456789abcdef0123456789abcdef",SHOPIFY_API_SECRET:SECRET,SHOPIFY_APP_URL:"https://synthetic-app.invalid",SCOPES:"read_inventory,read_locations,read_products,read_shipping",APP_DISTRIBUTION:"public",FORCE_PLAN_LITE:"0"});
 globalThis.prismaGlobal=db;oldFetch=globalThis.fetch;globalThis.fetch=syntheticFetch;setAbstractFetchFunc(syntheticFetch);
 for(const f of fixtures)await db.session.create({data:{id:"offline_"+f.shop,shop:f.shop,state:"synthetic",isOnline:false,scope:process.env.SCOPES,accessToken:f.token,expires:new Date(Date.now()+86400000),refreshToken:"synthetic-refresh",refreshTokenExpires:new Date(Date.now()+172800000)}});
 vite=await createServer({configFile:false,appType:"custom",server:{middlewareMode:true,hmr:false}});
 route=await vite.ssrLoadModule("/app/routes/apps.location-stock.js");setAbstractFetchFunc(syntheticFetch);
});
after(async()=>{
 try{await db.session.deleteMany({where:{shop:{in:fixtures.map(f=>f.shop)}}});}
 finally{await vite?.close();await db.$disconnect();delete globalThis.prismaGlobal;globalThis.fetch=oldFetch;setAbstractFetchFunc(oldFetch);for(const k of envKeys){if(priorEnv[k]===undefined)delete process.env[k];else process.env[k]=priorEnv[k];}}
});
test("LOC-PROXY-SESSION-001: signed tenants load real PG offline sessions through actual SDK/route and return isolated inventory without mutations",async()=>{
 const beforeRows=await db.session.findMany({where:{shop:{in:fixtures.map(f=>f.shop)}},orderBy:{shop:"asc"}});
 const responses=await Promise.all(fixtures.map(f=>route.loader({request:new Request(signedUrl(f.shop))})));
 for(let i=0;i<fixtures.length;i++){
  const f=fixtures[i],response=responses[i];assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.ok,true);assert.equal(body.variantId,"9002257");assert.equal(body.stocks.length,1);
  assert.equal(body.stocks[0].locationId,f.location);assert.equal(body.stocks[0].quantity,f.quantity);assert.equal(body.stocks[0].displayName,f.label);
  assert.deepEqual(calls.filter(c=>c.shop===f.shop).map(c=>c.operation),["VariantInventoryWithConfig","ShopMarketDrivenShipping","DeliveryProfilesForLocations","ShopPlanAndLocations"]);
 }
 assert.equal(calls.length,8);assert.deepEqual(await db.session.findMany({where:{shop:{in:fixtures.map(f=>f.shop)}},orderBy:{shop:"asc"}}),beforeRows,"Read-only route must not refresh or alter the valid sessions");
});

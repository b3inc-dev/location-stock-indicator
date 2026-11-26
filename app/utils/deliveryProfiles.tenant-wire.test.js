import assert from"node:assert/strict";import{test}from"node:test";import{loadLocationDeliveryFlags}from"./deliveryProfiles.js";
const SHOPS=["mds-tenant-a.myshopify.com","mds-tenant-b.myshopify.com"];const end={hasNextPage:false,endCursor:null};const page=nodes=>({nodes,pageInfo:end});
async function fixture(failA,check){const previous=globalThis.fetch,calls=[];let roots=0,release;const barrier=new Promise(r=>release=r);
 globalThis.fetch=async(uri,init)=>{const req=new Request(uri,init),url=new URL(req.url),shop=url.hostname;const index=SHOPS.indexOf(shop);assert.notEqual(index,-1);assert.equal(url.pathname,"/admin/api/2026-07/graphql.json");assert.equal(req.headers.get("x-shopify-access-token"),"synthetic-token-"+index);const body=JSON.parse(await req.text());calls.push({shop,query:body.query,ownToken:true});
 if(body.query.includes("ShopMarketDrivenShipping"))return Response.json({data:{shop:{features:{marketDrivenShipping:true}}}});
 assert.match(body.query,/query MarketsDeliveryForLocations/);if(++roots===2)release();await barrier;
 if(failA&&index===0)return Response.json({errors:[{message:"synthetic denied",extensions:{code:"ACCESS_DENIED"}}]});
 return Response.json({data:{markets:page([{id:"market-"+index,delivery:{shipping:{isEnabled:true,optionDefinitions:page([{id:"option-"+index,name:"Standard",isActive:true,includedLocations:page([{id:"location-"+index}])}])}}}])}});
 };
 try{const results=await Promise.all(SHOPS.map((shop,index)=>loadLocationDeliveryFlags({graphql:()=>{throw new Error("No legacy fallback");}},{shop,accessToken:"synthetic-token-"+index})));await check(results,calls);}finally{globalThis.fetch=previous;release();}
}
test("LOC-MDS-TENANT-WIRE-001: concurrent versioned MDS requests preserve each tenant URL, credential and returned flags",async()=>{await fixture(false,([a,b],calls)=>{assert.equal(a.source,"markets");assert.equal(b.source,"markets");assert.deepEqual([...a.flags.keys()],["location-0"]);assert.deepEqual([...b.flags.keys()],["location-1"]);assert.equal(calls.length,4);assert.ok(calls.every(c=>c.ownToken));});});
test("one tenant MDS failure cannot erase, contaminate or fall back over the other in-flight success",async()=>{await fixture(true,([a,b],calls)=>{assert.equal(a.source,"none");assert.equal(a.flags.size,0);assert.equal(b.source,"markets");assert.deepEqual([...b.flags.keys()],["location-1"]);assert.equal(calls.length,4);});});

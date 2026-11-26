import assert from "node:assert/strict";import{test}from"node:test";import{loadLocationDeliveryFlags}from"./deliveryProfiles.js";
const page=nodes=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
async function fixture(mode,check){
 const previous=globalThis.fetch,calls=[];let roots=0;
 globalThis.fetch=async(uri,init)=>{
  const request=new Request(uri,init),url=new URL(request.url),body=JSON.parse(await request.text());
  assert.equal(url.hostname,"synthetic-mds.myshopify.com");assert.equal(url.pathname,"/admin/api/2026-07/graphql.json");assert.equal(request.headers.get("x-shopify-access-token"),"synthetic-token");calls.push(body);
  if(body.query.includes("ShopMarketDrivenShipping"))return Response.json({data:{shop:{features:{marketDrivenShipping:true}}}});
  assert.match(body.query,/query MarketsDeliveryForLocations/);roots++;
  if(roots===1){
   if(mode==="http")return Response.json({errors:[{message:"Throttled",extensions:{code:"THROTTLED"}}]},{status:503});
   const errors=[{message:"Throttled",extensions:{code:"THROTTLED"}}];if(mode==="mixed")errors.push({message:"synthetic denied",extensions:{code:"ACCESS_DENIED"}});
   return Response.json({errors});
  }
  return Response.json({data:{markets:page([{id:"market",delivery:{shipping:{isEnabled:true,optionDefinitions:page([{id:"option",isActive:true,name:"Standard",includedLocations:page([{id:"location"}])}])}}}])}});
 };
 try{await check(await loadLocationDeliveryFlags({graphql:()=>{throw new Error("No legacy fallback for MDS");}},{shop:"synthetic-mds.myshopify.com",accessToken:"synthetic-token"}),calls,roots);}finally{globalThis.fetch=previous;}
}
test("LOC-MDS-THROTTLE-001: pure MDS GraphQL throttling retries once and returns complete flags",async()=>{await fixture("pure",(result,calls,roots)=>{assert.equal(result.source,"markets","pure MDS throttling must get its bounded retry");assert.equal(result.flags.get("location").hasShipping,true);assert.equal(roots,2);assert.equal(calls.length,3);});});
test("mixed MDS errors fail closed without retry or stale legacy flags",async()=>{await fixture("mixed",(result,calls,roots)=>{assert.equal(result.source,"none");assert.equal(result.flags.size,0);assert.equal(roots,1);assert.equal(calls.length,2);});});
test("HTTP errors are not promoted into GraphQL throttling retries",async()=>{await fixture("http",(result,calls,roots)=>{assert.equal(result.source,"none");assert.equal(result.flags.size,0);assert.equal(roots,1);assert.equal(calls.length,2);});});

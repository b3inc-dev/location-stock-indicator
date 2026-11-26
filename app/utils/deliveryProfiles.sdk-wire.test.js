import assert from "node:assert/strict";
import test from "node:test";
import "@shopify/shopify-api/adapters/node";
import {shopifyApi,Session,LogSeverity} from "@shopify/shopify-api";
import {setAbstractFetchFunc} from "@shopify/shopify-api/runtime";
import {loadLocationDeliveryFlags} from "./deliveryProfiles.js";
const end={hasNextPage:false,endCursor:null};
const page=(nodes,next=null)=>({nodes,pageInfo:next?{hasNextPage:true,endCursor:next}:end});
const method={active:true,name:"Standard",rateProvider:{__typename:"DeliveryRateDefinition"}};
async function fixture(fail,check){
 const originalFetch=globalThis.fetch,calls=[];
 const fake=async(uri,init)=>{
  const req=new Request(uri,init),url=new URL(req.url),wire=JSON.parse(await req.text());
  assert.equal(url.hostname,"synthetic-sdk.myshopify.com");assert.equal(url.pathname,"/admin/api/2026-07/graphql.json");
  assert.equal(req.headers.get("x-shopify-access-token"),"synthetic-token");
  calls.push(wire);
  let payload;
  if(wire.query.includes("ShopMarketDrivenShipping"))payload={data:{shop:{features:{marketDrivenShipping:false}}}};
  else if(wire.query.includes("DeliveryGroupLocations")){
   assert.deepEqual(wire.variables,{id:"g",after:"L250"});
   payload=fail?{data:{node:{locations:page([{id:"partial"}])}},errors:[{message:"synthetic denied",extensions:{code:"ACCESS_DENIED"}},{message:"Throttled",extensions:{code:"THROTTLED"}}]}:{data:{node:{locations:page([{id:"l250"}])}}};
  }else{
   assert.match(wire.query,/query DeliveryProfilesForLocations/);
   payload={data:{deliveryProfiles:page([{id:"p",profileLocationGroups:[{locationGroup:{id:"g",locations:page(Array.from({length:250},(_,i)=>({id:"l"+i})),"L250")},locationGroupZones:page([{zone:{id:"z",name:"Domestic"},methodDefinitions:page([method])}])}]}])}};
  }
  return Response.json(payload,{headers:{"x-shopify-api-version":"2026-07"}});
 };
 globalThis.fetch=fake;setAbstractFetchFunc(fake);
 try{
  const api=shopifyApi({apiKey:"0123456789abcdef0123456789abcdef",apiSecretKey:"synthetic-secret",apiVersion:"2026-07",hostName:"synthetic.invalid",isEmbeddedApp:false,logger:{level:LogSeverity.Error}});
  const session=new Session({id:"offline_synthetic-sdk.myshopify.com",shop:"synthetic-sdk.myshopify.com",state:"synthetic",isOnline:false,accessToken:"synthetic-token"});
  const client=new api.clients.Graphql({session});
  // Same request→Response bridge used by the app's actual admin GraphQL factory.
  const admin={graphql:async(query,{variables}={})=>Response.json(await client.request(query,{variables,retries:0}))};
  const result=await loadLocationDeliveryFlags(admin,session);
  await check(result,calls);
 }finally{globalThis.fetch=originalFetch;setAbstractFetchFunc(originalFetch);}
}
test("actual Shopify GraphQL SDK serializes parent cursor and receives all 251 delivery locations",async()=>{
 await fixture(false,async(r,calls)=>{assert.equal(r.source,"deliveryProfiles");assert.equal(r.flags.size,251);assert.equal(r.flags.get("l250").hasShipping,true);assert.equal(calls.length,3);});
});
test("actual SDK mixed GraphQL error after page1 cannot publish partial delivery flags",async()=>{
 await fixture(true,async(r,calls)=>{assert.equal(r.source,"none");assert.equal(r.flags.size,0);assert.equal(calls.length,3);});
});

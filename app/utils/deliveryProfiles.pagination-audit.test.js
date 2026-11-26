import assert from "node:assert/strict";
import test from "node:test";
import { loadLocationDeliveryFlags } from "./deliveryProfiles.js";

async function readFlags(count) {
  const ids=Array.from({length:count},(_,i)=>"gid://shopify/Location/"+(i+1));
  const originalFetch=globalThis.fetch; let reads=0;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{shop:{features:{marketDrivenShipping:false}}}}));
  const admin={graphql:async query=>{
    reads++;
    const pageSize=Number(/locations\(first:\s*(\d+)\)/.exec(query)?.[1]??0);
    return {json:async()=>({data:{deliveryProfiles:{nodes:[{profileLocationGroups:[{
      locationGroup:{locations:{nodes:ids.slice(0,pageSize).map(id=>({id}))}},
      locationGroupZones:{nodes:[{zone:{name:"synthetic"},methodDefinitions:{nodes:[{active:true,name:"Standard",rateProvider:{__typename:"DeliveryRateDefinition"}}]}}]},
    }]}]}}})};
  }};
  try { const result=await loadLocationDeliveryFlags(admin,{shop:"fixture.myshopify.com",accessToken:"synthetic"},{allLocationIds:ids});return {result,ids,reads}; }
  finally {globalThis.fetch=originalFetch;}
}
test("legacy delivery read assigns shipping flags for all first 250 returned locations",async()=>{
  const {result,ids,reads}=await readFlags(250);
  assert.equal(result.source,"deliveryProfiles");assert.equal(reads,1);
  assert.ok(ids.every(id=>result.flags.get(id)?.hasShipping===true));
});
// Existing unresolved limitation: PR85 notes item3 already says locations(first:250) remains.
test("requested legacy location 251 is not silently left without delivery flags",{todo:"LOC-DELIVERY-251-001: PR85 known remaining deliveryProfiles location pagination"},async()=>{
  const {result,ids}=await readFlags(251);
  assert.equal(result.flags.get(ids[250])?.hasShipping,true);
});

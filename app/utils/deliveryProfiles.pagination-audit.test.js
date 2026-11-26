import assert from "node:assert/strict";
import test from "node:test";
import { loadLocationDeliveryFlags } from "./deliveryProfiles.js";
const end={hasNextPage:false,endCursor:null};
const page=(nodes,next=null)=>({nodes,pageInfo:next?{hasNextPage:true,endCursor:next}:end});
const method={active:true,name:"Standard",rateProvider:{__typename:"DeliveryRateDefinition"}};
const zone=(id="z")=>({zone:{id,name:"Domestic"},methodDefinitions:page([method])});
const profile=(locations)=>({id:"p",profileLocationGroups:[{locationGroup:{id:"g",locations},locationGroupZones:page([zone()])}]});
const session={shop:"synthetic.myshopify.com",accessToken:"synthetic"};
async function fixture(mds,read,body){
 const fetchBefore=globalThis.fetch;const calls=[];
 globalThis.fetch=async(_url,init)=>{
  const {query,variables}=JSON.parse(init.body);calls.push({query,variables});
  if(query.includes("ShopMarketDrivenShipping"))return Response.json({data:{shop:{features:{marketDrivenShipping:mds}}}});
  return Response.json(await read(query,variables));
 };
 const admin={graphql:async(query,{variables}={})=>{calls.push({query,variables});return {json:async()=>await read(query,variables)};}};
 try{return await body(()=>loadLocationDeliveryFlags(admin,session,{allLocationIds:["fallback"]}),calls);}
 finally{globalThis.fetch=fetchBefore;}
}
test("LOC-DELIVERY-251-001: legacy group locations collects 251 with its own cursor",async()=>{
 const ids=Array.from({length:251},(_,i)=>({id:"l"+i}));
 await fixture(false,async(q,v)=>{
  if(q.includes("DeliveryGroupLocations")){assert.deepEqual(v,{id:"g",after:"L250"});return {data:{node:{locations:page(ids.slice(250))}}};}
  return {data:{deliveryProfiles:page([profile(page(ids.slice(0,250),"L250"))])}};
 },async(load,calls)=>{const r=await load();assert.equal(r.source,"deliveryProfiles");assert.equal(r.flags.size,251);assert.equal(r.flags.get("l250").hasShipping,true);assert.equal(calls.length,3);});
});
test("legacy root, zone and method connections use independent parent cursors",async()=>{
 const p=profile(page([{id:"l1"}]));p.profileLocationGroups[0].locationGroupZones={edges:[{cursor:"Z1",node:{zone:{id:"z1",name:"x"},methodDefinitions:page([{...method,active:false}],"M1")}}],pageInfo:{hasNextPage:true,endCursor:"Z1"}};
 await fixture(false,async(q,v)=>{
  if(q.includes("DeliveryZoneMethods")){assert.equal(v.zoneAfter,null);assert.equal(v.after,"M1");return {data:{deliveryProfile:{profileLocationGroups:[{locationGroup:{id:"g"},locationGroupZones:page([{zone:{id:"z1"},methodDefinitions:page([method])}])}]}}};}
  if(q.includes("DeliveryGroupZones")){assert.equal(v.after,"Z1");assert.equal(v.group,"g");return {data:{deliveryProfile:{profileLocationGroups:[{locationGroup:{id:"g"},locationGroupZones:page([zone("z2")])}]}}};}
  if(v?.after==="P1")return {data:{deliveryProfiles:page([])}};
  return {data:{deliveryProfiles:page([p],"P1")}};
 },async load=>{const r=await load();assert.equal(r.source,"deliveryProfiles");assert.equal(r.flags.get("l1").hasShipping,true);});
});
test("MDS root/options/included locations hydrate 251 using option anchor",async()=>{
 const opt={id:"o1",isActive:true,name:"Standard",includedLocations:page(Array.from({length:250},(_,i)=>({id:"l"+i})),"L250")};
 const market={id:"m1",delivery:{shipping:{isEnabled:true,optionDefinitions:{edges:[{cursor:"O1",node:opt}],pageInfo:{hasNextPage:true,endCursor:"O1"}}}}};
 await fixture(true,async(q,v)=>{
  if(q.includes("MarketOptionLocations")){assert.deepEqual(v,{id:"m1",optionAfter:null,after:"L250"});return {data:{market:{delivery:{shipping:{optionDefinitions:page([{id:"o1",includedLocations:page([{id:"l250"}])}])}}}}};}
  if(q.includes("MarketDeliveryOptions")){assert.equal(v.after,"O1");return {data:{market:{delivery:{shipping:{optionDefinitions:page([])}}}}};}
  if(v?.after==="MARKET1")return {data:{markets:page([])}};
  return {data:{markets:page([market],"MARKET1")}};
 },async load=>{const r=await load();assert.equal(r.source,"markets");assert.equal(r.flags.size,251);assert.equal(r.flags.get("l250").hasShipping,true);});
});
for(const [name,failure] of [
 ["transport",()=>{throw new Error("synthetic transport failure");}],
 ["mixed errors",()=>({data:{node:{locations:page([{id:"later"}])}},errors:[{extensions:{code:"THROTTLED"}},{message:"Access denied"}]})],
 ["missing data",()=>({data:null})],
 ["missing connection",()=>({data:{node:{}}})],
 ["missing pageInfo",()=>({data:{node:{locations:{nodes:[{id:"later"}]}}}})],
 ["same cursor",()=>({data:{node:{locations:page([{id:"later"}],"L250")}}})],
]){
 test("legacy continuation "+name+" rejects the entire partial map",async()=>{
  await fixture(false,async(q)=>q.includes("DeliveryGroupLocations")?failure():({data:{deliveryProfiles:page([profile(page([{id:"early"}],"L250"))])}}),
   async load=>{const r=await load();assert.equal(r.source,"none");assert.equal(r.flags.size,0);});
 });
}
test("MDS continuation failure never falls back to stale legacy data",async()=>{
 let legacy=0;
 await fixture(true,async(q)=>{
  if(q.includes("DeliveryProfiles"))legacy++;
  if(q.includes("MarketDeliveryOptions"))return {data:{market:null},errors:[{message:"unavailable"}]};
  return {data:{markets:page([{id:"m",delivery:{shipping:{isEnabled:true,optionDefinitions:page([{id:"o",includedLocations:page([{id:"early"}])}],"O1")}}}])}};
 },async load=>{const r=await load();assert.equal(r.source,"none");assert.equal(r.flags.size,0);assert.equal(legacy,0);});
});
test("fully read empty MDS includedLocations retains all-location rule",async()=>{
 await fixture(true,async()=>({data:{markets:page([{id:"m",delivery:{shipping:{isEnabled:true,optionDefinitions:page([{id:"o",includedLocations:page([])}])}}}])}}),
 async load=>{const r=await load();assert.equal(r.source,"markets");assert.equal(r.flags.get("fallback").hasShipping,true);});
});

test("HTTP failure with apparently valid GraphQL data is never treated as a complete MDS map",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(_url,init)=>{
  const {query}=JSON.parse(init.body);
  if(query.includes("ShopMarketDrivenShipping"))return Response.json({data:{shop:{features:{marketDrivenShipping:true}}}});
  return Response.json({data:{markets:page([{id:"m",delivery:{shipping:{isEnabled:true,optionDefinitions:page([{id:"o",includedLocations:page([{id:"hidden"}])}])}}}])}},{status:500});
 };
 try{const r=await loadLocationDeliveryFlags({graphql:()=>{throw new Error("No stale legacy fallback");}},session);assert.equal(r.source,"none");assert.equal(r.flags.size,0);}finally{globalThis.fetch=original;}
});

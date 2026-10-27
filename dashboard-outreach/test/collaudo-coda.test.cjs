const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../monitoraggio-domain.js');
const {createAdapter,createOutreachCollaudoCoda,fixture,removeOwnFixture,verifyCleanup,FIELD,MARK}=require('../collaudo-coda.js');
const DELETE=Symbol('delete');
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
function setup() {
 const session={slug:'davide-caiazzo',email:'ceo@davidecaiazzo.it',uid:'uid-ceo',runId:'owned-run'};
 const state=fixture(session.slug,D,'2026-10-27T09:00:00Z');
 const store=new Map([
  ['clienti/'+session.slug,{monitoraggio_v1:{real:true},controllo_v1:{unchanged:true},other:'preserved',[FIELD]:{kind:MARK,client_slug:session.slug,owner_email:session.email,owner_uid:session.uid,run_id:session.runId,stato:state}}],
  ['config/admins',{emails:[session.email]}],['config/approvatori_messaggi',{emails:['reviewer@example.it']}]
 ]);
 const updates=[],reads=[],txReads=[],listeners=new Map();let current=true,before=null,after=null,staleClient,failRead=false;
 const snapshot=path=>({exists:store.has(path),data:()=>clone(store.get(path))});
 const ref=path=>({path,get:async opts=>{reads.push([path,opts]);return staleClient!==undefined && path.startsWith('clienti/')?{exists:true,data:()=>clone(staleClient)}:snapshot(path);},onSnapshot:next=>{listeners.set(path,next);next(snapshot(path));return()=>listeners.delete(path);}});
 const db={collection:name=>({doc:id=>ref(name+'/'+id)}),runTransaction:async callback=>{
  if(before)before();const pending=[];
  const result=await callback({get:async r=>{txReads.push(r.path);if(failRead){failRead=false;throw Error('Lettura transazionale non disponibile.');}return snapshot(r.path);},update:(r,p)=>pending.push([r.path,p])});
  for(const [path,patch] of pending){updates.push([path,patch]);const doc=store.get(path);
   for(const [k,v] of Object.entries(patch)){if(k===FIELD+'.stato')doc[FIELD].stato=clone(v);else if(v===DELETE)delete doc[k];else doc[k]=clone(v);}
   if(after)after();listeners.get(path)?.(snapshot(path));
  }return result;
 }};
 const auth={currentUser:{email:session.email,uid:session.uid}};
 const options={db,auth,isAdmin:()=>true,isCurrent:()=>current,domain:D,fieldDelete:()=>DELETE};
 return {session,state,store,updates,reads,txReads,listeners,auth,options,adapter:createAdapter(options,session),before:fn=>before=fn,after:fn=>after=fn,invalidate:()=>current=false,cacheClient:x=>staleClient=x,failReadOnce:()=>failRead=true};
}
const settle=()=>new Promise(r=>setImmediate(r));
function requested(f){const s=clone(f.state);D.request(s,s.contacts[0].id,'email',s.contacts[0].bozza,f.session.email,'2026-10-27T09:00:00Z');return s;}
test('fixture is one existing EMAIL account with no requests, send or coverage claims',()=>{
 const f=setup(),s=f.state;assert.equal(s.contacts.length,1);assert.equal(s.contacts[0].email,'ceo@davidecaiazzo.it');assert.equal(s.contacts[0].scope,'outreach');
 assert.ok(Object.values(s.coverage).every(x=>x===false));assert.deepEqual(s.outbox,[]);assert.match(s.source,/COLLAUDO/);assert.doesNotMatch(JSON.stringify(s),/linkedin|sent_at|delivered_at/);
});
test('get and subscription project only isolated state and read genuine config',async()=>{
 const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug);
 assert.deepEqual((await r.get()).data().monitoraggio_v1,f.state);assert.equal((await r.get()).data()[FIELD],undefined);
 assert.deepEqual((await f.adapter.collection('config').doc('admins').get()).data(),{emails:[f.session.email]});
 let got;const off=r.onSnapshot(x=>got=x.data());await settle();assert.deepEqual(got.monitoraggio_v1,f.state);assert.equal(got.other,'preserved');off();assert.equal(f.listeners.size,0);
});
test('renderer transaction maps exclusively monitoraggio to isolated stato',async()=>{
 const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug);
 await f.adapter.runTransaction(async tx=>{const x=await tx.get(r);assert.deepEqual(x.data().monitoraggio_v1,f.state);const roles=await tx.get(f.adapter.collection('config').doc('approvatori_messaggi'));assert.deepEqual(roles.data().emails,['reviewer@example.it']);tx.update(r,{monitoraggio_v1:requested(f)});});
 assert.deepEqual(Object.keys(f.updates[0][1]),[FIELD+'.stato']);const raw=f.store.get('clienti/'+f.session.slug);assert.equal(raw[FIELD].stato.outbox[0].stato,'richiesta');assert.deepEqual(raw.monitoraggio_v1,{real:true});assert.deepEqual(raw.controllo_v1,{unchanged:true});assert.equal(raw[FIELD].run_id,f.session.runId);
});
test('direct update is transactional and forbids other fields and paths',async()=>{
 const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug);await r.update({monitoraggio_v1:requested(f)});assert.equal(f.updates.length,1);
 await assert.rejects(r.update({monitoraggio_v1:f.state,other:'overwrite'}),/soltanto/);await assert.rejects(r.update({[FIELD]:{}}),/soltanto/);
 assert.throws(()=>f.adapter.collection('clienti').doc('other-client'),/altri clienti/);assert.throws(()=>f.adapter.collection('outbox').doc('x'),/altri clienti/);assert.throws(()=>f.adapter.collection('config').doc('other'),/non consentita/);
 await assert.rejects(f.adapter.runTransaction(tx=>tx.update({path:'clienti/'+f.session.slug},{monitoraggio_v1:f.state})),/soltanto/);
});
test('identity, current session and administrator role are checked freshly',async()=>{
 for(const change of [f=>f.auth.currentUser=null,f=>f.auth.currentUser.email='other@example.it',f=>f.auth.currentUser.uid='other-uid',f=>f.store.set('config/admins',{emails:[]}),f=>f.invalidate()]){
  const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug);f.before(()=>change(f));await assert.rejects(r.update({monitoraggio_v1:f.state}));assert.equal(f.updates.length,0);
 }
});
test('owner, client and run conflicts fail closed',async()=>{
 for(const patch of [{run_id:'other'},{owner_email:'other@example.it'},{owner_uid:'other'},{client_slug:'other'},{kind:'other'}]){
  const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug);Object.assign(f.store.get('clienti/'+f.session.slug)[FIELD],patch);
  await assert.rejects(r.get());await assert.rejects(r.update({monitoraggio_v1:f.state}));assert.equal(f.updates.length,0);
 }
});
test('other contacts, coverage and invented sent/delivered results are rejected',async()=>{
 for(const change of [s=>s.contacts[0].email='other@example.it',s=>s.contacts.push({...s.contacts[0],id:'second',email:'second@example.it'}),s=>s.coverage.email=true,s=>Object.assign(s.outbox[0],{stato:'inviato',sent_at:'2026-10-27T10:00:00Z',evidence:'invented'}),s=>Object.assign(s.outbox[0],{stato:'consegnato',sent_at:'2026-10-27T10:00:00Z',delivered_at:'2026-10-27T10:01:00Z',evidence:'invented'})]){
  const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug),s=requested(f);change(s);await assert.rejects(r.update({monitoraggio_v1:s}));assert.equal(f.updates.length,0);
 }
});
test('cleanup deletes only own isolated field with server absence check',async()=>{
 const f=setup(),before=clone(f.store.get('clienti/'+f.session.slug));delete before[FIELD];await removeOwnFixture(f.options,f.session);
 assert.deepEqual(f.store.get('clienti/'+f.session.slug),before);assert.deepEqual(Object.keys(f.updates[0][1]),[FIELD]);assert.equal(f.updates[0][1][FIELD],DELETE);assert.equal(f.reads.filter(([path])=>path.startsWith('clienti/')).length,0);assert.equal(f.txReads.filter(path=>path.startsWith('clienti/')).length,2);
});
test('cleanup rejects conflicting owner/run and revoked identity or permissions',async()=>{
 for(const change of [f=>f.store.get('clienti/'+f.session.slug)[FIELD].run_id='other',f=>f.store.get('clienti/'+f.session.slug)[FIELD].owner_uid='other',f=>f.auth.currentUser=null,f=>f.store.set('config/admins',{emails:[]}),f=>f.invalidate()]){
  const f=setup();f.before(()=>change(f));await assert.rejects(removeOwnFixture(f.options,f.session));assert.equal(f.updates.length,0);
 }
});
test('cleanup cannot declare absence when another run appears at readback',async()=>{
 const f=setup();f.after(()=>f.store.get('clienti/'+f.session.slug)[FIELD]={run_id:'new-run'});await assert.rejects(removeOwnFixture(f.options,f.session),/assenza/);assert.equal(f.store.get('clienti/'+f.session.slug)[FIELD].run_id,'new-run');
});
test('cleanup reports concurrent real-data changes and never reverts them',async()=>{
 const f=setup();f.after(()=>f.store.get('clienti/'+f.session.slug).monitoraggio_v1={concurrent:true});await assert.rejects(removeOwnFixture(f.options,f.session),/monitoraggio reale/);assert.deepEqual(f.store.get('clienti/'+f.session.slug).monitoraggio_v1,{concurrent:true});
});
test('listener drops queued events after unsubscribe and detects revoked session',async()=>{
 const f=setup(),r=f.adapter.collection('clienti').doc(f.session.slug);let calls=0,errors=0;const off=r.onSnapshot(()=>calls++,()=>errors++);off();await settle();assert.equal(calls,0);
 const off2=r.onSnapshot(()=>calls++,()=>errors++);await settle();assert.equal(calls,1);f.invalidate();f.listeners.get('clienti/'+f.session.slug)({exists:true,data:()=>f.store.get('clienti/'+f.session.slug)});await settle();assert.equal(calls,1);assert.equal(errors,1);off2();
});

function fakeBox(){
 const nodes=new Map();return {innerHTML:'',value:'',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,fakeBox());return nodes.get(selector);}};
}
test('adapter reads server even when client cache lacks a persisted fixture',async()=>{
 const f=setup(),cached=clone(f.store.get('clienti/'+f.session.slug));delete cached[FIELD];f.cacheClient(cached);
 const doc=await f.adapter.collection('clienti').doc(f.session.slug).get();assert.deepEqual(doc.data().monitoraggio_v1,f.state);
 assert.equal(f.reads.length,0);assert.ok(f.txReads.includes('clienti/'+f.session.slug));
});
test('inspect offers resume from server even when cache says no fixture exists',async()=>{
 const f=setup(),cached=clone(f.store.get('clienti/'+f.session.slug));delete cached[FIELD];f.cacheClient(cached);
 const box=fakeBox(),panel=createOutreachCollaudoCoda({...f.options,box});panel.open({slug:f.session.slug});await settle();
 assert.match(box.querySelector('[data-collaudo-actions]').innerHTML,/data-collaudo-resume/);panel.stop();
});
test('start verifies persisted fixture on server and mounts despite stale empty cache',async()=>{
 const f=setup(),raw=f.store.get('clienti/'+f.session.slug);delete raw[FIELD];f.cacheClient(clone(raw));
 const box=fakeBox();let opened=0;const previous=globalThis.createOutreachMonitoraggio;
 globalThis.createOutreachMonitoraggio=()=>({open:()=>opened++,stop:()=>{}});
 const panel=createOutreachCollaudoCoda({...f.options,box});
 try{
  panel.open({slug:f.session.slug});await settle();
  const actions=box.querySelector('[data-collaudo-actions]');assert.match(actions.innerHTML,/data-collaudo-start/);
  await actions.querySelector('[data-collaudo-start]').onclick({currentTarget:{disabled:false}});await settle();
  assert.equal(opened,1);assert.ok(f.store.get('clienti/'+f.session.slug)[FIELD].run_id);
  assert.doesNotMatch(box.querySelector('[data-collaudo-status]').textContent,/non confermato/);
  assert.equal(f.reads.filter(([path])=>path.startsWith('clienti/')).length,0);assert.ok(f.txReads.length>=6);
 }finally{panel.stop();globalThis.createOutreachMonitoraggio=previous;}
});

test('cleanup confirms absence through a separate transaction despite stale server get',async()=>{
 const f=setup();f.cacheClient(clone(f.store.get('clienti/'+f.session.slug)));
 const proof={},result=await removeOwnFixture(f.options,f.session,proof);
 assert.equal(result.absent,true);assert.equal(result.unchanged,true);assert.equal(f.updates.length,1);
 assert.equal(f.reads.length,0);assert.equal(f.txReads.filter(path=>path.startsWith('clienti/')).length,2);
});
test('read-only cleanup verification never deletes a present fixture',async()=>{
 const f=setup();await assert.rejects(verifyCleanup(f.options,f.session),/assenza/);assert.equal(f.updates.length,0);
});
test('failed cleanup readback leaves verification-only UI without another deletion',async()=>{
 const f=setup(),box=fakeBox(),previous=globalThis.createOutreachMonitoraggio;let stops=0;
 globalThis.createOutreachMonitoraggio=()=>({open:()=>{},stop:()=>stops++});
 const panel=createOutreachCollaudoCoda({...f.options,box});
 try{
  panel.open({slug:f.session.slug});await settle();
  const actions=box.querySelector('[data-collaudo-actions]');actions.querySelector('[data-collaudo-resume]').onclick();await settle();
  f.after(()=>{assert.equal(stops,1);f.failReadOnce();});
  const remove=actions.querySelector('[data-collaudo-cleanup]').onclick;
  await remove();assert.equal(f.updates.length,1);assert.equal(f.store.get('clienti/'+f.session.slug)[FIELD],undefined);
  assert.match(actions.innerHTML,/data-collaudo-verify/);assert.doesNotMatch(actions.innerHTML,/data-collaudo-cleanup/);
  assert.match(box.querySelector('[data-collaudo-status]').textContent,/Pulizia da verificare/);
  await remove();assert.equal(f.updates.length,1);
  await actions.querySelector('[data-collaudo-verify]').onclick();
  assert.equal(f.updates.length,1);assert.match(box.querySelector('[data-collaudo-status]').textContent,/Monitoraggio reale invariato/);
  assert.equal(box.querySelector('[data-collaudo-json]').value,'');
 }finally{panel.stop();globalThis.createOutreachMonitoraggio=previous;}
});

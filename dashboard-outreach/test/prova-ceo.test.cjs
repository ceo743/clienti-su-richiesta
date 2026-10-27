const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../monitoraggio-domain.js');
const P = require('../prova-ceo-ui.js');
const NOW = '2026-10-27T09:15:00.000Z', DELETE = Symbol('delete');
const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function setup(initial = {}) {
  const store = new Map([['clienti/'+P.SLUG,clone(initial)],['config/admins',{emails:[P.EMAIL]}]]);
  const reads=[],writes=[];let before,after,current=true;
  const auth={currentUser:{uid:'ceo-uid',email:P.EMAIL}};
  const snap=path=>({exists:store.has(path),data:()=>clone(store.get(path))});
  const db={collection:name=>({doc:id=>({path:name+'/'+id,get:()=>{throw Error('Forbidden cached read');}})}),runTransaction:async callback=>{
    if(before)before();const pending=[];
    const result=await callback({get:async ref=>{reads.push(ref.path);return snap(ref.path);},update:(ref,patch)=>pending.push([ref.path,patch])});
    for(const [path,patch] of pending){writes.push([path,patch]);const doc=store.get(path);for(const [key,value] of Object.entries(patch)){if(value===DELETE)delete doc[key];else doc[key]=clone(value);}if(after)after();}
    return result;
  }};
  const options={db,auth,domain:D,isAdmin:()=>true,isCurrent:()=>current,now:()=>NOW,fieldDelete:()=>DELETE};
  const session=P.identity(options);
  return {store,reads,writes,auth,options,session,before:fn=>before=fn,after:fn=>after=fn,invalidate:()=>current=false,doc:()=>store.get('clienti/'+P.SLUG)};
}
const preview=f=>P.prepare(f.options,f.session,f.doc(),NOW);
const create=f=>P.createRequest(f.options,f.session,preview(f),true);
function sent(f) {
  const state=f.doc().monitoraggio_v1,r=state.outbox.find(r=>r.purpose===P.PURPOSE);
  const context={actor:P.EMAIL,operators:[P.EMAIL],approvers:[P.EMAIL],now:NOW,claim_id:'claim-ceo-proof',verification:{checked_at:NOW,thread_url:'https://mail.google.com/mail/u/0/#sent/exactEmailThread',testo:r.testo,destinatario:P.EMAIL,evidence:'Exact authorized email thread verified before send'}};
  assert.equal(D.claim(state,r.id,context).may_send,true);
  D.recordOutcome(state,r.id,{...context,at:NOW,stato:'inviato',testo:r.testo,destinatario:P.EMAIL,thread_url:context.verification.thread_url,evidence:'SENT RAW id:exact-message-id sha256:exact-body'});
  return r;
}
test('single real email request uses exact CEO text and canonical ID; no sales claims',async()=>{
  const f=setup({other:{preserved:true}}),p=preview(f);
  assert.equal(p.id,'richiesta-'+NOW+'-'+P.CONTACT_ID);
  assert.equal(p.testo,'Ciao Davide,\n\nquesta è la prova reale richiesta da te, partita dalla coda della nostra dashboard outreach.\nID richiesta: '+p.id+'\nDashboard: https://clienti.davidecaiazzo.it/dashboard-outreach/\nQuesta email collauda il percorso email e non dimostra l’invio di messaggi LinkedIn.\n\nSofIA | DC Academy\nAssistente AI di Davide Caiazzo');
  const result=await P.createRequest(f.options,f.session,p,true),state=f.doc().monitoraggio_v1;
  assert.equal(result.created,true);assert.equal(state.outbox.length,1);assert.deepEqual(f.doc().other,{preserved:true});assert.equal(f.doc().collaudo_coda_v1,undefined);
  const r=state.outbox[0],c=state.contacts[0];
  assert.equal(r.tipo,'email');assert.equal(r.testo,p.testo);assert.equal(r.destinatario,P.EMAIL);assert.equal(r.stato,'richiesta');
  assert.equal(r.purpose,P.PURPOSE);assert.equal(r.fonte_autorizzazione,P.AUTHORIZATION);assert.equal(r.created_by_agent,'Codex');assert.equal(r.human_literal_text_approval,false);assert.match(r.approval_origin,/testo_preparato_da_agente/);
  assert.deepEqual(r.approval_snapshot,{testo:p.testo,destinatario:P.EMAIL,confirmed_at:NOW,confirmed_by:P.EMAIL,ultima_risposta:'',conversazione_verificata_il:NOW});
  assert.equal(c.nome,'PROVA INTERNA — Davide Caiazzo');assert.equal(c.scope,'lead');assert.notEqual(c.internal,true);assert.deepEqual(c.events,{});assert.equal(c.profilo,undefined);
  assert.equal(state.source,P.SOURCE);assert.equal(state.verified_at,NOW);assert.ok(Object.values(state.coverage).every(value=>value===false));assert.deepEqual(state.calls,[]);assert.deepEqual(state.reports,[]);
  assert.deepEqual(Object.keys(f.writes[0][1]),['monitoraggio_v1']);assert.equal(f.reads.filter(x=>x.startsWith('clienti/')).length,2);
  const metrics=D.summarize(state,{dal:'2026-10-01',al:'2026-10-31'});assert.deepEqual(metrics.contacts,[]);assert.ok(Object.values(metrics.known).every(value=>value===0));
});
test('creation requires confirmation and declines tampered or expired preview',async()=>{
  for(const mutate of [p=>p.testo+=' edited',p=>p.id='other',p=>p.now='2026-10-26T09:00:00Z']){
    const f=setup(),p=preview(f);mutate(p);await assert.rejects(P.createRequest(f.options,f.session,p,true));assert.equal(f.writes.length,0);
  }
  const f=setup();await assert.rejects(P.createRequest(f.options,f.session,preview(f),false),/Confermare/);assert.equal(f.writes.length,0);
  const p=preview(f);f.options.now=()=> '2026-10-27T09:31:00.000Z';await assert.rejects(P.createRequest(f.options,f.session,p,true),/scaduta/);
});
test('transactional access requires exact CEO identity, uid, current client and fresh roles',async()=>{
  for(const change of [f=>f.auth.currentUser=null,f=>f.auth.currentUser.email='chiara@example.it',f=>f.auth.currentUser.email='CEO@davidecaiazzo.it',f=>f.auth.currentUser.uid='other',f=>f.options.isAdmin=()=>false,f=>f.invalidate(),f=>f.store.set('config/admins',{emails:[]})]){
    const f=setup(),p=preview(f);f.before(()=>change(f));await assert.rejects(P.createRequest(f.options,f.session,p,true));assert.equal(f.writes.length,0);
  }
  const f=setup();await assert.rejects(P.readFresh(f.options,{...f.session,slug:'other-client'}));assert.equal(f.reads.length,0);
});
test('changed initial monitor/archive fails instead of overwriting concurrent work',async()=>{
  for(const field of ['monitoraggio_v1',P.ARCHIVE]){
    const f=setup(),p=preview(f);f.before(()=>{f.doc()[field]=field===P.ARCHIVE?{version:1,entries:[{other:true}]}:{concurrent:true};});
    await assert.rejects(P.createRequest(f.options,f.session,p,true),/cambiati/);assert.equal(f.writes.length,0);assert.equal(f.doc()[field]!==undefined,true);
  }
});
test('any present request with purpose prevents recreation in every status',async()=>{
  for(const status of D.OUTBOX){
    const f=setup();const first=await create(f),p=preview(f);assert.equal(p.existing.request.id,first.request.id);
    f.doc().monitoraggio_v1.outbox[0].stato=status;
    const stale={now:NOW,id:first.request.id,testo:first.request.testo,hadMonitor:false,expected_monitor_signature:undefined,expected_archive_signature:undefined};
    assert.equal((await P.createRequest(f.options,f.session,stale,true)).created,false);assert.equal(f.writes.length,1);assert.equal(f.doc().monitoraggio_v1.outbox.length,1);
  }
});
test('existing contact/email and malformed archive are never overwritten',()=>{
  for(const c of [{id:'real-person',nome:'Davide',email:P.EMAIL,events:{}},{id:P.CONTACT_ID,nome:'Existing',events:{}}]){
    const s=D.empty(P.SLUG);Object.assign(s,{source:'Fonte verificata',verified_at:NOW,contacts:[c]});const f=setup({monitoraggio_v1:s});
    assert.throws(()=>preview(f),/già presente/);assert.equal(f.writes.length,0);
  }
  const f=setup({[P.ARCHIVE]:{unknown:true}});assert.throws(()=>preview(f),/non riconosciuto/);assert.equal(f.writes.length,0);
});
test('export reads exact persisted request and roles through a fresh transaction',async()=>{
  const f=setup();await create(f);const count=f.reads.length;
  const value=await P.exportFresh(f.options,f.session);
  assert.deepEqual(Object.keys(value),['schema_version','exported_at','client_slug','purpose','fonte_autorizzazione','request','actor','approver']);
  assert.deepEqual(value.request,f.doc().monitoraggio_v1.outbox[0]);assert.deepEqual(value.actor,{email:P.EMAIL,role:'ceo'});assert.deepEqual(value.approver,value.actor);assert.equal(f.reads.length,count+2);
  value.request.testo='local tamper';assert.notEqual(f.doc().monitoraggio_v1.outbox[0].testo,value.request.testo);
  f.doc().monitoraggio_v1.outbox[0].testo+=' tamper';await assert.rejects(P.exportFresh(f.options,f.session),/diversa/);
});
test('request follows standard claim/sent/delivery state machine without sales events',async()=>{
  const f=setup();await create(f);const r=sent(f);assert.equal(r.stato,'inviato');
  D.recordOutcome(f.doc().monitoraggio_v1,r.id,{actor:P.EMAIL,operators:[P.EMAIL],claim_id:r.claim_id,now:NOW,at:NOW,stato:'consegnato',testo:r.testo,destinatario:P.EMAIL,thread_url:r.thread_url,evidence:'INBOX exact message ID distinct from SENT RAW'});
  assert.equal(r.stato,'consegnato');assert.deepEqual(f.doc().monitoraggio_v1.contacts[0].events,{});
  assert.deepEqual(D.validate(f.doc().monitoraggio_v1,P.SLUG).contacts[0].events,{});
});
test('cleanup archives receipt and removes only test monitor; archive prevents recreation',async()=>{
  const f=setup({other:'preserved'});await create(f);const r=sent(f),before=clone(r);
  f.doc().monitoraggio_v1.updated_at='2026-10-27T09:16:00.000Z';
  const result=await P.cleanup(f.options,f.session,r.id);
  assert.equal(result.archived,true);assert.equal(result.monitorRemoved,true);assert.equal(Object.hasOwn(f.doc(),'monitoraggio_v1'),false);assert.equal(f.doc().other,'preserved');
  assert.deepEqual(f.doc()[P.ARCHIVE].entries[0].request,before);assert.equal(f.doc()[P.ARCHIVE].entries[0].counts_as_sales,false);
  assert.equal(preview(f).existing.archived,true);assert.equal((await P.exportFresh(f.options,f.session)).request.id,r.id);
  const count=f.writes.length;assert.equal((await P.cleanup(f.options,f.session,r.id)).alreadyArchived,true);assert.equal(f.writes.length,count);
});
test('cleanup preserves existing monitor and unrelated concurrent changes',async()=>{
  const state=D.empty(P.SLUG);Object.assign(state,{source:'Dati reali verificati',verified_at:NOW,contacts:[{id:'real',nome:'Real person',scope:'outreach',events:{},ingresso:NOW}]});
  const f=setup({monitoraggio_v1:state,other:'preserved'});await create(f);const r=sent(f);assert.equal(r.prova_ceo.baseline_signature,null);
  f.doc().monitoraggio_v1.contacts[0].prossimo_passo='Updated independently';const expected=clone(f.doc().monitoraggio_v1);expected.contacts.pop();expected.outbox=[];
  await P.cleanup(f.options,f.session,r.id);assert.deepEqual(f.doc().monitoraggio_v1,expected);assert.equal(f.doc().other,'preserved');
  const g=setup();await create(g);const q=sent(g);g.doc().monitoraggio_v1.coverage.email=true;
  await P.cleanup(g.options,g.session,q.id);assert.equal(g.doc().monitoraggio_v1.coverage.email,true);assert.deepEqual(g.doc().monitoraggio_v1.contacts,[]);
});
test('cleanup blocks before send, owner conflict, changed contact/references and revoked access',async()=>{
  const f=setup();await create(f);await assert.rejects(P.cleanup(f.options,f.session,f.doc().monitoraggio_v1.outbox[0].id),/dopo un invio/);assert.equal(f.writes.length,1);
  for(const change of [f=>f.doc().monitoraggio_v1.outbox[0].prova_ceo.owner_uid='other',f=>f.doc().monitoraggio_v1.contacts[0].prossimo_passo='Real updated task',f=>f.doc().monitoraggio_v1.outbox.push({...f.doc().monitoraggio_v1.outbox[0],id:'other-request',purpose:'other'}),f=>f.store.set('config/admins',{emails:[]}),f=>f.auth.currentUser.uid='other',f=>f.invalidate()]){
    const g=setup();await create(g);const r=sent(g);g.before(()=>change(g));await assert.rejects(P.cleanup(g.options,g.session,r.id));assert.equal(g.writes.length,1);
  }
});
test('cleanup readback catches recreated test data and never deletes twice',async()=>{
  const f=setup();await create(f);const r=sent(f),old=clone(f.doc().monitoraggio_v1);
  f.after(()=>{f.doc().monitoraggio_v1=old;});await assert.rejects(P.cleanup(f.options,f.session,r.id),/Ricevuta|Pulizia/);assert.equal(f.writes.length,2);assert.ok(f.doc().monitoraggio_v1);
});
function fakeBox() {
  const nodes=new Map();return {innerHTML:'',value:'',checked:false,disabled:false,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,fakeBox());return nodes.get(selector);}};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('UI only renders CEO client with readonly text and confirmation; refresh resumes same request',async()=>{
  const f=setup(),box=fakeBox(),panel=P.createOutreachProvaCeo({...f.options,box});
  panel.open({slug:'other'});await settle();assert.equal(f.reads.length,0);assert.equal(box.innerHTML,'');
  panel.open({slug:P.SLUG});await settle();assert.match(box.innerHTML,/textarea data-prova-text readonly/);assert.match(box.innerHTML,/textarea data-prova-json readonly/);
  const actions=box.querySelector('[data-prova-actions]');assert.match(actions.innerHTML,/data-prova-create disabled/);
  const checkbox=actions.querySelector('[data-prova-confirm]'),button=actions.querySelector('[data-prova-create]');button.disabled=true;
  await button.onclick();assert.equal(f.writes.length,0);checkbox.checked=true;checkbox.onchange();await button.onclick();
  assert.equal(f.writes.length,1);assert.match(actions.innerHTML,/data-prova-refresh/);assert.doesNotMatch(actions.innerHTML,/data-prova-create/);
  assert.equal(JSON.parse(box.querySelector('[data-prova-json]').value).request.destinatario,P.EMAIL);
  await actions.querySelector('[data-prova-refresh]').onclick();assert.equal(f.writes.length,1);panel.stop();assert.equal(box.innerHTML,'');
});
test('UI drops delayed reads after stop or auth change without mutation',async()=>{
  const f=setup(),box=fakeBox();let authListener;
  f.auth.onAuthStateChanged=callback=>{authListener=callback;return()=>{authListener=null;};};
  const panel=P.createOutreachProvaCeo({...f.options,box});panel.open({slug:P.SLUG});panel.stop();await settle();assert.equal(box.innerHTML,'');
  panel.open({slug:P.SLUG});await settle();f.auth.currentUser.email='other@example.it';authListener();assert.equal(box.innerHTML,'');assert.equal(f.writes.length,0);
});

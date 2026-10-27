const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const D=require('../monitoraggio-domain.js'),P=require('../prova-team-ui.js');
// Filo FITTIZIO già presente nelle prove locali; nessun accesso a servizi esterni.
const THREAD=fs.readFileSync(path.join(__dirname,'dispatch-state.test.cjs'),'utf8').match(/const THREAD='([^']+)'/)[1];
const NOW='2026-10-27T09:15:00.000Z',DELETE=Symbol('delete');
const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
function setup(initial={}) {
  const store=new Map([['clienti/'+P.SLUG,clone(initial)],['config/admins',{emails:[P.EMAIL]}]]);
  const reads=[],writes=[];let before,after,current=true,postRead;
  const auth={currentUser:{uid:'ceo-uid',email:P.EMAIL}};
  const snapshot=path=>({exists:store.has(path),data:()=>clone(store.get(path))});
  const db={collection:name=>({doc:id=>({path:name+'/'+id,get:()=>{throw Error('Cached reads forbidden');}})}),runTransaction:async callback=>{
    if(before)before();const pending=[];
    const result=await callback({get:async ref=>{reads.push(ref.path);const value=snapshot(ref.path);if(postRead)await postRead();return value;},update:(ref,patch)=>pending.push([ref.path,patch])});
    for(const [path,patch] of pending){writes.push([path,patch]);const doc=store.get(path);for(const [key,value] of Object.entries(patch)){if(value===DELETE)delete doc[key];else doc[key]=clone(value);}if(after)after();}
    return result;
  }};
  const options={db,auth,domain:D,isAdmin:()=>true,isCurrent:()=>current,now:()=>NOW,fieldDelete:()=>DELETE};
  const session=P.identity(options);
  return {store,reads,writes,auth,options,session,before:fn=>before=fn,after:fn=>after=fn,postRead:fn=>postRead=fn,invalidate:()=>current=false,doc:()=>store.get('clienti/'+P.SLUG)};
}
const preview=f=>P.prepare(f.options,f.session,f.doc(),{thread_url:THREAD,confirmed:true},NOW);
const create=f=>P.createRequest(f.options,f.session,preview(f),true);
function sent(f) {
  const state=f.doc().monitoraggio_v1,r=state.outbox.find(r=>r.purpose===P.PURPOSE);
  const context={actor:P.EMAIL,operators:[P.EMAIL],approvers:[P.EMAIL],now:NOW,claim_id:'claim-team-proof',verification:{checked_at:NOW,thread_url:THREAD,testo:r.testo,destinatario:P.PROFILE,evidence:'Filo esatto controllato prima della singola prova interna'}};
  assert.equal(D.claim(state,r.id,context).may_send,true);
  D.recordOutcome(state,r.id,{...context,at:NOW,stato:'inviato',testo:r.testo,destinatario:P.PROFILE,thread_url:THREAD,evidence:'Messaggio esatto visibile nel filo, riscontro locale di prova'});
  return r;
}
test('unica richiesta standard di messaggio con testo esatto, contatto temporaneo e nessun risultato commerciale',async()=>{
  const f=setup({other:{preserved:true}}),p=preview(f);
  assert.equal(p.id,'richiesta-'+NOW+'-'+P.CONTACT_ID);assert.equal(Object.isFrozen(p),true);
  assert.equal(p.testo,'Ciao Gianfranco,\n\nquesta è l’unica prova interna richiesta da Davide per verificare gli invii LinkedIn dalla nostra dashboard outreach. Non serve rispondere.\nRiferimento: '+p.id+'\nDashboard: https://clienti.davidecaiazzo.it/dashboard-outreach/\n\nSofIA | DC Academy\nAssistente AI di Davide Caiazzo');
  const result=await create(f),state=f.doc().monitoraggio_v1,r=state.outbox[0],c=state.contacts[0];
  assert.equal(result.created,true);assert.equal(r.tipo,'messaggio');assert.equal(r.destinatario,P.PROFILE);assert.equal(r.testo,p.testo);assert.equal(r.stato,'richiesta');
  assert.equal(r.purpose,'collaudo_linkedin_team_autorizzato');assert.equal(r.fonte_autorizzazione,'AUTORIZZAZIONE-PROVA-TEAM-LINKEDIN-20261027');
  assert.equal(r.created_by_agent,'Codex');assert.equal(r.approval_origin,'ordine_esplicito_prova_team');assert.equal(r.human_literal_text_approval,false);
  assert.deepEqual(r.approval_snapshot,{testo:p.testo,destinatario:P.PROFILE,confirmed_at:NOW,confirmed_by:P.EMAIL,ultima_risposta:'',conversazione_verificata_il:NOW});
  assert.equal(r.prova_team.owner_uid,f.session.uid);assert.equal(r.prova_team.owner_email,P.EMAIL);assert.equal(r.prova_team.client_slug,P.SLUG);assert.equal(r.prova_team.thread_url,THREAD);
  assert.equal(c.nome,'PROVA INTERNA — Gianfranco Motta (Codex)');assert.equal(c.scope,'lead');assert.equal(c.profilo,P.PROFILE);assert.equal(c.email,undefined);assert.deepEqual(c.events,{});assert.equal(c.conversazione_url,THREAD);assert.equal(c.conversazione_verificata_il,NOW);assert.notEqual(c.internal,true);
  assert.deepEqual(f.doc().other,{preserved:true});assert.deepEqual(Object.keys(f.writes[0][1]),['monitoraggio_v1']);assert.equal(f.reads.filter(x=>x.startsWith('clienti/')).length,2);
  const metrics=D.summarize(state,{dal:'2026-10-01',al:'2026-10-31'});assert.deepEqual(metrics.contacts,[]);assert.ok(Object.values(metrics.known).every(value=>value===0));assert.ok(Object.values(state.coverage).every(value=>value===false));assert.deepEqual(state.calls,[]);
});
test('anteprima richiede un vero filo e dichiarazione; testo, id, verifica o data alterati non vengono salvati',async()=>{
  const f=setup();
  for(const verification of [{},{thread_url:THREAD,confirmed:false},{thread_url:P.PROFILE,confirmed:true},{thread_url:'non-url',confirmed:true}])assert.throws(()=>P.prepare(f.options,f.session,f.doc(),verification),/Dichiarare/);
  for(const change of [p=>p.testo+=' alterato',p=>p.id='altro',p=>p.verification_confirmed=false,p=>p.thread_url=P.PROFILE]){
    const g=setup(),p={...preview(g)};change(p);await assert.rejects(P.createRequest(g.options,g.session,p,true),/Anteprima/);assert.equal(g.writes.length,0);
  }
  await assert.rejects(P.createRequest(f.options,f.session,preview(f),false),/Confermare/);
  const p=preview(f);f.options.now=()=> '2026-10-27T09:31:00.000Z';await assert.rejects(P.createRequest(f.options,f.session,p,true),/scaduta/);assert.equal(f.writes.length,0);
});
test('solo CEO amministratore con UID e cliente stabili, ruoli riletti dal server',async()=>{
  for(const change of [f=>f.auth.currentUser=null,f=>f.auth.currentUser.email='altra@example.test',f=>f.auth.currentUser.email='CEO@davidecaiazzo.it',f=>f.auth.currentUser.uid='other',f=>f.options.isAdmin=()=>false,f=>f.invalidate(),f=>f.store.set('config/admins',{emails:[]})]){
    const f=setup(),p=preview(f);f.before(()=>change(f));await assert.rejects(P.createRequest(f.options,f.session,p,true));assert.equal(f.writes.length,0);
  }
  const f=setup();await assert.rejects(P.readFresh(f.options,{...f.session,slug:'other-client'}));assert.equal(f.reads.length,0);
  f.postRead(async()=>{await Promise.resolve();f.auth.currentUser.uid='other';});await assert.rejects(P.readFresh(f.options,f.session));assert.equal(f.writes.length,0);
});
test('monitoraggio e archivio cambiati dopo anteprima non sovrascrivono il lavoro concorrente',async()=>{
  for(const field of ['monitoraggio_v1',P.ARCHIVE]){
    const f=setup(),p=preview(f);f.before(()=>{f.doc()[field]=field===P.ARCHIVE?{version:1,entries:[{other:true}]}:{concurrent:true};});
    await assert.rejects(P.createRequest(f.options,f.session,p,true),/cambiati/);assert.equal(f.writes.length,0);assert.ok(f.doc()[field]);
  }
});
test('ogni stato della prova esistente impedisce la creazione di un’altra richiesta',async()=>{
  for(const stato of D.OUTBOX){
    const f=setup();const first=await create(f);f.doc().monitoraggio_v1.outbox[0].stato=stato;
    const stale={...preview(setup())};
    assert.equal((await P.createRequest(f.options,f.session,stale,true)).created,false);assert.equal(f.writes.length,1);assert.equal(f.doc().monitoraggio_v1.outbox.length,1);
    assert.equal(preview(f).existing.request.id,first.request.id);
  }
});
test('contatti esistenti e archivio sconosciuto non vengono sostituiti',()=>{
  for(const c of [{id:'real-person',nome:'Gianfranco',profilo:P.PROFILE,events:{}},{id:'case-variant',nome:'Gianfranco',profilo:P.PROFILE.toUpperCase().replace('WWW.','').replace(/\/$/,''),events:{}},{id:P.CONTACT_ID,nome:'Existing',events:{}}]){
    const state=D.empty(P.SLUG);Object.assign(state,{source:'Fonte verificata',verified_at:NOW,contacts:[c]});const f=setup({monitoraggio_v1:state});
    assert.throws(()=>preview(f),/già presente/);assert.equal(f.writes.length,0);
  }
  assert.throws(()=>preview(setup({[P.ARCHIVE]:{unknown:true}})),/non riconosciuto/);
});
test('export di un solo record server mantiene metadati fedeli, testo e contatto senza altri clienti o prove',async()=>{
  const f=setup({other:{secret:'NON ESPORTARE'},[P.ARCHIVE]:{version:1,entries:[{purpose:'collaudo_ceo_autorizzato',secret:'NON ESPORTARE'}]}});await create(f);
  const count=f.reads.length,out=await P.exportFresh(f.options,f.session);
  assert.deepEqual(out.request,f.doc().monitoraggio_v1.outbox[0]);assert.deepEqual(out.contact,f.doc().monitoraggio_v1.contacts[0]);assert.equal(f.reads.length,count+2);
  assert.equal(out.approval.human_literal_text_approval,false);assert.equal(out.approval.origin,'ordine_esplicito_prova_team');assert.equal(out.approver,undefined);assert.doesNotMatch(JSON.stringify(out),/NON ESPORTARE/);
  out.request.testo='locale';out.contact.nome='locale';assert.notEqual(f.doc().monitoraggio_v1.outbox[0].testo,'locale');assert.notEqual(f.doc().monitoraggio_v1.contacts[0].nome,'locale');
  f.doc().monitoraggio_v1.outbox[0].testo+=' alterato';await assert.rejects(P.exportFresh(f.options,f.session),/diversa/);
});
test('la richiesta segue la macchina standard di claim/invio/consegna senza eventi commerciali',async()=>{
  const f=setup();await create(f);const r=sent(f);assert.equal(r.stato,'inviato');
  D.recordOutcome(f.doc().monitoraggio_v1,r.id,{actor:P.EMAIL,operators:[P.EMAIL],claim_id:r.claim_id,now:NOW,at:NOW,stato:'consegnato',testo:r.testo,destinatario:P.PROFILE,thread_url:THREAD,evidence:'Indicatore di consegna distinto visibile nel filo'});
  assert.equal(r.stato,'consegnato');assert.deepEqual(D.validate(f.doc().monitoraggio_v1,P.SLUG).contacts[0].events,{});
});
test('pulizia archivia ricevuta e rimuove solo prova; archivio impedisce altre creazioni',async()=>{
  const other={purpose:'collaudo_ceo_autorizzato',request:{id:'precedente'},counts_as_sales:false};
  const f=setup({other:'preserved',[P.ARCHIVE]:{version:1,entries:[other]}});await create(f);const r=sent(f),before=clone(r);
  f.doc().monitoraggio_v1.updated_at='2026-10-27T09:16:00.000Z';
  const result=await P.cleanup(f.options,f.session,r.id);
  assert.equal(result.archived,true);assert.equal(result.monitorRemoved,true);assert.equal(Object.hasOwn(f.doc(),'monitoraggio_v1'),false);assert.equal(f.doc().other,'preserved');
  assert.deepEqual(f.doc()[P.ARCHIVE].entries[0],other);const receipt=f.doc()[P.ARCHIVE].entries[1];assert.deepEqual(receipt.request,before);assert.equal(receipt.counts_as_sales,false);assert.equal(receipt.contact.scope,'lead');
  assert.equal(preview(f).existing.archived,true);assert.equal((await P.exportFresh(f.options,f.session)).request.id,r.id);
  const count=f.writes.length;assert.equal((await P.cleanup(f.options,f.session,r.id)).alreadyArchived,true);assert.equal(f.writes.length,count);
});
test('pulizia preserva monitoraggio preesistente o modifiche concorrenti fuori dalla prova',async()=>{
  const state=D.empty(P.SLUG);Object.assign(state,{source:'Dati reali verificati',verified_at:NOW,contacts:[{id:'real',nome:'Real person',scope:'outreach',events:{},ingresso:NOW}]});
  const f=setup({monitoraggio_v1:state,other:'preserved'});await create(f);const r=sent(f);assert.equal(r.prova_team.baseline_signature,null);
  f.doc().monitoraggio_v1.contacts[0].prossimo_passo='Aggiornato da altro operatore';const expected=clone(f.doc().monitoraggio_v1);expected.contacts.pop();expected.outbox=[];
  await P.cleanup(f.options,f.session,r.id);assert.deepEqual(f.doc().monitoraggio_v1,expected);assert.equal(f.doc().other,'preserved');
  const g=setup();await create(g);const q=sent(g);g.doc().monitoraggio_v1.coverage.email=true;
  await P.cleanup(g.options,g.session,q.id);assert.equal(g.doc().monitoraggio_v1.coverage.email,true);assert.deepEqual(g.doc().monitoraggio_v1.contacts,[]);
});
test('pulizia respinge invio senza claim/prova, owner errato, contatto modificato o collegato, ruoli revocati',async()=>{
  const f=setup();await create(f);await assert.rejects(P.cleanup(f.options,f.session,f.doc().monitoraggio_v1.outbox[0].id),/dopo un invio/);assert.equal(f.writes.length,1);
  for(const change of [f=>delete f.doc().monitoraggio_v1.outbox[0].claim_id,f=>f.doc().monitoraggio_v1.outbox[0].evidence='',f=>f.doc().monitoraggio_v1.outbox[0].prova_team.owner_uid='other',f=>f.doc().monitoraggio_v1.contacts[0].prossimo_passo='Real updated task',f=>f.doc().monitoraggio_v1.outbox.push({...f.doc().monitoraggio_v1.outbox[0],id:'other-request',purpose:'other'}),f=>f.store.set('config/admins',{emails:[]}),f=>f.auth.currentUser.uid='other',f=>f.invalidate()]){
    const g=setup();await create(g);const r=sent(g);g.before(()=>change(g));await assert.rejects(P.cleanup(g.options,g.session,r.id));assert.equal(g.writes.length,1);
  }
});
test('seconda rilettura della pulizia rileva residui ricomparsi e non ripete eliminazioni',async()=>{
  const f=setup();await create(f);const r=sent(f),old=clone(f.doc().monitoraggio_v1);
  f.after(()=>{f.doc().monitoraggio_v1=old;});await assert.rejects(P.cleanup(f.options,f.session,r.id),/Ricevuta|Pulizia/);assert.equal(f.writes.length,2);assert.ok(f.doc().monitoraggio_v1);
});
function fakeBox(){const nodes=new Map();return {innerHTML:'',value:'',checked:false,disabled:false,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,fakeBox());return nodes.get(selector);}};}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('UI richiede filo reale e dichiarazione prima dell’anteprima, poi conferma separata e riprende la stessa richiesta',async()=>{
  const f=setup(),box=fakeBox(),panel=P.createOutreachProvaTeam({...f.options,box});
  panel.open({slug:'other'});await settle();assert.equal(f.reads.length,0);assert.equal(box.innerHTML,'');
  panel.open({slug:P.SLUG});await settle();assert.match(box.innerHTML,/textarea data-team-text readonly/);assert.match(box.innerHTML,/textarea data-team-json readonly/);
  const actions=box.querySelector('[data-team-actions]'),thread=actions.querySelector('[data-team-thread]'),verified=actions.querySelector('[data-team-verified]'),button=actions.querySelector('[data-team-preview]');
  assert.match(actions.innerHTML,/data-team-preview disabled/);assert.doesNotMatch(actions.innerHTML,/data-team-create/);
  thread.value=THREAD;thread.oninput();assert.equal(button.disabled,true);verified.checked=true;verified.onchange();assert.equal(button.disabled,false);button.onclick();assert.equal(f.writes.length,0);
  const confirmation=actions.querySelector('[data-team-confirmation]');assert.match(confirmation.innerHTML,/data-team-create disabled/);assert.ok(box.querySelector('[data-team-text]').value.includes('Ciao Gianfranco'));
  const checkbox=confirmation.querySelector('[data-team-confirm]'),createButton=confirmation.querySelector('[data-team-create]');createButton.disabled=true;await createButton.onclick();assert.equal(f.writes.length,0);
  checkbox.checked=true;checkbox.onchange();await createButton.onclick();assert.equal(f.writes.length,1);assert.doesNotMatch(actions.innerHTML,/data-team-create/);assert.equal(JSON.parse(box.querySelector('[data-team-json]').value).request.destinatario,P.PROFILE);
  await actions.querySelector('[data-team-refresh]').onclick();assert.equal(f.writes.length,1);panel.stop();assert.equal(box.innerHTML,'');
});
test('UI invalida l’anteprima se cambia il filo e ignora letture dopo stop o cambio account',async()=>{
  const f=setup(),box=fakeBox();let authListener;
  f.auth.onAuthStateChanged=callback=>{authListener=callback;return()=>{authListener=null;};};
  const panel=P.createOutreachProvaTeam({...f.options,box});panel.open({slug:P.SLUG});panel.stop();await settle();assert.equal(box.innerHTML,'');
  panel.open({slug:P.SLUG});await settle();const actions=box.querySelector('[data-team-actions]'),thread=actions.querySelector('[data-team-thread]'),verified=actions.querySelector('[data-team-verified]');thread.value=THREAD;verified.checked=true;verified.onchange();actions.querySelector('[data-team-preview]').onclick();
  thread.value='invalid';thread.oninput();assert.equal(actions.querySelector('[data-team-confirmation]').innerHTML,'');assert.equal(box.querySelector('[data-team-text]').value,'');
  f.auth.currentUser.email='other@example.test';authListener();assert.equal(box.innerHTML,'');assert.equal(f.writes.length,0);
});

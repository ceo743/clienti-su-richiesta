const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const D = require('../monitoraggio-domain.js');
const E = require('../richiesta-export.js');
// Riusa soltanto URL FITTIZI delle prove locali: nessun accesso di rete.
const fixtureSource = fs.readFileSync(path.join(__dirname,'dispatch-state.test.cjs'),'utf8');
const profile = fixtureSource.match(/profilo:'([^']+)'/)[1];
const thread = fixtureSource.match(/const THREAD='([^']+)'/)[1];
const at = '2026-10-26T09:00:00Z';
const slug = 'cliente-test';
const actor = 'admin@example.test';
const approver = 'approvatore@example.test';
function fixture(tipo='messaggio') {
  const state = D.empty(slug);
  Object.assign(state,{source:'Registro di prova locale',verified_at:at});
  const contact = {id:'persona',nome:'Persona selezionata',profilo:profile,email:'persona@example.test',email_verificata:true,bozza:'Bozza corrente',conversazione_verificata_il:at,conversazione_url:thread,events:{risposta:at,interesse:at,vendita:at},vendita_fonte:'Prova locale',vendita_riscontro:'Dato vendite riservato',internal:false,escluso:false,chiuso:false,target:'RISERVATO'};
  state.contacts.push(contact,{id:'altra',nome:'Altra persona riservata',email:'altra@example.test',events:{}});
  const request = {id:'richiesta-corrente',contact_id:contact.id,tipo,testo:'Testo confermato corrente',destinatario:tipo==='email'?contact.email:contact.profilo,stato:'richiesta',created_at:at,confirmed_at:at,confirmed_by:approver};
  request.approval_snapshot = {testo:request.testo,destinatario:request.destinatario,confirmed_at:at,confirmed_by:approver};
  state.outbox.push(request);
  return state;
}
function harness(state=fixture()) {
  const h = {reads:[],writes:0,transactions:0,current:true,admin:true,admins:[actor],approvers:[approver],exists:true,configExists:true,state,afterRead:null,afterTransaction:null};
  h.auth = {currentUser:{email:actor,uid:'uid-admin'}};
  h.data = {slug,monitoraggio_v1:state,messaggi:[{id:'richiesta-storica',testo:'Storico riservato'}],email:'cliente-riservato@example.test'};
  h.options = {domain:D,auth:h.auth,isAdmin:()=>h.admin,isCurrent:()=>h.current,db:{collection(collection){return {doc(id){return {path:collection+'/'+id};}};},async runTransaction(fn){
    h.transactions++;
    const result=await fn({async get(ref){
      h.reads.push(ref.path);
      if(h.afterRead) await h.afterRead(ref.path);
      return ref.path==='clienti/'+slug ? {exists:h.exists,data:()=>h.data} : {exists:h.configExists,data:()=>({emails:ref.path==='config/admins'?h.admins:h.approvers})};
    },set(){h.writes++;throw Error('Scrittura vietata');},update(){h.writes++;throw Error('Scrittura vietata');},delete(){h.writes++;throw Error('Scrittura vietata');}});
    if(h.afterTransaction) await h.afterTransaction();
    return result;
  }}};
  h.read = (requestId='richiesta-corrente',client=slug) => E.read(h.options,client,requestId);
  return h;
}
test('legge soltanto i tre documenti autorizzati, con dati correnti e senza scritture',async()=>{
  const h=harness();
  h.options.state={outbox:[{id:'richiesta-corrente',testo:'UI VECCHIA'}]};
  const out=await h.read();
  assert.deepEqual(h.reads,['clienti/'+slug,'config/admins','config/approvatori_messaggi']);
  assert.equal(h.writes,0);assert.equal(h.transactions,1);
  assert.equal(out.request.testo,'Testo confermato corrente');
  assert.equal(out.schema_version,1);assert.equal(out.client_slug,slug);assert.equal(out.source,'dashboard_firestore_transaction');
  assert.ok(Number.isFinite(Date.parse(out.exported_at)));
  assert.deepEqual(out.actor,{email:actor,is_admin:true});
  assert.deepEqual(out.approver,{email:approver,authorized:true});
});
test('esporta solo il contatto esatto e i campi necessari al canale',async()=>{
  for (const tipo of ['messaggio','email']) {
    const h=harness(fixture(tipo)), out=await h.read();
    const allowed=['id','nome','bozza','conversazione_verificata_il','conversazione_url','internal','escluso','chiuso','events',...(tipo==='email'?['email','email_verificata']:['profilo'])];
    assert.deepEqual(Object.keys(out.contact).sort(),allowed.sort());
    assert.deepEqual(out.contact.events,{risposta:at});
    assert.doesNotMatch(JSON.stringify(out),/Altra persona|altra@example|RISERVATO|Dato vendite riservato|cliente-riservato|uid-admin/);
    assert.ok(!JSON.stringify(out).includes('"emails"'));
    assert.equal(h.writes,0);
  }
});
test('mantiene integralmente richiesta, claim e snapshot senza modificare o condividere oggetti',async()=>{
  const h=harness(), r=h.state.outbox[0];
  Object.assign(r,{claim_id:'claim-preciso',claimed_at:at,claimed_by:actor,dispatch_snapshot:{testo:r.testo,destinatario:r.destinatario,confirmed_at:at,confirmed_by:approver},audit:{nota:'originale'}});
  const before=JSON.stringify(h.data), out=await h.read();
  assert.deepEqual(out.request,r);assert.equal(JSON.stringify(h.data),before);
  out.request.approval_snapshot.testo='alterato';out.request.audit.nota='alterata';out.contact.bozza='alterata';
  assert.equal(JSON.stringify(h.data),before);
});
test('approvatore revocato resta esportabile per audit con authorized false',async()=>{
  const h=harness();h.approvers=[];
  const out=await h.read();assert.deepEqual(out.approver,{email:approver,authorized:false});assert.equal(h.writes,0);
  h.admins.push(approver.toUpperCase());assert.equal((await h.read()).approver.authorized,true);
});
test('richieste storiche o assenti non vengono sostituite; si seleziona solo il contact_id registrato',async()=>{
  const h=harness();
  await assert.rejects(h.read('richiesta-storica'),/corrente non disponibile/);
  await assert.rejects(h.read('inesistente'),/corrente non disponibile/);
  h.state.outbox[0].contact_id='altra';
  assert.equal((await h.read()).contact.id,'altra');
  h.state.outbox[0].contact_id='inesistente';
  await assert.rejects(h.read(),/Richiesta senza contatto/);
  assert.equal(h.writes,0);
});
test('differenze tra destinatario approvato e contatto corrente restano visibili senza autorizzare invii',async()=>{
  const h=harness(fixture('email'));h.state.contacts[0].email='aggiornata@example.test';
  const out=await h.read();
  assert.equal(out.request.destinatario,'persona@example.test');
  assert.equal(out.contact.email,'aggiornata@example.test');
  assert.equal(out.request.stato,'richiesta');assert.equal(h.writes,0);
});
test('slug non valido blocca prima della rete; cliente e monitoraggio discordanti sono rifiutati',async()=>{
  const h=harness();
  for(const invalid of ['../cliente','cliente/altro','',null,{},'A']) await assert.rejects(h.read('richiesta-corrente',invalid),/Cliente non valido/);
  assert.equal(h.transactions,0);
  h.data.slug='altro';await assert.rejects(h.read(),/Cliente non corrispondente/);
  h.data.slug=slug;h.state.client_slug='altro';await assert.rejects(h.read(),/Cliente non corrispondente/);
});
test('cliente assente, configurazione assente o malformata, admin revocato bloccano l’export',async()=>{
  const h=harness();h.exists=false;await assert.rejects(h.read(),/Cliente non più/);
  h.exists=true;h.configExists=false;await assert.rejects(h.read(),/Configurazione/);
  h.configExists=true;h.approvers='non-un-elenco';await assert.rejects(h.read(),/Configurazione/);
  h.approvers=[approver];h.admins=['email-invalida'];await assert.rejects(h.read(),/Configurazione/);
  h.admins=[];await assert.rejects(h.read(),/non più amministratore/);
  assert.equal(h.writes,0);
});
test('valida il monitoraggio reale senza riparare dati o ricorrere alla cache',async()=>{
  const h=harness();delete h.state.contacts[0].vendita_riscontro;
  await assert.rejects(h.read(),/Vendita senza fonte/);
  h.data.monitoraggio_v1=undefined;await assert.rejects(h.read(),/Monitoraggio mancante/);
});
test('sessione e permessi obbligatori prima di iniziare',async()=>{
  for(const change of [h=>h.admin=false,h=>h.current=false,h=>delete h.auth.currentUser.uid,h=>h.auth.currentUser=null]) {
    const h=harness();change(h);await assert.rejects(h.read(),/Accesso/);assert.equal(h.transactions,0);
  }
});
test('cambio cliente, email, UID o permesso durante le letture annulla il risultato',async()=>{
  for(const change of [h=>h.current=false,h=>h.admin=false,h=>h.auth.currentUser.email='altro@example.test',h=>h.auth.currentUser.uid='uid-altro']) {
    const h=harness();h.afterRead=async()=>{await Promise.resolve();change(h);};
    await assert.rejects(h.read(),/Accesso o cliente cambiato/);assert.equal(h.writes,0);
  }
});
test('riesamina sessione e cliente anche dopo la risoluzione asincrona della transazione',async()=>{
  for(const change of [h=>h.current=false,h=>h.admin=false,h=>h.auth.currentUser.uid='uid-altro',h=>h.auth.currentUser.email='altro@example.test']) {
    const h=harness();h.afterTransaction=async()=>{await Promise.resolve();change(h);};
    await assert.rejects(h.read(),/Accesso o cliente cambiato/);assert.equal(h.writes,0);
  }
});
test('ogni tentativo ripetuto della transazione riesamina il contesto',async()=>{
  const h=harness(), original=h.options.db.runTransaction;
  h.options.db.runTransaction=async fn=>{await original(fn);h.current=false;return original(fn);};
  await assert.rejects(h.read(),/Accesso o cliente cambiato/);assert.equal(h.reads.length,3);
});
test('UMD espone il lettore nel browser e usa il dominio globale',async()=>{
  const sandbox={OutreachMonitoraggio:D};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../richiesta-export.js'),'utf8'),sandbox);
  assert.equal(typeof sandbox.OutreachRequestExport.read,'function');
  const h=harness();delete h.options.domain;
  const out=await sandbox.OutreachRequestExport.read(h.options,slug,'richiesta-corrente');
  assert.equal(out.request.id,'richiesta-corrente');assert.equal(h.writes,0);
});

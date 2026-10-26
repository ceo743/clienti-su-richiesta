const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const D = require('./monitoraggio-domain.js');
const f = {dal:'2026-10-01',al:'2026-10-26',settore:'',tema:'',target:''};
const person = (id, events={}, other={})=>({id,nome:'Persona '+id,ingresso:'2026-10-02',events,...other});
function state(contacts=[]) {return {...D.empty('cliente-prova'),source:'Registro verificato',verified_at:'2026-10-26T08:00:00Z',contacts};}
function full(s) {s.coverage=Object.fromEntries(D.STAGES.map(k=>[k,true]));return s;}

test('copertura parziale non diventa zero; storico luglio escluso dal periodo attuale',()=>{
  const s=state([person('luglio',{invito:'2026-07-02'},{ingresso:'2026-07-02'}),person('oggi',{invito:'2026-10-02'})]);
  const a=D.summarize(s,f); assert.equal(a.counts.invito,null);assert.equal(a.known.invito,1);assert.equal(a.contacts.length,1);
  s.coverage.invito=true;assert.equal(D.summarize(s,f).counts.invito,1);
  assert.equal(D.summarize(s,{...f,dal:'2026-10-20'}).counts.invito,0);
});
test('percentuali sulla stessa persona e date ordinate, mai somma di coorti',()=>{
  const s=full(state([person('a',{invito:'2026-10-02',accettazione:'2026-10-03'}),person('b',{invito:'2026-10-02'}),person('c',{accettazione:'2026-10-03'}),person('d',{invito:'2026-10-05',accettazione:'2026-10-03'})]));
  const r=D.summarize(s,f).rates[0];assert.equal(r.numerator,1);assert.equal(r.denominator,3);assert.equal(r.value,100/3);
  assert.equal(D.summarize(s,{...f,al:'2026-10-02'}).rates[0].value,0);
});
test('filtri settore, topic, target, periodo e chiamate seguono la stessa coorte',()=>{
  const s=full(state([person('a',{risposta:'2026-10-03'},{settore:'Medici',tema:'AI',target:'Titolari'}),person('b',{}, {settore:'Studi',tema:'AI',target:'Titolari'}),person('team',{}, {internal:true})]));
  s.calls=[{id:'call-a',contact_id:'a',creata:'2026-10-04'},{id:'call-b',contact_id:'b',creata:'2026-10-04'}];
  const r=D.summarize(s,{...f,settore:'Medici',tema:'AI',target:'Titolari'});assert.deepEqual(r.contacts.map(c=>c.id),['a']);assert.deepEqual(r.calls.map(c=>c.id),['call-a']);
  assert.equal(D.summarize(s,{...f,target:'Altro'}).contacts.length,0);
  assert.throws(()=>D.summarize(s,{...f,dal:'2026-02-31'}),/Intervallo/);
});
test('grazie non è interesse; prenotazione non è call fatta; esiti separati',()=>{
  const s=full(state([person('grazie',{risposta:'2026-10-03'},{tipo_risposta:'cortesia'}),person('call',{call_fissata:'2026-10-04'})]));
  const r=D.summarize(s,f);assert.equal(r.counts.interesse,0);assert.equal(r.counts.call_fissata,1);assert.equal(r.counts.call_fatta,0);assert.equal(r.responses.cortesia,1);
  s.contacts[1].events.call_fatta='2026-10-05';assert.throws(()=>D.validate(s,'cliente-prova'),/svolgimento/);
});
test('attesa dall’ultima risposta, esclude risposte già gestite e prossimo passo',()=>{
  const ev={risposta:'2026-10-20T09:00:00Z',interesse:'2026-10-20T09:00:00Z'};
  const s=state([person('attesa',ev),person('gestito',{...ev,nostra_risposta:'2026-10-21'}),person('azione',ev,{prossimo_passo:'Chiamare domani'}),person('chiuso',ev,{chiuso:true}),person('prenotato',{...ev,call_fissata:'2026-10-22'})]);
  assert.deepEqual(D.summarize(s,f).waiting.map(c=>[c.id,c.attesa]),[['attesa',6]]);
});
test('import isolato per cliente, fonti verificabili, niente Taplio e niente doppioni',()=>{
  const s=state([person('a')]);assert.equal(D.validateImport({slug:'cliente-prova',monitoraggio_v1:s},'cliente-prova').contacts.length,1);
  assert.throws(()=>D.validateImport({slug:'altro',monitoraggio_v1:s},'cliente-prova'),/slug/);
  assert.throws(()=>D.validateImport({slug:'cliente-prova',monitoraggio_v1:s,kpi:{}},'cliente-prova'),/slug/);
  assert.throws(()=>D.validate({...s,source:'Taplio'},'cliente-prova'),/fonte/);
  s.calls=[{id:'c',contact_id:'a',creata:'2026-10-01',source:'Foglio'}];assert.throws(()=>D.validate(s,'cliente-prova'),/fonte esplicita/);
  s.calls=[];s.contacts=[person('a',{}, {email:'persona@example.test'}),person('b',{}, {email:'PERSONA@example.test'})];assert.throws(()=>D.validate(s,'cliente-prova'),/Stessa email/);
});
test('richiesta non è invio: conferma fresca, annullamento solo locale e limite giornaliero',()=>{
  const s=state(Array.from({length:11},(_,i)=>person(String(i),{},{profilo:'https://www.linkedin.com/in/persona-'+i+'/',conversazione_verificata_il:'2026-10-26T08:00:00Z'})));const now='2026-10-26T09:00:00Z';
  assert.throws(()=>D.request(s,'0','invito','Testo','operatore@example.test',now),/nessun nuovo invito/);
  for(let i=0;i<10;i++)D.request(s,String(i),'messaggio','Testo per il target','operatore@example.test',now);
  assert.equal(s.outbox[0].stato,'richiesta');assert.equal(s.outbox[0].created_at,s.outbox[0].confirmed_at);
  assert.throws(()=>D.request(s,'10','messaggio','Testo','operatore@example.test',now),/dieci/);
  D.cancel(s,s.outbox[0].id,now);assert.equal(s.outbox[0].stato,'annullata');assert.throws(()=>D.cancel(s,s.outbox[0].id),/non è annullabile/);
  s.outbox[1].stato='inviato';assert.throws(()=>D.validate(s,'cliente-prova'),/Invio senza prova/);
});
test('le percentuali richieste da Chiara usano accettati e risposte come basi',()=>{
  const s=full(state([person('a',{invito:'2026-10-01',accettazione:'2026-10-02',risposta:'2026-10-03',call_fissata:'2026-10-04'}),person('b',{invito:'2026-10-01',accettazione:'2026-10-02'}),person('c',{invito:'2026-10-01'})]));
  const r=D.summarize(s,f).rates;
  assert.deepEqual(r.map(x=>[x.n,x.d]),[['accettazione','invito'],['risposta','accettazione'],['call_fissata','risposta']]);
  assert.equal(r[1].value,50);assert.equal(r[2].value,100);
});
test('call create nel periodo includono lead da altre fonti e ingressi precedenti',()=>{
  const s=state([person('lead',{}, {scope:'lead',ingresso:''}),person('vecchio',{}, {ingresso:'2026-07-01'})]);
  s.calls=[{id:'a',contact_id:'lead',creata:'2026-10-02'},{id:'b',contact_id:'vecchio',creata:'2026-10-03'},{id:'old',contact_id:'vecchio',creata:'2026-07-01'}];
  const r=D.summarize(s,f);assert.equal(r.contacts.length,0);assert.deepEqual(r.calls.map(x=>x.id),['a','b']);
});
test('vendita richiede prova; offerta e prenotazione non sono vendite',()=>{
  const s=state([person('a',{call_fissata:'2026-10-03'},{esito:'Offerta inviata'})]);
  assert.equal(D.summarize(s,f).known.vendita,0);
  s.contacts[0].events.vendita='2026-10-05';assert.throws(()=>D.validate(s,'cliente-prova'),/Vendita senza/);
  Object.assign(s.contacts[0],{vendita_fonte:'Registro vendite',vendita_riscontro:'Ordine confermato con identificativo verificato'});assert.ok(D.validate(s,'cliente-prova'));
});
test('invio blocca identità incompleta e conversazione scaduta',()=>{
  const s=state([person('a')]);const now='2026-10-26T09:00:00Z';
  assert.throws(()=>D.request(s,'a','messaggio','Testo','operatore@example.test',now),/conversazione/);
  s.contacts[0].conversazione_verificata_il=now;
  assert.throws(()=>D.request(s,'a','messaggio','Testo','operatore@example.test',now),/profilo/);
  assert.throws(()=>D.request(s,'a','email','Testo','operatore@example.test',now),/email verificato/);
});
test('ingresso ignoto rende i totali indisponibili anche con copertura dichiarata completa',()=>{
  const s=full(state([person('ignoto',{invito:'2026-10-02',risposta:'2026-10-04'},{ingresso:''})]));
  D.validate(s,'cliente-prova');const r=D.summarize(s,f);assert.equal(r.unknownIngress,1);assert.equal(r.counts.invito,null);assert.equal(r.counts.risposta,null);assert.equal(r.rates[0].value,null);
});
test('report comprende coorte e arretrato precedente senza dichiarare invio',()=>{
  const s=state([person('vecchio',{risposta:'2026-10-20',interesse:'2026-10-20'},{ingresso:'2026-07-03'})]);
  const r=D.report(s,f,'2026-10-26T09:00:00Z');assert.equal(r.stato,'preparato');assert.equal(r.summary.contacts.length,0);assert.equal(r.backlog.length,1);assert.equal(r.coverage.invito,false);
});
test('script dashboard e integrazione sintatticamente validi; salvataggio solo monitoraggio_v1',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
  const ui=fs.readFileSync(path.join(__dirname,'monitoraggio-ui.js'),'utf8');new vm.Script(ui);
  assert.match(ui,/transaction\.update\(ref,\{monitoraggio_v1:D\.validate\(next,slug\)\}\)/);
  assert.match(html,/monitoraggio\.stop\(\);[^\n]*stopWatchCoda\(\); stopWatchEsclusi\(\); stopAdminDaApprovare\(\)/);
});

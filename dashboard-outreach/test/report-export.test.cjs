const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const D = require('../monitoraggio-domain.js');
const E = require('../report-export.js');
const C = require('../controllo-clienti-domain.js');
const {fixture,client,filters,now} = require('./report-export-fixture.cjs');

test('genera testo e HTML completi con tutte le fasi, classificazioni, prove vendita e fonti call',()=>{
  const input=fixture(), before=JSON.stringify(input);
  const out=E.prepare(input,client,filters,now);
  assert.equal(JSON.stringify(input),before);
  assert.equal(out.report.stato,'preparato');
  assert.deepEqual(out.report.summary.counts,{invito:3,accettazione:2,primo_messaggio:1,email:1,risposta:2,interesse:1,call_fissata:1,call_fatta:1,vendita:1});
  assert.deepEqual(out.report.summary.rates.map(r=>[r.numerator,r.denominator]),[[2,3],[2,2],[1,2]]);
  assert.equal(out.report.summary.responses.cortesia,1);
  assert.equal(out.report.summary.interested.bisogno_call,1);
  assert.deepEqual(out.report.summary.calls.map(c=>c.id),['call-vendita','call-arretrato','call-lead']);
  assert.deepEqual(out.report.backlog.map(c=>[c.id,c.attesa]),[['arretrato',5]]);
  for(const text of ['VENDITE CON RISCONTRO','TEST-001','LinkedIn','Passaparola','Sito web','Operatrice prova','Avvio concordato','Altra operatrice','5 giorni','consegna']) assert.ok(out.text.includes(text),text);
  assert.ok(out.html.includes('<!doctype html>'));
  assert.ok(out.html.includes(out.text));
  assert.ok(!out.text.includes('PROVA team'));
  assert.ok(!out.text.includes('PROVA futuro'));
});
test('copertura parziale e ingresso ignoto restano indisponibili, non diventano totali zero',()=>{
  const input=fixture();input.coverage.vendita=false;
  const partial=E.prepare(input,client,filters,now);
  assert.equal(partial.report.summary.counts.vendita,null);
  assert.match(partial.text,/Vendite confermate: non disponibile; osservati 1/);
  input.contacts.push({id:'ignoto',nome:'PROVA ingresso ignoto',ingresso:'',events:{risposta:'2026-10-20',interesse:'2026-10-20'}});
  const unknown=E.prepare(input,client,filters,now);
  assert.equal(unknown.report.summary.unknownIngress,1);
  assert.ok(D.STAGES.every(k=>unknown.report.summary.counts[k]===null));
  assert.match(unknown.text,/Arretrato non ricostruibile per 1 persone/);
});
test('rilevazione assente prepara realmente un report con limiti e nessun finto totale zero',()=>{
  const out=E.prepare(null,client,filters,now);
  assert.equal(out.missing,true);
  assert.ok(D.STAGES.every(k=>out.report.summary.counts[k]===null));
  assert.match(out.text,/Nessuna rilevazione operativa disponibile/);
  assert.match(out.text,/Cortesia \/ grazie: non disponibile/);
  assert.match(out.text,/Fonte: non disponibile/);
  assert.ok(out.html.includes('nessun invio effettuato'));
});
test('filtri coorte e call, date limite Roma e rapporto a base vuota',()=>{
  const input=fixture();
  const filtered=E.prepare(input,client,{...filters,settore:'Altro'},now);
  assert.equal(filtered.report.summary.contacts.length,0);
  assert.deepEqual(filtered.report.summary.calls.map(c=>c.id),['call-lead']);
  assert.ok(filtered.report.summary.rates.every(r=>r.value===null));
  input.calls.push({id:'call-confine',contact_id:'lead-sito',creata:'2026-10-25T23:30:00Z',source:'Agenda FITTIZIA',source_evidence:'Prenotazione FITTIZIA F'});
  assert.ok(!E.prepare(input,client,filters,now).report.summary.calls.some(c=>c.id==='call-confine'));
});
test('rifiuta vendita senza prova, call senza provenienza, cliente errato e date filtro errate',()=>{
  let input=fixture();delete input.contacts[0].vendita_riscontro;
  assert.throws(()=>E.prepare(input,client,filters,now),/Vendita senza/);
  input=fixture();delete input.calls[0].source_evidence;
  assert.throws(()=>E.prepare(input,client,filters,now),/fonte esplicita/);
  assert.throws(()=>E.prepare(fixture(),{...client,slug:'altro'},filters,now),/Cliente non corrispondente/);
  assert.throws(()=>E.prepare(null,client,{...filters,dal:'2026-02-31'},now),/Intervallo/);
});
test('HTML inerte: nomi, fonti e prossime azioni codificati; niente rete o credenziali',()=>{
  const input=fixture();input.contacts[0].nome='<script>alert("x")</script>';
  const out=E.prepare(input,client,filters,now);
  assert.ok(!out.html.includes('<script>'));assert.ok(out.html.includes('&lt;script&gt;'));
  const source=fs.readFileSync(path.join(__dirname,'../report-export.js'),'utf8');
  assert.doesNotMatch(source,/fetch\(|XMLHttpRequest|https\.request|firebase|process\.env|writeFile|smtp/i);
});

// DOM minimo locale: esegue il vero handler UI e il renderer originali.
// Non simula un browser o Firebase: intercetta soltanto il salvataggio in memoria.
function uiHarness(input,control=null,editable=true) {
  const nodes=new Map();
  const box={html:'',set innerHTML(v){this.html=v;nodes.clear();},get innerHTML(){return this.html;},querySelector(selector){if(!nodes.has(selector)){const key=selector==='[data-report-dal]'?'dal':selector==='[data-report-al]'?'al':null;const value=key?this.html.match(new RegExp('data-report-'+key+' type="date" value="([^"]*)"'))?.[1]:'';nodes.set(selector,{innerHTML:'',textContent:'',className:'',disabled:false,value});}return nodes.get(selector);},querySelectorAll(){return [];}};
  let saved=null, transactions=0;
  let operators=['operatore@example.test'];
  const reads=[];
  let remote={monitoraggio_v1:input,...(control?{controllo_v1:control}:{})};
  const snapshot={exists:true,data:()=>remote};
  const ref={onSnapshot(fn){fn(snapshot);return ()=>{};}};
  const db={collection(collection){return {doc(id){return collection==='clienti'?ref:{collection,id};}};},async runTransaction(fn){transactions++;return fn({async get(target){reads.push(target===ref?'clienti':target.collection+'/'+target.id);return target===ref?snapshot:{exists:true,data:()=>({emails:target.id==='admins'?operators:['approvatore@example.test']})};},update(_ref,data){saved=data;}});}};
  class FixedDate extends Date { constructor(...args){super(...(args.length ? args : [now]));} }
  const sandbox={window:{OutreachMonitoraggio:D,OutreachReportExport:E},document:{getElementById:()=>box},Date:FixedDate,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../monitoraggio-ui.js'),'utf8'),sandbox);
  const panel=sandbox.window.createOutreachMonitoraggio({db,auth:{currentUser:{email:'operatore@example.test'}},isAdmin:()=>editable,isApprovatore:()=>editable});
  panel.open(client);
  return {box,nodes,reads,setOperators(emails){operators=emails;},setRemote(data){remote=data;},get saved(){return saved;},get transactions(){return transactions;}};
}
test('renderer originale: click effettivo genera testo completo e salva solo monitoraggio_v1 in memoria',async()=>{
  const input=fixture(), h=uiHarness(input);
  assert.match(h.box.innerHTML,/data-report/);
  // Il vero pannello usa gli ultimi trenta giorni; i dati di prova restano inclusi.
  await h.nodes.get('[data-report]').onclick();
  assert.equal(h.transactions,1);
  assert.deepEqual(h.reads,['clienti','config/admins','config/approvatori_messaggi']);
  assert.deepEqual(Object.keys(h.saved),['monitoraggio_v1']);
  const report=h.saved.monitoraggio_v1.reports.at(-1);
  assert.equal(report.stato,'preparato');
  for(const text of ['CALL CREATE NEL PERIODO','Sito web','PERSONE DELLA COORTE / RESPONSABILI / PROSSIMI PASSI','INTERESSATI IN ATTESA','Questa preparazione non costituisce un invio']) assert.ok(report.testo.includes(text),text);
  assert.match(h.nodes.get('[data-report-body]').innerHTML,/<textarea data-report-text readonly/);
  assert.match(h.nodes.get('[data-report-body]').innerHTML,/data-report-html readonly/);
  assert.ok(report.html.includes('CONTROLLO CLIENTE'));
});
test('renderer integrato: rilevazione assente prepara testo e HTML senza transazioni o monitoraggio fittizio',async()=>{
  const h=uiHarness(undefined);
  assert.match(h.box.innerHTML,/Prepara report con dati disponibili/);
  await h.nodes.get('[data-report]').onclick();
  assert.equal(h.transactions,0);
  assert.equal(h.saved,null);
  assert.match(h.nodes.get('[data-report-body]').innerHTML,/Nessuna rilevazione/);
  assert.match(h.nodes.get('[data-report-body]').innerHTML,/data-report-html/);
});
test('controllo cliente opzionale riporta fonte e date distinte, azioni e riscontro senza modificarli',()=>{
  const control={...C.empty(client.slug),fonte:'Registro controllo FITTIZIO',data_fonte:'2026-10-20',responsabile:'Responsabile test',prossimo_passo:'Verificare fonte',scadenza:'2026-10-30',esito:'Parziale',riscontro:'Documento FITTIZIO controllo-001',ultimo_controllo:'2026-10-23T08:00:00Z',controllato_da:'operatore@example.test'};
  const original=JSON.stringify(control);
  const out=E.prepare(null,{...client,controllo_v1:control},filters,now);
  for(const text of ['Registro controllo FITTIZIO','Data reale fonte controllo: 2026-10-20','Ultimo controllo: 2026-10-23','Responsabile test','Verificare fonte','2026-10-30','controllo-001']) assert.ok(out.text.includes(text),text);
  assert.equal(JSON.stringify(control),original);
  assert.equal(out.report.controllo_v1.data_fonte,'2026-10-20');
  assert.throws(()=>E.prepare(null,{...client,controllo_v1:{...control,client_slug:'altro'}},filters,now),/altro cliente/);
});
test('report presente salva snapshot controllo; conflitti monitoraggio o controllo bloccano scrittura',async()=>{
  const control=C.empty(client.slug),h=uiHarness(fixture(),control);
  await h.nodes.get('[data-report]').onclick();
  assert.equal(h.saved.monitoraggio_v1.reports.at(-1).controllo_v1.revision,0);
  for(const kind of ['monitoraggio','controllo']) {
    const input=fixture(), c=C.empty(client.slug), t=uiHarness(input,c);
    const changed=JSON.parse(JSON.stringify({monitoraggio_v1:input,controllo_v1:c}));
    if(kind==='monitoraggio') changed.monitoraggio_v1.updated_at=now;else changed.controllo_v1.revision=1;
    t.setRemote(changed);await t.nodes.get('[data-report]').onclick();
    assert.equal(t.saved,null,kind);
    assert.match(t.nodes.get('[data-status]').textContent,/aggiornat/i);
  }
});
test('sola lettura genera anteprima senza scrittura e pagina carica esportatore prima del pannello',async()=>{
  const h=uiHarness(fixture(),null,false);
  await h.nodes.get('[data-report]').onclick();assert.equal(h.transactions,0);
  assert.match(h.nodes.get('[data-report-body]').innerHTML,/data-report-text/);
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.ok(html.indexOf('report-export.js')>html.indexOf('controllo-clienti-domain.js'));
  assert.ok(html.indexOf('report-export.js')<html.indexOf('monitoraggio-ui.js'));
});
test('periodo report separato dalla coorte schermata, anche senza rilevazione: venerdì–giovedì selezionabile',async()=>{
  for(const input of [fixture(),undefined]) {
    const h=uiHarness(input),dal=h.box.querySelector('[data-report-dal]'),al=h.box.querySelector('[data-report-al]');
    const initial={dal:dal.value,al:al.value};
    assert.deepEqual(initial,{dal:'2026-09-27',al:'2026-10-26'});
    assert.match(h.box.innerHTML,/Report dal/);assert.match(h.box.innerHTML,/Report fino al/);
    dal.value='2026-10-16';al.value='2026-10-22';
    await h.nodes.get('[data-report]').onclick();
    assert.match(h.nodes.get('[data-report-body]').innerHTML,/Periodo ingresso: 2026-10-16 \/ 2026-10-22/);
    if(input) assert.equal(h.saved.monitoraggio_v1.reports.at(-1).periodo.al,'2026-10-22');
    else {assert.equal(h.transactions,0);assert.equal(h.saved,null);}
    // Riportando soltanto gli input report ai valori iniziali, il secondo output
    // deve riusare la coorte originale: il primo click non modifica filters.
    dal.value=initial.dal;al.value=initial.al;
    await h.nodes.get('[data-report]').onclick();
    assert.match(h.nodes.get('[data-report-body]').innerHTML,/Periodo ingresso: 2026-09-27 \/ 2026-10-26/);
    if(input) assert.equal(h.saved.monitoraggio_v1.reports.at(-1).periodo.dal,'2026-09-27');
    else assert.equal(h.transactions,0);
  }
});
test('handler report rifiuta date vuote, invertite e inesistenti senza salvare o lasciare anteprima vecchia',async()=>{
  for(const [dal,al] of [['','2026-10-22'],['2026-10-23','2026-10-22'],['2026-02-31','2026-10-22']]) {
    const h=uiHarness(undefined);
    h.box.querySelector('[data-report-body]').innerHTML='anteprima precedente';
    h.box.querySelector('[data-report-dal]').value=dal;h.box.querySelector('[data-report-al]').value=al;
    await h.nodes.get('[data-report]').onclick();
    assert.equal(h.transactions,0);assert.equal(h.saved,null);
    assert.equal(h.nodes.get('[data-report-body]').innerHTML,'');
    assert.match(h.nodes.get('[data-status]').textContent,/Intervallo non valido/);
  }
});
test('ruolo amministratore revocato durante il salvataggio blocca la scrittura reale',async()=>{
  const h=uiHarness(fixture());h.setOperators([]);
  await h.nodes.get('[data-report]').onclick();
  assert.equal(h.saved,null);assert.match(h.nodes.get('[data-status]').textContent,/non più amministratore/);
});
test('la coda renderizzata espone destinatario, approvatore e prove distinte senza fingere il trasporto',()=>{
  const input=fixture(),c=input.contacts[0];
  Object.assign(c,{bozza:'Testo approvato visibile',profilo:'https://www.linkedin.com/in/persona-prova/',conversazione_verificata_il:now});
  const r=D.request(input,c.id,'messaggio',c.bozza,'approvatore@example.test',now);
  const h=uiHarness(input);
  for(const text of [r.destinatario,'approvatore@example.test','Testo approvato visibile','Nessuna prova di invio','Nessuna prova distinta di consegna','registra richieste e riscontri; non trasmette messaggi','Controlla richiesta e riscontri']) assert.ok(h.box.innerHTML.includes(text),text);
  assert.doesNotMatch(h.box.innerHTML,/>Invia ora</);
});

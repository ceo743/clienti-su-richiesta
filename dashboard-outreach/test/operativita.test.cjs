const test=require('node:test'),assert=require('node:assert/strict'),D=require('../operativita-domain.js');
const slug='davide-caiazzo',now='2026-10-26T20:00:00Z',actor='ceo@example.test';
const report={id:'email-reale',funzione:'report_email',esito:'verificato',eseguito_il:'2026-10-26T19:30:00Z',fonte:'SENT e MIME RAW verificati',riscontro:'Allegato identico al report del periodo',periodo:{dal:'2026-10-16',al:'2026-10-22'},messaggio_id:'<prova@example.test>',destinatario:'chiara@example.test',sha256_html:'a'.repeat(64)};
const coordinato={...report,id:'procedura-anticipata',funzione:'report_coordinato',eseguito_il:'2026-10-26T19:31:00Z',origine:'coordinatore_reale_avvio_anticipato',esecuzione_id:'attempt-prova-1',sha256_manifest:'b'.repeat(64),sha256_ricevuta:'c'.repeat(64),sha256_raw:'d'.repeat(64),fonte:'Manifest del coordinatore, ricevuta SENT e MIME RAW verificati',riscontro:'Procedura coordinata avviata in anticipo con invio e riconciliazione reali'};
const payload=e=>({version:1,client_slug:slug,entries:e});
const canale={id:'prova-canale-ufficiale',funzione:'invio_linkedin',esito:'canale_verificato',eseguito_il:'2026-10-26T19:08:00Z',fonte:'Interfaccia ufficiale dopo l’unico invio autorizzato',riscontro:'Messaggio visibile in Sales Navigator; non partito dalla coda',destinatario:'https://www.linkedin.com/in/persona-prova/',filo:'https://www.linkedin.com/sales/lead/profilo-prova,name,prova?msgType=inmail',esecuzione_id:'intento-prova-unico'};
test('assenza di prove non significa successo',()=>assert.ok(D.summarize(null,slug).every(x=>x.latest===null)));
test('verifica del solo canale LinkedIn non dichiara collaudata la coda',()=>{
  const s=D.append(null,slug,0,payload([canale]),actor,now),before=JSON.stringify(s);
  const item=D.summarize(s,slug).find(x=>x.funzione==='invio_linkedin');
  assert.equal(item.latest.esito,'canale_verificato');
  assert.equal(D.RESULTS[item.latest.esito],'Canale di invio verificato · coda da collaudare');
  assert.equal(JSON.stringify(s),before);assert.equal(s.outbox,undefined);assert.equal(s.kpi,undefined);
  assert.equal(D.append(s,slug,1,payload([canale]),actor,now).entries.length,1);
  const thread={...canale,id:'prova-filo-messaggistica',filo:'https://www.linkedin.com/messaging/thread/filo-prova/'};
  assert.equal(D.append(null,slug,0,payload([thread]),actor,now).entries[0].esito,'canale_verificato');
});
test('la verifica del solo canale non può essere applicata ad altre funzioni',()=>{
  for(const funzione of ['controllo_clienti','report_email','report_coordinato','report_automatico','report_calendario'])assert.throws(()=>D.append(null,slug,0,payload([{...canale,funzione}]),actor,now),/esclusivamente.*LinkedIn/);
});
test('canale verificato richiede profilo, intento e filo ufficiale esatti',()=>{
  for(const filo of ['https://www.linkedin.com/in/persona-prova/','http://www.linkedin.com/sales/lead/persona','https://linkedin.com.evil.test/sales/lead/persona','https://www.linkedin.com/sales/inbox','https://evil.test/messaging/thread/persona'])assert.throws(()=>D.append(null,slug,0,payload([{...canale,filo}]),actor,now),/filo ufficiale/);
  for(const patch of [{destinatario:'persona@example.test'},{destinatario:'https://www.linkedin.com/in/persona-prova/?persona=altra'},{esecuzione_id:''}])assert.throws(()=>D.append(null,slug,0,payload([{...canale,...patch}]),actor,now),/profilo LinkedIn esatto/);
  assert.throws(()=>D.append(null,slug,0,payload([{...canale,fonte:''}]),actor,now),/fonte e riscontro/);
  assert.throws(()=>D.append(null,slug,0,payload([{...canale,riscontro:''}]),actor,now),/fonte e riscontro/);
});
test('email manuale non rende collaudato automatico',()=>{const s=D.append(null,slug,0,payload([report]),actor,now);assert.equal(D.summarize(s,slug).find(x=>x.funzione==='report_automatico').latest,null);});
test('collaudo coordinato reale resta distinto dalla partenza settimanale',()=>{
  const s=D.append(null,slug,0,payload([report,coordinato]),actor,now),items=D.summarize(s,slug);
  assert.equal(items.find(x=>x.funzione==='report_coordinato').latest.esecuzione_id,'attempt-prova-1');
  assert.equal(items.find(x=>x.funzione==='report_automatico').latest,null);
  assert.equal(items.find(x=>x.funzione==='report_automatico').title,'Partenza settimanale del report');
  assert.equal(items.find(x=>x.funzione==='report_email').latest.messaggio_id,report.messaggio_id);
});
test('una email manuale clonata non diventa prova della procedura coordinata',()=>{
  for(const origine of [undefined,'email_manuale','coordinatore_simulato']) {
    assert.throws(()=>D.append(null,slug,0,payload([report,{...report,id:'falsa-procedura',funzione:'report_coordinato',origine}]),actor,now),/coordinatore reale/);
  }
});
test('collaudo coordinato richiede attempt e tutte le impronte della catena reale',()=>{
  for(const field of ['esecuzione_id','sha256_manifest','sha256_ricevuta','sha256_raw']) {
    const candidate={...coordinato};delete candidate[field];
    assert.throws(()=>D.append(null,slug,0,payload([report,candidate]),actor,now),/tentativo effettivo|impronte/);
  }
  assert.throws(()=>D.append(null,slug,0,payload([report,{...coordinato,sha256_raw:'not-a-hash'}]),actor,now),/impronte/);
});
test('la prova coordinata deve corrispondere a email verificata, periodo e allegato esatti',()=>{
  assert.throws(()=>D.append(null,slug,0,payload([coordinato]),actor,now),/riscontro email verificato/);
  for(const patch of [{messaggio_id:'<altra@example.test>'},{destinatario:'altra@example.test'},{sha256_html:'e'.repeat(64)},{periodo:{dal:'2026-10-09',al:'2026-10-15'}},{eseguito_il:'2026-10-26T19:29:00Z'}]){
    assert.throws(()=>D.append(null,slug,0,payload([report,{...coordinato,...patch}]),actor,now),/riscontro email verificato/);
  }
  assert.throws(()=>D.append(null,slug,0,payload([{...report,esito:'simulato'},coordinato]),actor,now),/riscontro email verificato/);
});
test('tentativi o messaggi clonati non diventano più collaudi coordinati',()=>{
  const s=D.append(null,slug,0,payload([report,coordinato]),actor,now);
  assert.throws(()=>D.append(s,slug,1,payload([{...coordinato,id:'clone-stesso-tentativo'}]),actor,now),/già registrato con un’altra prova/);
  assert.throws(()=>D.append(s,slug,1,payload([{...coordinato,id:'clone-stesso-messaggio',esecuzione_id:'attempt-prova-2'}]),actor,now),/già registrato con un’altra prova/);
  const again=D.append(s,slug,1,payload([coordinato]),actor,now);assert.equal(again.entries.length,2);
  const reordered={...coordinato,periodo:{al:coordinato.periodo.al,dal:coordinato.periodo.dal}};
  assert.equal(D.append(again,slug,2,payload([reordered]),actor,now).entries.length,2);
});
test('il form manuale non promuove email manuali a collaudo automatico',()=>{assert.throws(()=>D.append(null,slug,0,payload([{...report,id:'auto',funzione:'report_automatico',esecuzione_id:'run-1'}]),actor,now),/modulo manuale/);assert.throws(()=>D.append(null,slug,0,payload([report,{...report,id:'auto',funzione:'report_automatico',esecuzione_id:'run-1'}]),actor,now),/modulo manuale/);});
test('nemmeno il collaudo coordinato permette al form di dichiarare partita la settimana',()=>{
  const s=D.append(null,slug,0,payload([report,coordinato]),actor,now);
  assert.throws(()=>D.append(s,slug,1,payload([{...coordinato,id:'promozione-calendario',funzione:'report_automatico'}]),actor,now),/modulo manuale/);
  assert.equal(D.summarize(s,slug).find(x=>x.funzione==='report_automatico').latest,null);
});
test('la pagina distingue procedura anticipata, email e partenza settimanale con prove e date',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const s=D.append(null,slug,0,payload([report,coordinato]),actor,now);
  const box={innerHTML:'',querySelector:()=>null};
  const db={collection:()=>({doc:()=>({onSnapshot:fn=>{fn({data:()=>({operativita_v1:s})});return ()=>{};}})})};
  const context={window:{OutreachOperativita:D},document:{getElementById:()=>box},Date,JSON,Error};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../operativita-ui.js'),'utf8'),context);
  context.window.createOutreachOperativita({db,auth:{currentUser:{email:actor}},isAdmin:()=>false}).open({slug});
  for(const text of ['Report via email','Procedura report · collaudo reale anticipato','Partenza settimanale del report','non certifica la partenza del calendario settimanale','coordinatore reale avviato in anticipo','attempt-prova-1',coordinato.sha256_manifest,coordinato.sha256_ricevuta,coordinato.sha256_raw,'26/10/2026'])assert.ok(box.innerHTML.includes(text),text);
  assert.match(box.innerHTML,/<h4>Partenza settimanale del report<\/h4><p><strong>Da collaudare/);
  assert.doesNotMatch(box.innerHTML,/data-operativita-save/);
});
test('nessun report verificato senza allegato e periodo',()=>assert.throws(()=>D.append(null,slug,0,payload([{...report,sha256_html:''}]),actor,now),/prova email/));
test('registro errato, revisione concorrente e prova futura rifiutati',()=>{assert.throws(()=>D.append(null,slug,1,payload([report]),actor,now),/altro operatore/);assert.throws(()=>D.append(null,slug,0,{...payload([report]),client_slug:'altro'},actor,now),/cliente aperto/);assert.throws(()=>D.append(null,slug,0,payload([{...report,eseguito_il:'2027-01-01'}]),actor,now),/futura/);});
test('ritrasmettere lo stesso identificativo non duplica o sovrascrive',()=>{const s=D.append(null,slug,0,payload([report]),actor,now),again=D.append(s,slug,1,payload([report]),actor,now);assert.equal(again.entries.length,1);assert.throws(()=>D.append(s,slug,1,payload([{...report,riscontro:'Altro'}]),actor,now),/contenuto diverso/);});
test('idempotenza della prova resta valida dopo riordino map Firestore',()=>{const s=D.append(null,slug,0,payload([report]),actor,now);s.entries[0].periodo={al:report.periodo.al,dal:report.periodo.dal};const again=D.append(s,slug,1,payload([report]),actor,now);assert.equal(again.entries.length,1);});
test('simulazioni rimangono distinguibili e un blocco non è un invio',()=>{const s=D.append(null,slug,0,payload([{id:'blocco',funzione:'invio_linkedin',esito:'bloccato',eseguito_il:now,fonte:'Interfaccia ufficiale',riscontro:'Compositore non disponibile'}]),actor,now);assert.equal(D.summarize(s,slug).find(x=>x.funzione==='invio_linkedin').latest.esito,'bloccato');});
test('gli aggiornamenti concorrenti non cancellano la bozza del riscontro',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');let callback,draws=0;
  const input={value:''},reviewed={checked:false},status={},button={};
  const box={set innerHTML(value){draws++;this.html=value;},get innerHTML(){return this.html;},querySelector(selector){return {'[data-operativita-input]':input,'[data-operativita-reviewed]':reviewed,'[data-operativita-save]':button,'[data-operativita-status]':status}[selector]||null;}};
  const context={window:{OutreachOperativita:D},document:{getElementById:()=>box},Date,JSON,Error};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../operativita-ui.js'),'utf8'),context);
  const db={collection:()=>({doc:()=>({onSnapshot:fn=>{callback=fn;return ()=>{};}})})};
  context.window.createOutreachOperativita({db,auth:{currentUser:{email:actor}},isAdmin:()=>true}).open({slug});
  callback({data:()=>({})});const before=draws;input.value='bozza da conservare';reviewed.checked=true;
  callback({data:()=>({controllo_v1:{revision:20}})});assert.equal(draws,before);assert.equal(input.value,'bozza da conservare');
  const next=D.append(null,slug,0,payload([report]),actor,now);callback({data:()=>({operativita_v1:next})});
  assert.equal(draws,before);assert.equal(input.value,'bozza da conservare');assert.match(status.textContent,/bozza è conservata/);
});

function pendingUiSave(){
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  let callback,draws=0,nodes={},resolveCommit,rejectCommit;
  const writes=[],commit=new Promise((resolve,reject)=>{resolveCommit=resolve;rejectCommit=reject;});
  const box={
    set innerHTML(value){
      draws++;this.html=value;
      nodes={
        '[data-operativita-input]':{value:''},
        '[data-operativita-reviewed]':{checked:false},
        '[data-operativita-save]':{disabled:false},
        '[data-operativita-status]':{}
      };
    },
    get innerHTML(){return this.html;},
    querySelector(selector){return nodes[selector]||null;}
  };
  const ref={onSnapshot:fn=>{callback=fn;return ()=>{};}};
  const db={
    collection:()=>({doc:()=>ref}),
    runTransaction:async work=>{
      await work({get:async()=>({exists:true,data:()=>({})}),update:(target,value)=>{assert.equal(target,ref);writes.push(value.operativita_v1);}});
      return commit;
    }
  };
  const context={window:{OutreachOperativita:D},document:{getElementById:()=>box},Date,JSON,Error};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../operativita-ui.js'),'utf8'),context);
  context.window.createOutreachOperativita({db,auth:{currentUser:{email:actor}},isAdmin:()=>true}).open({slug});
  callback({data:()=>({})});
  const draft=JSON.stringify(payload([report]));
  nodes['[data-operativita-input]'].value=draft;
  nodes['[data-operativita-reviewed]'].checked=true;
  return {
    start:()=>nodes['[data-operativita-save]'].onclick(),
    snapshot:state=>callback({data:()=>({operativita_v1:state})}),
    resolve:()=>resolveCommit(),reject:error=>rejectCommit(error),
    node:selector=>nodes[selector],draws:()=>draws,writes,box,draft
  };
}

test('snapshot esterno durante il salvataggio e rigetto conservano bozza ed errore visibile',async()=>{
  const h=pendingUiSave(),before=h.draws(),save=h.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.writes.length,1,'transazione sospesa dopo aver calcolato il proprio risultato');
  assert.equal(h.node('[data-operativita-save]').disabled,true);
  const external=D.append(null,slug,0,payload([{...report,id:'salvato-da-altro-operatore'}]),'altro@example.test',now);
  h.snapshot(external);
  assert.equal(h.draws(),before,'lo snapshot esterno non deve ridisegnare il modulo pendente');
  assert.equal(h.node('[data-operativita-input]').value,h.draft);
  assert.equal(h.node('[data-operativita-reviewed]').checked,true);
  assert.match(h.node('[data-operativita-status]').textContent,/bozza è conservata/);
  h.reject(new Error('Registro aggiornato da un altro operatore.'));
  await save;
  assert.equal(h.draws(),before);
  assert.equal(h.node('[data-operativita-input]').value,h.draft);
  assert.match(h.node('[data-operativita-status]').textContent,/Registro aggiornato/);
  assert.equal(h.node('[data-operativita-status]').className,'msg err');
  assert.equal(h.node('[data-operativita-save]').disabled,false);
});

test('lo snapshot proprio dopo la risoluzione della transazione aggiorna il registro senza falso conflitto',async()=>{
  const h=pendingUiSave(),before=h.draws(),save=h.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.writes.length,1);
  h.resolve();await save;
  assert.equal(h.draws(),before,'la risoluzione da sola non deve cancellare la bozza prima dello snapshot');
  assert.equal(h.node('[data-operativita-input]').value,h.draft);
  h.snapshot(h.writes[0]);
  assert.equal(h.draws(),before+1,'la firma propria deve essere riconosciuta anche dopo la promise');
  assert.equal(h.node('[data-operativita-input]').value,'');
  assert.equal(h.node('[data-operativita-reviewed]').checked,false);
  assert.equal(h.node('[data-operativita-status]').textContent,undefined);
  assert.match(h.box.innerHTML,/email-reale/);
});

test('lo snapshot proprio riconosce le chiavi map riordinate ricorsivamente da Firestore',async()=>{
  const h=pendingUiSave(),before=h.draws(),save=h.start();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.writes.length,1);
  h.resolve();await save;
  const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reorder(value[key])])):value;
  const snapshot=reorder(h.writes[0]);
  assert.deepEqual(snapshot,h.writes[0],'il riordino non cambia valori o ordine degli array');
  assert.notEqual(JSON.stringify(snapshot),JSON.stringify(h.writes[0]),'il caso deve cambiare effettivamente l’ordine delle chiavi');
  assert.notDeepEqual(Object.keys(snapshot.entries[0].periodo),Object.keys(h.writes[0].entries[0].periodo),'anche le map annidate devono avere ordine diverso');
  h.snapshot(snapshot);
  assert.equal(h.draws(),before+1);
  assert.equal(h.node('[data-operativita-input]').value,'');
  assert.equal(h.node('[data-operativita-reviewed]').checked,false);
  assert.equal(h.node('[data-operativita-status]').textContent,undefined);
  assert.match(h.box.innerHTML,/email-reale/);
});

const calendario={id:'calendario-reale',funzione:'report_calendario',esito:'verificato',eseguito_il:'2026-10-26T19:40:00Z',fonte:'Evento reale, ricevuta e ripristino riletti',riscontro:'Il calendario ha saltato il report già spedito',periodo:{dal:'2026-10-16',al:'2026-10-22'},origine:'heartbeat_reale_report_gia_inviato',automazione_id:'dashboard-linkedin-report-settimanale-chiara',esecuzione_id:'heartbeat-reale-prova-1',sha256_evento:'1'.repeat(64),sha256_ricevuta:'2'.repeat(64),sha256_ripristino:'3'.repeat(64),ripristino_rrule:'FREQ=WEEKLY;BYDAY=FR;BYHOUR=11;BYMINUTE=0;BYSECOND=0'};
test('avvio reale del calendario con deduplicazione si registra senza una nuova email',()=>{
  const state=D.append(null,slug,0,payload([calendario]),actor,now),items=D.summarize(state,slug);
  assert.equal(items.find(x=>x.funzione==='report_calendario').title,'Avvio automatico · controllo anti-duplicato');
  assert.equal(items.find(x=>x.funzione==='report_calendario').latest.esito,'verificato');
  for(const funzione of ['report_email','report_coordinato','report_automatico'])assert.equal(items.find(x=>x.funzione===funzione).latest,null);
  for(const field of ['messaggio_id','destinatario','sha256_html'])assert.equal(Object.hasOwn(state.entries[0],field),false);
  assert.equal(state.revision,1);assert.equal(state.entries[0].registrato_da,actor);
});
test('calendario verificato richiede cliente, origine e automazione esatti',()=>{
  for(const candidate of [{...calendario,origine:undefined},{...calendario,origine:'email_manuale'},{...calendario,automazione_id:undefined},{...calendario,automazione_id:'altro-job'}])assert.throws(()=>D.append(null,slug,0,payload([candidate]),actor,now),/cliente, origine e automazione/);
  assert.throws(()=>D.append(null,'altro-cliente',0,{version:1,client_slug:'altro-cliente',entries:[calendario]},actor,now),/cliente, origine e automazione/);
});
test('calendario verificato richiede esecuzione, periodo e tutte le impronte valide',()=>{
  for(const field of ['esecuzione_id','periodo','sha256_evento','sha256_ricevuta','sha256_ripristino']){
    const candidate={...calendario};delete candidate[field];
    assert.throws(()=>D.append(null,slug,0,payload([candidate]),actor,now),/esecuzione reale|impronte/);
  }
  for(const field of ['sha256_evento','sha256_ricevuta','sha256_ripristino'])for(const value of ['', 'x'.repeat(64),'a'.repeat(63),['a'.repeat(64)]])assert.throws(()=>D.append(null,slug,0,payload([{...calendario,[field]:value}]),actor,now),/impronte/);
  for(const periodo of [{dal:'2026-02-30',al:'2026-03-01'},{dal:'2026-10-22',al:'2026-10-16'},{}])assert.throws(()=>D.append(null,slug,0,payload([{...calendario,periodo}]),actor,now),/Periodo/);
  assert.throws(()=>D.append(null,slug,0,payload([{...calendario,esecuzione_id:' '}]),actor,now),/esecuzione reale/);
});
test('il ripristino del calendario deve coincidere esattamente con la cadenza prevista',()=>{
  for(const ripristino_rrule of [undefined,'','FREQ=DAILY','FREQ=WEEKLY;BYDAY=FR;BYHOUR=12;BYMINUTE=0;BYSECOND=0',calendario.ripristino_rrule+';COUNT=1'])assert.throws(()=>D.append(null,slug,0,payload([{...calendario,ripristino_rrule}]),actor,now),/ripristino settimanale esatto/);
});
test('il riscontro del calendario rifiuta sempre i campi di una nuova email',()=>{
  for(const field of ['messaggio_id','destinatario','sha256_html'])for(const value of [report[field],'',null])for(const esito of ['verificato','bloccato'])assert.throws(()=>D.append(null,slug,0,payload([{...calendario,esito,[field]:value}]),actor,now),/campi email non ammessi/);
  for(const funzione of ['report_email','report_coordinato'])assert.throws(()=>D.append(null,slug,0,payload([{...calendario,funzione}]),actor,now),/campi del calendario/);
  assert.throws(()=>D.append(null,slug,0,payload([{...calendario,token:'segreto'}]),actor,now),/Campi non ammessi/);
});
test('calendario idempotente per id e ordine delle map, senza clonare run o evento',()=>{
  const state=D.append(null,slug,0,payload([calendario]),actor,now);
  const reordered={...calendario,periodo:{al:calendario.periodo.al,dal:calendario.periodo.dal}};
  const again=D.append(state,slug,1,payload([reordered]),actor,now);assert.equal(again.entries.length,1);assert.equal(again.revision,2);
  assert.throws(()=>D.append(state,slug,1,payload([{...calendario,id:'clone-run',sha256_evento:'4'.repeat(64)}]),actor,now),/calendario già registrato/);
  assert.throws(()=>D.append(state,slug,1,payload([{...calendario,id:'clone-evento',esecuzione_id:'altro-run'}]),actor,now),/calendario già registrato/);
  assert.throws(()=>D.append(state,slug,1,payload([{...calendario,riscontro:'Altro'}]),actor,now),/contenuto diverso/);
  assert.throws(()=>D.append(state,slug,0,payload([calendario]),actor,now),/altro operatore/);
});
test('la prova calendario non sblocca il report automatico dal modulo manuale',()=>{
  const state=D.append(null,slug,0,payload([calendario]),actor,now);
  assert.throws(()=>D.append(state,slug,1,payload([{...report,funzione:'report_automatico',esecuzione_id:calendario.esecuzione_id}]),actor,now),/modulo manuale/);
  assert.throws(()=>D.append(state,slug,1,payload([{...calendario,id:'promosso',funzione:'report_automatico'}]),actor,now),/modulo manuale/);
  assert.equal(D.summarize(state,slug).find(x=>x.funzione==='report_automatico').latest,null);
});
test('la pagina mostra prove calendario e limiti senza presentarle come nuova email',()=>{
  const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
  const state=D.append(null,slug,0,payload([calendario]),actor,now),box={innerHTML:'',querySelector:()=>null};
  const db={collection:()=>({doc:()=>({onSnapshot:fn=>{fn({data:()=>({operativita_v1:state})});return ()=>{};}})})};
  const context={window:{OutreachOperativita:D},document:{getElementById:()=>box},Date,JSON,Error};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../operativita-ui.js'),'utf8'),context);
  context.window.createOutreachOperativita({db,auth:{currentUser:{email:actor}},isAdmin:()=>false}).open({slug});
  for(const text of ['Avvio automatico · controllo anti-duplicato','Il giro ha saltato il report già spedito','non prova un nuovo invio della settimana successiva',calendario.origine,calendario.automazione_id,calendario.esecuzione_id,calendario.sha256_evento,calendario.sha256_ricevuta,calendario.sha256_ripristino,calendario.ripristino_rrule])assert.ok(box.innerHTML.includes(text),text);
  assert.match(box.innerHTML,/<h4>Report via email<\/h4><p><strong>Da collaudare/);
  assert.match(box.innerHTML,/<h4>Partenza settimanale del report<\/h4><p><strong>Da collaudare/);
  assert.doesNotMatch(box.innerHTML,/data-operativita-save/);
});

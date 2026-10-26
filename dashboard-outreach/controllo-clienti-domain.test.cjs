const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const D=require('./controllo-clienti-domain.js');
const now='2026-10-26T10:00:00.000Z';
const actor='operatore@example.test';
const fields=(overrides={})=>Object.fromEntries(D.CAMPI.map(k=>[k,({stato:'in_corso',fonte:'Verbale revisione cliente',data_fonte:'2026-10-22',responsabile:'Responsabile cliente',prossimo_passo:'Controllare riscontro',scadenza:'2026-10-30',esito:'Esaminato',riscontro:'Verbale revisione del 22 ottobre, paragrafo clienti',...overrides})[k]]));
function database(initial) {
  let value=structuredClone(initial), writes=[];
  const db={collection:name=>{assert.equal(name,'clienti');return {doc:slug=>({slug})};},runTransaction:async callback=>callback({get:async ref=>({exists:true,data:()=>structuredClone(value)}),update:(ref,patch)=>{writes.push({slug:ref.slug,patch:structuredClone(patch)});value={...value,...structuredClone(patch)};}})};
  return {db,writes,value:()=>value};
}
const commitOptions=(db,overrides={})=>({db,slug:'cliente-a',expectedRevision:0,fields:fields(),actor,now,reviewed:false,canEdit:()=>true,isCurrent:()=>true,...overrides});
test('nuovo cliente resta da controllare e non eredita la data storica',()=>{
  const s=D.summary({slug:'cliente-a',aggiornato:'2026-07-20',kpi:{da_approvare:8}});
  assert.equal(s.control.stato,'da_controllare');assert.equal(s.control.data_fonte,'');assert.equal(s.control.ultimo_controllo,'');assert.equal(s.requests,null);
});
test('salvataggio e controllo sono azioni distinte',()=>{
  const next=D.prepare(null,'cliente-a',0,fields(),actor,now,false);
  assert.equal(next.updated_at,now);assert.equal(next.ultimo_controllo,'');assert.equal(next.data_fonte,'2026-10-22');assert.equal(next.revision,1);
  const checked=D.prepare(next,'cliente-a',1,fields(),actor,now,true);
  assert.equal(checked.ultimo_controllo,now);assert.equal(checked.controllato_da,actor);assert.equal(checked.data_fonte,'2026-10-22');
});
test('verificato richiede conferma fresca, fonte, data, esito e riscontro',()=>{
  const good=fields({stato:'verificato'});
  assert.throws(()=>D.prepare(null,'cliente-a',0,good,actor,now,false),/Conferma/);
  for(const key of ['fonte','data_fonte','esito','riscontro'])assert.throws(()=>D.prepare(null,'cliente-a',0,{...good,[key]:''},actor,now,true));
  const verified=D.prepare(null,'cliente-a',0,good,actor,now,true);assert.equal(verified.stato,'verificato');
  assert.throws(()=>D.prepare(verified,'cliente-a',1,good,actor,now,false),/Conferma/);
});
test('data reale futura o inesistente, slug e campi estranei sono respinti',()=>{
  for(const data_fonte of ['2026-10-27','2026-02-30'])assert.throws(()=>D.prepare(null,'cliente-a',0,fields({data_fonte}),actor,now,false));
  assert.throws(()=>D.prepare(null,'cliente-a',0,{...fields(),nome:'Nome alterato'},actor,now,false),/non ammessi/);
  assert.throws(()=>D.validate(D.empty('cliente-b'),'cliente-a'),/altro cliente/);
});
test('date e scadenze usano il giorno italiano anche dopo mezzanotte',()=>{
  const midnight='2026-10-25T23:30:00.000Z';
  assert.equal(D.dayInRome(midnight),'2026-10-26');
  assert.equal(D.prepare(null,'cliente-a',0,fields({data_fonte:'2026-10-26'}),actor,midnight,false).data_fonte,'2026-10-26');
});
test('non sovrascrive modifiche concorrenti o altre parti del documento',async()=>{
  const original={nome:'Cliente originale',brand:'Brand originale',kpi:{inviti_totali:77},monitoraggio_v1:{outbox:[]},custom:{keep:true}};
  const storage=database(original);
  await D.commit(commitOptions(storage.db));
  assert.deepEqual(Object.keys(storage.writes[0].patch),['controllo_v1']);
  for(const key of Object.keys(original))assert.deepEqual(storage.value()[key],original[key]);
  await assert.rejects(D.commit(commitOptions(storage.db)),/altro operatore/);
  assert.equal(storage.writes.length,1);
});
test('il contenitore controllo conserva campi sconosciuti preesistenti',()=>{
  const raw={...D.empty('cliente-a'),future_field:{keep:true}};
  const next=D.prepare(raw,'cliente-a',0,fields(),actor,now,false);assert.deepEqual(next.future_field,{keep:true});
});
test('controllo di autorizzazione prima e dopo lettura transazionale',async()=>{
  const storage=database({});
  await assert.rejects(D.commit(commitOptions(storage.db,{canEdit:()=>false})),/non autorizzata/);
  let checks=0;
  await assert.rejects(D.commit(commitOptions(storage.db,{isCurrent:()=>++checks<3})),/cliente cambiato/);
  assert.equal(storage.writes.length,0);
});
test('cambio cliente e documento eliminato non scrivono',async()=>{
  const storage=database({});
  await assert.rejects(D.commit(commitOptions(storage.db,{isCurrent:()=>false})),/cliente cambiato/);
  const db={...storage.db,runTransaction:async f=>f({get:async()=>({exists:false}),update:()=>assert.fail('scrittura vietata')})};
  await assert.rejects(D.commit(commitOptions(db)),/non più disponibile/);
});
test('richieste nuove isolate dal cliente e dalle approvazioni legacy',()=>{
  const monitoraggio_v1={version:1,client_slug:'cliente-a',outbox:[{stato:'richiesta'},{stato:'annullata'},{stato:'inviato'}]};
  assert.equal(D.summary({slug:'cliente-a',monitoraggio_v1,kpi:{da_approvare:8}}).requests,1);
  assert.equal(D.summary({slug:'cliente-b',monitoraggio_v1}).requests,null);
  const controllo_v1=D.prepare(null,'cliente-a',0,fields({scadenza:'2026-10-01'}),actor,now,false);
  assert.equal(D.summary({slug:'cliente-a',controllo_v1},'2026-10-26').overdue,true);
});
function uiHarness(admin=false,approver=false) {
  const blocks={controlloCliente:{innerHTML:'',querySelector:()=>null},controlloClienti:{innerHTML:'',querySelectorAll:()=>[]}};
  const listeners=[];
  const db={collection:()=>({doc:slug=>({onSnapshot:callback=>{const listener={slug,callback,stopped:false};listeners.push(listener);return ()=>listener.stopped=true;}}),onSnapshot:callback=>{const listener={overview:true,callback,stopped:false};listeners.push(listener);return ()=>listener.stopped=true;}})};
  const context={window:{OutreachControlloClienti:D},document:{getElementById:id=>blocks[id]},Date,FormData,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'controllo-clienti-ui.js'),'utf8'),context);
  const api=context.window.createOutreachControlloClienti({db,auth:{currentUser:{email:actor}},isAdmin:()=>admin,isApprovatore:()=>approver,openClient:()=>{}});
  const publish=(i,data)=>listeners[i].callback({exists:true,data:()=>data});
  return {blocks,listeners,api,publish};
}
test('vista cliente non rivela il cliente precedente dopo il cambio o logout',()=>{
  const h=uiHarness(true);h.api.open({slug:'cliente-a',nome:'Cliente A'});h.publish(0,{nome:'Cliente A'});
  assert.match(h.blocks.controlloCliente.innerHTML,/Cliente A/);
  h.api.open({slug:'cliente-b',nome:'Cliente B'});h.publish(1,{nome:'Cliente B'});h.publish(0,{nome:'Cliente A fuori tempo'});
  assert.match(h.blocks.controlloCliente.innerHTML,/Cliente B/);assert.doesNotMatch(h.blocks.controlloCliente.innerHTML,/Cliente A/);assert.equal(h.listeners[0].stopped,true);
  h.api.stop();h.publish(1,{nome:'Cliente B fuori tempo'});assert.equal(h.blocks.controlloCliente.innerHTML,'');
});
test('cliente ordinario in sola lettura, amministratore e approvatore possono aprire modifica',()=>{
  for(const [admin,approver,editable] of [[false,false,false],[true,false,true],[false,true,true]]){
    const h=uiHarness(admin,approver);h.api.open({slug:'cliente-a',nome:'Cliente A'});h.publish(0,{nome:'Cliente A'});
    assert.equal(h.blocks.controlloCliente.innerHTML.includes('data-control-edit>'),editable);
  }
});
test('testo cliente è escapato e le date mancanti restano non disponibili',()=>{
  const h=uiHarness();h.api.open({slug:'cliente-a',nome:'<img src=x onerror=alert(1)>'});h.publish(0,{nome:'<img src=x onerror=alert(1)>'});
  assert.doesNotMatch(h.blocks.controlloCliente.innerHTML,/<img/);assert.match(h.blocks.controlloCliente.innerHTML,/&lt;img/);assert.match(h.blocks.controlloCliente.innerHTML,/Non disponibile/);
});
test('integrazione esistente mantiene la coda storica senza azioni di scrittura',()=>{
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  assert.match(html,/id="controlloClienti"/);assert.match(html,/id="controlloCliente"/);assert.match(html,/controllo-clienti-ui.js/);
  const legacy=html.slice(html.indexOf('function renderEsclusi'),html.indexOf('let __toastTimer'));
  assert.doesNotMatch(legacy,/\.update\(|data-act=/);assert.match(legacy,/readonly/);assert.match(html,/Coda storica messaggi/);
  for(const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]))new vm.Script(script);
});

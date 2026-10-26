const test=require('node:test'),assert=require('node:assert/strict'),D=require('../operativita-domain.js');
const slug='davide-caiazzo',now='2026-10-26T20:00:00Z',actor='ceo@example.test';
const report={id:'email-reale',funzione:'report_email',esito:'verificato',eseguito_il:'2026-10-26T19:30:00Z',fonte:'SENT e MIME RAW verificati',riscontro:'Allegato identico al report del periodo',periodo:{dal:'2026-10-16',al:'2026-10-22'},messaggio_id:'<prova@example.test>',destinatario:'chiara@example.test',sha256_html:'a'.repeat(64)};
const payload=e=>({version:1,client_slug:slug,entries:e});
test('assenza di prove non significa successo',()=>assert.ok(D.summarize(null,slug).every(x=>x.latest===null)));
test('email manuale non rende collaudato automatico',()=>{const s=D.append(null,slug,0,payload([report]),actor,now);assert.equal(D.summarize(s,slug).find(x=>x.funzione==='report_automatico').latest,null);});
test('il form manuale non promuove email manuali a collaudo automatico',()=>{assert.throws(()=>D.append(null,slug,0,payload([{...report,id:'auto',funzione:'report_automatico',esecuzione_id:'run-1'}]),actor,now),/modulo manuale/);assert.throws(()=>D.append(null,slug,0,payload([report,{...report,id:'auto',funzione:'report_automatico',esecuzione_id:'run-1'}]),actor,now),/modulo manuale/);});
test('nessun report verificato senza allegato e periodo',()=>assert.throws(()=>D.append(null,slug,0,payload([{...report,sha256_html:''}]),actor,now),/prova email/));
test('registro errato, revisione concorrente e prova futura rifiutati',()=>{assert.throws(()=>D.append(null,slug,1,payload([report]),actor,now),/altro operatore/);assert.throws(()=>D.append(null,slug,0,{...payload([report]),client_slug:'altro'},actor,now),/cliente aperto/);assert.throws(()=>D.append(null,slug,0,payload([{...report,eseguito_il:'2027-01-01'}]),actor,now),/futura/);});
test('ritrasmettere lo stesso identificativo non duplica o sovrascrive',()=>{const s=D.append(null,slug,0,payload([report]),actor,now),again=D.append(s,slug,1,payload([report]),actor,now);assert.equal(again.entries.length,1);assert.throws(()=>D.append(s,slug,1,payload([{...report,riscontro:'Altro'}]),actor,now),/contenuto diverso/);});
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

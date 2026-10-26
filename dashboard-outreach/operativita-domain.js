/* Registro delle prove operative: nessun trasporto esterno e nessuna credenziale. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OutreachOperativita=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const TYPES={controllo_clienti:'Controllo clienti',invio_linkedin:'Invii LinkedIn',report_email:'Report via email',report_automatico:'Report automatico'};
  const RESULTS={verificato:'Prova reale registrata',bloccato:'Bloccato',incerto:'Esito da verificare',simulato:'Solo simulazione'};
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const timestamp=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
  const text=(x,n=2000)=>typeof x==='string'&&x.trim().length>0&&x.length<=n;
  const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  const date=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'')&&timestamp(x)&&new Date(x).toISOString().slice(0,10)===x;
  const empty=slug=>({version:1,client_slug:slug,revision:0,entries:[],updated_at:'',updated_by:''});
  function validate(raw,slug){
    assert(raw&&raw.version===1&&raw.client_slug===slug&&/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug),'Registro di un altro cliente.');
    assert(Number.isSafeInteger(raw.revision)&&raw.revision>=0&&Array.isArray(raw.entries)&&raw.entries.length<=100,'Registro operativo non valido.');
    const ids=new Set();
    for(const e of raw.entries){
      assert(text(e.id,200)&&!ids.has(e.id),'Identificativo prova duplicato.');ids.add(e.id);
      assert(Object.hasOwn(TYPES,e.funzione)&&Object.hasOwn(RESULTS,e.esito),'Funzione o esito non valido.');
      assert(timestamp(e.eseguito_il)&&timestamp(e.registrato_il)&&text(e.registrato_da,320),'Data o operatore della prova mancante.');
      assert(text(e.fonte)&&text(e.riscontro),'Ogni esito richiede fonte e riscontro rintracciabile.');
      if(e.periodo)assert(date(e.periodo.dal)&&date(e.periodo.al)&&e.periodo.dal<=e.periodo.al,'Periodo della prova non valido.');
      if(e.esito==='verificato'&&['report_email','report_automatico'].includes(e.funzione)){
        assert(text(e.messaggio_id,320)&&text(e.destinatario,320)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.destinatario)&&/^[a-f0-9]{64}$/.test(e.sha256_html||'')&&e.periodo,'Report senza prova email e allegato.');
      }
      if(e.esito==='verificato'&&e.funzione==='invio_linkedin')assert(/^https:\/\/www\.linkedin\.com\/messaging\/thread\/[^\s]+$/.test(e.filo||'')&&text(e.destinatario,1000),'Invio LinkedIn senza filo e destinatario.');
      if(e.esito==='verificato'&&e.funzione==='report_automatico'){
        assert(text(e.esecuzione_id,200),'Manca il riferimento alla vera esecuzione automatica.');
        assert(raw.entries.some(p=>p.funzione==='report_email'&&p.esito==='verificato'&&p.messaggio_id===e.messaggio_id&&p.sha256_html===e.sha256_html&&p.destinatario===e.destinatario&&p.periodo?.dal===e.periodo.dal&&p.periodo?.al===e.periodo.al),'Prima registrare il riscontro email della stessa esecuzione.');
      }
    }
    assert(JSON.stringify(raw).length<200000,'Registro troppo grande.');
    return JSON.parse(JSON.stringify(raw));
  }
  function append(raw,slug,expected,payload,actor,now=new Date().toISOString()){
    const state=raw?validate(raw,slug):empty(slug);
    assert(state.revision===expected,'Registro aggiornato da un altro operatore: riapri prima di salvare.');
    assert(text(actor,320)&&timestamp(now),'Accesso o data non validi.');
    assert(payload&&payload.version===1&&payload.client_slug===slug&&Array.isArray(payload.entries)&&payload.entries.length>0&&payload.entries.length<=10,'Indicare le prove del solo cliente aperto.');
    const fields=['id','funzione','esito','eseguito_il','fonte','riscontro','periodo','messaggio_id','destinatario','sha256_html','filo','esecuzione_id'];
    for(const entry of payload.entries){
      assert(entry&&Object.keys(entry).every(k=>fields.includes(k)),'Campi non ammessi nella prova.');
      assert(!(entry.funzione==='report_automatico'&&entry.esito==='verificato'),'Il modulo manuale non certifica la partenza automatica: serve un riscontro del processo automatico distinto.');
      assert(timestamp(entry.eseguito_il)&&Date.parse(entry.eseguito_il)<=Date.parse(now),'La prova non può essere futura.');
      const prior=state.entries.find(e=>e.id===entry.id);
      if(prior){assert(fields.every(k=>stable(prior[k])===stable(entry[k])),'Prova già registrata con contenuto diverso.');continue;}
      state.entries.push({...entry,registrato_il:now,registrato_da:actor});
    }
    state.revision++;state.updated_at=now;state.updated_by=actor;return validate(state,slug);
  }
  function summarize(raw,slug){const state=raw?validate(raw,slug):empty(slug);return Object.keys(TYPES).map(funzione=>({funzione,title:TYPES[funzione],latest:state.entries.filter(e=>e.funzione===funzione).sort((a,b)=>Date.parse(b.eseguito_il)-Date.parse(a.eseguito_il))[0]||null}));}
  return {TYPES,RESULTS,empty,validate,append,summarize};
});

/* Modello condiviso per dashboard e verifiche locali. Nessuna integrazione esterna. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OutreachMonitoraggio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STAGES = ['invito','accettazione','primo_messaggio','email','risposta','interesse','call_fissata','call_fatta','vendita'];
  const LABELS = ['Inviti','Accettati','Primi messaggi','Email','Risposte','Interessati','Call fissate','Call fatte','Vendite confermate'];
  const RESPONSE = ['da_classificare','cortesia','proposta','negativa'];
  const INTEREST = ['da_classificare','bisogno_call','materiale'];
  const OUTBOX = ['richiesta','annullata','inviato','consegnato','errore'];
  const parsed = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value) : null;
  function day(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return parsed(value) && new Date(value).toISOString().slice(0,10) === value ? value : null;
    const date = parsed(value);
    return date ? new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit' }).format(date) : null;
  }
  function empty(slug) { return {version:1,client_slug:slug,source:'',verified_at:'',updated_at:'',coverage:Object.fromEntries(STAGES.map(s=>[s,false])),contacts:[],calls:[],outbox:[],reports:[]}; }
  function assert(ok, message) { if (!ok) throw Error(message); }
  function text(value, max=2000) { return typeof value === 'string' && value.length <= max; }
  function source(value) { return text(value) && value.trim() && !/taplio/i.test(value); }
  function validate(input, slug) {
    assert(input && typeof input === 'object' && !Array.isArray(input), 'Monitoraggio mancante.');
    assert(input.version === 1 && input.client_slug === slug && /^[a-z0-9][a-z0-9-]{0,100}$/.test(slug), 'Cliente non corrispondente.');
    assert(source(input.source) && parsed(input.verified_at), 'Servono fonte primaria e data di verifica; Taplio non è una fonte dati.');
    assert(!input.updated_at || parsed(input.updated_at), 'Data aggiornamento non valida.');
    assert(input.coverage && STAGES.every(k=>typeof input.coverage[k] === 'boolean'), 'Dichiarare la copertura di ogni fase.');
    assert(Array.isArray(input.contacts) && Array.isArray(input.calls), 'Contatti e call devono essere elenchi.');
    assert(input.contacts.length <= 2000 && input.calls.length <= 2000, 'Troppi record per il documento cliente.');
    const ids = new Set(), emails = new Set(), profiles = new Set();
    for (const c of input.contacts) {
      assert(text(c.id,200) && c.id && !ids.has(c.id) && text(c.nome,300) && c.nome.trim(), 'Identificativo contatto duplicato o contatto incompleto.'); ids.add(c.id);
      if(c.email) { assert(text(c.email,320), 'Email non valida.');const key=c.email.trim().toLowerCase();assert(!emails.has(key),'Stessa email presente in più contatti: unificare la persona prima di importare.');emails.add(key); }
      if(c.profilo) { assert(text(c.profilo,1000), 'Profilo non valido.');const key=c.profilo.trim().replace(/\/$/,'');assert(!profiles.has(key),'Stesso profilo presente in più contatti.');profiles.add(key); }
      assert(!c.ingresso || day(c.ingresso), 'Data di ingresso non valida; se ignota lasciarla vuota.');
      assert(!c.scope || ['outreach','lead'].includes(c.scope), 'Ambito contatto non valido.');
      assert(c.events && typeof c.events === 'object' && !Array.isArray(c.events), 'Eventi contatto mancanti.');
      for (const [key,value] of Object.entries(c.events)) assert([...STAGES,'nostra_risposta'].includes(key) && parsed(value), 'Evento o data non validi.');
      assert(!c.source || source(c.source), 'Fonte contatto non ammessa.');
      assert(!c.sources || (Array.isArray(c.sources) && c.sources.every(source)), 'Fonti contatto non ammesse.');
      for (const key of ['settore','tema','target','responsabile','prossimo_passo','bozza','esito']) assert(c[key] === undefined || text(c[key],key==='bozza'?6000:2000), 'Campo contatto non valido: '+key);
      assert(!c.tipo_risposta || RESPONSE.includes(c.tipo_risposta), 'Tipo risposta non valido.');
      assert(!c.tipo_interesse || INTEREST.includes(c.tipo_interesse), 'Tipo interesse non valido.');
      for (const key of ['internal','escluso','chiuso']) assert(c[key] === undefined || typeof c[key] === 'boolean', 'Flag contatto non valido.');
      assert(!c.conversazione_verificata_il || parsed(c.conversazione_verificata_il), 'Verifica conversazione non valida.');
      if(c.events.vendita) assert(source(c.vendita_fonte) && text(c.vendita_riscontro) && c.vendita_riscontro.trim(), 'Vendita senza fonte e riscontro espliciti.');
    }
    const callIds = new Set();
    for (const c of input.calls) {
      assert(text(c.id,200) && c.id && !callIds.has(c.id), 'Identificativo call duplicato.'); callIds.add(c.id);
      assert(ids.has(c.contact_id) && parsed(c.creata), 'Call senza contatto o data creazione.');
      assert(source(c.source) && text(c.source_evidence) && c.source_evidence.trim(), 'Ogni call richiede fonte esplicita e riferimento alla prova.');
      for (const key of ['fissata_per','fatta_il']) assert(!c[key] || parsed(c[key]), 'Data call non valida.');
      assert(!c.esito || text(c.esito), 'Esito call non valido.');
    }
    for(const c of input.contacts) if(c.events.call_fatta) assert(input.calls.some(b=>b.contact_id===c.id && parsed(b.fatta_il)), 'Call svolta senza riscontro esplicito di svolgimento.');
    const state = JSON.parse(JSON.stringify(input));
    state.outbox ||= []; state.reports ||= [];
    assert(Array.isArray(state.outbox) && Array.isArray(state.reports), 'Coda e report devono essere elenchi.');
    const requestIds = new Set();
    for (const r of state.outbox) {
      assert(text(r.id,200) && r.id && !requestIds.has(r.id) && ids.has(r.contact_id), 'Richiesta senza contatto o identificativo univoco.'); requestIds.add(r.id);
      assert(OUTBOX.includes(r.stato) && ['messaggio','email'].includes(r.tipo) && text(r.testo,6000) && r.testo.trim() && parsed(r.created_at), 'Richiesta incompleta.');
      assert(parsed(r.confirmed_at) && r.confirmed_by && Date.parse(r.confirmed_at)>=Date.parse(r.created_at) && Date.parse(r.confirmed_at)-Date.parse(r.created_at)<=900000, 'Ogni richiesta richiede una conferma fresca entro quindici minuti.');
      if (['inviato','consegnato'].includes(r.stato)) assert(parsed(r.sent_at) && text(r.evidence) && r.evidence.trim(), 'Invio senza prova.');
      if (r.stato==='consegnato') assert(parsed(r.delivered_at), 'Consegna senza prova temporale.');
    }
    const perDay={};for(const r of state.outbox) {const key=day(r.created_at);perDay[key]=(perDay[key]||0)+1;assert(perDay[key]<=10,'Più di dieci richieste nello stesso giorno.');}
    assert(new TextEncoder().encode(JSON.stringify(state)).length < 650000, 'Monitoraggio troppo grande per il documento cliente.');
    return state;
  }
  function validateImport(payload, slug) {
    assert(payload && payload.slug === slug && Object.keys(payload).every(k=>['slug','monitoraggio_v1'].includes(k)), 'Importazione: indicare solo slug e monitoraggio_v1 del cliente aperto.');
    return validate(payload.monitoraggio_v1, slug);
  }
  function summarize(state, filters) {
    const f = filters;
    assert(day(f.dal) && day(f.al) && f.dal<=f.al, 'Intervallo non valido.');
    const at = (c,k) => !!day(c.events?.[k]) && day(c.events[k]) <= f.al;
    const contacts = state.contacts.filter(c=>!c.internal && c.scope!=='lead' && day(c.ingresso)>=f.dal && day(c.ingresso)<=f.al && ['settore','tema','target'].every(k=>!f[k]||c[k]===f[k]));
    const known = Object.fromEntries(STAGES.map(k=>[k,contacts.filter(c=>at(c,k)).length]));
    const unknownIngress=state.contacts.filter(c=>!c.internal && c.scope!=='lead' && !day(c.ingresso) && ['settore','tema','target'].every(k=>!f[k]||c[k]===f[k])).length;
    const counts = Object.fromEntries(STAGES.map(k=>[k,state.coverage?.[k]===true && !unknownIngress ? known[k] : null]));
    const ratePairs = [['accettazione','invito'],['risposta','accettazione'],['call_fissata','risposta']];
    const rates = ratePairs.map(([n,d])=>{
      const eligible=contacts.filter(c=>at(c,d));
      const converted=eligible.filter(c=>at(c,n) && Date.parse(c.events[n])>=Date.parse(c.events[d]));
      return {n,d,numerator:converted.length,denominator:eligible.length,value:counts[n]!==null && counts[d]!==null && eligible.length ? 100*converted.length/eligible.length : null};
    });
    const waiting = contacts.filter(c=>at(c,'interesse') && at(c,'risposta') && !at(c,'call_fissata') && !c.chiuso && !c.escluso && !c.prossimo_passo?.trim() && (!parsed(c.events.nostra_risposta)||Date.parse(c.events.risposta)>Date.parse(c.events.nostra_risposta))).map(c=>({...c,attesa:Math.max(0,Math.floor((Date.parse(f.al+'T12:00:00Z')-Date.parse(day(c.events.risposta)+'T12:00:00Z'))/86400000))})).sort((a,b)=>b.attesa-a.attesa);
    const callContacts = state.contacts.filter(c=>!c.internal && ['settore','tema','target'].every(k=>!f[k]||c[k]===f[k]));
    const ids = new Set(callContacts.map(c=>c.id));
    const calls = state.calls.filter(c=>ids.has(c.contact_id) && day(c.creata)>=f.dal && day(c.creata)<=f.al);
    const split=(eventKey,key,values)=>Object.fromEntries(values.map(v=>[v,contacts.filter(c=>at(c,eventKey) && (c[key]||'da_classificare')===v).length]));
    return {contacts,counts,known,rates,waiting,calls,unknownIngress,filters:f,responses:split('risposta','tipo_risposta',RESPONSE),interested:split('interesse','tipo_interesse',INTEREST)};
  }
  function request(state, contactId, tipo, testo, user, now=new Date().toISOString()) {
    assert(['messaggio','email'].includes(tipo), 'Sono consentiti solo messaggi ed email, nessun nuovo invito.');
    const c=state.contacts.find(c=>c.id===contactId);
    assert(c && !c.escluso && !c.chiuso && !c.internal, 'Contatto non disponibile.');
    assert(parsed(c.conversazione_verificata_il) && Date.parse(now)>=Date.parse(c.conversazione_verificata_il) && Date.parse(now)-Date.parse(c.conversazione_verificata_il)<=86400000, 'Verificare prima la conversazione aggiornata entro un giorno.');
    if(tipo==='messaggio') assert(/^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?$/.test(c.profilo||''), 'Serve il profilo LinkedIn esatto della persona.');
    if(tipo==='email') assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email||'') && c.email_verificata===true, 'Serve un indirizzo email verificato.');
    assert(user && text(testo,6000) && testo.trim(), 'Confermare un testo non vuoto.');
    assert(!state.outbox.some(r=>r.contact_id===contactId && r.stato==='richiesta'), 'Esiste già una richiesta aperta per questa persona.');
    assert(state.outbox.filter(r=>day(r.created_at)===day(now)).length<10, 'Limite di dieci richieste al giorno raggiunto.');
    const r={id:'richiesta-'+now+'-'+contactId,contact_id:contactId,tipo,testo,destinatario:tipo==='email'?c.email:c.profilo,stato:'richiesta',created_at:now,confirmed_at:now,confirmed_by:user};
    state.outbox.push(r); return r;
  }
  function cancel(state,id,now=new Date().toISOString()) {
    const r=state.outbox.find(r=>r.id===id); assert(r && r.stato==='richiesta' && !r.sent_at, 'La richiesta non è annullabile in dashboard.');
    r.stato='annullata'; r.cancelled_at=now;
  }
  function report(state,f,now=new Date().toISOString()) {
    const s=summarize(state,f), backlog=summarize(state,{...f,dal:'1900-01-01'}).waiting;
    return {id:'report-'+now,created_at:now,stato:'preparato',periodo:{...f},scadenza:'venerdì prima delle 12:00 Europe/Rome',summary:s,backlog,source:state.source,verified_at:state.verified_at,coverage:state.coverage};
  }
  return {STAGES,LABELS,RESPONSE,INTEREST,OUTBOX,day,parsed,empty,validate,validateImport,summarize,request,cancel,report};
});

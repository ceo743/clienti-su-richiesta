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
  const OUTBOX = ['richiesta','sospesa','in_corso','da_verificare','annullata','inviato','consegnato','errore'];
  const DAY_MS = 86400000;
  // Firestore restituisce mappe con un ordine proprio; gli array restano ordinati.
  const signature = value => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  function mergeImport(latest, incoming, slug) {
    const next=validate(incoming,slug);
    if(!latest) return next;
    const current=validate(latest,slug);
    const ids=new Set(next.contacts.map(c=>c.id));
    assert(current.outbox.every(r=>ids.has(r.contact_id)),'Importazione bloccata: conserva le persone associate alle richieste già registrate.');
    assert(!next.outbox.length || signature(next.outbox)===signature(current.outbox),'L’importazione non può sostituire le richieste operative.');
    assert(!next.reports.length || signature(next.reports)===signature(current.reports),'L’importazione non può sostituire i report registrati.');
    next.outbox=current.outbox; next.reports=current.reports;
    return validate(next,slug);
  }
  function validateCheckInput(tipo, fields, now=new Date().toISOString(), knownReply='') {
    assert(parsed(now) && parsed(fields.at) && Date.parse(fields.at)<=Date.parse(now) && Date.parse(now)-Date.parse(fields.at)<=900000,'Indica la data reale del controllo, entro quindici minuti.');
    assert(threadUrl(tipo,fields.thread_url),'Indica il collegamento esatto del filo nel canale corretto.');
    assert(text(fields.evidence) && fields.evidence.trim(),'Inserisci il riscontro concreto prima di salvare.');
    assert(!fields.latest_reply_at || (parsed(fields.latest_reply_at) && Date.parse(fields.latest_reply_at)<=Date.parse(now)),'Data dell’ultima risposta non valida o futura.');
    assert(!parsed(knownReply) || parsed(fields.latest_reply_at),'Indica la data dell’ultima risposta già presente nella scheda.');
  }
  const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  function destination(tipo, value) {
    if (typeof value !== 'string') return '';
    if (tipo === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? emailKey(value) : '';
    return /^https:\/\/(www\.)?linkedin\.com\/in\/[^/?#]+\/?$/.test(value.trim()) ? value.trim().replace(/^https:\/\/linkedin\.com\//,'https://www.linkedin.com/').replace(/\/$/,'') : '';
  }
  function threadUrl(tipo, value) {
    if (typeof value !== 'string' || value.length > 2000) return false;
    return tipo === 'messaggio' ? /^https:\/\/(www\.)?linkedin\.com\/messaging\/thread\/[^/?#]+\/?(?:\?[^#\s]*)?$/.test(value) : /^https:\/\/mail\.google\.com\/mail\/u\/\d+\/#(?:all|sent|inbox|search\/[^/]+)\/[A-Za-z0-9_-]+$/.test(value);
  }
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
      assert(!c.conversazione_url || threadUrl('messaggio',c.conversazione_url), 'Link del filo LinkedIn non valido.');
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
      if (r.conversation_url) assert(threadUrl(r.tipo,r.conversation_url), 'Filo della richiesta non valido.');
      if (r.approval_snapshot) assert(r.approval_snapshot.testo===r.testo && r.approval_snapshot.destinatario===r.destinatario && destination(r.tipo,r.destinatario) && (!r.approval_snapshot.confirmed_at || r.approval_snapshot.confirmed_at===r.confirmed_at) && (!r.approval_snapshot.confirmed_by || r.approval_snapshot.confirmed_by===r.confirmed_by), 'Testo, destinatario o autore non corrispondenti alla conferma originaria.');
      for (const k of ['claimed_at','checked_at','latest_reply_at','suspended_at','uncertain_at']) assert(!r[k] || parsed(r[k]), 'Data operativa non valida: '+k);
      if (r.stato==='in_corso') assert(text(r.claim_id,200) && r.claim_id && r.claimed_by && parsed(r.claimed_at) && threadUrl(r.tipo,r.thread_url) && text(r.check_evidence) && r.check_evidence.trim(), 'Presa in carico senza controllo o identificativo.');
      if (['sospesa','da_verificare'].includes(r.stato)) assert(text(r.reason) && r.reason.trim(), 'Serve il motivo del blocco.');
      if (r.claim_id) assert(text(r.claim_id,200) && r.claim_id && r.claimed_by && parsed(r.claimed_at) && r.dispatch_snapshot && r.dispatch_snapshot.testo===r.testo && r.dispatch_snapshot.destinatario===r.destinatario && r.dispatch_snapshot.confirmed_at===r.confirmed_at && r.dispatch_snapshot.confirmed_by===r.confirmed_by, 'Il testo o destinatario preso in carico è stato modificato.');
      if (r.sent_by) assert(threadUrl(r.tipo,r.thread_url) && r.claim_id && r.sent_by && Date.parse(r.sent_at)>=Date.parse(r.claimed_at), 'Riscontro invio non coerente con la presa in carico.');
      if (r.delivered_by) assert(text(r.delivery_evidence) && r.delivery_evidence.trim() && r.delivery_evidence!==r.evidence && Date.parse(r.delivered_at)>=Date.parse(r.sent_at), 'La consegna richiede un riscontro distinto e successivo all’invio.');
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
    assert(!state.outbox.some(r=>r.contact_id===contactId && ['richiesta','in_corso','da_verificare'].includes(r.stato)), 'Esiste già una richiesta aperta o da verificare per questa persona.');
    assert(state.outbox.filter(r=>day(r.created_at)===day(now)).length<10, 'Limite di dieci richieste al giorno raggiunto.');
    const r={id:'richiesta-'+now+'-'+contactId,contact_id:contactId,tipo,testo,destinatario:tipo==='email'?c.email:c.profilo,stato:'richiesta',created_at:now,confirmed_at:now,confirmed_by:user,conversation_url:tipo==='messaggio'?(c.conversazione_url||''):'',approval_snapshot:{testo,destinatario:tipo==='email'?c.email:c.profilo,confirmed_at:now,confirmed_by:user,ultima_risposta:c.events?.risposta||'',conversazione_verificata_il:c.conversazione_verificata_il}};
    state.outbox.push(r); return r;
  }
  function cancel(state,id,now=new Date().toISOString()) {
    const r=state.outbox.find(r=>r.id===id); assert(r && r.stato==='richiesta' && !r.sent_at, 'La richiesta non è annullabile in dashboard.');
    r.stato='annullata'; r.cancelled_at=now;
  }
  function operator(context) {
    assert(context && emailKey(context.actor) && Array.isArray(context.operators) && context.operators.map(emailKey).includes(emailKey(context.actor)), 'Operatore non amministratore: nessuna modifica.');
  }
  function preflight(state,id,context) {
    const r=state.outbox.find(x=>x.id===id), reasons=[], now=context?.now || new Date().toISOString();
    const reject=message=>reasons.push(message), v=context?.verification || {};
    if(!r) return {ok:false,reasons:['Richiesta non presente.']};
    const c=state.contacts.find(x=>x.id===r.contact_id), time=Date.parse(now);
    if(!Number.isFinite(time)) reject('Data del controllo non valida.');
    if(r.stato!=='richiesta') reject(r.stato==='da_verificare'?'Esito incerto: nessun ritentativo.':'Richiesta non disponibile per una nuova presa in carico.');
    if(!context || !Array.isArray(context.operators) || !context.operators.map(emailKey).includes(emailKey(context.actor))) reject('Operatore non amministratore.');
    if(!Array.isArray(context?.approvers) || !context.approvers.map(emailKey).includes(emailKey(r.confirmed_by))) reject('Approvatore non più autorizzato.');
    if(!r.approval_snapshot || r.approval_snapshot.testo!==r.testo || r.approval_snapshot.destinatario!==r.destinatario || r.approval_snapshot.confirmed_at!==r.confirmed_at || r.approval_snapshot.confirmed_by!==r.confirmed_by) reject('Conferma originaria di testo, destinatario, autore o data mancante o modificata.');
    if(!c || c.internal || c.escluso || c.chiuso) reject('Contatto non disponibile.');
    if(!destination(r.tipo,r.destinatario) || !c || destination(r.tipo,r.destinatario)!==destination(r.tipo,r.tipo==='email'?c.email:c.profilo)) reject('Destinatario cambiato o non univoco.');
    if(c && c.bozza!==r.testo) reject('Testo cambiato dopo l’approvazione.');
    if(!parsed(r.confirmed_at) || time<Date.parse(r.confirmed_at) || time-Date.parse(r.confirmed_at)>DAY_MS) reject('Approvazione scaduta: occorre una nuova approvazione del testo esatto.');
    if(!c || !parsed(c.conversazione_verificata_il) || time<Date.parse(c.conversazione_verificata_il) || time-Date.parse(c.conversazione_verificata_il)>DAY_MS) reject('Verifica della conversazione scaduta.');
    if(c && parsed(c.events?.risposta) && Date.parse(c.events.risposta)>Date.parse(r.confirmed_at)) reject('La persona ha risposto dopo l’approvazione.');
    if(c && r.approval_snapshot && (c.events?.risposta || '')!==(r.approval_snapshot.ultima_risposta || '')) reject('Risposta registrata cambiata dopo la conferma.');
    if(!parsed(v.checked_at) || time<Date.parse(v.checked_at) || time-Date.parse(v.checked_at)>900000 || !threadUrl(r.tipo,v.thread_url) || !text(v.evidence) || !v.evidence.trim()) reject('Ricontrollare il singolo filo nel canale reale entro quindici minuti e indicarne il riscontro.');
    if(v.testo!==r.testo || destination(r.tipo,v.destinatario)!==destination(r.tipo,r.destinatario)) reject('Il controllo del filo non coincide con testo e destinatario approvati.');
    if(v.latest_reply_at && (!parsed(v.latest_reply_at) || Date.parse(v.latest_reply_at)>Date.parse(r.confirmed_at))) reject('Risposta più recente successiva all’approvazione o data non valida.');
    if(c && parsed(c.events?.risposta) && (!parsed(v.latest_reply_at) || Date.parse(v.latest_reply_at)<Date.parse(c.events.risposta))) reject('Il riscontro del filo non comprende l’ultima risposta già registrata.');
    if(r.conversation_url && r.conversation_url!==v.thread_url) reject('Il filo non coincide con quello verificato per la richiesta.');
    if(state.outbox.some(x=>x.id!==id && x.testo===r.testo && destination(x.tipo,x.destinatario)===destination(r.tipo,r.destinatario) && ['richiesta','in_corso','da_verificare','inviato','consegnato'].includes(x.stato))) reject('Testo e destinatario già presenti in un’altra richiesta attiva o inviata.');
    const used=state.outbox.filter(x=>x.id!==id && (day(x.sent_at)===day(now) || (['in_corso','da_verificare'].includes(x.stato) && day(x.claimed_at)===day(now)))).length;
    if(used>=10) reject('Limite di dieci invii o prese in carico nel giorno raggiunto.');
    return {ok:reasons.length===0,reasons,used,request_id:id};
  }
  function claim(state,id,context) {
    operator(context);
    const now=context.now || new Date().toISOString();
    assert(parsed(now),'Data del controllo non valida.');
    const r=state.outbox.find(x=>x.id===id);
    assert(r,'Richiesta non presente.');
    assert(text(context.claim_id,200) && context.claim_id.trim(),'Identificativo univoco di presa in carico mancante.');
    if(r.stato==='in_corso' && r.claim_id===context.claim_id && emailKey(r.claimed_by)===emailKey(context.actor)) return {ok:true,claimed:false,may_send:false,request_id:id,stato:r.stato};
    assert(r.stato==='richiesta','Richiesta già presa in carico, chiusa o incerta: nessun ritentativo.');
    assert(!state.outbox.some(x=>x.id!==id && x.claim_id===context.claim_id),'Identificativo già usato per un’altra richiesta.');
    const result=preflight(state,id,{...context,now});
    r.last_checked_at=now; r.last_checked_by=context.actor;
    if(!result.ok) {r.stato='sospesa';r.reason=result.reasons.join(' ');r.suspended_at=now;return {...result,claimed:false,may_send:false,stato:r.stato};}
    Object.assign(r,{stato:'in_corso',claim_id:context.claim_id,claimed_at:now,claimed_by:context.actor,checked_at:context.verification.checked_at,thread_url:context.verification.thread_url,latest_reply_at:context.verification.latest_reply_at||'',check_evidence:context.verification.evidence,dispatch_snapshot:{testo:r.testo,destinatario:r.destinatario,confirmed_at:r.confirmed_at,confirmed_by:r.confirmed_by}});
    delete r.reason;
    return {ok:true,claimed:true,may_send:true,request_id:id,stato:r.stato};
  }
  function recordOutcome(state,id,context) {
    operator(context);
    const r=state.outbox.find(x=>x.id===id), at=context.at, now=context.now || new Date().toISOString();
    assert(r && r.claim_id && r.claim_id===context.claim_id,'Riscontro senza la presa in carico esatta.');
    assert(parsed(now) && parsed(r.claimed_at) && Date.parse(r.claimed_at)<=Date.parse(now),'Ora corrente o data della presa in carico non valida o futura.');
    assert(!r.checked_at || (parsed(r.checked_at) && Date.parse(r.checked_at)<=Date.parse(now)),'Data del controllo del filo non valida o futura.');
    assert(parsed(at) && Date.parse(at)>=Date.parse(r.claimed_at) && Date.parse(at)<=Date.parse(now),'Data del riscontro non valida o futura.');
    assert(['inviato','consegnato','da_verificare','errore'].includes(context.stato),'Esito operativo non ammesso.');
    if(context.stato==='da_verificare' || context.stato==='errore') {
      assert(['in_corso','da_verificare'].includes(r.stato),'Richiesta già conclusa: non sovrascrivere il riscontro.');
      assert(text(context.reason) && context.reason.trim(),'Documentare il motivo senza ritentare.');
      Object.assign(r,{stato:context.stato,reason:context.reason,uncertain_at:at,last_checked_at:at,last_checked_by:context.actor});
      return {recorded:true,may_send:false,stato:r.stato};
    }
    assert(context.testo===r.testo && context.destinatario===r.destinatario,'La prova non corrisponde al testo e destinatario presi in carico.');
    assert(threadUrl(r.tipo,context.thread_url) && context.thread_url===r.thread_url && text(context.evidence) && context.evidence.trim(),'Serve un riscontro preciso nel filo verificato.');
    if(context.stato==='inviato') {
      if(['inviato','consegnato'].includes(r.stato)) {assert(r.sent_at===at && r.evidence===context.evidence,'Invio già registrato: non sovrascrivere la prova.');return {recorded:false,may_send:false,stato:r.stato};}
      assert(['in_corso','da_verificare'].includes(r.stato),'Non è possibile registrare un invio per questa richiesta.');
      assert(state.outbox.filter(x=>x.id!==id && day(x.sent_at)===day(at)).length<10,'Limite di dieci invii provati nel giorno raggiunto: riconciliare senza ritentare.');
      Object.assign(r,{stato:'inviato',sent_at:at,sent_by:context.actor,evidence:context.evidence,last_checked_at:at,last_checked_by:context.actor});
    } else {
      if(r.stato==='consegnato') {assert(r.delivered_at===at && r.delivery_evidence===context.evidence,'Consegna già registrata: non sovrascrivere la prova.');return {recorded:false,may_send:false,stato:r.stato};}
      assert(r.stato==='inviato' && Date.parse(at)>=Date.parse(r.sent_at) && context.evidence!==r.evidence,'La consegna richiede una prova distinta dopo l’invio.');
      Object.assign(r,{stato:'consegnato',delivered_at:at,delivered_by:context.actor,delivery_evidence:context.evidence,last_checked_at:at,last_checked_by:context.actor});
    }
    delete r.reason;
    return {recorded:true,may_send:false,stato:r.stato};
  }
  function report(state,f,now=new Date().toISOString()) {
    const s=summarize(state,f), backlog=summarize(state,{...f,dal:'1900-01-01'}).waiting;
    return {id:'report-'+now,created_at:now,stato:'preparato',periodo:{...f},scadenza:'venerdì prima delle 12:00 Europe/Rome',summary:s,backlog,source:state.source,verified_at:state.verified_at,coverage:state.coverage};
  }
  return {STAGES,LABELS,RESPONSE,INTEREST,OUTBOX,day,parsed,empty,validate,validateImport,mergeImport,signature,validateCheckInput,summarize,request,cancel,preflight,claim,recordOutcome,threadUrl,report};
});

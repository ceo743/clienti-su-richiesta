/* Singola prova EMAIL autorizzata: usa la coda reale, nessun trasporto nel browser. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.createOutreachProvaCeo = api.createOutreachProvaCeo;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const EMAIL = 'ceo@davidecaiazzo.it', SLUG = 'davide-caiazzo';
  const PURPOSE = 'collaudo_ceo_autorizzato', AUTHORIZATION = 'AUTORIZZAZIONE-PROVA-REALE-CEO-20261027';
  const CONTACT_ID = 'prova-ceo-email-autorizzata-20261027', ARCHIVE = 'collaudi_invio_v1';
  const SOURCE = 'Solo prova email autorizzata da Davide; nessuna rilevazione commerciale';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const fail = message => { throw Error(message); };
  const domain = options => options.domain || root.OutreachMonitoraggio;
  const clock = options => options.now ? options.now() : new Date().toISOString();
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function exactText(id) {
    return 'Ciao Davide,\n\nquesta è la prova reale richiesta da te, partita dalla coda della nostra dashboard outreach.\nID richiesta: '+id+'\nDashboard: https://clienti.davidecaiazzo.it/dashboard-outreach/\nQuesta email collauda il percorso email e non dimostra l’invio di messaggi LinkedIn.\n\nSofIA | DC Academy\nAssistente AI di Davide Caiazzo';
  }
  function identity(options) {
    const user = options.auth.currentUser;
    if (!options.isAdmin() || !user || user.email !== EMAIL || !user.uid) fail('Prova riservata all’account CEO amministratore.');
    return {email:EMAIL,uid:user.uid,slug:SLUG};
  }
  function guard(options, session) {
    const actor = identity(options);
    if (!session || session.slug !== SLUG || actor.email !== session.email || actor.uid !== session.uid || (options.isCurrent && !options.isCurrent())) fail('Account o cliente cambiato: operazione fermata.');
  }
  function adminsGuard(snapshot) {
    if (!snapshot.exists || !Array.isArray(snapshot.data()?.emails) || !snapshot.data().emails.some(x => typeof x === 'string' && x.trim().toLowerCase() === EMAIL)) fail('Account CEO non più amministratore.');
  }
  function refs(options, session) {
    guard(options,session);
    return {client:options.db.collection('clienti').doc(SLUG),admins:options.db.collection('config').doc('admins')};
  }
  async function transactionRead(options, session, action) {
    const ref = refs(options,session);
    return options.db.runTransaction(async transaction => {
      const [snapshot,admins] = await Promise.all([transaction.get(ref.client),transaction.get(ref.admins)]);
      guard(options,session); adminsGuard(admins);
      if (!snapshot.exists) fail('Cliente CEO non disponibile.');
      return action(snapshot.data(),transaction,ref.client);
    });
  }
  async function readFresh(options, session) {
    return transactionRead(options,session,data => copy(data));
  }
  function archived(data) {
    const value = data[ARCHIVE];
    if (value === undefined) return [];
    if (!value || value.version !== 1 || !Array.isArray(value.entries)) fail('Archivio prove non riconosciuto: nessuna sostituzione.');
    return value.entries;
  }
  function findExisting(data) {
    const live = data.monitoraggio_v1?.outbox;
    if (live !== undefined && !Array.isArray(live)) fail('Coda non valida: nessuna modifica.');
    const request = live?.find(r => r?.purpose === PURPOSE);
    if (request) return {request,archived:false};
    const entry = archived(data).find(r => r?.purpose === PURPOSE || r?.request?.purpose === PURPOSE);
    return entry ? {request:entry.request,archived:true,receipt:entry} : null;
  }
  function checkOwned(request, session, D) {
    if (!request || request.purpose !== PURPOSE || request.fonte_autorizzazione !== AUTHORIZATION || request.tipo !== 'email' || request.destinatario !== EMAIL || request.contact_id !== CONTACT_ID || request.id !== 'richiesta-'+request.created_at+'-'+CONTACT_ID || request.testo !== exactText(request.id) || request.confirmed_by !== EMAIL || request.created_by_agent !== 'Codex' || request.approval_origin !== 'ordine_esplicito_prova_reale_ceo; testo_preparato_da_agente' || request.human_literal_text_approval !== false || request.prova_ceo?.owner_email !== session.email || request.prova_ceo?.owner_uid !== session.uid || request.prova_ceo?.client_slug !== SLUG || !D.parsed(request.created_at)) fail('Richiesta diversa dalla prova autorizzata: nessuna modifica o esportazione.');
    if (request.approval_snapshot?.testo !== request.testo || request.approval_snapshot?.destinatario !== EMAIL || request.approval_snapshot?.confirmed_by !== EMAIL || request.approval_snapshot?.confirmed_at !== request.confirmed_at) fail('Conferma originaria della prova non corrispondente.');
    return request;
  }
  function prepare(options, session, data, now = clock(options)) {
    guard(options,session);
    const D = domain(options);
    if (!D.parsed(now)) fail('Data di verifica della prova non valida.');
    const existing = findExisting(data);
    if (existing) return {existing:copy(existing)};
    const hadMonitor = Object.hasOwn(data,'monitoraggio_v1');
    const state = hadMonitor ? D.validate(data.monitoraggio_v1,SLUG) : D.empty(SLUG);
    if (!hadMonitor) Object.assign(state,{source:SOURCE,verified_at:now,updated_at:now});
    if (state.contacts.some(c => c.id === CONTACT_ID || c.email?.trim().toLowerCase() === EMAIL)) fail('Il contatto CEO è già presente: nessuna sostituzione dei dati esistenti.');
    const id = 'richiesta-'+now+'-'+CONTACT_ID;
    return {now,id,testo:exactText(id),expected_monitor_signature:D.signature(data.monitoraggio_v1),expected_archive_signature:D.signature(data[ARCHIVE]),hadMonitor};
  }
  async function createRequest(options, session, preview, confirmed) {
    guard(options,session);
    if (confirmed !== true) fail('Confermare destinatario CEO e testo della prova.');
    if (!preview || preview.existing || preview.id !== 'richiesta-'+preview.now+'-'+CONTACT_ID || preview.testo !== exactText(preview.id)) fail('Anteprima della prova non valida.');
    const D = domain(options), checkedNow = clock(options);
    if (!D.parsed(checkedNow) || Date.parse(checkedNow)<Date.parse(preview.now) || Date.parse(checkedNow)-Date.parse(preview.now)>900000) fail('Anteprima scaduta: rileggere la prova senza creare una nuova richiesta.');
    const result = await transactionRead(options,session,(data,transaction,ref) => {
      const existing = findExisting(data);
      if (existing) return {created:false,...copy(existing)};
      if (D.signature(data.monitoraggio_v1) !== preview.expected_monitor_signature || D.signature(data[ARCHIVE]) !== preview.expected_archive_signature || Object.hasOwn(data,'monitoraggio_v1') !== preview.hadMonitor) fail('Dati cambiati dopo l’anteprima: rileggere prima di procedere.');
      const fresh = prepare(options,session,data,preview.now);
      if (fresh.id !== preview.id || fresh.testo !== preview.testo) fail('Il testo non corrisponde all’anteprima.');
      const state = preview.hadMonitor ? D.validate(data.monitoraggio_v1,SLUG) : D.empty(SLUG);
      if (!preview.hadMonitor) Object.assign(state,{source:SOURCE,verified_at:preview.now,updated_at:preview.now});
      const baselineSignature = preview.hadMonitor ? null : D.signature({...state,updated_at:''});
      const contact = {id:CONTACT_ID,nome:'PROVA INTERNA — Davide Caiazzo',email:EMAIL,email_verificata:true,scope:'lead',ingresso:preview.now,events:{},bozza:preview.testo,conversazione_verificata_il:preview.now,source:'Ordine esplicito di Davide: '+AUTHORIZATION+'; verifica della fonte, solo prova email CEO.',purpose:PURPOSE,fonte_autorizzazione:AUTHORIZATION,order_date:'2026-10-27'};
      state.contacts.push(contact);
      const request = D.request(state,CONTACT_ID,'email',preview.testo,EMAIL,preview.now);
      Object.assign(request,{purpose:PURPOSE,fonte_autorizzazione:AUTHORIZATION,created_by_agent:'Codex',approval_origin:'ordine_esplicito_prova_reale_ceo; testo_preparato_da_agente',human_literal_text_approval:false,order_date:'2026-10-27',source_verified_at:preview.now,prova_ceo:{owner_email:session.email,owner_uid:session.uid,client_slug:SLUG,monitor_absent_initially:!preview.hadMonitor,baseline_signature:baselineSignature,contact_signature:D.signature(contact)}});
      if (request.id !== preview.id || request.testo !== preview.testo) fail('Identificativo o testo della richiesta non corrispondente.');
      checkOwned(request,session,D); guard(options,session);
      transaction.update(ref,{monitoraggio_v1:D.validate(state,SLUG)});
      return {created:true,request:copy(request),archived:false};
    });
    // Conferma dal server con una nuova transazione; nessun fallback alla cache locale.
    const saved = findExisting(await readFresh(options,session));
    if (!saved || saved.request?.id !== result.request?.id) fail('Salvataggio della prova non confermato: rileggere, senza ripetere l’invio.');
    return {...result,request:copy(checkOwned(saved.request,session,D))};
  }
  async function exportFresh(options, session) {
    return transactionRead(options,session,data => {
      const found = findExisting(data);
      if (!found) fail('Richiesta di prova non presente.');
      const request = checkOwned(found.request,session,domain(options));
      return {schema_version:1,exported_at:clock(options),client_slug:SLUG,purpose:PURPOSE,fonte_autorizzazione:AUTHORIZATION,request:copy(request),actor:{email:EMAIL,role:'ceo'},approver:{email:EMAIL,role:'ceo'}};
    });
  }
  async function cleanup(options, session, requestId) {
    const D = domain(options);
    const proof = await transactionRead(options,session,(data,transaction,ref) => {
      const found = findExisting(data);
      if (!found) fail('Prova non presente: nessuna eliminazione.');
      const request = checkOwned(found.request,session,D);
      if (request.id !== requestId) fail('Identificativo della prova cambiato.');
      if (found.archived) return {alreadyArchived:true,receipt:copy(found.receipt)};
      const state = D.validate(data.monitoraggio_v1,SLUG);
      if (!['inviato','consegnato'].includes(request.stato) || !request.sent_at || !request.sent_by || !request.evidence) fail('Pulizia consentita solo dopo un invio con riscontro reale.');
      const contact = state.contacts.find(c => c.id === CONTACT_ID);
      if (!contact || D.signature(contact) !== request.prova_ceo.contact_signature || state.outbox.some(r => r.id !== request.id && r.contact_id === CONTACT_ID) || state.calls.some(c => c.contact_id === CONTACT_ID)) fail('Contatto della prova modificato o collegato ad altri dati: nessuna eliminazione.');
      const residual = copy(state);
      residual.contacts = residual.contacts.filter(c => c.id !== CONTACT_ID);
      residual.outbox = residual.outbox.filter(r => r.id !== request.id);
      // Il pannello standard aggiorna updated_at durante presa e riscontri della prova.
      // Ogni altro campo deve ancora coincidere prima di ripristinare l'assenza.
      const removeMonitor = request.prova_ceo.monitor_absent_initially === true && D.signature({...residual,updated_at:''}) === request.prova_ceo.baseline_signature;
      if (removeMonitor && typeof options.fieldDelete !== 'function') fail('Eliminazione del campo di prova non disponibile.');
      const receipt = {purpose:PURPOSE,fonte_autorizzazione:AUTHORIZATION,client_slug:SLUG,archived_at:clock(options),archived_by:EMAIL,owner_uid:session.uid,request:copy(request),contact:copy(contact),counts_as_sales:false,monitor_removed:removeMonitor};
      const entries = copy(archived(data)); entries.push(receipt);
      guard(options,session);
      transaction.update(ref,{[ARCHIVE]:{version:1,entries},monitoraggio_v1:removeMonitor ? options.fieldDelete() : D.validate(residual,SLUG)});
      return {receipt,expected_monitor_signature:removeMonitor ? undefined : D.signature(residual),monitorRemoved:removeMonitor};
    });
    const saved = await readFresh(options,session), found = findExisting(saved);
    if (!found?.archived || found.request?.id !== requestId || D.signature(found.receipt) !== D.signature(proof.receipt)) fail('Ricevuta della prova non confermata: nessuna nuova eliminazione.');
    if (saved.monitoraggio_v1?.outbox?.some(r => r.id === requestId) || saved.monitoraggio_v1?.contacts?.some(c => c.id === CONTACT_ID)) fail('Pulizia della prova non confermata.');
    if (!proof.alreadyArchived && (proof.monitorRemoved ? Object.hasOwn(saved,'monitoraggio_v1') : D.signature(saved.monitoraggio_v1) !== proof.expected_monitor_signature)) fail('Prova archiviata; dati cambiati durante la verifica. Nessuna modifica viene ripetuta.');
    return {archived:true,monitorRemoved:found.receipt.monitor_removed,alreadyArchived:!!proof.alreadyArchived};
  }
  function createOutreachProvaCeo(options) {
    const box = options.box || root.document.getElementById('provaCeo');
    let token = 0, client = null, offAuth = null;
    function stop() { ++token;client=null;if(offAuth)offAuth();offAuth=null;if(box)box.innerHTML=''; }
    function current(t,session) { return token===t && client?.slug===SLUG && options.isAdmin() && options.auth.currentUser?.email===session.email && options.auth.currentUser?.uid===session.uid; }
    function say(message,t,session) { if(current(t,session)){const el=box.querySelector('[data-prova-status]');if(el)el.textContent=message;} }
    async function load(t,session) {
      const guarded = {...options,isCurrent:()=>current(t,session)};
      const data = await readFresh(guarded,session);
      if(!current(t,session))return;
      const preview = prepare(guarded,session,data), existing = preview.existing;
      box.innerHTML='<div class="panel"><h3>Prova reale email CEO</h3><p>Una sola email a '+EMAIL+'. Nessun invio LinkedIn. La richiesta usa la coda reale e resta separata dai risultati commerciali.</p><p>Il testo è preparato dall’assistente per l’ordine esplicito di Davide; non è dichiarato revisionato parola per parola da Davide.</p><p data-prova-status role="status" aria-live="polite"></p><div data-prova-actions></div><label>Testo esatto della prova<textarea data-prova-text readonly rows="12"></textarea></label><details><summary>Richiesta salvata dal server · sola lettura</summary><button type="button" data-prova-export>Aggiorna esportazione</button><textarea data-prova-json readonly rows="12"></textarea></details></div>';
      box.querySelector('[data-prova-text]').value=existing?.request?.testo || preview.testo || '';
      const actions=box.querySelector('[data-prova-actions]');
      const readExport=async()=>{const value=await exportFresh(guarded,session);if(current(t,session))box.querySelector('[data-prova-json]').value=JSON.stringify(value,null,2);};
      const refresh=async()=>{try{await load(t,session);}catch(e){say(e.message,t,session);}};
      box.querySelector('[data-prova-export]').onclick=()=>readExport().catch(e=>say(e.message,t,session));
      if(existing){
        say('Richiesta '+(existing.request?.id || 'presente')+' · '+(existing.archived?'archiviata':existing.request?.stato || 'da verificare')+'. Nessuna nuova prova verrà creata.',t,session);
        actions.innerHTML='<button type="button" data-prova-refresh>Rileggi prova esistente</button>';
        if(!existing.archived && ['inviato','consegnato'].includes(existing.request?.stato)){
          actions.innerHTML+='<button type="button" data-prova-cleanup>Archivia ricevuta e rimuovi solo questa prova</button>';
          actions.querySelector('[data-prova-cleanup]').onclick=async event=>{const button=event.currentTarget;button.disabled=true;try{await cleanup(guarded,session,existing.request.id);await load(t,session);}catch(e){say(e.message,t,session);}finally{button.disabled=false;}};
        }
        actions.querySelector('[data-prova-refresh]').onclick=refresh;
        await readExport();
      }else{
        say('Anteprima pronta. Nessuna richiesta ancora salvata; questa pagina non invia email.',t,session);
        actions.innerHTML='<label><input type="checkbox" data-prova-confirm> Confermo la prova solo a CEO e il testo esatto mostrato, secondo l’ordine di Davide.</label><button type="button" data-prova-create disabled>Crea unica richiesta nella coda reale</button><button type="button" data-prova-refresh>Rileggi senza creare</button>';
        const checkbox=actions.querySelector('[data-prova-confirm]'),button=actions.querySelector('[data-prova-create]');
        checkbox.onchange=()=>{button.disabled=!checkbox.checked;};
        actions.querySelector('[data-prova-refresh]').onclick=refresh;
        button.onclick=async()=>{if(button.disabled || !checkbox.checked)return;button.disabled=true;try{await createRequest(guarded,session,preview,checkbox.checked);await load(t,session);}catch(e){say(e.message,t,session);checkbox.checked=false;}};
      }
    }
    function open(c) {
      stop();if(!box || c?.slug!==SLUG)return;
      try{
        const session=identity(options),t=token;client={slug:SLUG};
        box.innerHTML='<div class="panel"><h3>Prova reale email CEO</h3><p data-prova-status role="status">Lettura dal server…</p></div>';
        if(typeof options.auth.onAuthStateChanged==='function')offAuth=options.auth.onAuthStateChanged(()=>{if(!current(t,session))stop();});
        load(t,session).catch(e=>say(e.message,t,session));
      }catch(e){box.innerHTML='<div class="panel">'+esc(e.message)+'</div>';}
    }
    return {open,stop};
  }
  return {createOutreachProvaCeo,identity,readFresh,prepare,createRequest,exportFresh,cleanup,exactText,findExisting,EMAIL,SLUG,PURPOSE,AUTHORIZATION,CONTACT_ID,ARCHIVE,SOURCE};
});

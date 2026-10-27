/* Collaudo ADMIN nel solo campo isolato. Nessun trasporto, accesso esterno o invio. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.createOutreachCollaudoCoda = api.createOutreachCollaudoCoda;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const FIELD = 'collaudo_coda_v1', EMAIL = 'ceo@davidecaiazzo.it';
  const MARK = 'collaudo-isolato-nessun-invio';
  const ALLOWED = new Set(['richiesta','annullata','sospesa','in_corso','da_verificare']);
  const key = email => typeof email === 'string' ? email.trim().toLowerCase() : '';
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const fail = message => { throw Error(message); };
  const validSlug = slug => typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,100}$/.test(slug);
  function identity(auth) {
    const user = auth.currentUser;
    if (!user || !key(user.email) || !user.uid) fail('Accesso amministratore necessario.');
    return {email:key(user.email),uid:user.uid};
  }
  function owned(value, session) {
    return !!session && !!value && value.kind === MARK && value.client_slug === session.slug && value.owner_email === session.email && value.owner_uid === session.uid && value.run_id === session.runId;
  }
  function localGuard(options, session) {
    const actor = identity(options.auth);
    if (!options.isAdmin() || actor.email !== session.email || actor.uid !== session.uid || !validSlug(session.slug) || (options.isCurrent && !options.isCurrent())) fail('Accesso, sessione o cliente cambiato: collaudo fermato.');
  }
  function adminsGuard(snapshot, session) {
    const emails = snapshot.data()?.emails;
    if (!Array.isArray(emails) || !emails.some(email => key(email) === session.email)) fail('Operatore non più amministratore.');
  }
  function validateState(state, slug, domain) {
    const next = domain.validate(state, slug);
    const c = next.contacts[0];
    if (next.contacts.length !== 1 || c.id !== 'collaudo-ceo' || c.email !== EMAIL || c.email_verificata !== true || c.scope !== 'outreach' || !c.nome.startsWith('COLLAUDO') || c.profilo || c.conversazione_url || c.internal || next.calls.length || next.reports.length || domain.STAGES.some(stage => next.coverage[stage] !== false)) fail('Il collaudo consente soltanto il contatto interno e nessun dato di produzione.');
    for (const request of next.outbox) {
      if (request.contact_id !== c.id || request.tipo !== 'email' || request.destinatario !== EMAIL || !ALLOWED.has(request.stato) || request.sent_at || request.sent_by || request.delivered_at || request.delivered_by || request.delivery_evidence || request.conversation_url) fail('Stato o destinatario non consentito nel collaudo: nessun invio o consegna.');
    }
    if (/linkedin\.com/i.test(JSON.stringify(next))) fail('Nessun collegamento LinkedIn consentito nel collaudo.');
    return next;
  }
  function fixture(slug, domain, now = new Date().toISOString(), actor = EMAIL) {
    const state = domain.empty(slug);
    Object.assign(state,{source:'COLLAUDO ISOLATO — campi e coda; nessuna lettura nuova, nessun invio',verified_at:now,updated_at:now});
    state.contacts = [{id:'collaudo-ceo',nome:'COLLAUDO — account interno CEO',email:EMAIL,email_verificata:true,scope:'outreach',ingresso:now,events:{},bozza:'COLLAUDO ISOLATO — questo testo non deve essere inviato.',tipo_risposta:'da_classificare',tipo_interesse:'da_classificare',conversazione_verificata_il:now,responsabile:'COLLAUDO interno',prossimo_passo:'Verificare solo i campi isolati, senza invii'}];
    return validateState(state,slug,domain);
  }
  function createAdapter(options, session) {
    const domain = options.domain || root.OutreachMonitoraggio;
    localGuard(options,session);
    const rawRef = options.db.collection('clienti').doc(session.slug);
    const adminsRef = options.db.collection('config').doc('admins');
    const refs = new Map();
    function project(snapshot) {
      localGuard(options,session);
      if (!snapshot.exists || !owned(snapshot.data()?.[FIELD],session)) fail('Collaudo assente o appartenente a un’altra esecuzione.');
      return {exists:snapshot.exists,id:session.slug,data:()=>{
        localGuard(options,session);
        const data=copy(snapshot.data());
        const isolated=data[FIELD];
        delete data[FIELD];
        data.monitoraggio_v1=validateState(isolated.stato,session.slug,domain);
        return data;
      }};
    }
    const clientRef = Object.freeze({
      get:async()=>{localGuard(options,session);const [snapshot,admins]=await Promise.all([rawRef.get(),adminsRef.get()]);localGuard(options,session);adminsGuard(admins,session);return project(snapshot);},
      onSnapshot:(next,error)=>{
        localGuard(options,session);
        let live=true;
        const off=rawRef.onSnapshot(snapshot=>{
          Promise.resolve().then(()=>adminsRef.get()).then(admins=>{if(!live)return;localGuard(options,session);adminsGuard(admins,session);next(project(snapshot));}).catch(e=>{if(live && error)error(e);});
        },e=>{if(live && error)error(e);});
        return ()=>{live=false;off();};
      },
      update:patch=>adapter.runTransaction(transaction=>transaction.update(clientRef,patch))
    });
    refs.set(clientRef,{type:'client',real:rawRef});
    function configRef(id) {
      if (!['admins','approvatori_messaggi'].includes(id)) fail('Configurazione non consentita nel collaudo.');
      const real=options.db.collection('config').doc(id);
      const ref=Object.freeze({get:()=>{localGuard(options,session);return real.get();}});
      refs.set(ref,{type:'config',real});return ref;
    }
    const adapter = Object.freeze({
      collection:name=>Object.freeze({doc:id=>{
        localGuard(options,session);
        if(name==='clienti' && id===session.slug)return clientRef;
        if(name==='config')return configRef(id);
        return fail('Il collaudo non può accedere ad altri clienti o raccolte.');
      }}),
      runTransaction:callback=>{
        localGuard(options,session);
        return options.db.runTransaction(async transaction=>{
          const [snapshot,admins]=await Promise.all([transaction.get(rawRef),transaction.get(adminsRef)]);
          localGuard(options,session);adminsGuard(admins,session);project(snapshot);
          let written=false;
          const wrapped=Object.freeze({
            get:async ref=>{
              localGuard(options,session);const info=refs.get(ref);
              if(!info || written)fail('Lettura non consentita dopo la scrittura o riferimento estraneo.');
              return info.type==='client'?project(snapshot):transaction.get(info.real);
            },
            update:(ref,patch)=>{
              localGuard(options,session);
              if(ref!==clientRef || written || !patch || Array.isArray(patch) || Object.keys(patch).length!==1 || !Object.hasOwn(patch,'monitoraggio_v1')) fail('È scrivibile soltanto lo stato della prova isolata.');
              const state=validateState(patch.monitoraggio_v1,session.slug,domain);
              written=true;transaction.update(rawRef,{[FIELD+'.stato']:state});
            }
          });
          const result=await callback(wrapped);
          localGuard(options,session);
          return result;
        });
      }
    });
    return adapter;
  }
  async function removeOwnFixture(options, session) {
    localGuard(options,session);
    if(typeof options.fieldDelete!=='function')fail('Eliminazione campo non disponibile.');
    const ref=options.db.collection('clienti').doc(session.slug),adminsRef=options.db.collection('config').doc('admins');
    let before;
    await options.db.runTransaction(async transaction=>{
      const [snapshot,admins]=await Promise.all([transaction.get(ref),transaction.get(adminsRef)]);
      localGuard(options,session);adminsGuard(admins,session);
      if(!snapshot.exists || !owned(snapshot.data()?.[FIELD],session))fail('Prova di un’altra esecuzione: nessuna eliminazione.');
      before=(options.domain || root.OutreachMonitoraggio).signature(snapshot.data()?.monitoraggio_v1);
      transaction.update(ref,{[FIELD]:options.fieldDelete()});
    });
    const saved=await ref.get({source:'server'});
    localGuard(options,session);
    if(saved.data()?.[FIELD]!==undefined)fail('L’assenza del campo di prova non è confermata. Riaprire il pannello.');
    if((options.domain || root.OutreachMonitoraggio).signature(saved.data()?.monitoraggio_v1)!==before)fail('Prova eliminata; il monitoraggio reale risulta cambiato durante la pulizia. Verificare le modifiche concorrenti.');
  }
  function createOutreachCollaudoCoda(options) {
    const domain=options.domain || root.OutreachMonitoraggio;
    const box=options.box || root.document.getElementById('collaudoCoda');
    let token=0,client=null,renderer=null,session=null,offAuth=null;
    const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function stop() {++token;if(renderer)renderer.stop();renderer=null;session=null;client=null;if(offAuth)offAuth();offAuth=null;if(box)box.innerHTML='';}
    function say(message) {const el=box?.querySelector('[data-collaudo-status]');if(el)el.textContent=message;}
    function current(t,actor,slug) {return t===token && client?.slug===slug && options.isAdmin() && options.auth.currentUser?.uid===actor.uid && key(options.auth.currentUser?.email)===actor.email;}
    function frame() {
      box.innerHTML='<div class="panel"><h3>Collaudo isolato della coda · solo amministratori</h3><p role="note"><strong>AREA DI TEST — nessun invio, nessuna consegna, nessun dato nei risultati reali.</strong> Il processo automatico non legge questo campo. La prova controlla solo campi e passaggi della coda.</p><div data-collaudo-actions></div><p data-collaudo-status role="status" aria-live="polite"></p></div><details class="panel"><summary>Campo isolato salvato · sola lettura</summary><button type="button" data-collaudo-export>Aggiorna lettura dal server</button><textarea data-collaudo-json rows="8" readonly></textarea></details><div data-collaudo-renderer></div>';
    }
    function mount(t,actor,slug,runId) {
      if(!current(t,actor,slug))fail('Sessione di collaudo cambiata.');
      session={...actor,slug,runId};
      const mountedSession=session;
      const adapter=createAdapter({...options,isCurrent:()=>current(t,actor,slug),domain},session);
      const target=box.querySelector('[data-collaudo-renderer]');
      const readExport=async()=>{
        const raw=await options.db.collection('clienti').doc(slug).get({source:'server'});
        if(!current(t,actor,slug) || session!==mountedSession)return;
        const value=raw.data()?.[FIELD];
        if(!owned(value,session))fail('Campo di prova non più appartenente a questa esecuzione.');
        box.querySelector('[data-collaudo-json]').value=JSON.stringify(value,null,2);
      };
      box.querySelector('[data-collaudo-export]').onclick=()=>readExport().catch(e=>say(e.message));
      readExport().catch(e=>say(e.message));
      if(renderer)renderer.stop();
      renderer=root.createOutreachMonitoraggio({db:adapter,auth:options.auth,isAdmin:()=>current(t,actor,slug),box:target,testMode:true});
      renderer.open(client);
      const actions=box.querySelector('[data-collaudo-actions]');
      actions.innerHTML='<button type="button" data-collaudo-reload>Rileggi prova salvata</button><button type="button" data-collaudo-cleanup>Elimina solo questa prova</button>';
      actions.querySelector('[data-collaudo-reload]').onclick=async()=>{try{await adapter.collection('clienti').doc(slug).get();if(!current(t,actor,slug))return;renderer.open(client);say('Prova isolata riletta. Nessun invio effettuato.');}catch(e){say(e.message);}};
      actions.querySelector('[data-collaudo-cleanup]').onclick=async e=>{
        const button=e.currentTarget;button.disabled=true;
        try{
          await removeOwnFixture({...options,isCurrent:()=>current(t,actor,slug)},session);
          if(!current(t,actor,slug))return;
          if(renderer)renderer.stop();renderer=null;session=null;
          box.querySelector('[data-collaudo-json]').value='';
          await inspect(t,actor,slug);
          say('Prova isolata eliminata; assenza confermata dal server. Monitoraggio reale invariato.');
        }catch(error){say(error.message);button.disabled=false;}
      };
      say('Prova isolata attiva. Apri la scheda standard o «Controlla richiesta e riscontri». Nessun messaggio viene trasmesso.');
    }
    async function inspect(t,actor,slug) {
      const ref=options.db.collection('clienti').doc(slug),adminsRef=options.db.collection('config').doc('admins');
      const [snapshot,admins]=await Promise.all([ref.get(),adminsRef.get()]);
      if(!current(t,actor,slug))return;
      adminsGuard(admins,{...actor,slug});
      if(!snapshot.exists)fail('Cliente non disponibile.');
      const existing=snapshot.data()?.[FIELD],actions=box.querySelector('[data-collaudo-actions]');
      if(existing!==undefined){
        const resumable=existing?.kind===MARK && existing.client_slug===slug && existing.owner_email===actor.email && existing.owner_uid===actor.uid && typeof existing.run_id==='string' && existing.run_id;
        actions.innerHTML=resumable?'<button type="button" data-collaudo-resume>Riprendi il tuo collaudo esistente</button>':'';
        say(resumable?'È presente una tua prova isolata. Puoi riprenderla e rimuoverla al termine.':'Esiste una prova diversa: non viene sostituita né eliminata.');
        if(resumable)actions.querySelector('[data-collaudo-resume]').onclick=()=>{try{mount(t,actor,slug,existing.run_id);}catch(e){say(e.message);}};
        return;
      }
      actions.innerHTML='<button type="button" data-collaudo-start>Avvia prova isolata — nessun invio</button>';
      actions.querySelector('[data-collaudo-start]').onclick=async e=>{
        const button=e.currentTarget;button.disabled=true;
        try{
          const runId=root.crypto.randomUUID(),newSession={...actor,slug,runId};
          await options.db.runTransaction(async transaction=>{
            const [latest,roles]=await Promise.all([transaction.get(ref),transaction.get(adminsRef)]);
            if(!current(t,actor,slug))fail('Sessione o cliente cambiato: avvio annullato.');
            adminsGuard(roles,newSession);
            if(!latest.exists)fail('Cliente non disponibile.');
            if(latest.data()?.[FIELD]!==undefined)fail('Un altro collaudo è già presente: nessuna sostituzione.');
            const now=new Date().toISOString();
            transaction.update(ref,{[FIELD]:{kind:MARK,client_slug:slug,owner_email:actor.email,owner_uid:actor.uid,run_id:runId,created_at:now,stato:fixture(slug,domain,now,actor.email)}});
          });
          if(!current(t,actor,slug))return;
          const saved=await ref.get();
          if(!current(t,actor,slug))return;
          if(!owned(saved.data()?.[FIELD],newSession))fail('Salvataggio della prova non confermato.');
          mount(t,actor,slug,runId);
        }catch(error){say(error.message);button.disabled=false;}
      };
    }
    function open(c) {
      stop();if(!box || !options.isAdmin() || !options.auth.currentUser)return;
      try{
        if(!validSlug(c?.slug))fail('Cliente non valido.');
        const actor=identity(options.auth),t=token,slug=c.slug;client={...c};frame();
        if(typeof options.auth.onAuthStateChanged==='function')offAuth=options.auth.onAuthStateChanged(()=>{if(!current(t,actor,slug))stop();});
        inspect(t,actor,slug).catch(e=>{if(current(t,actor,slug))say(e.message);});
      }catch(error){if(box)box.innerHTML='<div class="panel">'+esc(error.message)+'</div>';}
    }
    return {open,stop};
  }
  return {createOutreachCollaudoCoda,createAdapter,fixture,validateState,removeOwnFixture,FIELD,MARK};
});

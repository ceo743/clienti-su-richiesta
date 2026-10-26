/* Pannello aggiuntivo della dashboard originale: nessun invio esterno. */
window.createOutreachMonitoraggio = function (options) {
  'use strict';
  const D = window.OutreachMonitoraggio;
  const Report = window.OutreachReportExport;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const pretty = value => value ? new Date(value).toLocaleString('it-IT',{timeZone:'Europe/Rome'}) : 'non disponibile';
  const labels = Object.fromEntries(D.STAGES.map((s,i)=>[s,D.LABELS[i]]));
  const words = {da_classificare:'Da classificare',cortesia:'Cortesia / grazie',proposta:'Risposta alla proposta / CTA',negativa:'Negativa',bisogno_call:'Bisogno concreto / call',materiale:'Solo materiale',richiesta:'Da eseguire · non ancora inviata',annullata:'Richiesta annullata',inviato:'Invio provato',consegnato:'Consegna provata',errore:'Errore'};
  let client = null, state = null, stopListener = null, active = 0, filters = null, draftImport = null, editing = false;
  const box = document.getElementById('monitoraggio');
  function stop() { ++active; if (stopListener) stopListener(); stopListener=null; client=null; state=null; draftImport=null; editing=false; box.innerHTML=''; }
  function say(message, error=false) { const el=box.querySelector('[data-status]'); if(el){el.textContent=message;el.className=error?'msg err':'msg ok';} }
  function defaults() { const al=D.day(new Date().toISOString()); return {dal:new Date(Date.parse(al+'T12:00:00Z')-29*86400000).toISOString().slice(0,10),al,settore:'',tema:'',target:''}; }
  const canEdit = () => !!options.auth.currentUser && (options.isAdmin() || options.isApprovatore());
  function open(c) {
    stop(); client=c; filters=defaults(); const token=active;
    box.innerHTML='<div class="panel"><h3>Monitoraggio operativo</h3><p>Caricamento dati verificati…</p></div>';
    stopListener=options.db.collection('clienti').doc(c.slug).onSnapshot(snapshot=>{
      if (token!==active) return;
      const data=snapshot.data() || {};
      client={...c,...data,slug:c.slug};
      const value=data.monitoraggio_v1;
      try { state=value ? D.validate(value,c.slug) : null; if(!editing) render(); else say('I dati sono stati aggiornati. Le modifiche aperte saranno confrontate prima del salvataggio.'); }
      catch(e) { state=null;box.innerHTML='<div class="panel"><h3>Monitoraggio non disponibile</h3><p>'+esc(e.message)+'</p></div>'; }
    },()=>{ if(token===active) box.innerHTML='<div class="panel"><h3>Monitoraggio non disponibile</h3><p>Permesso di lettura non disponibile. Nessun dato è stato modificato.</p></div>'; });
  }
  async function mutate(change, expected, expectedControl) {
    const slug=client?.slug, token=active;
    const actor=options.auth.currentUser?.email;
    if(!slug || !canEdit()) throw Error('Modifica riservata agli operatori abilitati.');
    await options.db.runTransaction(async transaction=>{
      const ref=options.db.collection('clienti').doc(slug), snapshot=await transaction.get(ref);
      if(token!==active || !canEdit() || options.auth.currentUser?.email!==actor) throw Error('Accesso o cliente cambiato: operazione annullata.');
      const raw=snapshot.data()?.monitoraggio_v1;
      if(expectedControl!==undefined && JSON.stringify(snapshot.data()?.controllo_v1 || null)!==expectedControl) throw Error('Controllo cliente aggiornato: prepara di nuovo il report.');
      if(expected!==undefined && JSON.stringify(raw ? D.validate(raw,slug) : null)!==expected) throw Error('Dati aggiornati da un altro operatore. Riapri il pannello prima di salvare.');
      const latest=raw ? D.validate(raw,slug) : D.empty(slug);
      const next=change(latest) || latest;
      next.updated_at=new Date().toISOString();
      transaction.update(ref,{monitoraggio_v1:D.validate(next,slug)});
    });
  }
  function select(key, value, values) { return '<select data-field="'+key+'">'+values.map(v=>'<option value="'+esc(v)+'" '+(v===value?'selected':'')+'>'+esc(words[v]||v)+'</option>').join('')+'</select>'; }
  function table(headers,rows) { return rows.length?'<div class="table-scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="empty">Nessun record verificato per questi filtri.</p>'; }
  function render() {
    draftImport=null; editing=false;
    const head='<div class="panel monitor-head"><h3>Monitoraggio operativo</h3><p>I totali richiedono una copertura completa. Lo storico resta separato. Nessuna automazione di invio viene attivata da questo pannello.</p><div data-status role="status" aria-live="polite"></div></div>';
    if(!state) { box.innerHTML=head+'<div class="panel"><p>Nessuna rilevazione operativa importata per questo cliente. I dati storici sotto non costituiscono i totali attuali.</p></div>'+reportBox()+importBox(); bindReport(); bindImport(); return; }
    let summary;
    try { summary=D.summarize(state,filters); } catch(e) {say(e.message,true);return;}
    const values=key=>[...new Set(state.contacts.map(c=>c[key]).filter(Boolean))].sort();
    const filter='<form data-filters class="panel monitor-filters"><label>Ingresso dal<input name="dal" type="date" value="'+esc(filters.dal)+'" required></label><label>Fino al<input name="al" type="date" value="'+esc(filters.al)+'" required></label>'+['settore','tema','target'].map(k=>'<label>'+({settore:'Settore',tema:'Topic',target:'Target'}[k])+'<select name="'+k+'"><option value="">Tutti</option>'+values(k).map(v=>'<option '+(filters[k]===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>').join('')+'<button type="submit">Applica</button><button type="button" data-all>Tutto il periodo</button><p>Stesse persone: ingresso nel periodo selezionato, avanzamento osservato fino alla data finale. Ogni percentuale usa solo persone presenti nel suo denominatore.</p></form>';
    const tiles='<div class="tiles">'+D.STAGES.map(k=>'<div class="tile"><div class="k">'+labels[k]+'</div><div class="v">'+(summary.counts[k]===null?'—':summary.counts[k])+'</div><div class="d">'+(summary.counts[k]===null?'Copertura incompleta · osservati '+summary.known[k]:'Persone uniche')+'</div></div>').join('')+'</div>';
    const coverage='<details class="panel"><summary>Copertura e fonti</summary><p>Fonte: '+esc(state.source)+' · verifica '+pretty(state.verified_at)+'</p>'+table(['Fase','Copertura'],D.STAGES.map(k=>[labels[k],state.coverage[k]&&!summary.unknownIngress?'Completa':'Parziale / non disponibile']))+'<p>Persone con ingresso non rilevato: '+summary.unknownIngress+'. Ultimo salvataggio: '+pretty(state.updated_at)+'. Le date mancanti non diventano zero.</p></details>';
    const rates='<div class="panel"><h3>Passaggi sulla stessa coorte</h3>'+table(['Passaggio','Persone convertite / base','Percentuale'],summary.rates.map(r=>[labels[r.d]+' → '+labels[r.n],r.numerator+' / '+r.denominator,r.value===null?'Non disponibile':r.value.toLocaleString('it-IT',{maximumFractionDigits:1})+'%']))+'</div>';
    const splits='<div class="grid2"><div class="panel"><h3>Tipi di risposta osservati</h3>'+table(['Risposta','Persone'],Object.entries(summary.responses).map(([k,v])=>[words[k],v]))+'</div><div class="panel"><h3>Tipi di interesse osservati</h3>'+table(['Interesse','Persone'],Object.entries(summary.interested).map(([k,v])=>[words[k],v]))+'<p>Un grazie da solo non produce un interesse.</p></div></div>';
    const backlog=D.summarize(state,{...filters,dal:'1900-01-01'}).waiting;
    const waiting='<div class="panel"><h3>Interessati senza prossimo passo</h3><p>Include anche gli ingressi precedenti al periodo. Attesa dall’ultima risposta della persona, fino al '+esc(filters.al)+'.</p>'+table(['Persona','Attesa','Responsabile','Ultima verifica','Azione'],backlog.map(c=>[esc(c.nome),c.attesa+' giorni',esc(c.responsabile||'Da assegnare'),pretty(c.conversazione_verificata_il),'<button data-edit="'+esc(c.id)+'">Apri scheda</button>']))+'</div>';
    const people='<details class="panel"><summary>Persone della coorte e classificazioni</summary>'+table(['Persona','Settore / topic / target','Risposta','Interesse','Esito','Scheda'],summary.contacts.map(c=>[esc(c.nome),[c.settore,c.tema,c.target].map(esc).join(' / '),esc(words[c.tipo_risposta]||'Da classificare'),esc(words[c.tipo_interesse]||'Da classificare'),esc(c.esito||'Non rilevato'),'<button data-edit="'+esc(c.id)+'">Apri</button>']))+'</details>';
    const calls='<div class="panel"><h3>Call e provenienza</h3><p>Prenotazioni create nel periodo, da tutte le fonti dichiarate: anche contatti entrati prima o fuori outreach. Prenotazione, svolgimento e vendita restano distinti.</p>'+table(['Persona','Prenotazione creata','Fissata per','Fatta','Fonte attribuita','Fonte dato / prova','Esito'],summary.calls.map(c=>[esc(state.contacts.find(p=>p.id===c.contact_id)?.nome||c.contact_id),pretty(c.creata),pretty(c.fissata_per),pretty(c.fatta_il),esc(c.fonte||'Da attribuire'),esc(c.source)+'<br>'+esc(c.source_evidence),esc(c.esito||'Non rilevato')]))+'</div>';
    const outbox='<details class="panel"><summary>Richieste nuove di invio</summary><p>Questa coda registra la richiesta; non invia. Nessuna vecchia approvazione è trasferita qui. Limite dieci richieste al giorno, nessun nuovo invito. Invio e consegna richiedono prove distinte.</p>'+table(['Persona','Creata / confermata','Testo','Stato','Azione'],state.outbox.map(r=>[esc(state.contacts.find(c=>c.id===r.contact_id)?.nome||r.contact_id),pretty(r.created_at)+'<br>'+pretty(r.confirmed_at),esc(r.testo),esc(words[r.stato]),r.stato==='richiesta'&&!r.sent_at&&canEdit()?'<button data-cancel="'+esc(r.id)+'">Annulla richiesta</button>':'—']))+'</details>';
    const reports=reportBox();
    box.innerHTML=head+filter+tiles+coverage+rates+splits+waiting+people+calls+outbox+reports+importBox()+'<div data-editor></div>';
    box.querySelector('[data-filters]').onsubmit=e=>{e.preventDefault(); const f=Object.fromEntries(new FormData(e.currentTarget));try{D.summarize(state,f);filters=f;render();}catch(error){say(error.message,true);}};
    box.querySelector('[data-all]').onclick=()=>{filters.dal=state.contacts.map(c=>D.day(c.ingresso)).sort()[0]||filters.dal;render();};
    box.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editor(b.dataset.edit));
    box.querySelectorAll('[data-cancel]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{if(!canEdit())throw Error('Operazione non disponibile.');await mutate(s=>{D.cancel(s,b.dataset.cancel);});say('Richiesta annullata nella dashboard. Nessun annullamento esterno è stato richiesto.');}catch(e){say(e.message,true);b.disabled=false;}});
    bindReport();
    bindImport();
  }
  function reportBox() {
    const schedule=client.slug==='davide-caiazzo'?'Report a Chiara programmato venerdì alle 11:00. Controllo delle nuove richieste approvate alle 09:00 e 16:00 dal lunedì al sabato. Ogni invio richiede una prova separata.':'Nessuna programmazione di invio configurata per questo cliente in questo pannello.';
    return '<div class="panel"><h3>Report commerciale</h3><p>Include controllo cliente, fasi, classificazioni, provenienza call, esiti, attese, responsabili, prossime azioni e copertura. La preparazione non invia email.</p><p>'+schedule+'</p><button data-report>Prepara report con dati disponibili</button><div data-report-body></div><p>Ultimo report salvato: '+pretty(state?.reports.at(-1)?.created_at)+'</p></div>';
  }
  function bindReport() {
    box.querySelector('[data-report]').onclick=async()=>{
      try {
        const expected=JSON.stringify(state), expectedControl=JSON.stringify(client.controllo_v1 || null);
        const output=Report.prepare(state,client,filters), report=output.report;
        box.querySelector('[data-report-body]').innerHTML='<label>Report completo — testo esportabile<textarea data-report-text readonly rows="18">'+esc(output.text)+'</textarea></label><details><summary>Versione HTML esportabile</summary><label>HTML completo<textarea data-report-html readonly rows="10">'+esc(output.html)+'</textarea></label></details>';
        if(!state) {say('Report preparato con limiti espliciti. Nessuna rilevazione creata e nessuna email inviata.');return;}
        if(!canEdit()) {say('Anteprima pronta. Salvataggio riservato agli operatori abilitati.');return;}
        await mutate(s=>{s.reports=[...s.reports.slice(-7),{id:report.id,created_at:report.created_at,stato:'preparato',periodo:report.periodo,testo:output.text,html:output.html,controllo_v1:report.controllo_v1}];},expected,expectedControl);
        say('Report preparato e salvato. Nessuna email inviata.');
      } catch(e) {say(e.message,true);}
    };
  }
  function editor(id) {
    const c=state.contacts.find(c=>c.id===id);if(!c)return;
    editing=true;const expected=JSON.stringify(state), target=box.querySelector('[data-editor]');
    target.innerHTML='<form class="panel monitor-editor"><h3>'+esc(c.nome)+'</h3><p>Classificazioni esplicite e testo per il target '+esc(c.target||'da definire')+'. Nessuna deduzione automatica.</p>'+[['tipo_risposta','Risposta',D.RESPONSE],['tipo_interesse','Interesse',D.INTEREST]].map(([k,t,v])=>'<label>'+t+select(k,c[k]||'da_classificare',v)+'</label>').join('')+['settore','tema','target','responsabile','prossimo_passo','esito'].map(k=>'<label>'+esc(({tema:'Topic',prossimo_passo:'Prossimo passo'}[k])||k)+'<input data-field="'+k+'" value="'+esc(c[k])+'" maxlength="2000"></label>').join('')+'<label>Bozza modificabile<textarea data-field="bozza" maxlength="6000" rows="5">'+esc(c.bozza)+'</textarea></label><label><input type="checkbox" data-reviewed> Ho verificato la conversazione e queste classificazioni</label><label>Tipo richiesta'+select('tipo_invio','messaggio',['messaggio','email'])+'</label><label><input type="checkbox" data-confirm> Confermo ora questo testo per una nuova richiesta di invio</label><div class="monitor-actions"><button type="submit" class="primary" '+(!canEdit()?'disabled':'')+'>Salva scheda</button><button type="button" data-request '+(!canEdit()?'disabled':'')+'>Registra richiesta di invio</button><button type="button" data-close>Chiudi scheda</button></div><p>La richiesta resta ferma finché l’operatività di invio non è autorizzata e verificata.</p></form>';
    const form=target.querySelector('form');
    const save=async send=>{
      const fields=Object.fromEntries([...form.querySelectorAll('[data-field]')].map(el=>[el.dataset.field,el.value]));
      if(!canEdit())return say('Modifica non disponibile.',true);
      if(!form.querySelector('[data-reviewed]').checked)return say('Conferma la verifica della conversazione.',true);
      if(send&&!form.querySelector('[data-confirm]').checked)return say('Serve una nuova conferma del testo.',true);
      const {tipo_invio:tipo,...patch}=fields;
      try {await mutate(s=>{const p=s.contacts.find(x=>x.id===id);if(!p)throw Error('Contatto non più presente.');Object.assign(p,patch,{conversazione_verificata_il:new Date().toISOString()});if(send)D.request(s,id,tipo,p.bozza,options.auth.currentUser.email);},expected);editing=false;render();say(send?'Richiesta nuova salvata. Nessun messaggio inviato.':'Scheda salvata per questo cliente.');}catch(e){say(e.message,true);}
    };
    form.onsubmit=e=>{e.preventDefault();save(false);};form.querySelector('[data-request]').onclick=()=>save(true);form.querySelector('[data-close]').onclick=()=>render();target.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function importBox() { return options.isAdmin()?'<details class="panel"><summary>Importa rilevazione verificata (amministratori)</summary><p>Lo slug deve coincidere con '+esc(client.slug)+'. L’importazione aggiorna solo monitoraggio_v1. I dati storici e le code originali restano invariati.</p><label>JSON<textarea data-import rows="6" spellcheck="false"></textarea></label><button data-preview>Verifica e mostra anteprima</button><div data-import-preview></div></details>':''; }
  function bindImport() {
    const button=box.querySelector('[data-preview]');if(!button)return;
    button.onclick=()=>{
      try {
        if(!options.isAdmin())throw Error('Importazione riservata agli amministratori.');
        const text=box.querySelector('[data-import]').value;if(text.length>700000)throw Error('File troppo grande.');
        draftImport=D.validateImport(JSON.parse(text),client.slug);const expected=JSON.stringify(state||null);
        const preview=box.querySelector('[data-import-preview]');preview.innerHTML='<p>Cliente '+esc(client.slug)+' · contatti '+draftImport.contacts.length+' · call '+draftImport.calls.length+' · fonte '+esc(draftImport.source)+' · verifica '+pretty(draftImport.verified_at)+'. La rilevazione operativa precedente sarà sostituita.</p><label><input type="checkbox" data-import-confirm> Confermo cliente, fonte e sostituzione della rilevazione</label><button data-import-save>Salva importazione verificata</button>';
        preview.querySelector('[data-import-save]').onclick=async()=>{try{if(!options.isAdmin()||!preview.querySelector('[data-import-confirm]').checked)throw Error('Confermare l’anteprima prima di salvare.');const next=D.validate(draftImport,client.slug);await mutate(()=>next,expected);render();say('Rilevazione importata. Storico e code originali conservati.');}catch(e){say(e.message,true);}};
      } catch(e) {draftImport=null;say(e.message,true);}
    };
  }
  return {open,stop};
};

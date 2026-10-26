/* Vista operativa interna; nessun invio, nessuna raccolta dati da LinkedIn. */
window.createOutreachControlloClienti = function (options) {
  'use strict';
  const D=window.OutreachControlloClienti;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pretty=value=>value ? new Date(value.length===10?value+'T12:00:00Z':value).toLocaleString('it-IT',{timeZone:'Europe/Rome',...(value.length===10?{year:'numeric',month:'2-digit',day:'2-digit'}:{})}) : 'Non disponibile';
  const box=document.getElementById('controlloCliente'), overview=document.getElementById('controlloClienti');
  const canEdit=()=>!!(options.auth.currentUser && (options.isAdmin() || options.isApprovatore()));
  let active=0, unsubscribe=null, client=null, control=null, editing=false;
  function stop() { ++active;if(unsubscribe)unsubscribe();unsubscribe=null;client=null;control=null;editing=false;box.innerHTML='';overview.innerHTML=''; }
  function say(text,error=false) { const target=(client?box:overview).querySelector('[data-control-status]');if(target){target.textContent=text;target.className=error?'msg err':'msg ok';} }
  function heading(c) { return '<h3>Controllo cliente — '+esc(c.nome||c.slug)+'</h3>'; }
  function open(c) {
    stop();client=c;const token=active;
    box.innerHTML='<div class="panel">'+heading(c)+'<p>Caricamento controllo…</p></div>';
    unsubscribe=options.db.collection('clienti').doc(c.slug).onSnapshot(snapshot=>{
      if(token!==active)return;
      if(!snapshot.exists){box.innerHTML='<div class="panel"><p>Cliente non più disponibile.</p></div>';return;}
      try {
        client={...snapshot.data(),slug:c.slug};
        control=client.controllo_v1?D.validate(client.controllo_v1,c.slug):D.empty(c.slug);
        options.onClient?.(client);
        if(editing)say('Un aggiornamento è arrivato. Il salvataggio controllerà la revisione aperta.');else render();
      } catch(e) {control=null;editing=false;box.innerHTML='<div class="panel">'+heading(c)+'<p>'+esc(e.message)+'</p></div>';}
    },()=>{if(token===active)box.innerHTML='<div class="panel">'+heading(c)+'<p>Controllo non disponibile: permesso di lettura mancante.</p></div>';});
  }
  function openOverview() {
    stop();if(!options.isAdmin())return;
    const token=active;
    overview.innerHTML='<div class="panel"><h3>Controllo clienti</h3><p>Caricamento…</p></div>';
    unsubscribe=options.db.collection('clienti').onSnapshot(snapshot=>{
      if(token!==active || !options.isAdmin())return;
      const clients=snapshot.docs.map(d=>({...d.data(),slug:d.id})).sort((a,b)=>(a.nome||a.slug).localeCompare(b.nome||b.slug));
      options.onClients?.(clients);
      const rows=clients.map(c=>{
        try {const {control:s,requests,overdue}=D.summary(c);return '<tr><td><strong>'+esc(c.nome||c.slug)+'</strong><br>'+esc(c.brand||'')+'</td><td>'+esc(D.STATI[s.stato])+(overdue?'<br><strong>Scadenza superata</strong>':'')+'</td><td>'+esc(s.fonte||'Non disponibile')+'<br>'+pretty(s.data_fonte)+'</td><td>'+pretty(s.ultimo_controllo)+'</td><td>'+esc(s.responsabile||'Da assegnare')+'<br>'+esc(s.prossimo_passo||'Da definire')+'<br>'+pretty(s.scadenza)+'</td><td>'+esc(s.esito||'Non rilevato')+'<br>'+esc(s.riscontro||'Nessun riscontro registrato')+'</td><td>'+(requests===null?'Non disponibili':requests)+'</td><td><button data-control-open="'+esc(c.slug)+'">Apri cliente</button></td></tr>';}
        catch(e){return '<tr><td>'+esc(c.nome||c.slug)+'</td><td colspan="6">Controllo non disponibile: '+esc(e.message)+'</td><td><button data-control-open="'+esc(c.slug)+'">Apri cliente</button></td></tr>';}
      }).join('');
      overview.innerHTML='<div class="panel"><h3>Controllo clienti</h3><p>La data della fonte indica quando risalgono i dati reali. L’ultimo controllo indica quando un operatore li ha esaminati. Aprire una scheda non aggiorna nessuna data.</p><div data-control-status role="status" aria-live="polite"></div><div class="table-scroll"><table><thead><tr>'+['Cliente','Stato controllo','Fonte / data reale','Ultimo controllo','Responsabile / prossimo passo / scadenza','Esito / riscontro','Richieste nuove','Scheda'].map(t=>'<th>'+t+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table></div><p>Le richieste nuove appartengono al monitoraggio corrente; i messaggi e le approvazioni originali sono nella coda storica separata sotto. Nessun dato LinkedIn o Taplio viene raccolto da questa vista.</p></div>';
      overview.querySelectorAll('[data-control-open]').forEach(button=>button.onclick=()=>{const c=clients.find(c=>c.slug===button.dataset.controlOpen);if(c)options.openClient(c);});
    },()=>{if(token===active)overview.innerHTML='<div class="panel"><h3>Controllo clienti</h3><p>Elenco non disponibile: permesso di lettura mancante.</p></div>';});
  }
  function render() {
    if(!client || !control)return;
    const s=control, summary=D.summary(client);
    box.innerHTML='<div class="panel">'+heading(client)+'<p><strong>'+esc(D.STATI[s.stato])+'</strong>'+(summary.overdue?' · Scadenza superata':'')+'</p><div class="control-grid">'+[['Fonte reale',s.fonte||'Non disponibile'],['Data reale della fonte',pretty(s.data_fonte)],['Ultimo controllo',pretty(s.ultimo_controllo)],['Responsabile',s.responsabile||'Da assegnare'],['Prossimo passo',s.prossimo_passo||'Da definire'],['Scadenza',pretty(s.scadenza)],['Esito',s.esito||'Non rilevato'],['Riscontro concreto',s.riscontro||'Non disponibile']].map(([label,value])=>'<div><strong>'+label+'</strong><br>'+esc(value)+'</div>').join('')+'</div><p>Controllato da: '+esc(s.controllato_da||'Non registrato')+'. Ultima modifica scheda: '+pretty(s.updated_at)+'.</p><div data-control-status role="status" aria-live="polite"></div>'+(canEdit()?'<button data-control-edit>Modifica controllo cliente</button>':'<p>Controllo in sola lettura.</p>')+'<div data-control-editor></div></div>';
    const button=box.querySelector('[data-control-edit]');if(button)button.onclick=editor;
  }
  function editor() {
    if(!canEdit() || !control)return;
    editing=true;
    const expectedRevision=control.revision, s={...control}, token=active, slug=client.slug, actor=options.auth.currentUser.email;
    const target=box.querySelector('[data-control-editor]');
    target.innerHTML='<form class="control-form"><p>Stai modificando solo il controllo di <strong>'+esc(client.nome||slug)+'</strong>. Nome, brand e dati storici restano quelli originali.</p><label>Stato controllo<select name="stato">'+Object.entries(D.STATI).map(([key,label])=>'<option value="'+key+'" '+(s.stato===key?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+[['fonte','Fonte reale e riferimento'],['data_fonte','Data reale della fonte'],['responsabile','Responsabile'],['prossimo_passo','Prossimo passo'],['scadenza','Scadenza'],['esito','Esito del controllo'],['riscontro','Riscontro concreto (documento, riferimento o prova rintracciabile)']].map(([key,label])=>'<label>'+label+(key==='esito'||key==='riscontro'?'<textarea name="'+key+'" maxlength="2000">'+esc(s[key])+'</textarea>':'<input name="'+key+'" type="'+(['data_fonte','scadenza'].includes(key)?'date':'text')+'" value="'+esc(s[key])+'" maxlength="2000">')+'</label>').join('')+'<label><input data-control-reviewed type="checkbox"> Ho esaminato ora la fonte e il riscontro riportati per questo cliente</label><p>Lo stato Verificato richiede questa conferma, la data della fonte, un esito e un riscontro concreto. Un semplice salvataggio non aggiorna l’ultimo controllo.</p><button type="submit" class="primary">Salva controllo</button> <button type="button" data-control-close>Chiudi modifiche</button></form>';
    const form=target.querySelector('form');
    form.querySelector('[data-control-close]').onclick=()=>{editing=false;render();};
    form.onsubmit=async event=>{
      event.preventDefault();const submit=form.querySelector('[type="submit"]');submit.disabled=true;
      try {
        const fields=Object.fromEntries(new FormData(form));
        const saved=await D.commit({db:options.db,slug,expectedRevision,fields,actor,reviewed:form.querySelector('[data-control-reviewed]').checked,canEdit,isCurrent:()=>token===active && client?.slug===slug && options.auth.currentUser?.email===actor});
        if(token!==active)return;
        control=saved;client={...client,controllo_v1:saved};options.onClient?.(client);editing=false;render();say('Controllo salvato per questo cliente.');
      }catch(e){if(token===active){say(e.message,true);submit.disabled=false;}}
    };
  }
  return {open,openOverview,stop};
};

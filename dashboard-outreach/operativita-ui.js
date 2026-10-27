/* Prove mostrate al cliente: registrare una prova non esegue alcun invio. */
window.createOutreachOperativita=function(options){
  'use strict';const D=window.OutreachOperativita,box=document.getElementById('statoOperativo');
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const when=x=>new Date(x).toLocaleString('it-IT',{timeZone:'Europe/Rome'});
  // Firestore può restituire le chiavi in ordine diverso da quello inviato.
  const signatureOf=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
  let client=null,state=null,unsubscribe=null,generation=0,fingerprint=null,expectedSignature=null;
  const stop=()=>{generation++;if(unsubscribe)unsubscribe();unsubscribe=null;client=null;state=null;fingerprint=null;expectedSignature=null;box.innerHTML='';};
  const canEdit=()=>!!options.auth.currentUser&&options.isAdmin();
  function render(){
    const items=D.summarize(state,client.slug),byType=Object.fromEntries(items.map(item=>[item.funzione,item.latest]));
    const verified=funzione=>byType[funzione]?.esito==='verificato';
    const rows=[];
    const add=(funzione,title,description)=>{
      const e=byType[funzione],ok=verified(funzione);
      let pending='Manca una verifica con un’esecuzione reale.';
      if(e?.esito==='bloccato')pending='Bloccato: '+e.riscontro;
      else if(e?.esito==='incerto')pending='Esito da verificare: '+e.riscontro;
      else if(e?.esito==='canale_verificato')pending='Verificato il solo canale LinkedIn. Il percorso dalla coda all’invio resta da verificare.';
      if(funzione==='report_automatico'&&!ok){
        pending=verified('report_calendario')?'Da verificare al prossimo invio: il giro anti-duplicato ha saltato un report già spedito e non prova l’invio di uno nuovo.':'Nessun nuovo invio automatico del report è stato provato.';
        if(['bloccato','incerto'].includes(e?.esito))pending+=' '+(e.esito==='bloccato'?'Bloccato: ':'Esito da verificare: ')+e.riscontro;
      }
      rows.push({title,ok,description:ok?description:pending});
    };
    add('controllo_clienti','Controllo del cliente','Il controllo del cliente è stato salvato e riletto.');
    add('invio_linkedin','Invii LinkedIn dalla coda','Verificato il percorso dalla coda all’invio su LinkedIn, con esito salvato e riletto. Consegna e lettura non verificate.');
    if(verified('report_email')&&verified('report_coordinato'))rows.push({title:'Preparazione e invio del report',ok:true,description:'Report generato dalla dashboard e inviato, con messaggio e allegato ricontrollati.'});
    else{
      add('report_email','Invio del report via email','Report inviato, con messaggio e allegato ricontrollati.');
      add('report_coordinato','Preparazione e invio del report dalla dashboard','Verificati generazione, invio e riscontro del report.');
    }
    add('report_calendario','Avvio del calendario e controllo dei doppioni','Il calendario si è avviato e ha bloccato il report già inviato. Ripristinato il venerdì alle 11.');
    add('coda_email_ceo','Email dalla coda a Davide','Verificato il percorso dalla coda all’arrivo dell’email nella casella di Davide.');
    add('report_automatico','Invio di un nuovo report settimanale','Verificato l’invio di un nuovo report dal calendario settimanale.');
    const group=(ok,title)=>'<section data-operativita-'+(ok?'verified':'pending')+'><h4>'+title+'</h4>'+(rows.filter(row=>row.ok===ok).map(row=>'<article><h5>'+esc(row.title)+'</h5><p>'+esc(row.description)+'</p></article>').join('')||'<p>'+(ok?'Nessuna funzione ancora verificata.':'Nessuna verifica in sospeso.')+'</p>')+'</section>';
    const detailFields={id:'Identificativo',origine:'Origine',automazione_id:'Automazione',esecuzione_id:'Esecuzione',messaggio_id:'Messaggio',destinatario:'Destinatario',filo:'Conversazione ufficiale',richiesta_id:'Richiesta',presa_id:'Presa in carico',sha256_html:'Impronta allegato',sha256_manifest:'Impronta manifest',sha256_ricevuta:'Impronta ricevuta',sha256_raw:'Impronta messaggio originale',sha256_testo:'Impronta testo',sha256_evento:'Impronta evento',sha256_ripristino:'Impronta ripristino',ripristino_rrule:'Calendario ripristinato'};
    const history=(state?.entries||[]).map(e=>'<article><h4>'+esc(D.TYPES[e.funzione])+'</h4><p><strong>'+esc(D.RESULTS[e.esito])+'</strong></p><p>'+esc(e.riscontro)+'</p><p>Verifica: '+esc(when(e.eseguito_il))+(e.periodo?' · periodo '+esc(e.periodo.dal)+' / '+esc(e.periodo.al):'')+'</p><p>Fonte: '+esc(e.fonte)+'</p>'+Object.keys(detailFields).filter(key=>Object.hasOwn(e,key)).map(key=>'<p>'+esc(detailFields[key])+': '+esc(e[key])+'</p>').join('')+'<p>Registrato da '+esc(e.registrato_da)+' il '+esc(when(e.registrato_il))+'</p></article>').join('');
    box.innerHTML='<div class="panel" data-operativita-current><h3>Cosa funziona davvero</h3>'+group(true,'Funziona · verificato')+group(false,'Da verificare')+'<div data-operativita-status role="status" aria-live="polite"></div></div><details class="panel" data-operativita-history><summary>Storico dei collaudi</summary><p>Le prove originali restano qui, comprese simulazioni e blocchi superati.</p>'+(history||'<p>Nessuna prova registrata.</p>')+'<details><summary>Registro delle prove</summary><label>Registro esportabile<textarea data-operativita-export rows="8" readonly>'+esc(JSON.stringify(state||D.empty(client.slug),null,2))+'</textarea></label></details></details>'+(canEdit()?'<details class="panel"><summary>Registra un riscontro già verificato</summary><p>Solo esiti reali e riferimenti controllati per questo cliente. La registrazione non esegue messaggi, email o prove automatiche.</p><label>Prove verificate del cliente<textarea data-operativita-input rows="8" spellcheck="false"></textarea></label><label><input type="checkbox" data-operativita-reviewed> Ho controllato fonte, cliente e riscontro esatti</label><button data-operativita-save>Salva riscontro verificato</button></details>':'');
    const b=box.querySelector('[data-operativita-save]');if(b)b.onclick=save;
  }
  async function save(){
    const status=box.querySelector('[data-operativita-status]'),button=box.querySelector('[data-operativita-save]');
    const fail=e=>{status.textContent=e.message;status.className='msg err';button.disabled=false;};
    try{
      if(!canEdit()||!box.querySelector('[data-operativita-reviewed]').checked)throw Error('Conferma la verifica dei riscontri.');
      const input=box.querySelector('[data-operativita-input]').value;if(input.length>50000)throw Error('Prova troppo grande.');
      const payload=JSON.parse(input),slug=client.slug,actor=options.auth.currentUser.email,token=generation,revision=state?.revision||0;
      button.disabled=true;
      await options.db.runTransaction(async t=>{
        const ref=options.db.collection('clienti').doc(slug),snapshot=await t.get(ref);
        if(!snapshot.exists||token!==generation||!canEdit()||actor!==options.auth.currentUser?.email)throw Error('Cliente o accesso cambiato: salvataggio annullato.');
        const next=D.append(snapshot.data().operativita_v1,slug,revision,payload,actor);expectedSignature=signatureOf(next);t.update(ref,{operativita_v1:next});
      });
    }catch(e){expectedSignature=null;fail(e);}
  }
  function open(c){stop();client=c;const token=generation;box.innerHTML='<p>Caricamento prove operative…</p>';
    unsubscribe=options.db.collection('clienti').doc(c.slug).onSnapshot(s=>{if(token!==generation)return;try{
      const next=s.data()?.operativita_v1?D.validate(s.data().operativita_v1,c.slug):null,signature=signatureOf(next);
      if(signature===fingerprint)return;
      const input=box.querySelector('[data-operativita-input]'),dirty=!!input&&(!!input.value.trim()||box.querySelector('[data-operativita-reviewed]').checked);
      if(dirty&&signature!==expectedSignature){const status=box.querySelector('[data-operativita-status]');status.textContent='Registro aggiornato da un altro operatore. La tua bozza è conservata; riapri il cliente prima di salvarla.';status.className='msg err';return;}
      state=next;fingerprint=signature;if(signature===expectedSignature)expectedSignature=null;render();
    }catch(e){box.textContent='Prove non disponibili: '+e.message;}},()=>{if(token===generation)box.textContent='Prove non disponibili: permesso di lettura assente.';});
  }
  return {open,stop};
};

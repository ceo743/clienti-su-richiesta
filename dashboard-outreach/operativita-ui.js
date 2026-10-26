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
    const items=D.summarize(state,client.slug);
    box.innerHTML='<div class="panel"><h3>Cosa funziona davvero</h3><p>Richiesta salvata, invio e consegna sono passaggi distinti. Il calendario attivo non prova che il report automatico sia già partito.</p>'+items.map(item=>{
      const e=item.latest;return '<article><h4>'+esc(item.title)+'</h4><p><strong>'+esc(e?D.RESULTS[e.esito]:'Da collaudare · nessuna prova registrata')+'</strong></p>'+(e?'<p>'+esc(e.riscontro)+'</p><p>Verifica: '+esc(when(e.eseguito_il))+(e.periodo?' · periodo '+esc(e.periodo.dal)+' / '+esc(e.periodo.al):'')+'</p><details><summary>Fonte e riscontro</summary><p>'+esc(e.fonte)+'</p><p>Riferimento: '+esc(e.messaggio_id||e.esecuzione_id||e.id)+'</p><p>Registrato da '+esc(e.registrato_da)+' il '+esc(when(e.registrato_il))+'</p></details>':'')+'</article>';
    }).join('')+'<p>Un report inviato manualmente non collauda la partenza automatica. Un esito incerto non autorizza un secondo invio.</p><div data-operativita-status role="status" aria-live="polite"></div></div><details class="panel"><summary>Registro delle prove</summary><label>Registro esportabile<textarea data-operativita-export rows="8" readonly>'+esc(JSON.stringify(state||D.empty(client.slug),null,2))+'</textarea></label></details>'+(canEdit()?'<details class="panel"><summary>Registra un riscontro già verificato</summary><p>Solo esiti reali e riferimenti controllati per questo cliente. La registrazione non esegue messaggi, email o prove automatiche.</p><label>Prove verificate del cliente<textarea data-operativita-input rows="8" spellcheck="false"></textarea></label><label><input type="checkbox" data-operativita-reviewed> Ho controllato fonte, cliente e riscontro esatti</label><button data-operativita-save>Salva riscontro verificato</button></details>':'');
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

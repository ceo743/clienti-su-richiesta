/* Controllo cliente: soli dati dichiarati, separati dai riepiloghi storici. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OutreachControlloClienti = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const STATI = {da_controllare:'Da controllare',in_corso:'Controllo in corso',da_seguire:'Da seguire',bloccato:'Bloccato',verificato:'Verificato'};
  const CAMPI = ['stato','fonte','data_fonte','responsabile','prossimo_passo','scadenza','esito','riscontro'];
  const assert = (ok, message) => { if (!ok) throw Error(message); };
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
  const timestamp = value => typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value));
  const slugOk = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,100}$/.test(value);
  const text = (value, max=2000) => typeof value === 'string' && value.length <= max;
  function dayInRome(value=new Date().toISOString()) {
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
    return parts.year+'-'+parts.month+'-'+parts.day;
  }
  function empty(slug) {
    assert(slugOk(slug), 'Cliente non valido.');
    return {version:1,client_slug:slug,revision:0,stato:'da_controllare',fonte:'',data_fonte:'',responsabile:'',prossimo_passo:'',scadenza:'',esito:'',riscontro:'',ultimo_controllo:'',controllato_da:'',updated_at:'',updated_by:''};
  }
  function validate(value, slug) {
    assert(value && typeof value === 'object' && !Array.isArray(value), 'Scheda di controllo non valida.');
    assert(slugOk(slug) && value.version===1 && value.client_slug===slug, 'Il controllo appartiene a un altro cliente.');
    assert(Number.isSafeInteger(value.revision) && value.revision>=0, 'Revisione controllo non valida.');
    assert(Object.hasOwn(STATI,value.stato), 'Stato controllo non valido.');
    for (const key of CAMPI.filter(k=>k!=='stato')) assert(text(value[key]), 'Campo controllo non valido: '+key);
    for (const key of ['data_fonte','scadenza']) assert(!value[key] || date(value[key]), 'Data non valida: '+key);
    for (const key of ['ultimo_controllo','updated_at']) assert(value[key]==='' || timestamp(value[key]), 'Data controllo non valida.');
    for (const key of ['controllato_da','updated_by']) assert(text(value[key],320), 'Operatore non valido.');
    if (value.stato==='verificato') {
      assert(value.fonte.trim().length>=3 && date(value.data_fonte), 'Per verificare servono fonte e data reale della fonte.');
      assert(value.esito.trim().length>=3 && value.riscontro.trim().length>=8, 'Per verificare servono esito e un riscontro concreto rintracciabile.');
      assert(timestamp(value.ultimo_controllo) && value.controllato_da.trim(), 'Manca la conferma del controllo.');
    }
    return value;
  }
  function prepare(raw, slug, expectedRevision, fields, actor, now, reviewed) {
    const latest = raw ? validate(raw,slug) : empty(slug);
    assert(latest.revision===expectedRevision, 'Il controllo è cambiato da un altro operatore. Chiudi e riapri la scheda prima di salvare.');
    assert(text(actor,320) && actor.trim() && timestamp(now), 'Accesso o data di salvataggio non validi.');
    assert(fields && typeof fields==='object' && CAMPI.every(k=>Object.hasOwn(fields,k)) && Object.keys(fields).every(k=>CAMPI.includes(k)), 'Campi di modifica non ammessi.');
    assert(typeof reviewed==='boolean', 'Conferma di controllo non valida.');
    assert(fields.stato!=='verificato' || reviewed, 'Conferma di aver controllato ora la fonte e il riscontro.');
    const next = {...latest,...fields,revision:latest.revision+1,updated_at:now,updated_by:actor};
    if (reviewed) { next.ultimo_controllo=now; next.controllato_da=actor; }
    validate(next,slug);
    assert(!next.data_fonte || next.data_fonte<=dayInRome(now), 'La data reale della fonte non può essere futura.');
    return next;
  }
  async function commit(options) {
    const {db,slug,expectedRevision,fields,actor,reviewed,canEdit,isCurrent}=options;
    assert(canEdit() && isCurrent(), 'Modifica non autorizzata o cliente cambiato.');
    let result;
    await db.runTransaction(async transaction=>{
      assert(canEdit() && isCurrent(), 'Accesso scaduto o cliente cambiato.');
      const ref=db.collection('clienti').doc(slug), snapshot=await transaction.get(ref);
      assert(canEdit() && isCurrent(), 'Accesso scaduto o cliente cambiato.');
      assert(snapshot.exists, 'Cliente non più disponibile.');
      result=prepare(snapshot.data().controllo_v1,slug,expectedRevision,fields,actor,options.now || new Date().toISOString(),reviewed);
      // Aggiorna esclusivamente il contenitore controllo: nessun nome, brand, KPI o coda.
      transaction.update(ref,{controllo_v1:result});
    });
    return result;
  }
  function summary(client, today=dayInRome()) {
    const control=client.controllo_v1 ? validate(client.controllo_v1,client.slug) : empty(client.slug);
    const monitor=client.monitoraggio_v1;
    const requests=monitor && monitor.version===1 && monitor.client_slug===client.slug && Array.isArray(monitor.outbox) ? monitor.outbox.filter(r=>r.stato==='richiesta').length : null;
    return {control,requests,overdue:!!control.scadenza && control.scadenza<today && control.stato!=='verificato'};
  }
  return {STATI,CAMPI,empty,validate,prepare,commit,summary,date,timestamp,dayInRome};
});

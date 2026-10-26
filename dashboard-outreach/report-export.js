/* Esportazione pura: nessuna rete, scrittura, credenziale o invio. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./monitoraggio-domain.js'), require('./controllo-clienti-domain.js'));
  else root.OutreachReportExport = factory(root.OutreachMonitoraggio, root.OutreachControlloClienti);
})(typeof globalThis !== 'undefined' ? globalThis : this, function(D, C) {
  'use strict';
  const labels = Object.fromEntries(D.STAGES.map((key, i) => [key, D.LABELS[i]]));
  const words = {da_classificare:'Da classificare',cortesia:'Cortesia / grazie',proposta:'Risposta alla proposta / CTA',negativa:'Negativa',bisogno_call:'Bisogno concreto / call',materiale:'Solo materiale'};
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = (v, fallback) => typeof v === 'string' && v.trim() ? v : fallback;
  function prepare(input, client, filters, now = new Date().toISOString(), control = client?.controllo_v1) {
    if (!client || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(client.slug) || typeof client.nome !== 'string' || !client.nome.trim()) throw Error('Identità cliente incompleta.');
    if (!D.parsed(now)) throw Error('Data preparazione non valida.');
    const missing = input === null || input === undefined;
    const state = missing ? D.empty(client.slug) : D.validate(input, client.slug);
    const r = D.report(state, filters, now), s = r.summary;
    r.controllo_v1 = control == null ? null : JSON.parse(JSON.stringify(C.validate(control, client.slug)));
    const warnings = [];
    if (missing) warnings.push('Nessuna rilevazione operativa disponibile: i totali, le classificazioni e le call non sono verificabili.');
    if (D.STAGES.some(k => s.counts[k] === null)) warnings.push('Copertura incompleta: gli osservati non rappresentano i totali.');
    if (s.unknownIngress) warnings.push('Persone outreach con data ingresso non rilevata: '+s.unknownIngress+'. Non entrano nella coorte; rendono indisponibili i totali.');
    const knownContactIds = new Set([...s.contacts, ...r.backlog].map(c => c.id));
    const unknownActionData = state.contacts.filter(c => !c.internal && !knownContactIds.has(c.id) && !D.day(c.ingresso) && c.scope !== 'lead' && ['settore','tema','target'].every(k => !filters[k] || c[k] === filters[k]));
    if (unknownActionData.length) warnings.push('Arretrato non ricostruibile per '+unknownActionData.length+' persone senza data ingresso.');
    const people = new Map(state.contacts.map(c => [c.id,c]));
    const lines = [
      'Dashboard outreach — '+client.nome,
      'Stato: preparato; nessun invio effettuato.',
      'Periodo ingresso: '+filters.dal+' / '+filters.al,
      'Filtri: '+['settore','tema','target'].map(k => k+'='+(filters[k] || 'tutti')).join(', '),
      'Avanzamento della stessa coorte osservato fino al '+filters.al+'.',
      'Fonte: '+value(state.source,'non disponibile'),
      'Verifica fonte: '+value(state.verified_at,'non disponibile'),
      'Preparato: '+now,
      '', 'CONTROLLO CLIENTE (separato dai dati commerciali)',
      ...(r.controllo_v1 ? [
        'Stato controllo: '+C.STATI[r.controllo_v1.stato],
        'Fonte controllo: '+value(r.controllo_v1.fonte,'non disponibile'),
        'Data reale fonte controllo: '+value(r.controllo_v1.data_fonte,'non disponibile'),
        'Ultimo controllo: '+value(r.controllo_v1.ultimo_controllo,'non disponibile'),
        'Controllato da: '+value(r.controllo_v1.controllato_da,'non registrato'),
        'Responsabile: '+value(r.controllo_v1.responsabile,'da assegnare'),
        'Prossimo passo: '+value(r.controllo_v1.prossimo_passo,'da definire'),
        'Scadenza: '+value(r.controllo_v1.scadenza,'non disponibile'),
        'Esito controllo: '+value(r.controllo_v1.esito,'non rilevato'),
        'Riscontro concreto: '+value(r.controllo_v1.riscontro,'non disponibile')
      ] : ['Nessun controllo cliente registrato.']),
      '', 'LIMITI E COPERTURA',
      ...(warnings.length ? warnings : ['Copertura dichiarata completa per la coorte selezionata.']),
      ...D.STAGES.map(k => labels[k]+': '+(s.counts[k] === null ? 'non disponibile; osservati '+s.known[k] : s.counts[k])+' | copertura fase: '+(state.coverage[k] ? 'dichiarata completa' : 'parziale / non disponibile')),
      '', 'PASSAGGI SULLE STESSE PERSONE',
      ...s.rates.map(v => labels[v.d]+' → '+labels[v.n]+': '+v.numerator+'/'+v.denominator+'; '+(v.value === null ? 'non disponibile' : v.value.toFixed(1)+'%')),
      '', 'RISPOSTE OSSERVATE',
      ...Object.entries(s.responses).map(([k,v]) => words[k]+': '+(missing ? 'non disponibile' : v)),
      'INTERESSATI OSSERVATI',
      ...Object.entries(s.interested).map(([k,v]) => words[k]+': '+(missing ? 'non disponibile' : v)),
      '', 'CALL CREATE NEL PERIODO (tutte le fonti)',
      'Include anche lead fuori outreach e persone entrate prima; la data filtro è la creazione della prenotazione.',
      ...s.calls.map(c => [people.get(c.contact_id).nome,c.creata,c.fissata_per || 'data non rilevata',c.fatta_il || 'svolgimento non verificato',c.fonte || 'da attribuire',c.source,c.source_evidence,c.esito || 'esito non rilevato'].join(' | ')),
      ...(!s.calls.length ? ['Nessun record osservato; non equivale a nessuna call se la copertura è incompleta.'] : []),
      '', 'PERSONE DELLA COORTE / RESPONSABILI / PROSSIMI PASSI / ESITI',
      ...s.contacts.map(c => [c.nome,c.responsabile || 'da assegnare',c.prossimo_passo || 'da definire',c.esito || 'esito non rilevato'].join(' | ')),
      ...(!s.contacts.length ? ['Nessuna persona osservata nella coorte.'] : []),
      '', 'VENDITE CON RISCONTRO (coorte selezionata)',
      ...s.contacts.filter(c => D.day(c.events.vendita) && D.day(c.events.vendita) <= filters.al).map(c => [c.nome,c.events.vendita,c.vendita_fonte,c.vendita_riscontro].join(' | ')),
      ...(!s.known.vendita ? ['Nessuna vendita osservata; offerte e prenotazioni non sono vendite.'] : []),
      '', 'INTERESSATI IN ATTESA (inclusi ingressi precedenti)',
      ...r.backlog.map(c => [c.nome,c.attesa+' giorni',c.responsabile || 'da assegnare',c.prossimo_passo || 'da definire'].join(' | ')),
      ...(!r.backlog.length ? ['Nessun arretrato osservato; le persone senza ingresso non permettono una ricostruzione completa.'] : []),
      '', 'Questa preparazione non costituisce un invio né una prova di consegna.'
    ];
    const text = lines.join('\n');
    const html = '<!doctype html><html lang="it"><meta charset="utf-8"><title>'+escape('Report commerciale — '+client.nome)+'</title><body><main><pre style="white-space:pre-wrap;font:15px/1.5 system-ui,sans-serif">'+escape(text)+'</pre></main></body></html>';
    return {report:r,missing,warnings,text,html};
  }
  return {prepare};
});

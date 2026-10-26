const D = require('../monitoraggio-domain.js');
const filters = {dal:'2026-10-19',al:'2026-10-25',settore:'',tema:'',target:''};
const client = {slug:'cliente-prova',nome:'CLIENTE FITTIZIO — COLLAUDO ISOLATO'};
const now = '2026-10-26T09:00:00Z';
function fixture() {
  const state = {...D.empty(client.slug),source:'Registro FITTIZIO in memoria — non dati reali',verified_at:now,coverage:Object.fromEntries(D.STAGES.map(k=>[k,true]))};
  const person = (id,events,extra={}) => ({id,nome:'PROVA '+id,ingresso:'2026-10-19',events,settore:'Studio',tema:'AI',target:'Titolare',...extra});
  const events = {invito:'2026-10-19T08:00:00Z',accettazione:'2026-10-20T08:00:00Z',primo_messaggio:'2026-10-20T09:00:00Z',email:'2026-10-20T10:00:00Z',risposta:'2026-10-21T08:00:00Z',interesse:'2026-10-21T08:00:00Z',call_fissata:'2026-10-22T08:00:00Z',call_fatta:'2026-10-23T08:00:00Z',vendita:'2026-10-24T08:00:00Z'};
  state.contacts = [
    person('vendita',events,{tipo_risposta:'proposta',tipo_interesse:'bisogno_call',responsabile:'Operatrice prova',prossimo_passo:'Avvio concordato',esito:'Vendita confermata FITTIZIA',vendita_fonte:'Registro vendite FITTIZIO',vendita_riscontro:'Ordine FITTIZIO TEST-001'}),
    person('grazie',{invito:events.invito,accettazione:events.accettazione,risposta:events.risposta},{tipo_risposta:'cortesia'}),
    person('solo-invito',{invito:events.invito}),
    person('arretrato',{risposta:'2026-10-20T08:00:00Z',interesse:'2026-10-20T08:00:00Z'},{ingresso:'2026-07-01',responsabile:'Altra operatrice'}),
    person('gia-gestito',{risposta:events.risposta,interesse:events.interesse,nostra_risposta:'2026-10-22T08:00:00Z'},{ingresso:'2026-07-02'}),
    person('lead-sito',{}, {scope:'lead',ingresso:'',settore:'Altro'}),
    person('team',{}, {internal:true}),
    person('futuro',{invito:'2026-10-26T08:00:00Z'}, {ingresso:'2026-10-26'})
  ];
  state.calls = [
    {id:'call-vendita',contact_id:'vendita',creata:'2026-10-22T08:00:00Z',fissata_per:'2026-10-23T08:00:00Z',fatta_il:'2026-10-23T08:00:00Z',fonte:'LinkedIn',source:'Agenda FITTIZIA',source_evidence:'Prenotazione FITTIZIA A',esito:'Svolta FITTIZIA'},
    {id:'call-arretrato',contact_id:'arretrato',creata:'2026-10-24T08:00:00Z',fonte:'Passaparola',source:'Agenda FITTIZIA',source_evidence:'Prenotazione FITTIZIA B'},
    {id:'call-lead',contact_id:'lead-sito',creata:'2026-10-25T08:00:00Z',fonte:'Sito web',source:'Agenda FITTIZIA',source_evidence:'Prenotazione FITTIZIA C'},
    {id:'call-vecchia',contact_id:'arretrato',creata:'2026-10-18T08:00:00Z',source:'Agenda FITTIZIA',source_evidence:'Prenotazione FITTIZIA D'},
    {id:'call-team',contact_id:'team',creata:'2026-10-22T08:00:00Z',source:'Agenda FITTIZIA',source_evidence:'Prenotazione FITTIZIA E'}
  ];
  return state;
}
module.exports = {fixture,client,filters,now};

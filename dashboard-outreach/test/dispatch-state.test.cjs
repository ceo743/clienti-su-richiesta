const test=require('node:test');
const assert=require('node:assert/strict');
const D=require('../monitoraggio-domain.js');
const NOW='2026-10-26T09:01:00Z';
const ADMIN='operatore@example.test', APPROVER='approvatore@example.test';
const THREAD='https://www.linkedin.com/messaging/thread/filo-prova/';
function fixture() {
  const s={...D.empty('cliente-prova'),source:'Registro verificato',verified_at:NOW,contacts:[{id:'a',nome:'Persona a',ingresso:'2026-10-01',events:{risposta:'2026-10-26T08:58:00Z'},profilo:'https://www.linkedin.com/in/persona-a/',bozza:'Risposta approvata',conversazione_verificata_il:'2026-10-26T08:59:00Z',conversazione_url:THREAD}]};
  const r=D.request(s,'a','messaggio',s.contacts[0].bozza,APPROVER,'2026-10-26T09:00:00Z');
  const c={actor:ADMIN,operators:[ADMIN],approvers:[APPROVER],claim_id:'presa-univoca',now:NOW,verification:{checked_at:NOW,thread_url:THREAD,latest_reply_at:s.contacts[0].events.risposta,evidence:'Filo ricontrollato: destinatario e testo esatti',testo:r.testo,destinatario:r.destinatario}};
  return {s,r,c};
}
function outcome(r,extra={}) {return {actor:ADMIN,operators:[ADMIN],claim_id:r.claim_id,stato:'inviato',at:'2026-10-26T09:02:00Z',now:'2026-10-26T10:00:00Z',thread_url:THREAD,testo:r.testo,destinatario:r.destinatario,evidence:'Messaggio esatto visibile nel filo alle 09:02 UTC',...extra};}
test('presa in carico non è invio e secondo claim identico non autorizza nuova esecuzione',()=>{
  const {s,r,c}=fixture();assert.equal(D.preflight(s,r.id,c).ok,true);
  assert.equal(D.claim(s,r.id,c).may_send,true);assert.equal(r.stato,'in_corso');assert.equal(r.sent_at,undefined);
  assert.equal(D.claim(s,r.id,c).may_send,false);assert.equal(D.claim(s,r.id,c).claimed,false);
  assert.throws(()=>D.claim(s,r.id,{...c,claim_id:'altra-presa'}),/nessun ritentativo/);
  D.validate(s,'cliente-prova');
});
test('operatore o approvatore non più autorizzato blocca la presa',()=>{
  let {s,r,c}=fixture();assert.throws(()=>D.claim(s,r.id,{...c,operators:[]}),/amministratore/);assert.equal(r.stato,'richiesta');
  ({s,r,c}=fixture());const res=D.claim(s,r.id,{...c,approvers:[]});assert.equal(res.may_send,false);assert.equal(r.stato,'sospesa');assert.match(r.reason,/Approvatore/);
});
test('testo o destinatario mutati dopo approvazione sospendono senza inviare',()=>{
  for(const field of ['bozza','profilo']) {const {s,r,c}=fixture();s.contacts[0][field]=field==='bozza'?'Testo nuovo':'https://www.linkedin.com/in/altra-persona/';assert.equal(D.claim(s,r.id,c).may_send,false);assert.equal(r.stato,'sospesa');}
});
test('conferma mancante o alterata non viene eseguita neppure modificando la scheda insieme',()=>{
  const {s,r,c}=fixture();r.testo=s.contacts[0].bozza='Testo cambiato';c.verification.testo=r.testo;
  assert.equal(D.preflight(s,r.id,c).ok,false);assert.throws(()=>D.validate(s,'cliente-prova'),/conferma originaria/);
  delete r.approval_snapshot;assert.equal(D.claim(s,r.id,c).may_send,false);
});
test('autore o data approvazione modificati non diventano una nuova conferma fresca',()=>{
  for(const field of ['confirmed_by','confirmed_at']){const {s,r,c}=fixture();r[field]=field==='confirmed_by'?ADMIN:'2026-10-26T09:00:10Z';c.approvers.push(ADMIN);assert.equal(D.preflight(s,r.id,c).ok,false);assert.throws(()=>D.validate(s,'cliente-prova'),/conferma originaria/);}
});
test('risposta successiva o diversa dalla fotografia approvata sospende il singolo invio',()=>{
  for(const date of ['2026-10-26T09:00:30Z','2026-10-26T08:59:00Z']) {const {s,r,c}=fixture();s.contacts[0].events.risposta=date;c.verification.latest_reply_at=date;assert.equal(D.claim(s,r.id,c).may_send,false);assert.match(r.reason,/Risposta|risposto/);}
});
test('approvazione o controllo vecchio, futuro o privo del filo sono bloccati',()=>{
  const changes=[c=>c.now='2026-10-28T09:01:00Z',c=>c.verification.checked_at='2026-10-26T08:00:00Z',c=>c.verification.checked_at='2026-10-26T10:00:00Z',c=>c.verification.thread_url='https://www.linkedin.com/in/persona-a/',c=>c.verification.evidence=''];
  for(const change of changes){const {s,r,c}=fixture();change(c);assert.equal(D.claim(s,r.id,c).may_send,false);assert.equal(r.sent_at,undefined);}
});
test('il ricontrollo deve coprire ultima risposta, testo, persona e stesso filo',()=>{
  const changes=[c=>c.verification.latest_reply_at='',c=>c.verification.testo='altro',c=>c.verification.destinatario='https://www.linkedin.com/in/altro/',c=>c.verification.thread_url='https://www.linkedin.com/messaging/thread/altro/'];
  for(const change of changes){const {s,r,c}=fixture();change(c);assert.equal(D.preflight(s,r.id,c).ok,false);}
});
test('limite invii conta invii di oggi creati ieri e prese in carico incerte',()=>{
  for(const mode of ['inviato','da_verificare']) {const {s,r,c}=fixture();for(let i=0;i<10;i++)s.outbox.push({...r,id:'precedente-'+i,contact_id:'precedente-'+i,testo:'Altro '+i,created_at:'2026-10-25T09:00:00Z',stato:mode,...(mode==='inviato'?{sent_at:NOW}:{claimed_at:NOW})});assert.equal(D.claim(s,r.id,c).may_send,false);assert.match(r.reason,/dieci invii/);}
});
test('un invio già in corso da ieri non supera il limite effettivo del giorno al riscontro',()=>{
  const {s,r,c}=fixture();D.claim(s,r.id,c);
  for(let i=0;i<10;i++)s.outbox.push({...r,id:'inviato-'+i,sent_at:'2026-10-27T08:00:00Z',stato:'inviato'});
  assert.throws(()=>D.recordOutcome(s,r.id,outcome(r,{at:'2026-10-27T09:00:00Z',now:'2026-10-27T10:00:00Z'})),/dieci invii provati/);assert.equal(r.stato,'in_corso');
});
test('riscontro invio esatto, idempotente e consegna con prova separata',()=>{
  const {s,r,c}=fixture();D.claim(s,r.id,c);const sent=outcome(r);assert.equal(D.recordOutcome(s,r.id,sent).recorded,true);assert.equal(r.stato,'inviato');
  assert.equal(D.recordOutcome(s,r.id,sent).recorded,false);assert.equal(r.delivered_at,undefined);
  assert.throws(()=>D.recordOutcome(s,r.id,{...sent,evidence:'Prova modificata'}),/non sovrascrivere/);
  assert.throws(()=>D.recordOutcome(s,r.id,{...sent,stato:'consegnato',at:'2026-10-26T09:03:00Z'}),/distinta/);
  const delivered={...sent,stato:'consegnato',at:'2026-10-26T09:03:00Z',evidence:'Indicatore Consegnato comparso nel filo dopo invio'};
  assert.equal(D.recordOutcome(s,r.id,delivered).recorded,true);assert.equal(D.recordOutcome(s,r.id,delivered).recorded,false);D.validate(s,'cliente-prova');
});
test('non si registra prova su destinatario, testo, filo o presa diversi',()=>{
  for(const change of [{claim_id:'altra-presa'},{testo:'Altro testo'},{destinatario:'https://www.linkedin.com/in/altro/'},{thread_url:'https://www.linkedin.com/messaging/thread/altro/'}]){const {s,r,c}=fixture();D.claim(s,r.id,c);assert.throws(()=>D.recordOutcome(s,r.id,outcome(r,change)));assert.equal(r.stato,'in_corso');}
});
test('incerto vieta nuovi tentativi ma permette riconciliare una prova già avvenuta',()=>{
  const {s,r,c}=fixture();D.claim(s,r.id,c);
  D.recordOutcome(s,r.id,outcome(r,{stato:'da_verificare',reason:'Timeout dopo il tentativo: esito non noto'}));assert.equal(r.stato,'da_verificare');
  assert.throws(()=>D.claim(s,r.id,c),/nessun ritentativo/);assert.throws(()=>D.request(s,'a','messaggio',r.testo,APPROVER,NOW),/già una richiesta/);
  assert.equal(D.recordOutcome(s,r.id,outcome(r,{at:'2026-10-26T09:04:00Z'})).recorded,true);
});
test('errore non autorizza un nuovo tentativo sulla stessa richiesta',()=>{
  const {s,r,c}=fixture();D.claim(s,r.id,c);D.recordOutcome(s,r.id,outcome(r,{stato:'errore',reason:'Canale indisponibile, nessun riscontro di invio'}));assert.throws(()=>D.claim(s,r.id,c),/nessun ritentativo/);
});
test('le ricevute email richiedono URL del messaggio, non la sola casella',()=>{
  assert.equal(D.threadUrl('email','https://mail.google.com/mail/u/0/'),false);
  assert.equal(D.threadUrl('email','https://mail.google.com/mail/u/0/#sent/abc123'),true);
});
test('nessun riscontro futuro viene registrato, inclusi errore e stato incerto',()=>{
  for(const stato of ['inviato','consegnato','da_verificare','errore']) {
    const {s,r,c}=fixture();D.claim(s,r.id,c);
    if(stato==='consegnato')D.recordOutcome(s,r.id,outcome(r));
    const before=JSON.stringify(s);
    assert.throws(()=>D.recordOutcome(s,r.id,outcome(r,{stato,now:'2026-10-26T10:00:00Z',at:'2026-10-26T10:00:01Z',reason:'Esito da verificare',evidence:'Prova distinta futura'})),/futura/);
    assert.equal(JSON.stringify(s),before);
  }
});
test('ora del riscontro pari a ora corrente accettata, orologio o controllo operativo invalidi respinti',()=>{
  const {s,r,c}=fixture();D.claim(s,r.id,c);
  assert.throws(()=>D.recordOutcome(s,r.id,outcome(r,{now:'non una data'})),/corrente/);
  r.checked_at='2026-10-26T10:00:01Z';
  assert.throws(()=>D.recordOutcome(s,r.id,outcome(r)),/controllo del filo.*futura/);
  r.checked_at=NOW;r.claimed_at='2026-10-26T10:00:01Z';
  assert.throws(()=>D.recordOutcome(s,r.id,outcome(r)),/presa in carico.*futura/);
  r.claimed_at=NOW;
  assert.equal(D.recordOutcome(s,r.id,outcome(r,{at:'2026-10-26T10:00:00Z'})).recorded,true);
});
test('orologio del claim non valido non persiste neppure il controllo o la sospensione',()=>{
  const {s,r,c}=fixture(),before=JSON.stringify(s);
  assert.throws(()=>D.claim(s,r.id,{...c,now:'non una data'}),/Data del controllo/);
  assert.equal(JSON.stringify(s),before);
});

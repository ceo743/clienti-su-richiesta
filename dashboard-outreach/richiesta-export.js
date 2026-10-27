/* Lettura di una sola richiesta corrente: nessuna scrittura o azione di invio. */
(function(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OutreachRequestExport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const emailKey = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
  const validEmail = value => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  function fail(message) { throw Error(message); }
  function configEmails(snapshot, name) {
    const emails = snapshot.exists && snapshot.data()?.emails;
    if (!Array.isArray(emails) || !emails.every(validEmail)) fail('Configurazione '+name+' non disponibile o non valida.');
    return emails.map(emailKey);
  }
  async function read(options, slug, requestId) {
    if (!options || typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) fail('Cliente non valido.');
    if (typeof requestId !== 'string' || !requestId || requestId.length > 200) fail('Identificativo richiesta non valido.');
    const D = options.domain || root.OutreachMonitoraggio;
    if (!D || typeof D.validate !== 'function') fail('Modello monitoraggio non disponibile.');
    const session = options.auth?.currentUser;
    if (!session || !validEmail(session.email) || typeof session.uid !== 'string' || !session.uid) fail('Accesso amministratore richiesto.');
    const actor = {email:session.email,uid:session.uid};
    const guard = () => {
      const current = options.auth?.currentUser;
      if (!current || current.email !== actor.email || current.uid !== actor.uid || typeof options.isAdmin !== 'function' || options.isAdmin() !== true || (options.isCurrent !== undefined && (typeof options.isCurrent !== 'function' || options.isCurrent() !== true))) fail('Accesso o cliente cambiato: esportazione annullata.');
    };
    guard();
    if (!options.db || typeof options.db.runTransaction !== 'function' || typeof options.db.collection !== 'function') fail('Archivio non disponibile.');
    const result = await options.db.runTransaction(async transaction => {
      guard();
      const ref = options.db.collection('clienti').doc(slug);
      const [snapshot, adminsSnapshot, approversSnapshot] = await Promise.all([
        transaction.get(ref),
        transaction.get(options.db.collection('config').doc('admins')),
        transaction.get(options.db.collection('config').doc('approvatori_messaggi'))
      ]);
      guard();
      if (!snapshot.exists) fail('Cliente non più disponibile.');
      const admins = configEmails(adminsSnapshot, 'amministratori');
      const approvers = configEmails(approversSnapshot, 'approvatori');
      if (!admins.includes(emailKey(actor.email))) fail('Operatore non più amministratore.');
      const data = snapshot.data();
      if (data.slug !== undefined && data.slug !== slug) fail('Cliente non corrispondente.');
      const state = D.validate(data.monitoraggio_v1, slug);
      const request = state.outbox.find(item => item.id === requestId);
      if (!request) fail('Richiesta corrente non disponibile.');
      const person = state.contacts.find(item => item.id === request.contact_id);
      if (!person) fail('Contatto della richiesta non disponibile.');
      const contact = {id:person.id,nome:person.nome};
      const keys = ['bozza','conversazione_verificata_il','conversazione_url','internal','escluso','chiuso',...(request.tipo === 'email' ? ['email','email_verificata'] : ['profilo'])];
      for (const key of keys) if (Object.prototype.hasOwnProperty.call(person,key)) contact[key] = copy(person[key]);
      contact.events = Object.prototype.hasOwnProperty.call(person.events,'risposta') ? {risposta:person.events.risposta} : {};
      guard();
      return {
        schema_version:1,
        exported_at:new Date().toISOString(),
        client_slug:slug,
        source:'dashboard_firestore_transaction',
        actor:{email:actor.email,is_admin:true},
        approver:{email:request.confirmed_by,authorized:[...admins,...approvers].includes(emailKey(request.confirmed_by))},
        request:copy(request),
        contact
      };
    });
    guard();
    return result;
  }
  return {read};
});

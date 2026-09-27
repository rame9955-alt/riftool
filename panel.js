// Capital Rift Lager – Seitenleiste.
// Quellen (am 25.09.2026 im Spielcode und per Abfrage geprüft):
//   /api/me                              aktive Firma
//   /api/game/<firma>                    Rucksack, Aufträge, Warennamen, Marktpreise, Bargeld
//   /api/game/<firma>/logistics          Orte mit Bestand, Ladeplätze, offene Anforderungen (requests)
//   /api/building-furniture?ref=<geb.>   Maschinen mit Rezept, Status, Inhalt
//   /api/market/book?commodity=<ID>      Gebote für den Sofortverkauf
//   /api/game/<firma>/sellable?commodity verkaufbare Menge
// Aktionen (nur auf Klick mit Bestätigung): /market/order, /market/cancel, /logistics/lane.
// "Zeigen" tippt Koordinaten ins Ortssuchfeld des Spiels (#search-input), das Spiel fährt die Kamera hin.

const API = 'https://play.capitalrift.com/api';
const AUTO_MS = 60_000;
const MASCHINEN = new Set(Object.keys(REZEPTE).map(k => k.split('|')[0]));

// ---------- Daten holen ----------
// kopf: x-cr-sec mit den Kennungen der Teile, die sammle nicht braucht (Räume, Angebote …); der Server lässt sie dann weg.
async function sammle(API, kopf) {
  const hol = async (p, k) => {
    const r = await fetch(API + p, { credentials: 'include', headers: k || undefined, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return r.json();
  };
  const me = await hol('/me');
  const id = (me.piloting && me.piloting.companyId) || me.playerId;   // ohne Firma: eigener Spieler
  if (!id) throw Object.assign(new Error('Nicht angemeldet'), { status: 0 });
  const [g, lg] = await Promise.all([hol('/game/' + id, kopf && kopf[id]), hol('/game/' + id + '/logistics')]);
  const namen = {}; for (const i of g.itemsCatalog || []) namen[i.id] = i.name;
  const preise = {}, volumen = {}; for (const m of g.market || []) if (m.key) { preise[String(m.key).toLowerCase()] = m.last ?? m.price ?? null; volumen[String(m.key).toLowerCase()] = m.volume ?? null; }
  const rucksack = {}; for (const s of g.inventory || []) if (s && s.itemId) rucksack[s.itemId] = (rucksack[s.itemId] || 0) + s.qty;
  const orte = (lg.endpoints || []).map(e => ({
    name: e.label, art: e.kind, ref: e.ref, unitKey: e.unitKey, gebaeude: e.buildings || [],
    pads: (e.pads || []).map(p => p.id), lat: e.lat, lon: e.lon, waren: e.onHand || e.stock || {}, land: e.landmassId, bedarf: e.requested || {}, tags: [...new Set((e.pads || []).map(p => p.name).filter(Boolean))],
    // übrig = Lager minus das, was der Ort selbst anfordert; nur das kann eine Route abholen
    frei: Object.fromEntries(Object.entries(e.stock || e.onHand || {}).map(([w, n]) => [w, n - ((e.requested || {})[w] || 0)]).filter(([, n]) => n > 0)),
  }));
  const auftraege = (g.orders || []).map(o => ({ orderId: o.id, id: String(o.commodity).toLowerCase(), seite: o.side, rest: (o.qty || 0) - (o.filled || 0), menge: o.qty, preis: o.price }));
  const fehlt = (lg.requests || []).map(r => ({
    ware: r.itemId, will: r.want, hat: r.onHand, grund: r.reason, zu: r.toLabel, zuKey: r.toUnitKey, lat: r.toLat, lon: r.toLon,
    von: r.fromLabel, hint: r.hint ? { ort: r.hint.label, key: r.hint.unitKey, menge: r.hint.qty, lack: r.hint.lack } : null,
  }));
  const ortName = {}; for (const e of lg.endpoints || []) ortName[e.ref + '|' + e.unitKey] = e.label;
  const routen = (lg.lanes || []).map(l => ({ von: l.manual && l.manual.fromPadId, zu: l.manual && l.manual.toPadId, nach: ortName[l.toRef + '|' + l.toUnitKey], vonName: ortName[l.fromRef + '|' + l.fromUnitKey],
    vonLat: l.fromLat, vonLon: l.fromLon, nachLat: l.toLat, nachLon: l.toLon, km: Math.round((l.straightM || 0) / 1000),
    items: (l.items || []).map(i => ({ itemId: i.itemId, ratePerMin: i.wantRate, wirkt: i.effective, grund: i.reason })) }));
  // Postenname mit Ort: room:<unitKey>:rolle bzw. parcel:<id>:rolle → Name des Ortes aus der Logistik
  const postenName = a => { const k = a.businessKey, rolle = k.split(':').pop();
    const e = (lg.endpoints || []).find(e => k.startsWith('room:') ? k === 'room:' + e.unitKey + ':' + rolle : k.startsWith('parcel:') && e.ref === 'parcel/' + k.split(':')[1]);
    return e ? e.label + ' · ' + rolle.charAt(0).toUpperCase() + rolle.slice(1) : a.label; };
  const posten = {};
  for (const w of g.workers || []) {
    if (!w.assignment) continue;
    const p = posten[w.assignment.businessKey] ??= { key: w.assignment.businessKey, label: postenName(w.assignment), ist: 0, untaetig: 0, blockiert: 0 };
    p.ist++; if (w.plan && w.plan.status === 'idle') p.untaetig++; if (w.plan && w.plan.status === 'blocked') p.blockiert++;
  }
  const personal = { anzahl: (g.workers || []).length, ohnePosten: (g.workers || []).filter(w => !w.assignment).length,
    lohnProMin: (g.workers || []).reduce((n, w) => n + (w.wagePerMin || 0), 0), posten: Object.values(posten),
    ohneFahrer: (g.vehicles || []).filter(v => !posten['vehicle:' + v.id]).length, fahrzeuge: (g.vehicles || []).length };
  const s = lg.summary || {};
  return { firmaId: id, teile: g.sectionHashes || null, firma: me.piloting ? me.piloting.name : 'Eigener Spieler', cash: g.cash, at: Date.now(), namen, preise, rucksack, orte, auftraege, fehlt, routen, personal, volumen,
    wartet: (g.pending || []).reduce((m, p) => { for (const [k, n] of Object.entries(p.goods || {})) if (n > 0) m[k.toLowerCase()] = (m[k.toLowerCase()] || 0) + n; return m; }, {}),
    gebraucht: [...new Set((lg.endpoints || []).flatMap(e => Object.entries(e.requested || {}).filter(([, n]) => n > 0).map(([w]) => w)))],
    lage: { ohneVorrat: s.outOfStock, volleReihen: s.padFullRows, unversorgt: s.unsupplied, festgefahren: s.strandedLanes } };
}

// Teile des Spielstands, die sammle nicht benutzt: deren Kennungen gehen beim nächsten Laden mit, der Server lässt sie weg (2,6 MB → ~0,2 MB)
const SAMMLE_UNNOETIG = ['leases', 'listings', 'propertyAnchors', 'assets', 'landHoldings', 'carts', 'shops', 'bank', 'miningZones', 'worldWarnings'];
const SAMMLE_KOPF = {};   // id → {'x-cr-sec': …}
async function laden() {
  try { return await sammle(API, SAMMLE_KOPF); }
  catch (e) {
    if (e.status !== 401 && e.status !== 403 && !(e instanceof TypeError)) throw e;
    const tab = await crSpielTab(false);
    if (!tab) throw new Error('Nicht angemeldet. Öffne play.capitalrift.com in einem Tab und melde dich an.');
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: sammle, args: [API, SAMMLE_KOPF] });
    if (!res || !res.result) throw new Error('Spiel-Tab hat keine Daten geliefert.');
    return res.result;
  }
}

// ---------- Zustand ----------
const lies = (k, d) => { try { return localStorage.getItem('lager.' + k) || d; } catch { return d; } };
const merk = (k, v) => { try { localStorage.setItem('lager.' + k, v); } catch {} };
let D = null, ALLE = {}, TICKER = null, SOFORT = null, PROD = null;
let reiter = lies('reiter', 'lager'), ansicht = lies('ansicht', 'ware'), sortBy = lies('sort', 'wert'), firmaWahl = lies('firma', 'aktiv');
let ABHOL = { auto: true, log: null, ablade: {} }, UNTER = [], PAUSE = {};   // PAUSE: von der Erweiterung pausierte Maschinen {id: {rezept, ort, produkt, firmaId}}
let offen = new Set(), zuP = new Set(), prodLaedt = false, DIALOG = null;   // DIALOG: {art:'endv'|'kauf'|'route'|'storno', ...}

// ---------- Format ----------
const nf = new Intl.NumberFormat(LOC(), { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat(LOC(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const geld = n => n == null || !isFinite(n) ? '–' : (Math.abs(n) < 100 ? nf2 : nf).format(n) + ' $';
const zahl = n => n == null || !isFinite(n) ? '–' : nf.format(n);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const uhr = ms => new Date(ms).toLocaleTimeString(LOC(), { hour: '2-digit', minute: '2-digit' });
const datum = ms => new Date(ms).toLocaleString(LOC(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dauer = m => !isFinite(m) ? 'steht still' : m < 60 ? Math.round(m) + ' Min' : m < 1440 ? nf2.format(m / 60) + ' Std' : nf2.format(m / 1440) + ' Tage';   // Einheiten übersetzt i18n.js
const wname = id => (D && D.namen[id]) || String(id).replace(/_/g, ' ');
const preis = id => (TICKER && TICKER.P && TICKER.P[id] != null ? TICKER.P[id] : D && D.preise[id]);
const wert = (id, n) => preis(id) != null ? preis(id) * n : null;
const zeigKnopf = (lat, lon) => lat == null ? '' : `<button class="zeig" data-lat="${lat}" data-lon="${lon}" title="Im Spiel zu diesem Ort springen">Zeigen</button>`;
function melde(t, fehler) { $('stand').innerHTML = fehler ? '<span class="fehler">' + esc(t) + '</span>' : esc(t); }

// ---------- Lager ----------
function firmen() { return firmaWahl === 'alle' ? Object.values(ALLE).sort((a, b) => a.firma.localeCompare(b.firma)) : (D ? [D] : []); }
function quellen() {
  const F = firmen(), mehr = F.length > 1, q = [];
  for (const f of F) {
    const pre = mehr ? f.firma + ' · ' : '', alt = f.firmaId !== D.firmaId ? ' · Stand ' + datum(f.at) : '';
    for (const o of f.orte) q.push({ ort: pre + o.name, info: (o.art === 'land' ? 'Grundstück' : 'Raum') + alt, lat: o.lat, lon: o.lon, waren: o.waren });
    if (Object.keys(f.rucksack).length) q.push({ ort: pre + 'Rucksack', info: 'trägst du bei dir' + alt, waren: f.rucksack, rucksack: f.firmaId === D.firmaId });
    const v = {}; for (const a of f.auftraege) if (a.seite === 'sell' && a.rest > 0) v[a.id] = (v[a.id] || 0) + a.rest;
    if (Object.keys(v).length) q.push({ ort: pre + 'Im Verkauf', info: 'offene Verkaufsaufträge' + alt, waren: v });
  }
  return q;
}
const schluessel = (id, n) => sortBy === 'anzahl' ? n : sortBy === 'preis' ? (preis(id) ?? -1) : (wert(id, n) ?? -1);
const nachWare = (a, b) => sortBy === 'name' ? wname(a[0]).localeCompare(wname(b[0]), 'de') : schluessel(b[0], b[1]) - schluessel(a[0], a[1]);

// Wie viel einer Ware an einem Ort in Maschinen steckt (aus den geladenen Maschinen; der Spiel-Bestand enthält sie schon)
function inMaschinen(ort, w) {
  if (!PROD || PROD.firmaId !== D.firmaId) return 0;
  return PROD.gruppen.filter(g => g.ort === ort).reduce((n, g) => n + (g.inhalt[w] || 0), 0);
}

function renderLager() {
  if (firmaWahl === 'aktiv' && (!PROD || PROD.firmaId !== D.firmaId || Date.now() - PROD.at > 10 * 60000) && !prodLaedt) prodLaden();   // für „in Maschinen"
  const f = $('q').value.toLowerCase().trim(), Q = quellen();
  let html = dialogHtml();
  if (firmaWahl === 'alle' && Object.keys(ALLE).length < 2) html += '<div class="kasten klein">Bisher ist nur eine Firma bekannt. Jede weitere erscheint hier, sobald du sie im Spiel einmal steuerst und die Leiste offen ist.</div>';
  if (SOFORT && SOFORT.key === firmaWahl) html += `<div class="kasten">Sofort an die Gebote verkauft: <b>${geld(SOFORT.summe)}</b><br><span class="klein">Listenwert ${geld(SOFORT.liste)} · ${SOFORT.liste ? nf.format(SOFORT.summe / SOFORT.liste * 100) : '–'} % davon · berechnet ${uhr(SOFORT.at)}</span></div>`;
  html += auftraegeHtml() + schritteHtml() + unnoetigHtml();
  if (ansicht === 'ware') {
    const m = {};
    for (const q of Q) for (const [id, n] of Object.entries(q.waren)) if (n > 0) (m[id] ??= []).push({ q, n });
    const rows = Object.entries(m).map(([id, orte]) => ({ id, orte, sum: orte.reduce((s, o) => s + o.n, 0) }))
      .filter(r => !f || wname(r.id).toLowerCase().includes(f) || r.orte.some(o => o.q.ort.toLowerCase().includes(f)))
      .sort((a, b) => nachWare([a.id, a.sum], [b.id, b.sum]));
    html += rows.map(r => {
      const s = SOFORT && SOFORT.key === firmaWahl && SOFORT.proWare[r.id];
      const sofort = s ? ' · sofort ' + geld(s.erloes) + (s.menge < r.sum ? ' für ' + zahl(s.menge) : '') : '';
      const stk = preis(r.id) != null ? ' · à ' + geld(preis(r.id)) : '';
      const mSum = r.orte.reduce((m, o) => m + inMaschinen(o.q.ort, r.id), 0), imV = r.orte.filter(o => o.q.ort.endsWith('Im Verkauf')).reduce((m, o) => m + o.n, 0);
      return `<details data-k="w:${r.id}"${offen.has('w:' + r.id) ? ' open' : ''}><summary><span class="name">${esc(wname(r.id))}</span><span class="menge">${zahl(r.sum)}</span><span class="sub">${r.orte.length === 1 ? esc(r.orte[0].q.ort) : r.orte.length + ' Orte'}${stk}${sofort}${mSum ? ' · Lager ' + zahl(r.sum - mSum - imV) + ' · in Maschinen ' + zahl(mSum) + (imV ? ' · im Verkauf ' + zahl(imV) : '') : ''}</span><span class="wert">${geld(wert(r.id, r.sum))}</span></summary><div class="zeilen">${
        r.orte.sort((a, b) => b.n - a.n).map(o => `<div class="z"><span>${esc(o.q.ort)} <small>${esc(o.q.info)}</small></span><span>${(m => m ? '<small>Lager ' + zahl(o.n - m) + ' · Maschinen ' + zahl(m) + '</small> ' : '')(inMaschinen(o.q.ort, r.id))}${zahl(o.n)} ${zeigKnopf(o.q.lat, o.q.lon)}</span></div>`).join('')
      }${firmaWahl === 'aktiv' ? `<div class="z"><span></span><span><button class="zeig" data-verkauf="${r.id}">Verkaufen…</button></span></div>` : ''}</div></details>`;
    }).join('');
  } else {
    const orte = Q.map(q => {
      const w = Object.entries(q.waren).filter(([id, n]) => n > 0 && (!f || wname(id).toLowerCase().includes(f) || q.ort.toLowerCase().includes(f)));
      if (!w.length) return null;
      return { q, w, summe: w.reduce((s, [id, n]) => s + (wert(id, n) ?? 0), 0), menge: w.reduce((s, [, n]) => s + n, 0) };
    }).filter(Boolean);
    orte.sort((a, b) => sortBy === 'name' ? a.q.ort.localeCompare(b.q.ort, 'de') : sortBy === 'anzahl' ? b.menge - a.menge : b.summe - a.summe);
    html += orte.map(({ q, w, summe }) => `<details data-k="o:${esc(q.ort)}"${offen.has('o:' + q.ort) ? ' open' : ''}><summary><span class="name">${esc(q.ort)}</span><span class="menge">${w.length} Waren</span><span class="sub">${esc(q.info)}</span><span class="wert">${geld(summe)} ${zeigKnopf(q.lat, q.lon)}${firmaWahl === 'aktiv' && D.orte.some(o => o.name === q.ort && o.pads.length) ? ` <button class="zeig" data-ausl="${esc(q.ort)}">Auslagern…</button>` : ''}</span></summary><div class="zeilen">${
      w.sort(nachWare).map(([id, n]) => `<div class="z"><span>${esc(wname(id))} <small>${sortBy === 'preis' ? 'à ' + geld(preis(id)) : geld(wert(id, n))}</small></span><span>${zahl(n)}</span></div>`).join('')
    }</div></details>`).join('');
  }
  return html;
}

// Deine offenen Verkaufsangebote dieser Ware am Markt: günstigstes zuerst
function angebotText(w) {
  const a = D.auftraege.filter(x => x.seite === 'sell' && x.id === w && x.rest > 0).sort((x, y) => x.preis - y.preis);
  if (!a.length) return '<b>kein Angebot am Markt</b> · ';
  return '<b>dein Angebot: ' + zahl(a[0].rest) + ' zu ' + geld(a[0].preis) + '</b>' + (a.length > 1 ? ' (+' + (a.length - 1) + ' teurere)' : '') + ' · ';
}

// Bestand einer Ware über alle Orte ohne den Inhalt der Maschinen (der ist verplant)
function lagerOhneMaschinen(w) {
  return D.orte.reduce((n, o) => n + Math.max(0, (o.waren[w] || 0) - inMaschinen(o.name, w)), 0);
}

function regelText(u) {
  return u.typ === 'halten' ? 'hält ' + zahl(u.ziel) + ' offen zu ' + geld(u.preis) + ' · ' + zahl(u.gestellt) + ' von ' + zahl(u.max) + ' nachgeschoben'
    : zahl(u.gestellt) + ' von ' + zahl(u.max) + ' gestellt · je ' + zahl(u.schritt) + ' · nie unter ' + geld(u.minPreis);
}

// Aktive Verkäufe in Schritten (Unterbieten-Regeln) der gerade aktiven Firma
function schritteHtml() {
  if (firmaWahl !== 'aktiv') return '';
  const r = UNTER.filter(u => !u.firmaId || u.firmaId === D.firmaId);
  return `<details data-zu="schritte"${zuP.has('schritte') ? '' : ' open'}><summary><span class="name">Verkäufe in Schritten</span><span class="menge">${r.length}</span><span class="sub">${r.length ? 'jede Minute geprüft, immer 1 Cent unter dem günstigsten fremden Angebot' : 'keine aktiv. Anlegen über „Verkaufen…" → A'}</span><span class="wert"></span></summary><div class="zeilen">${
    r.map(u => `<div class="z"><span><b>${esc(u.name)}</b> <small>${angebotText(u.ware)}im Lager ${zahl(lagerOhneMaschinen(u.ware))} · ${regelText(u)}${u.log ? ' · ' + (u.at ? uhr(u.at) + ': ' : '') + esc(u.log) : ' · wartet auf erste Prüfung'}</small></span><span><button class="zeig" data-umenge="${esc(u.id)}">Bearbeiten…</button> <button class="zeig" data-uweg="${esc(u.id)}">Stoppen</button></span></div>`).join('')
  }</div></details>`;
}

// Kleine rote Marke, wenn für die Ware schon ein Verkaufsauftrag läuft oder eine Schritt-/Auffüllen-Regel aktiv ist
function imVerkauf(w) {
  const auftr = D.auftraege.filter(a => a.seite === 'sell' && a.id === w && a.rest > 0).reduce((n, a) => n + a.rest, 0);
  const regel = UNTER.some(u => u.aktiv && u.ware === w && (!u.firmaId || u.firmaId === D.firmaId));
  return auftr || regel ? '<span class="imverkauf" title="' + (auftr ? zahl(auftr) + ' Stück stehen schon im Verkauf' : '') + (auftr && regel ? ' · ' : '') + (regel ? 'Regel aktiv' : '') + '">im Verkauf</span> ' : '';
}

// Ware, die du besitzt, die aber kein Ort anfordert (keine Maschine, keine Route braucht sie): Kandidaten zum Verkaufen
function unnoetigHtml() {
  if (firmaWahl !== 'aktiv' || !D.gebraucht) return '';
  const gebraucht = new Set(D.gebraucht), summe = {};
  for (const o of D.orte) for (const [w, n] of Object.entries(o.waren)) if (n > 0 && !gebraucht.has(w)) summe[w] = (summe[w] || 0) + n;
  const liste = Object.entries(summe).sort((a, b) => (wert(b[0], b[1]) ?? 0) - (wert(a[0], a[1]) ?? 0));
  if (!liste.length) return '';
  const gesamt = liste.reduce((n, [w, m]) => n + (wert(w, m) ?? 0), 0);
  return `<details data-k="unnoetig"${offen.has('unnoetig') ? ' open' : ''}><summary><span class="name">Nicht gebraucht, verkaufbar</span><span class="menge">${liste.length}</span><span class="sub">kein Ort und keine Maschine fordert diese Waren an</span><span class="wert">${geld(gesamt)}</span></summary><div class="zeilen">${
    liste.map(([w, n]) => `<div class="z"><span>${esc(wname(w))} ${imVerkauf(w)}<small>${geld(wert(w, n))}</small></span><span>${zahl(n)} <button class="zeig" data-verkauf="${esc(w)}">Verkaufen…</button></span></div>`).join('')
  }</div></details>`;
}

function auftraegeHtml() {
  if (firmaWahl !== 'aktiv' || !D.auftraege.length) return '';
  return `<details data-zu="auftraege"${zuP.has('auftraege') ? '' : ' open'}><summary><span class="name">Deine offenen Aufträge</span><span class="menge">${D.auftraege.length}</span><span class="sub">Kauf- und Verkaufsaufträge am Markt</span><span class="wert"></span></summary><div class="zeilen">${
    D.auftraege.map(a => `<div class="z"><span>${a.seite === 'sell' ? 'Verkauf' : 'Kauf'} ${esc(wname(a.id))} <small>${zahl(a.rest)} von ${zahl(a.menge)} à ${geld(a.preis)}</small></span><span>${a.seite === 'sell' ? `<button class="zeig" data-halten="${esc(a.id)}|${a.menge}|${a.preis}">Auffüllen…</button> ` : ''}<button class="zeig" data-storno="${esc(a.orderId)}">Löschen…</button></span></div>`).join('')
  }</div></details>`;
}

// ---------- Produktion ----------
async function prodLaden() {
  if (!D || prodLaedt) return;
  prodLaedt = true;
  $('prodStand').textContent = 'lädt Maschinen…'; $('prodNeu').disabled = true;
  try {
    const refs = [...new Set(D.orte.flatMap(o => o.art === 'room' ? [o.ref] : o.gebaeude))].filter(Boolean);
    const res = await api(refs.map(r => '/api/building-furniture?ref=' + encodeURIComponent(r)), 600);
    const G = {};
    for (const f of res.flatMap(r => (r.json && r.json.furniture) || [])) {
      if (!MASCHINEN.has(f.itemId)) continue;
      const ort = D.orte.find(o => o.unitKey === f.unitKey) || D.orte.find(o => o.ref === f.buildingRef) || D.orte.find(o => o.gebaeude.includes(f.buildingRef));
      const key = (ort ? ort.name : f.buildingRef) + '|' + f.itemId + '|' + (f.machineRecipe || '');
      const g = G[key] ??= { ort: ort ? ort.name : f.buildingRef, lat: ort && ort.lat, lon: ort && ort.lon, lager: ort ? ort.waren : {}, pads: !!(ort && ort.pads.length), maschine: f.itemId, rezept: f.machineRecipe || null, anzahl: 0, aktiv: 0, inhalt: {}, ids: [] };
      g.ids.push(f.id);
      g.anzahl++; if (f.machineActive) g.aktiv++;
      for (const [k, v] of Object.entries(f.contents || {})) g.inhalt[k] = (g.inhalt[k] || 0) + v;
    }
    for (const g of Object.values(G)) {
      const R = g.rezept ? (REZEPTE[g.maschine + '|' + g.rezept] || REZEPTE[g.maschine + '|' + g.rezept.replace(/^v_/, '')]) : null;
      if (g.rezept) g.produkt = REZEPTE[g.maschine + '|' + g.rezept] ? g.rezept : g.rezept.replace(/^v_/, '');
      g.R = R;
      if (!R) continue;
      let laeufe = Infinity, eng = null;
      for (const [w, q] of R.i) { const hat = g.lager[w] || 0 /* Spiel-Bestand enthält Maschinen-Inhalt schon */, l = Math.floor(hat / q); if (l < laeufe) { laeufe = l; eng = { w, hat, q }; } }
      g.stueck = laeufe * R.q;
      const proMin = (g.aktiv || 0) * R.r;               // R.r = Stück pro Minute je Maschine (Wiki)
      g.minuten = proMin > 0 ? g.stueck / proMin : Infinity;
      g.eng = eng;
    }
    PROD = { at: Date.now(), firmaId: D.firmaId, gruppen: Object.values(G), fehler: res.filter(r => r.status !== 200).length };
    $('prodStand').textContent = 'Stand ' + uhr(PROD.at) + (PROD.fehler ? ' · ' + PROD.fehler + ' Gebäude nicht geladen' : '');
  } catch (e) { $('prodStand').textContent = e.message; }
  finally { $('prodNeu').disabled = false; prodLaedt = false; }
  if (reiter === 'prod' || (reiter === 'lager' && !DIALOG)) render();
}

// Bilanz je Fabrik aus den geladenen Maschinen (PROD.gruppen) und dem AKTUELLEN Lagerbestand (D), bei jedem Zeichnen neu.
function bilanzRechnen(G) {
  // Bilanz je Fabrik: Bestand, Verbrauch und Eigenproduktion pro Stunde bei Volllast aller Maschinen mit Rezept
  const F = {};
  for (const g of G) {
    const ort = D.orte.find(o => o.name === g.ort);
    const f = F[g.ort] ??= { ort: g.ort, pads: g.pads, lat: g.lat, lon: g.lon, lager: ort ? ort.waren : g.lager, inhalt: {}, waren: {} };
    for (const [k, v] of Object.entries(g.inhalt)) f.inhalt[k] = (f.inhalt[k] || 0) + v;
    if (!g.R) continue;
    const laeufeProStd = g.anzahl * g.R.r / g.R.q * 60;
    for (const [w, q] of g.R.i) { const x = f.waren[w] ??= { verbrauch: 0, produktion: 0 }; x.verbrauch += laeufeProStd * q; }
    const y = f.waren[g.produkt] ??= { verbrauch: 0, produktion: 0 }; y.produktion += laeufeProStd * g.R.q;
  }
  // Bilanz pro Minute = eigene Herstellung − Verbrauch + Zulauf per Route. Stufen: ok (hält oder wächst),
  // spaeter (sinkt, reicht aber ≥ 2 Std), knapp (leer in < 2 Std), fehlt (nichts da und sinkt).
  const RANG = { fehlt: 0, knapp: 1, spaeter: 2, ok: 3 };
  for (const f of Object.values(F)) {
    f.liste = Object.entries(f.waren).filter(([, x]) => x.verbrauch > 0).map(([w, x]) => {
      const bestand = f.lager[w] || 0, inMaschinen = Math.min(bestand, f.inhalt[w] || 0), netto = x.produktion - x.verbrauch;   // Spiel-Bestand enthält Maschinen-Inhalt schon
      const zulauf = (D.routen || []).filter(r => r.nach === f.ort).flatMap(r => r.items.filter(i => i.itemId === w && i.wirkt > 0).map(i => ({ von: r.vonName || '?', n: i.wirkt })));
      const kommt = zulauf.reduce((n, z) => n + z.n, 0), bilanz = netto / 60 + kommt;
      const imLager = bestand - inMaschinen;   // maßgeblich: nur das ist für andere Maschinen greifbar
      const minuten = bilanz >= 0 ? Infinity : imLager / -bilanz;
      const status = imLager <= 0 ? 'fehlt' : minuten < 1440 ? 'spaeter' : 'ok';   // Rot leer, Gelb < 24 Std, sonst Grün
      const land = (D.orte.find(o => o.name === f.ort) || {}).land;
      const woanders = D.orte.filter(o => o.name !== f.ort && o.land === land && (o.frei[w] || 0) > 0).map(o => ({ name: o.name, menge: o.frei[w], pads: o.pads.length > 0 })).sort((a, b) => b.menge - a.menge);
      return { w, bestand, inMaschinen, imLager, verbrauch: x.verbrauch, produktion: x.produktion, netto, kommt, von: [...new Set(zulauf.map(z => z.von))], bilanz, stunden: minuten / 60, status, woanders };
    }).sort((a, b) => (RANG[a.status] - RANG[b.status]) || (a.stunden === b.stunden ? 0 : a.stunden - b.stunden));
  }
  return Object.values(F);
}

function renderProd() {
  if (!PROD || PROD.firmaId !== D.firmaId) { prodLaden(); return '<div class="hinweis">Fabriken werden geladen…</div>'; }
  PROD.fabriken = bilanzRechnen(PROD.gruppen);
  if (Date.now() - PROD.at > 10 * 60000 && !prodLaedt) prodLaden();
  if (!PROD.fabriken.length) return '<div class="hinweis">Keine Maschinen gefunden.</div>';
  let html = dialogHtml() + '<div class="kasten klein">Rechnung pro Minute bei vollem Betrieb aller Maschinen (Rezepte aus der Wiki): eigene Herstellung − Verbrauch + Zulauf per Route = Bilanz. Grün: reicht mindestens 24 Stunden oder wächst. Gelb: reicht weniger als 24 Stunden. Rot: im Lager ist nichts mehr.</div>';
  const rot = f => f.liste.filter(x => x.status === 'fehlt').length, gelb = f => f.liste.filter(x => x.status === 'spaeter').length;
  for (const f of PROD.fabriken.slice().sort((a, b) => (rot(b) - rot(a)) || (gelb(b) - gelb(a)))) {
    const gs = PROD.gruppen.filter(g => g.ort === f.ort);
    const r = rot(f), y = gelb(f), g = f.liste.length - r - y;
    html += `<details data-zu="${esc(f.ort)}"${zuP.has(f.ort) ? '' : ' open'}><summary><span class="name">${esc(f.ort)}</span><span class="menge">${r ? '<span class="marke schlecht">✗ ' + r + '</span> ' : ''}${y ? '<span class="marke mittel">⚠ ' + y + '</span> ' : ''}<span class="marke gut">✓ ${g}</span></span><span class="sub">${gs.reduce((n, x) => n + x.anzahl, 0)} Maschinen</span><span class="wert">${zeigKnopf(f.lat, f.lon)}</span></summary><div class="zeilen">`;
    html += f.liste.map(x => wareHtml(f, x)).join('');
    const ende = Object.entries(f.waren).filter(([, x]) => x.produktion > 0 && x.verbrauch === 0);
    if (ende.length) html += `<div class="ende">Stellt her: ${ende.map(([w, x]) => '<b>' + esc(wname(w)) + '</b> ' + min1(x.produktion / 60) + '/Min <button class="zeig" data-endv="' + esc(w) + '">Verkaufen…</button> <button class="zeig" data-dross="' + esc(f.ort) + '|' + esc(w) + '">Drosseln…</button>').join(' · ')}</div>`;
    const aus = gs.filter(g => !g.rezept);
    if (aus.length) html += `<div class="ende">Ausgeschaltet: ${aus.map(g => '<b>' + esc(wname(g.maschine)) + '</b> × ' + g.anzahl + ' <button class="zeig" data-an="' + esc(f.ort) + '|' + esc(g.maschine) + '">Einschalten…</button>').join(' · ')}</div>`;
    html += `<details data-k="m:${esc(f.ort)}"${offen.has('m:' + f.ort) ? ' open' : ''}><summary><span class="name">Maschinen</span><span class="menge">${gs.length} Gruppen</span></summary><div class="zeilen">${gs.map(maschineHtml).join('')}</div></details>`;
    html += '</div></details>';
  }
  return html;
}

const min1 = n => n !== 0 && Math.abs(n) < 0.05 ? (n < 0 ? '-' : '') + (SPRACHE === 'en' ? 'below 0.1' : 'unter 0,1') : n.toLocaleString(LOC(), { maximumFractionDigits: 1 });

function wareHtml(f, x) {
  const urteil = x.status === 'fehlt'
      ? '<span class="marke schlecht">✗ Lager leer' + (x.bilanz >= 0 ? ', Herstellung/Zulauf deckt den Verbrauch gerade so' : x.inMaschinen ? ', nur noch Reste in den Maschinen' : ', Maschinen stehen') + '</span>'
    : x.status === 'spaeter' ? '<span class="marke mittel">⚠ reicht nur noch ' + dauer(x.stunden * 60) + ' (unter 24 Std)</span>'
    : '<span class="marke gut">✓ ' + (x.bilanz > 0.05 ? 'reicht, Vorrat wächst' : x.bilanz >= 0 ? 'reicht' : 'reicht noch ' + dauer(x.stunden * 60)) + '</span>';
  const teile = ['Verbrauch ' + min1(x.verbrauch / 60) + '/Min'];
  if (x.produktion > 0) teile.push('selbst hergestellt ' + min1(x.produktion / 60) + '/Min');
  if (x.kommt > 0) teile.push('Zulauf ' + min1(x.kommt) + '/Min von ' + x.von.map(esc).join(' und '));
  teile.push('<b>Im Lager ' + zahl(x.imLager) + '</b>' + (x.inMaschinen ? ' · in Maschinen ' + zahl(x.inMaschinen) : ''));
  const gem = gemessen(f.ort, x.w);
  if (gem) teile.push('gemessen ' + (gem.proMin >= 0 ? '+' : '') + min1(gem.proMin) + '/Min in ' + gem.min + ' Min');
  let aktionen = '';
  if (x.status === 'fehlt' || (x.status === 'spaeter' && x.bilanz < 0)) {   // Knöpfe bei Rot und Gelb
    const bedarf = -x.netto / 60;   // was von außen kommen muss
    const eigene = (D.routen || []).find(r => r.nach === f.ort && r.von && r.items.some(i => i.itemId === x.w && i.wirkt > 0));
    const jetzt = eigene ? eigene.items.find(i => i.itemId === x.w).ratePerMin : 0;
    if (eigene) aktionen += `<button class="zeig" data-rplus="${esc(eigene.von)}|${esc(eigene.zu)}|${esc(x.w)}|${jetzt}|${Math.max(jetzt + 1, Math.ceil(bedarf * 2))}|${min1(bedarf)}">Mehr liefern…</button>`;
    else if (x.woanders.length) aktionen += 'Übrig in: ' + x.woanders.slice(0, 3).map(o => esc(o.name) + ' ' + zahl(o.menge) + (f.pads && o.pads ? ` <button class="zeig" data-froute="${esc(f.ort)}|${esc(x.w)}|${esc(o.name)}|${Math.max(1, Math.ceil(bedarf))}">Route…</button>` : '')).join(' · ') + ' ';
    else aktionen += 'Kein Ort in Fahrweite hat etwas übrig. ';
    aktionen += `<button class="zeig" data-nachkauf="${esc(x.w)}|${esc(f.ort)}|${Math.ceil(x.verbrauch * 24)}">Kaufregel…</button> `;
    aktionen += `<button class="zeig" data-kauf="${esc(x.w)}|${Math.max(1, Math.ceil(x.verbrauch * 2 - x.imLager))}|${esc(f.ort)}">Kaufen (${geld(preis(x.w))} je Stück)…</button>`;
  }
  if (false) {   // (in den Knöpfen oben enthalten)
    const eigene = (D.routen || []).find(r => r.nach === f.ort && r.von && r.items.some(i => i.itemId === x.w && i.wirkt > 0));
    if (eigene) { const jetzt = eigene.items.find(i => i.itemId === x.w).ratePerMin, bedarf = Math.max(0.1, -x.netto / 60);
      aktionen += `<button class="zeig" data-rplus="${esc(eigene.von)}|${esc(eigene.zu)}|${esc(x.w)}|${jetzt}|${Math.max(jetzt + 1, Math.ceil(bedarf * 2))}|${min1(bedarf)}">Mehr liefern…</button>`; }
  }
  if (x.produktion > 0 && x.bilanz > 0.05) aktionen += `<button class="zeig" data-dross="${esc(f.ort)}|${esc(x.w)}">Drosseln…</button>`;
  return `<div class="ware ${x.status}"><div class="kopf"><b>${esc(wname(x.w))}</b>${urteil}</div><div class="rechnung">${teile.join(' · ')} → <b>Bilanz ${x.bilanz >= 0 ? '+' : ''}${min1(x.bilanz)}/Min</b></div>${aktionen ? '<div class="aktionen">' + aktionen + '</div>' : ''}</div>`;
}

function maschineHtml(g) {
  const kopf = `<div class="kopf"><b>${esc(wname(g.maschine))} × ${g.anzahl}</b><span class="klein">${g.aktiv} aktiv</span></div>`;
  if (!g.rezept) return `<div class="p">${kopf}<div class="klein">kein Rezept eingestellt</div></div>`;
  if (!g.R) return `<div class="p">${kopf}<div class="klein">stellt ${esc(wname(g.produkt))} her, Rezept nicht in der Wiki-Liste</div></div>`;
  const leer = g.stueck === 0;
  return `<div class="p">${kopf}<div>→ ${esc(wname(g.produkt))}: <b class="${leer ? 'leer' : ''}">noch ${zahl(g.stueck)} Stück</b> <span class="klein">· ${leer ? 'Material fehlt' : g.aktiv ? 'reicht ' + dauer(g.minuten) : 'Maschinen stehen'}</span></div>${
    g.eng ? `<div class="klein">Engpass: ${esc(wname(g.eng.w))} (${zahl(g.eng.hat)} da, ${zahl(g.eng.q)} je Durchgang)</div>` : ''}</div>`;
}

// ---------- Engpässe ----------
const GRUND = {
  out_of_stock: 'Quelle ist leer',
  pad_rejects: 'Ladeplatz nimmt die Ware nicht an',
  pad_full: 'Ladeplatz ist voll',
  sea: 'nur übers Meer erreichbar',
};
function tipp(r) {
  if (r.hint && r.hint.lack === 'not_shipped') return `Liegt in <b>${esc(r.hint.ort)}</b> (${zahl(r.hint.menge)} Stück), wird aber nicht nach ${esc(r.zu)} geliefert. Lösung: Route von ${esc(r.hint.ort)} nach ${esc(r.zu)} für ${esc(wname(r.ware))} anlegen.`;
  if (r.hint && r.hint.lack === 'sea') return `Liegt in <b>${esc(r.hint.ort)}</b> (${zahl(r.hint.menge)} Stück), aber jenseits des Meeres. Lösung: Schiff oder Hafen nötig.`;
  if (r.grund === 'out_of_stock') return `Die Quelle dieser Lieferung, ${esc(r.von || 'unbekannt')}, hat keine ${esc(wname(r.ware))} mehr. Lösung: dort mehr herstellen, eine andere Quelle anbinden oder am Markt kaufen.`;
  if (r.grund === 'pad_rejects') return `Der Ladeplatz bei ${esc(r.zu)} lehnt ab. Lösung: Filter des Ladeplatzes prüfen oder volle Ladeplätze leeren.`;
  if (r.grund === 'pad_full') return `Ein Ladeplatz auf der Strecke ${esc(r.von || '?')} → ${esc(r.zu)} ist voll, deshalb wird nicht weitergeliefert. Lösung: Ladeplätze an beiden Orten prüfen und leeren oder weitere Ladeplätze bauen.`;
  if (r.grund === 'sea') return `Ziel ist nur übers Meer erreichbar. Lösung: Schiffsroute nötig.`;
  return 'Grund laut Spiel: ' + esc(r.grund);
}
let HAEFEN = null, haefenLaedt = false;
async function haefenLaden() {
  if (haefenLaedt || (HAEFEN && HAEFEN.firmaId === D.firmaId && Date.now() - HAEFEN.at < 30 * 60000)) return;
  haefenLaedt = true;
  try {
    const [r] = await api(['/api/game/' + D.firmaId + '/logistics/pads']);
    const liste = ((r.json && r.json.pads) || []).filter(p => p.kind === 'port' && p.port && (p.port.public || p.port.own));
    HAEFEN = { at: Date.now(), firmaId: D.firmaId, liste };
  } catch {} finally { haefenLaedt = false; }
  if (reiter === 'eng' && !DIALOG) render();
}
const kmZwischen = (a, b, c, d) => { const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); };
function naechsteHaefen(lat, lon, n = 3) {
  if (!HAEFEN || lat == null) return [];
  return HAEFEN.liste.map(p => ({ p, km: kmZwischen(lat, lon, p.lat, p.lon) })).sort((a, b) => a.km - b.km).slice(0, n);
}
function meerHtml() {
  const meer = (D.routen || []).filter(r => r.items.some(i => i.grund === 'sea'));
  if (!meer.length) return '';
  if (!HAEFEN || HAEFEN.firmaId !== D.firmaId) { haefenLaden(); return '<div class="kasten klein">Routen übers Meer gefunden, lade öffentliche Häfen…</div>'; }
  const hafenZeile = h => `<div class="z"><span>${esc(h.p.label || h.p.name || 'Hafen')}${h.p.port.own ? ' <small>(deiner)</small>' : ''} <small>${zahl(h.km)} km · Gebühr ${h.p.port.fare != null ? esc(String(h.p.port.fare)) : '–'}</small></span><span>${zeigKnopf(h.p.lat, h.p.lon)}</span></div>`;
  return meer.map(r => `<details data-zu="meer:${esc(r.vonName)}|${esc(r.nach)}"${zuP.has('meer:' + r.vonName + '|' + r.nach) ? '' : ' open'}><summary><span class="name">Übers Meer: ${esc(r.vonName || '?')} → ${esc(r.nach || '?')}</span><span class="menge">${zahl(r.km)} km</span><span class="sub">${r.items.filter(i => i.grund === 'sea').map(i => esc(wname(i.itemId))).join(', ')} · braucht Häfen an beiden Enden und ein Schiff</span><span class="wert"></span></summary><div class="zeilen">
    <div class="klein" style="margin:4px 0"><b>Öffentliche Häfen nahe ${esc(r.vonName || '?')}</b></div>${naechsteHaefen(r.vonLat, r.vonLon).map(hafenZeile).join('')}
    <div class="klein" style="margin:8px 0 4px"><b>Öffentliche Häfen nahe ${esc(r.nach || '?')}</b></div>${naechsteHaefen(r.nachLat, r.nachLon).map(hafenZeile).join('')}
    <div class="klein" style="margin-top:6px">Ob das Spiel die Route von selbst über fremde Häfen führt oder man sie im Spiel wählen muss, ist nicht geprüft. „Gebühr" ist der Wert „fare" des Spiels.</div></div></details>`).join('');
}

function renderEng() {
  const probleme = D.fehlt.filter(r => r.grund !== 'met' && r.grund !== 'moving');
  const unterwegs = D.fehlt.filter(r => r.grund === 'moving').length, erfuellt = D.fehlt.filter(r => r.grund === 'met').length;
  let html = dialogHtml() + `<div class="kasten"><b>${probleme.length}</b> Probleme · ${unterwegs} unterwegs · ${erfuellt} erfüllt<br><span class="klein">Spiel meldet: ${zahl(D.lage.ohneVorrat)} ohne Vorrat · ${zahl(D.lage.volleReihen)} volle Ladeplatz-Reihen · ${zahl(D.lage.unversorgt)} unversorgt</span></div>`;
  html += `<div class="kasten"><label><input type="checkbox" id="autoAb"${ABHOL.auto ? ' checked' : ''}> Nicht abgeholte Ware automatisch dorthin liefern, wo sie gebraucht wird</label>
    <div class="bar" style="margin:6px 0;flex-wrap:wrap"><label class="lbl">Wenn nirgends gebraucht: abladen bei <select id="abAblade"><option value="">– liegen lassen –</option>${D.orte.flatMap(o => o.tags.map(t => `<option value="${esc(t)}"${(ABHOL.ablade[D.firmaId] || '') === t ? ' selected' : ''}>${esc(o.name)}${t !== o.name ? ' (Ladeplatz „' + esc(t) + '“)' : ''}</option>`)).join('')}</select></label><span class="klein">wird nicht verkauft, nur eingelagert</span></div>
    <div class="klein">${ABHOL.log ? 'Zuletzt ' + new Date(ABHOL.log.at).toLocaleTimeString(LOC()) + ': ' + esc(ABHOL.log.text) : 'Prüft jede Minute.'} <button class="zeig" data-abholen="1">Jetzt prüfen</button></div></div>`;
  html += meerHtml();
  if (!probleme.length) return html + '<div class="hinweis">Alles wird geliefert.</div>';
  const proZiel = {};
  for (const r of probleme) (proZiel[r.zu] ??= []).push(r);
  for (const [zu, rs] of Object.entries(proZiel).sort((a, b) => b[1].length - a[1].length)) {
    html += `<details data-k="e:${esc(zu)}"${offen.has('e:' + zu) ? ' open' : ''}><summary><span class="name">Nach ${esc(zu)}</span><span class="menge">${rs.length}</span><span class="sub">${rs.slice(0, 4).map(r => esc(wname(r.ware))).join(', ')}${rs.length > 4 ? ' …' : ''}</span><span class="wert">${zeigKnopf(rs[0].lat, rs[0].lon)}</span></summary><div class="zeilen">${
      rs.map((r, i) => {
        const route = r.hint && r.hint.lack === 'not_shipped' && D.orte.find(o => o.unitKey === r.hint.key) && D.orte.find(o => o.unitKey === r.zuKey);
        return `<div class="problem${r.hint ? '' : ' warn'}"><b>${esc(wname(r.ware))}</b> · ${esc(GRUND[r.grund] || r.grund)} <span class="klein">(braucht ${zahl(r.will)}, hat ${zahl(r.hat)})</span><div class="tipp">${tipp(r)}</div>${
          route ? `<div style="margin-top:4px"><button class="zeig" data-route="${esc(zu)}|${i}">Route anlegen…</button></div>` : ''}</div>`;
      }).join('')
    }</div></details>`;
  }
  return html;
}

// ---------- Dialoge für Aktionen ----------
function dialogHtml() {
  const d = DIALOG; if (!d) return '';
  const knoepfe = (ok, text) => `<div class="bar" style="margin-top:8px"><button class="knopf" data-ok="1"${ok ? '' : ' disabled'}>${text}</button><button class="knopf" data-abbruch="1">Abbrechen</button></div>${d.msg ? `<div class="${d.fehler ? 'fehler' : 'klein'}" style="margin-top:6px">${esc(d.msg)}</div>` : ''}`;
  if (d.art === 'kauf') {
    if (d.laedt) return `<div class="kasten">Kauf ${esc(wname(d.id))}: lade Angebote… <button class="zeig" data-abbruch="1">Abbrechen</button></div>`;
    const kosten = m => d.ask != null ? geld(m * d.ask) : '–';
    return `<div class="kasten"><b>${esc(wname(d.id))} kaufen</b>
      <div class="klein">Am Markt gerade: günstigstes Verkaufsangebot <b>${geld(d.ask)}</b> je Stück · höchstes Kaufgebot <b>${geld(d.bid)}</b> je Stück</div>
      ${(() => { const ziele = kaufZiele(), std = (ziele.find(z => z.ort === d.ort) || {}).tag || '';
        const oben = Object.entries(D.wartet || {}).map(([w, n]) => zahl(n) + ' ' + esc(wname(w)));
        d.zielStd = std;
        return `<div class="bar" style="margin-top:8px;flex-wrap:wrap"><label class="lbl">Liefern an <select id="kZiel">${ziele.map(z => `<option value="${esc(z.tag)}"${z.tag === std ? ' selected' : ''}>${esc(z.ort)}${z.tag !== z.ort ? ' (Ladeplatz „' + esc(z.tag) + '“)' : ''}</option>`).join('')}<option value=""${std ? '' : ' selected'}>– nicht liefern, oben liegen lassen –</option></select></label></div>` + (oben.length ? `<div class="klein">Achtung: Beim Liefern schickt das Spiel alles mit, was oben schon wartet: ${oben.join(', ')}.</div>` : ''); })()}
      <div class="bar" style="margin-top:8px"><label class="lbl">Wie viele Stück? <input id="kMenge" type="number" min="1" step="1" value="${d.menge}" style="width:110px"></label></div>
      <div class="kasten" style="margin-top:8px"><b>A) Sofort kaufen</b><div class="klein">Kauft jetzt von den günstigsten Verkäufern. Direkt danach wird geliefert, und zwar an den oben gewählten Ort. Gibt es beim günstigsten Preis nicht genug, wird der Rest etwas teurer; mehr als 10 % über ${geld(d.ask)} je Stück im Schnitt zahlst du nie.</div>
        <button class="knopf" data-ok="sofort" style="margin-top:6px"${d.ask != null ? '' : ' disabled'}>Jetzt kaufen für ca. <span id="kKostenA">${kosten(d.menge)}</span></button>${d.ask != null ? '' : ' <span class="klein">gerade bietet niemand an</span>'}</div>
      <div class="kasten" style="margin-top:6px"><b>B) Kaufauftrag (Buy Order)</b><div class="klein">Du legst fest, was du höchstens je Stück zahlen willst. Gekauft wird erst, wenn jemand zu diesem Preis verkauft. Das kann dauern oder nie passieren, ist dafür meist billiger. Einen Lieferort kann man dem Kaufauftrag im Spiel nicht mitgeben: Die Ware wartet oben bei „Uncollected goods“, bis sie geliefert wird. Ist das automatische Abholen an, übernimmt das die Erweiterung.</div>
        <div class="bar" style="margin-top:4px;flex-wrap:wrap"><label class="lbl">Dein Preis je Stück <input id="kPreis" type="number" min="0" step="any" value="${d.preis}" style="width:110px"></label><span class="klein">Vorschlag: 1 Cent über dem höchsten Kaufgebot</span></div>
        <button class="knopf" data-ok="auftrag" style="margin-top:6px">Kaufauftrag stellen über <span id="kKostenB">${geld(d.menge * d.preis)}</span></button></div>
      <div class="bar" style="margin-top:6px"><button class="knopf" data-abbruch="1">Abbrechen</button></div>${d.msg ? `<div class="${d.fehler ? 'fehler' : 'klein'}" style="margin-top:6px">${esc(d.msg)}</div>` : ''}</div>`;
  }
  if (d.art === 'endv') {
    if (d.laedt) return `<div class="kasten">Verkauf ${esc(wname(d.id))}: lade Markt und verkaufbare Menge… <button class="zeig" data-abbruch="1">Abbrechen</button></div>`;
    return `<div class="kasten"><b>${esc(wname(d.id))} verkaufen</b><div class="klein">Verkaufbar laut Spiel: ${zahl(d.max)} (alle deine Lager zusammen) · günstigstes Angebot ${geld(d.ask)} · bestes Gebot ${geld(d.bid)}</div>
      <div class="bar" style="margin-top:6px;flex-wrap:wrap">${d.bid != null ? `<button class="zeig" data-epreis="${d.bid}">Preis B = bestes Gebot ${geld(d.bid)} (verkauft sofort)</button>` : ''}${d.ask != null ? `<button class="zeig" data-epreis="${d.ask}">Preis B = günstigstes Angebot ${geld(d.ask)}</button><button class="zeig" data-epreis="${+(d.ask - 0.01).toFixed(2)}">Preis B = 1 Cent darunter ${geld(+(d.ask - 0.01).toFixed(2))}</button>` : ''}</div>
      <div class="bar" style="margin-top:6px"><label class="lbl">Gesamtmenge (höchstens ${zahl(d.max)}) <input id="eMenge" type="number" min="1" max="${d.max}" step="1" value="${d.max}"${d.max > 0 ? '' : ' disabled'}></label></div>
      <div class="kasten" style="margin-top:8px"><b>A) In Schritten, immer knapp unter dem günstigsten Angebot</b>${d.ask != null ? '' : ' <span class="klein">(gerade bietet niemand an)</span>'}
        <div class="bar" style="margin-top:4px;flex-wrap:wrap"><label class="lbl">Stück je Schritt <input id="eSchritt" type="number" min="1" step="1" value="5" style="width:60px"></label><span class="lbl">immer 1 Cent unter dem günstigsten fremden Angebot</span><label class="lbl">nie unter $ <input id="eMin" type="number" min="0" step="any" placeholder="Mindestpreis" value="${d.ask != null ? Math.floor(d.ask * 0.9 * 100) / 100 : ''}" style="width:110px"></label><span class="klein">Vorschlag: 90 % des günstigsten Angebots</span></div>
        <button class="knopf" data-ok="unter" style="margin-top:6px"${d.max > 0 && d.ask != null ? '' : ' disabled'}>In Schritten verkaufen</button></div>
      <div class="kasten" style="margin-top:6px"><b>B) Alles auf einmal zu einem festen Preis</b>
        <div class="bar" style="margin-top:4px"><label class="lbl">Preis je Stück <input id="ePreis" type="number" min="0" step="any" value="${d.ask ?? preis(d.id) ?? ''}"></label></div>
        <button class="knopf" data-ok="fest" style="margin-top:6px"${d.max > 0 ? '' : ' disabled'}>Gesamtmenge auf einmal verkaufen</button></div>
      <div class="kasten" style="margin-top:6px"><b>C) Immer eine feste Menge am Markt halten (auffüllen)</b><div class="klein">Verkauftes wird jede Minute als neuer Auftrag zum selben Preis nachgeschoben, bis die Gesamtmenge verkauft ist.</div>
        <div class="bar" style="margin-top:4px;flex-wrap:wrap"><label class="lbl">immer offen <input id="cZiel" type="number" min="1" step="1" value="${Math.min(d.max, 350)}" style="width:80px"></label><label class="lbl">Preis je Stück <input id="cPreis" type="number" min="0" step="any" value="${d.ask ?? preis(d.id) ?? ''}" style="width:100px"></label></div>
        <button class="knopf" data-ok="halten" style="margin-top:6px"${d.max > 0 ? '' : ' disabled'}>Auffüllen starten</button></div>
      <div class="bar" style="margin-top:6px"><button class="knopf" data-abbruch="1">Abbrechen</button></div>${d.msg ? `<div class="${d.fehler ? 'fehler' : 'klein'}" style="margin-top:6px">${esc(d.msg)}</div>` : ''}</div>`;
  }
  if (d.art === 'auslagern') {
    const gruppe = (typ, titel, zeile) => { const l = d.plan.filter(x => x.typ === typ); return l.length ? `<div style="margin-top:8px"><b>${titel} (${l.length})</b>${l.map(x => '<div class="z"><span>' + esc(wname(x.w)) + ' <small>' + zeile(x) + '</small></span><span>' + zahl(x.n) + '</span></div>').join('')}</div>` : ''; };
    return `<div class="kasten"><b>${esc(d.ort.name)} auslagern</b><div class="klein">Ziel: Lager leer. Umlagern per Route dorthin, wo die Ware fehlt; Ware, die kein Ort anfordert, wird in Schritten verkauft (immer 1 Cent unter dem günstigsten fremden Angebot).</div>
      ${gruppe('route', 'Umlagern', x => '→ ' + esc(x.ziel.name) + ', ' + (x.hinweis || 'dort fehlen ' + zahl(x.menge)) + ', ' + zahl(x.rate) + '/Min')}
      ${gruppe('verkauf', 'Verkaufen', x => 'Marktpreis ' + geld(preis(x.w)))}
      ${gruppe('bleibt', 'Bleibt', x => esc(x.grund))}
      ${d.plan.some(x => x.typ === 'verkauf') ? `<div class="bar" style="margin-top:8px;flex-wrap:wrap"><label class="lbl">Verkauf: Stück je Schritt <input id="auSchritt" type="number" min="1" step="1" value="20" style="width:70px"></label><label class="lbl">nie unter % des Marktpreises <input id="auProzent" type="number" min="1" max="100" step="1" value="90" style="width:60px"></label></div>` : ''}
      ${knoepfe(d.plan.some(x => x.typ !== 'bleibt'), 'Plan ausführen')}</div>`;
  }
  if (d.art === 'halten') {
    if (d.laedt) return `<div class="kasten">Auffüllen ${esc(wname(d.id))}: lade verkaufbare Menge… <button class="zeig" data-abbruch="1">Abbrechen</button></div>`;
    return `<div class="kasten"><b>${esc(wname(d.id))} immer aufgefüllt halten</b><div class="klein">Jede Minute prüft die Erweiterung, wie viel zu diesem Preis noch offen ist, und stellt das Verkaufte als neuen Auftrag nach. Verkaufbar laut Spiel: ${zahl(d.hat)} (alle Lager, ohne was schon am Markt steht).</div>
      <div class="bar" style="margin-top:6px;flex-wrap:wrap"><label class="lbl">immer offen halten <input id="hZiel" type="number" min="1" step="1" value="${d.ziel}" style="width:90px"></label><label class="lbl">Preis je Stück <input id="hPreis" type="number" min="0" step="any" value="${d.preis}" style="width:100px"></label><label class="lbl">höchstens insgesamt nachschieben <input id="hMax" type="number" min="1" step="1" value="${d.hat}" style="width:100px"></label></div>
      ${knoepfe(d.hat > 0, 'Auffüllen starten')}</div>`;
  }
  if (d.art === 'dross') {
    const r = d.proMaschine, nach = d.bilanz - d.anzahl0 * r;
    return `<div class="kasten"><b>${esc(wname(d.w))} in ${esc(d.ort)} drosseln</b><div class="klein">${zahl(d.maschinen)} Maschinen stellen je ${min1(r)}/Min her. Bilanz jetzt ${d.bilanz >= 0 ? '+' : ''}${min1(d.bilanz)}/Min (bei vollem Betrieb). Pausierte Maschinen lässt das Spiel in Ruhe, Material darin bleibt liegen. „Einschalten…" steht danach an der Fabrik.</div>
      <div class="bar" style="margin-top:6px;flex-wrap:wrap"><label class="lbl">Maschinen pausieren <input id="dAnzahl" type="number" min="1" max="${d.maschinen}" step="1" value="${d.anzahl0}" style="width:70px"></label>
      <span class="klein">Vorschlag ${zahl(d.anzahl0)}: Bilanz danach ${nach >= 0 ? '+' : ''}${min1(nach)}/Min${d.spart.length ? ', spart je Maschine ' + d.spart.map(([w, q]) => min1(q) + ' ' + esc(wname(w)) + '/Min').join(', ') : ''}</span></div>
      ${knoepfe(d.maschinen > 0, 'Pausieren')}</div>`;
  }
  if (d.art === 'an') {
    return `<div class="kasten"><b>${esc(wname(d.maschine))} in ${esc(d.ort)} einschalten</b><div class="klein">${zahl(d.ids.length)} Maschinen sind ausgeschaltet (kein Rezept). Sie bekommen das gewählte Rezept und laufen los, sobald Material da ist.</div>
      <div class="bar" style="margin-top:6px;flex-wrap:wrap"><label class="lbl">Rezept <select id="anRezept">${d.rezepte.map(r => `<option value="${esc(r.rezept)}"${r.rezept === d.wahl ? ' selected' : ''}>${esc(wname(r.p))}</option>`).join('')}</select></label>
      <label class="lbl">Maschinen einschalten <input id="anAnzahl" type="number" min="1" max="${d.ids.length}" step="1" value="${d.ids.length}" style="width:70px"></label></div>
      ${knoepfe(d.rezepte.length > 0, 'Einschalten')}</div>`;
  }
  if (d.art === 'regelmenge') {
    const u = UNTER.find(x => x.id === d.id);
    if (!u) return '';
    if (u.typ === 'halten') return `<div class="kasten"><b>${esc(u.name)}: Auffüllen bearbeiten</b><div class="klein">Bisher ${zahl(u.gestellt)} von ${zahl(u.max)} nachgeschoben, im Lager liegen ${zahl(lagerOhneMaschinen(u.ware))}.</div>
      <div class="bar" style="margin-top:6px;flex-wrap:wrap"><label class="lbl">immer offen <input id="rmZiel" type="number" min="1" step="1" value="${u.ziel}" style="width:90px"></label><label class="lbl">Preis je Stück $ <input id="rmPreis" type="number" min="0" step="any" value="${u.preis}" style="width:100px"></label><label class="lbl">Gesamtmenge <input id="rmMax" type="number" min="${u.gestellt}" step="1" value="${u.max}" style="width:110px"></label></div>
      ${knoepfe(true, 'Änderungen übernehmen')}</div>`;
    return `<div class="kasten"><b>${esc(u.name)}: Verkauf in Schritten bearbeiten</b><div class="klein">Ändert nur die Regel, stellt keinen Auftrag. Verkauft wird weiter in Schritten, ab der nächsten Minute mit den neuen Werten. Bisher ${zahl(u.gestellt)} von ${zahl(u.max)} gestellt, im Lager liegen ${zahl(lagerOhneMaschinen(u.ware))}.</div>
      <div class="bar" style="margin-top:6px;flex-wrap:wrap"><label class="lbl">Mindestpreis $ (nie unter) <input id="rmMin" type="number" min="0" step="any" value="${u.minPreis}" style="width:110px"></label><label class="lbl">Stück je Schritt <input id="rmSchritt" type="number" min="1" step="1" value="${u.schritt}" style="width:80px"></label></div>
      <div class="bar" style="margin-top:6px"><label class="lbl">Neue Gesamtmenge <input id="rmMax" type="number" min="${u.gestellt}" step="1" value="${u.gestellt + lagerOhneMaschinen(u.ware)}" style="width:120px"></label><span class="klein">Vorschlag: bisher gestellt + alles im Lager</span></div>
      ${knoepfe(true, 'Änderungen übernehmen')}</div>`;
  }
  if (d.art === 'storno') {
    const a = D.auftraege.find(x => x.orderId === d.orderId);
    return `<div class="kasten"><b>Auftrag löschen?</b><div class="klein">${a ? (a.seite === 'sell' ? 'Verkauf ' : 'Kauf ') + esc(wname(a.id)) + ', ' + zahl(a.rest) + ' offen à ' + geld(a.preis) : ''}</div>${knoepfe(true, 'Ja, löschen')}</div>`;
  }
  if (d.art === 'route') {
    return `<div class="kasten"><b>${d.jetzt ? 'Liefermenge ändern (bisher ' + zahl(d.jetzt) + ' pro Minute)' : 'Neue Route anlegen'}</b><div class="klein">Von ${esc(d.vonName)} nach ${esc(d.zuName)} für ${esc(wname(d.ware))}. Benutzt jeweils den ersten Ladeplatz.${d.bedarf ? ' Gebraucht werden ' + esc(d.bedarf) + ' pro Minute; vorgeschlagen ist das Doppelte, damit sich ein Vorrat aufbaut.' : ''}</div>${(() => { const alt = (D.routen || []).find(r => r.von === d.von && r.zu === d.zu);
        return alt ? '<div class="klein">Auf dieser Strecke fährt schon: ' + alt.items.filter(i => i.itemId !== d.ware).map(i => esc(wname(i.itemId)) + ' ' + zahl(i.ratePerMin) + '/Min').join(', ') + '. Das bleibt drin.</div>' : ''; })()}
      <div class="bar" style="margin-top:6px"><input id="rRate" type="number" min="1" step="1" value="${d.rate}" aria-label="Stück pro Minute"><span class="klein">Stück pro Minute</span></div>${knoepfe(true, 'Route anlegen')}</div>`;
  }
  return '';
}

// Auslagern: Ort leeren. Ware, die ein anderer Ort (gleiche Insel, mit Ladeplatz) anfordert, geht per Route dorthin;
// Ware, die kein Ort anfordert, wird in Schritten verkauft; Rest bleibt (wird hier selbst gebraucht oder Ziel nicht erreichbar).
function auslagernPlan(ortName) {
  const ort = D.orte.find(o => o.name === ortName && o.pads.length), gebraucht = new Set(D.gebraucht || []);
  const plan = [];
  for (const [w, n] of Object.entries(ort.frei || {})) {
    const ziele = D.orte.filter(o => o !== ort && o.land === ort.land && o.pads.length && (o.bedarf[w] || 0) - (o.waren[w] || 0) > 0)
      .map(o => ({ o, fehlt: (o.bedarf[w] || 0) - (o.waren[w] || 0) })).sort((a, b) => b.fehlt - a.fehlt);
    if (ziele.length) { const menge = Math.min(n, ziele[0].fehlt); plan.push({ w, n, typ: 'route', ziel: ziele[0].o, menge, rate: Math.min(500, Math.max(1, Math.ceil(menge / 30))) }); }
    else {
      // Kein Ort mit Fehlmenge: trotzdem zum Ort, der die Ware verbraucht (Ziel ist ein leeres Lager), sonst verkaufen
      const nutzer = D.orte.filter(o => o !== ort && o.land === ort.land && o.pads.length && (o.bedarf[w] || 0) > 0).sort((a, b) => b.bedarf[w] - a.bedarf[w])[0];
      if (nutzer) plan.push({ w, n, typ: 'route', ziel: nutzer, menge: n, rate: Math.min(500, Math.max(1, Math.ceil(n / 60))), hinweis: 'dort wird es verbraucht' });
      else if (!gebraucht.has(w)) plan.push({ w, n, typ: 'verkauf' });
      else plan.push({ w, n, typ: 'bleibt', grund: 'wird gebraucht, aber kein Ort in Fahrweite mit Ladeplatz' });
    }
  }
  for (const [w, n] of Object.entries(ort.waren)) if (n > 0 && !(ort.frei || {})[w]) plan.push({ w, n, typ: 'bleibt', grund: 'wird hier selbst gebraucht' });
  return { ort, plan };
}

async function haltenOeffnen(id, ziel, preisJe) {
  DIALOG = { art: 'halten', id, laedt: true }; render(); window.scrollTo(0, 0);
  const [s] = await api(['/api/game/' + D.firmaId + '/sellable?commodity=' + id.toUpperCase()]);
  if (!DIALOG || DIALOG.art !== 'halten' || DIALOG.id !== id) return;
  const hat = (s.json && s.json.youHold) || 0;
  DIALOG = { art: 'halten', id, ziel, preis: preisJe, hat, msg: hat ? '' : 'Das Spiel meldet 0 verkaufbar: Es ist nichts mehr zum Nachschieben da.' };
  render();
}

function drossOeffnen(ort, w) {
  const f = PROD.fabriken.find(f => f.ort === ort), gs = PROD.gruppen.filter(g => g.ort === ort && g.produkt === w && g.R);
  if (!f || !gs.length) { melde('Keine Maschinen mit diesem Rezept gefunden.', true); return; }
  const x = f.liste.find(x => x.w === w) || { bilanz: (f.waren[w] || {}).produktion / 60 || 0, verbrauch: 0 };
  const R = gs[0].R, proMaschine = R.r, ids = gs.flatMap(g => g.ids);
  const anzahl0 = x.verbrauch > 0 ? Math.max(1, Math.min(ids.length, Math.floor(x.bilanz / proMaschine))) : 1;
  DIALOG = { art: 'dross', ort, w, rezept: gs[0].rezept, ids, maschinen: ids.length, proMaschine, bilanz: x.bilanz, anzahl0,
    spart: R.i.map(([z, q]) => [z, q * proMaschine / R.q]) };
  render(); window.scrollTo(0, 0);
}

// Ausgeschaltete Maschinen (ohne Rezept) wieder einschalten. Rezept-Vorschlag: was die Erweiterung beim Pausieren gemerkt hat, sonst das häufigste Rezept dieser Maschine am Ort
function anOeffnen(ort, maschine) {
  const gs = PROD.gruppen.filter(g => g.ort === ort && g.maschine === maschine), ids = gs.filter(g => !g.rezept).flatMap(g => g.ids);
  if (!ids.length) { melde('Keine ausgeschalteten Maschinen gefunden.', true); return; }
  const roh = {};   // Produkt → Rezept-Name, wie das Spiel ihn an dieser Maschinenart benutzt (manche mit v_ davor)
  for (const g of PROD.gruppen) if (g.maschine === maschine && g.rezept) roh[g.produkt] = g.rezept;
  const rezepte = Object.keys(REZEPTE).filter(k => k.startsWith(maschine + '|')).map(k => { const p = k.split('|')[1]; return { p, rezept: roh[p] || p }; });
  const gemerkt = ids.map(id => PAUSE[id] && PAUSE[id].rezept).find(Boolean);
  const haeufig = gs.filter(g => g.rezept).sort((x, y) => y.anzahl - x.anzahl)[0];
  DIALOG = { art: 'an', ort, maschine, ids, rezepte, wahl: gemerkt || (haeufig && haeufig.rezept) || (rezepte[0] && rezepte[0].rezept) || '' };
  render(); window.scrollTo(0, 0);
}

// Lieferziele: Ladeplatz-Namen, die genau einem Ort gehören (sonst könnte das Spiel am falschen Ort abladen)
function kaufZiele() {
  const zahl = {};
  for (const o of D.orte) for (const t of o.tags || []) zahl[t] = (zahl[t] || 0) + 1;
  return D.orte.flatMap(o => (o.tags || []).filter(t => zahl[t] === 1).map(t => ({ ort: o.name, tag: t })));
}

async function kaufOeffnen(id, menge, ort) {
  DIALOG = { art: 'kauf', id, laedt: true }; render(); window.scrollTo(0, 0);
  const [b] = await api(['/api/market/book?commodity=' + id.toUpperCase()]);
  if (!DIALOG || DIALOG.art !== 'kauf' || DIALOG.id !== id) return;
  const bk = b.json || {};
  const asks = (bk.asks || []).map(x => x.price).concat(bk.npcAsk != null ? [bk.npcAsk] : []).sort((x, y) => x - y);
  const bids = (bk.bids || []).map(x => x.price).concat(bk.npcBid != null ? [bk.npcBid] : []).sort((x, y) => y - x);
  DIALOG = { art: 'kauf', id, menge, ort, ask: asks[0] ?? null, bid: bids[0] ?? null, preis: bids[0] != null ? +(bids[0] + 0.01).toFixed(2) : (asks[0] ?? preis(id) ?? 0) };
  render();
}

async function endOeffnen(id) {
  DIALOG = { art: 'endv', id, laedt: true }; render(); window.scrollTo(0, 0);
  const [s, b] = await api(['/api/game/' + D.firmaId + '/sellable?commodity=' + id.toUpperCase(), '/api/market/book?commodity=' + id.toUpperCase()], 300);
  if (!DIALOG || DIALOG.art !== 'endv' || DIALOG.id !== id) return;
  const asks = ((b.json && b.json.asks) || []).map(x => x.price).sort((x, y) => x - y);
  const bids = ((b.json && b.json.bids) || []).map(x => x.price).sort((x, y) => y - x);
  const max = (s.json && s.json.youHold) || 0;
  DIALOG = { art: 'endv', id, max, ask: asks[0] ?? null, bid: bids[0] ?? null,
    msg: max ? '' : 'Das Spiel meldet 0 verkaufbar: Die Ware liegt in keinem deiner Lager oder steckt schon in einem Verkaufsauftrag.' };
  render();
}

async function dialogOk(modus) {
  const d = DIALOG; if (!d) return;
  // Eingaben ZUERST sichern: render() baut das Fenster neu und würde sonst die Standardwerte zurücksetzen
  const eingabe = {};
  document.querySelectorAll('#liste input, #liste select').forEach(i => { if (i.id) eingabe[i.id] = i.value; });
  const v = id => eingabe[id] ?? '';
  const zeichne = () => { render(); for (const [id, w] of Object.entries(eingabe)) { const el = $(id); if (el) el.value = w; } };
  d.msg = 'wird gesendet…'; d.fehler = false; zeichne();
  try {
    if (d.art === 'kauf') {
      const menge = Math.floor(+v('kMenge')), p = +v('kPreis'), C = d.id.toUpperCase();
      if (!(menge > 0)) throw new Error('Menge ungültig.');
      if (modus === 'sofort') {
        // maxTotal: Obergrenze für die Gesamtkosten, 10 % Luft über dem besten Angebot
        await aktion('/api/game/' + D.firmaId + '/market/trade', { commodity: C, side: 'buy', qty: menge, maxTotal: Math.ceil(menge * d.ask * 1.1) });
        const ziel = v('kZiel');
        if (ziel) {
          try { await aktion('/api/game/' + D.firmaId + '/market/deliver', { dest: { kind: 'tag', tag: ziel } }); melde('Gekauft: ' + zahl(menge) + ' ' + wname(d.id) + ', Lieferung an ' + ziel + ' ist unterwegs.'); }
          catch (e) { melde('Gekauft: ' + zahl(menge) + ' ' + wname(d.id) + '. Liefern ging nicht (' + e.message + '), die Ware wartet oben bei „Uncollected goods“.', true); }
        } else melde('Gekauft: ' + zahl(menge) + ' ' + wname(d.id) + '. Die Ware wartet oben bei „Uncollected goods“.');
      } else {
        if (!(p > 0)) throw new Error('Preis ungültig.');
        await aktion('/api/game/' + D.firmaId + '/market/order', { commodity: C, side: 'buy', price: p, qty: menge });
        melde('Kaufauftrag gestellt: ' + zahl(menge) + ' ' + wname(d.id) + ' à ' + geld(p));
      }
    } else if (d.art === 'endv') {
      const menge = Math.floor(+v('eMenge')), art = modus;
      if (!(menge > 0 && menge <= d.max)) throw new Error('Menge ungültig (höchstens ' + zahl(d.max) + ').');
      if (art === 'halten') {
        const ziel = Math.floor(+v('cZiel')), p = +v('cPreis');
        if (!(ziel > 0 && p > 0)) throw new Error('Menge und Preis müssen größer 0 sein.');
        UNTER = UNTER.filter(u => !(u.typ === 'halten' && u.ware === d.id && u.firmaId === D.firmaId && Math.abs(u.preis - p) < 0.005));
        UNTER.push({ id: crypto.randomUUID(), typ: 'halten', firmaId: D.firmaId, ware: d.id, name: wname(d.id), ziel, preis: p, max: menge, gestellt: 0, aktiv: true, log: '', at: 0 });
        await chrome.storage.local.set({ unterbieten: UNTER });
        chrome.runtime.sendMessage('unterbieten').catch(() => {});
        melde(wname(d.id) + ': es werden jetzt immer ' + zahl(ziel) + ' zu ' + geld(p) + ' offen gehalten, insgesamt bis ' + zahl(menge) + '.');
      } else if (art === 'unter') {
        const schritt = Math.floor(+v('eSchritt')), cent = 1, min = +v('eMin');
        if (!(schritt > 0)) throw new Error('Stück je Schritt muss mindestens 1 sein.');
        if (!(min > 0)) throw new Error('Mindestpreis fehlt. Ohne ihn könnten sich zwei Verkäufer bis auf 0 $ runterbieten.');
        UNTER.push({ id: crypto.randomUUID(), firmaId: D.firmaId, ware: d.id, name: wname(d.id), schritt, abstand: cent / 100, minPreis: min, max: menge, gestellt: 0, aktiv: true, log: '', at: 0 });
        await chrome.storage.local.set({ unterbieten: UNTER });
        chrome.runtime.sendMessage('unterbieten').catch(() => {});
        melde('Regel angelegt: ' + wname(d.id) + ' immer knapp unter dem günstigsten Angebot. Stand im Reiter Alarme.');
      } else {
        const p = +v('ePreis');
        if (!(p > 0)) throw new Error('Preis ungültig.');
        await aktion('/api/game/' + D.firmaId + '/market/order', { commodity: d.id.toUpperCase(), side: 'sell', price: p, qty: menge });
        melde('Verkaufsauftrag gestellt: ' + zahl(menge) + ' ' + wname(d.id) + ' à ' + geld(p));
      }
    } else if (d.art === 'auslagern') {
      const zeilen = [];
      // Routen: je Zielort ein Befehl, bestehende Waren der Strecke frisch aus dem Spiel übernehmen
      const routen = d.plan.filter(x => x.typ === 'route');
      if (routen.length) {
        const [lg] = await api(['/api/game/' + D.firmaId + '/logistics']);
        if (!lg.json) throw new Error('Routen konnten nicht geladen werden, bitte nochmal.');
        for (const zielName of [...new Set(routen.map(x => x.ziel.name))]) {
          const teil = routen.filter(x => x.ziel.name === zielName), von = d.ort.pads[0], zu = teil[0].ziel.pads[0];
          const frisch = (lg.json.lanes || []).find(l => l.manual && l.manual.fromPadId === von && l.manual.toPadId === zu);
          const neu = new Set(teil.map(x => x.w));
          const items = (frisch ? frisch.items.filter(i => !neu.has(i.itemId)).map(i => ({ itemId: i.itemId, ratePerMin: i.wantRate })) : []).concat(teil.map(x => ({ itemId: x.w, ratePerMin: x.rate })));
          await aktion('/api/game/' + D.firmaId + '/logistics/lane', { fromPadId: von, toPadId: zu, items, enabled: true });
          zeilen.push('Route nach ' + zielName + ': ' + teil.map(x => wname(x.w)).join(', '));
        }
      }
      // Verkauf: je Ware eine Schritt-Regel, Mindestpreis in % des Marktpreises; bestehende Regeln bleiben unberührt
      const verk = d.plan.filter(x => x.typ === 'verkauf');
      if (verk.length) {
        const schritt = Math.floor(+v('auSchritt')), pct = +v('auProzent');
        if (!(schritt > 0) || !(pct > 0 && pct <= 100)) throw new Error('Stück je Schritt und Prozent prüfen.');
        let neuR = 0;
        for (const x of verk) {
          const p = preis(x.w);
          if (p == null || UNTER.some(u => u.ware === x.w && u.firmaId === D.firmaId)) continue;
          UNTER.push({ id: crypto.randomUUID(), firmaId: D.firmaId, ware: x.w, name: wname(x.w), schritt, abstand: 0.01, minPreis: Math.floor(p * pct) / 100, max: x.n, gestellt: 0, aktiv: true, log: '', at: 0 });
          neuR++;
        }
        await chrome.storage.local.set({ unterbieten: UNTER });
        chrome.runtime.sendMessage('unterbieten').catch(() => {});
        zeilen.push(neuR + ' Schritt-Verkäufe angelegt');
      }
      melde(d.ort.name + ' wird ausgelagert: ' + zeilen.join(' · '));
    } else if (d.art === 'halten') {
      const ziel = Math.floor(+v('hZiel')), p = +v('hPreis'), max = Math.floor(+v('hMax'));
      if (!(ziel > 0 && p > 0 && max > 0)) throw new Error('Menge, Preis und Höchstmenge müssen größer 0 sein.');
      UNTER = UNTER.filter(u => !(u.typ === 'halten' && u.ware === d.id && u.firmaId === D.firmaId && Math.abs(u.preis - p) < 0.005));
      UNTER.push({ id: crypto.randomUUID(), typ: 'halten', firmaId: D.firmaId, ware: d.id, name: wname(d.id), ziel, preis: p, max, gestellt: 0, aktiv: true, log: '', at: 0 });
      await chrome.storage.local.set({ unterbieten: UNTER });
      chrome.runtime.sendMessage('unterbieten').catch(() => {});
      melde(wname(d.id) + ': es werden jetzt immer ' + zahl(ziel) + ' zu ' + geld(p) + ' offen gehalten.');
    } else if (d.art === 'dross') {
      const n = Math.floor(+v('dAnzahl'));
      if (!(n >= 1 && n <= d.ids.length)) throw new Error('Anzahl zwischen 1 und ' + d.ids.length + '.');
      // Noch nicht pausierte Maschinen nehmen; eine Ablehnung bricht nicht ab, die Meldung nennt Maschine und Grund
      const neu = { ...PAUSE }, fehler = []; let ok = 0;
      for (const id of d.ids.filter(id => !PAUSE[id])) {
        if (ok >= n) break;
        try {
          await aktion('/api/game/' + D.firmaId + '/machine/recipe', { placementId: id, recipe: null });
          neu[id] = { rezept: d.rezept, ort: d.ort, produkt: d.w, firmaId: D.firmaId, at: Date.now() }; ok++;
          await chrome.storage.local.set({ pausiert: neu });   // nach jeder Maschine sichern, damit „Wieder an" nichts vergisst
        } catch (e) { fehler.push(id.slice(0, 8) + ': ' + e.message.replace('Spiel lehnt ab: ', '')); if (fehler.length >= 3 && !ok) break; }
      }
      PAUSE = neu; PROD = null;
      if (fehler.length && !ok) throw new Error('Keine Maschine pausiert. Antwort des Spiels: ' + fehler.join(' · '));
      melde(ok + ' Maschinen für ' + wname(d.w) + ' pausiert.' + (fehler.length ? ' Abgelehnt: ' + fehler.join(' · ') : ''), !!fehler.length);
    } else if (d.art === 'an') {
      const n = Math.floor(+v('anAnzahl')), rezept = v('anRezept');
      if (!(n >= 1 && n <= d.ids.length)) throw new Error('Anzahl zwischen 1 und ' + d.ids.length + '.');
      if (!rezept) throw new Error('Kein Rezept gewählt.');
      const neu = { ...PAUSE }, fehler = []; let ok = 0;
      for (const id of d.ids.slice(0, n)) {
        try {
          await aktion('/api/game/' + D.firmaId + '/machine/recipe', { placementId: id, recipe: rezept });
          delete neu[id]; ok++;
          await chrome.storage.local.set({ pausiert: neu });
        } catch (e) { fehler.push(id.slice(0, 8) + ': ' + e.message.replace('Spiel lehnt ab: ', '')); if (fehler.length >= 3 && !ok) break; }
      }
      PAUSE = neu; PROD = null;
      if (fehler.length && !ok) throw new Error('Keine Maschine eingeschaltet. Antwort des Spiels: ' + fehler.join(' · '));
      melde(ok + ' Maschinen ' + wname(d.maschine) + ' eingeschaltet.' + (fehler.length ? ' Abgelehnt: ' + fehler.join(' · ') : ''), !!fehler.length);
    } else if (d.art === 'regelmenge') {
      const n = Math.floor(+v('rmMax')), u = UNTER.find(x => x.id === d.id);
      if (!u) throw new Error('Regel nicht mehr da.');
      if (!(n >= u.gestellt)) throw new Error('Die Gesamtmenge muss mindestens ' + zahl(u.gestellt) + ' sein (schon gestellt).');
      if (u.typ === 'halten') {
        const ziel = Math.floor(+v('rmZiel')), p = +v('rmPreis');
        if (!(ziel > 0 && p > 0)) throw new Error('Menge und Preis müssen größer 0 sein.');
        u.ziel = ziel; u.preis = p;
      } else {
        const min = +v('rmMin'), schritt = Math.floor(+v('rmSchritt'));
        if (!(min > 0)) throw new Error('Mindestpreis fehlt. Ohne ihn könnten sich zwei Verkäufer bis auf 0 $ runterbieten.');
        if (!(schritt > 0)) throw new Error('Stück je Schritt muss mindestens 1 sein.');
        u.minPreis = min; u.schritt = schritt;
      }
      u.max = n;
      await chrome.storage.local.set({ unterbieten: UNTER });
      chrome.runtime.sendMessage('unterbieten').catch(() => {});
      melde(u.name + ': Änderungen gespeichert, gilt ab der nächsten Minute.');
    } else if (d.art === 'storno') {
      await aktion('/api/game/' + D.firmaId + '/market/cancel', { orderId: d.orderId });
      melde('Auftrag gelöscht.');
    } else if (d.art === 'route') {
      const rate = +v('rRate');
      if (!(rate > 0)) throw new Error('Rate ungültig.');
      const [lg] = await api(['/api/game/' + D.firmaId + '/logistics']);
      if (!lg.json) throw new Error('Routen konnten nicht geladen werden, bitte nochmal.');
      const frisch = (lg.json.lanes || []).find(l => l.manual && l.manual.fromPadId === d.von && l.manual.toPadId === d.zu);
      const alt = frisch && { items: (frisch.items || []).map(i => ({ itemId: i.itemId, ratePerMin: i.wantRate })) };
      const items = (alt ? alt.items.filter(i => i.itemId !== d.ware).map(i => ({ itemId: i.itemId, ratePerMin: i.ratePerMin })) : []).concat({ itemId: d.ware, ratePerMin: rate });
      await aktion('/api/game/' + D.firmaId + '/logistics/lane', { fromPadId: d.von, toPadId: d.zu, items, enabled: true });
      melde('Route angelegt: ' + d.vonName + ' → ' + d.zuName);
    }
    DIALOG = null; SOFORT = null;
    await aktualisieren();
  } catch (e) { d.msg = e.message; d.fehler = true; zeichne(); }
}

// ---------- Sofortverkauf ----------
async function sofortBerechnen() {
  const summen = {};
  for (const q of quellen()) for (const [id, n] of Object.entries(q.waren)) if (n > 0) summen[id] = (summen[id] || 0) + n;
  const ids = Object.keys(summen);
  const btn = $('sofort'); btn.disabled = true; btn.textContent = 'rechnet ' + ids.length + ' Waren…';
  try {
    const res = await api(ids.map(id => '/api/market/book?commodity=' + id.toUpperCase()), 400);
    const proWare = {}; let summe = 0, liste = 0;
    ids.forEach((id, k) => {
      const n = summen[id], b = res[k] && res[k].json; liste += wert(id, n) ?? 0;
      if (!b) return;
      const bids = (b.bids || []).slice();
      if (b.npcBid > 0) bids.push({ price: b.npcBid, qty: Infinity });
      bids.sort((x, y) => y.price - x.price);
      let rest = n, erloes = 0;
      for (const x of bids) { if (rest <= 0) break; const t = Math.min(rest, x.qty); erloes += t * x.price; rest -= t; }
      proWare[id] = { erloes, menge: n - rest }; summe += erloes;
    });
    SOFORT = { at: Date.now(), key: firmaWahl, proWare, summe, liste };
  } catch (e) { melde(e.message, true); }
  finally { btn.disabled = false; btn.textContent = 'Sofortverkauf berechnen'; }
  render();
}

// ---------- Zu einem Ort springen ----------
async function zeigen(lat, lon) {
  const t = await crSpielTab(true);
  if (!t) { melde('Öffne zuerst das Spiel (play.capitalrift.com) in einem Tab.', true); return; }
  await chrome.tabs.update(t.id, { active: true });
  try { await chrome.windows.update(t.windowId, { focused: true }); } catch {}
  const [x] = await chrome.scripting.executeScript({
    target: { tabId: t.id }, world: 'MAIN', args: [(+lat).toFixed(5) + ', ' + (+lon).toFixed(5)],
    func: q => { const i = document.getElementById('search-input'); if (!i) return false; i.value = q; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; },
  });
  if (!x || !x.result) melde('Ortssuche im Spiel nicht gefunden. Ist das Spiel fertig geladen?', true);
}

// ---------- Rahmen ----------
// Nicht neu zeichnen, solange der Cursor in einem Eingabefeld oder einer Auswahlliste der Leiste steht (sonst springt Getipptes zurück);
// beim Verlassen des Feldes wird nachgeholt. Häkchen und Knöpfe sind ausgenommen.
let renderSpaeter = false;
const tipptGerade = () => { const a = document.activeElement; return !!a && $('liste').contains(a) && (a.tagName === 'SELECT' || a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !/^(checkbox|radio|button|submit)$/.test(a.type))); };
$('liste').addEventListener('focusout', () => setTimeout(() => { if (renderSpaeter && !tipptGerade()) { renderSpaeter = false; render(); } }, 0));
function render() {
  if (tipptGerade()) { renderSpaeter = true; return; }
  document.querySelectorAll('.reiter button').forEach(b => b.setAttribute('aria-selected', b.dataset.r === reiter));
  $('ctl-lager').hidden = reiter !== 'lager'; $('ctl-prod').hidden = reiter !== 'prod';
  document.querySelectorAll('#ansicht button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === ansicht));
  document.querySelectorAll('#sort button').forEach(b => b.setAttribute('aria-pressed', b.dataset.s === sortBy));
  $('firmaWahl').value = firmaWahl;
  if (!D) return;
  const html = reiter === 'prod' ? renderProd() : reiter === 'eng' ? renderEng() : renderLager();
  $('liste').innerHTML = html || '<div class="hinweis">Nichts gefunden.</div>';
  aufklappbar();
}

// Jeder Kasten mit Überschrift (<b> am Anfang) wird auf-/zuklappbar, anfangs offen. Zugeklapptes wird je Reiter + Überschrift gemerkt.
// Dialoge (mit OK-Knopf) bleiben immer offen. In die Kopfzeile kommt nur, was vor dem ersten Block oder Eingabefeld steht.
let ZU = new Set((() => { try { return JSON.parse(localStorage.getItem('lager.zu')) || []; } catch { return []; } })());
function aufklappbar() {
  const liste = $('liste'); if (!liste.querySelectorAll) return;
  for (const k of liste.querySelectorAll('div.kasten')) {
    const b = k.firstElementChild;
    if (!b || b.tagName !== 'B' || k.querySelector('[data-ok]')) continue;
    const key = reiter + ':' + b.textContent.trim();
    const d = document.createElement('details'); d.className = k.className; d.style.cssText = k.style.cssText; d.dataset.kasten = key; d.open = !ZU.has(key);
    const s = document.createElement('summary'); s.className = 'kk';
    while (k.firstChild && !(k.firstChild.nodeType === 1 && /^(DIV|DETAILS|TABLE|UL|OL|FORM|INPUT|SELECT|TEXTAREA|LABEL)$/.test(k.firstChild.tagName))) s.appendChild(k.firstChild);
    d.appendChild(s); while (k.firstChild) d.appendChild(k.firstChild);
    k.replaceWith(d);
  }
}

const VERLAUF = [];   // [{at, orte: {ortName: {ware: menge}}}], höchstens 60 Einträge
function gemessen(ort, w) {
  const jetzt = VERLAUF[VERLAUF.length - 1], alt = VERLAUF.find(v => jetzt && jetzt.at - v.at >= 10 * 60000);
  if (!jetzt || !alt || !alt.orte[ort] || !jetzt.orte[ort]) return null;
  const min = Math.round((jetzt.at - alt.at) / 60000);
  return { min, proMin: ((jetzt.orte[ort][w] || 0) - (alt.orte[ort][w] || 0)) / min };
}

async function aktualisieren() {
  melde('lädt…');
  try {
    D = await laden();
    if (D.teile) SAMMLE_KOPF[D.firmaId] = { 'x-cr-sec': SAMMLE_UNNOETIG.filter(k => D.teile[k]).map(k => k + '=' + D.teile[k]).join(',') };
    ALLE[D.firmaId] = D;
    if (VERLAUF.length && VERLAUF[0].firmaId !== D.firmaId) VERLAUF.length = 0;
    VERLAUF.push({ at: D.at, firmaId: D.firmaId, orte: Object.fromEntries(D.orte.map(o => [o.name, { ...o.waren }])) });
    if (VERLAUF.length > 60) VERLAUF.shift();
    chrome.storage.local.set({ ['firma:' + D.firmaId]: D });
    $('firma').textContent = D.firma;
    if (!Object.keys(FIRMEN).length) firmenLaden(); else $('firmaWechsel').value = FIRMEN[D.firmaId] ? D.firmaId : '';
    $('cash').textContent = 'Bargeld ' + geld(D.cash);
    melde('Stand ' + uhr(D.at));
    if (PROD && PROD.firmaId !== D.firmaId) PROD = null;
    if (!DIALOG) render();
  } catch (e) {
    melde(e.message, true);
    if (!D) $('liste').innerHTML = '<div class="hinweis">' + esc(e.message) + '</div>';
  }
}

document.querySelectorAll('.reiter button').forEach(b => b.addEventListener('click', () => { reiter = b.dataset.r; merk('reiter', reiter); DIALOG = null; render(); }));
document.querySelectorAll('#ansicht button').forEach(b => b.addEventListener('click', () => { ansicht = b.dataset.v; merk('ansicht', ansicht); render(); }));
document.querySelectorAll('#sort button').forEach(b => b.addEventListener('click', () => { sortBy = b.dataset.s; merk('sort', sortBy); render(); }));
$('firmaWahl').addEventListener('change', e => { firmaWahl = e.target.value; merk('firma', firmaWahl); render(); });
$('q').addEventListener('input', render);
$('neu').addEventListener('click', aktualisieren);
// Firma wechseln aus der Leiste: Liste aus /api/company/mine; nach dem Wechsel Spiel-Tab neu laden (wie das Spiel selbst), Leiste neu laden
let FIRMEN = {};   // firmaId → Name
async function firmenLaden() {
  try {
    const [r] = await api(['/api/company/mine']);
    FIRMEN = Object.fromEntries(((r.json && r.json.companies) || []).map(f => [f.id, f.name]));
    $('firmaWechsel').innerHTML = '<option value="">Eigener Spieler</option>' + Object.entries(FIRMEN).map(([id, n]) => '<option value="' + esc(id) + '">' + esc(n) + '</option>').join('');
    if (D) $('firmaWechsel').value = FIRMEN[D.firmaId] ? D.firmaId : '';
  } catch {}
}
$('firmaWechsel').addEventListener('change', async e => {
  const ziel = e.target.value;
  melde('wechselt zu ' + (FIRMEN[ziel] || 'eigenem Spieler') + '…');
  try {
    await crFirmaWechseln(ziel || null);
    for (const t of await chrome.tabs.query({ url: 'https://play.capitalrift.com/*' })) chrome.tabs.reload(t.id);
    await aktualisieren();
  } catch (err) { melde('Wechsel nicht möglich: ' + (err && err.message || err), true); if (D) e.target.value = FIRMEN[D.firmaId] ? D.firmaId : ''; }
});
$('sprache').textContent = SPRACHE === 'en' ? 'DE' : 'EN';
$('sprache').addEventListener('click', () => { const neu = SPRACHE === 'en' ? 'de' : 'en'; merk('sprache', neu); chrome.storage.local.set({ sprache: neu }).finally(() => location.reload()); });
$('sofort').addEventListener('click', sofortBerechnen);
$('prodNeu').addEventListener('click', prodLaden);
$('liste').addEventListener('toggle', e => {
  const d = e.target.dataset || {};
  if (d.k) e.target.open ? offen.add(d.k) : offen.delete(d.k);
  if (d.zu != null) e.target.open ? zuP.delete(d.zu) : zuP.add(d.zu);
  if (d.kasten) { e.target.open ? ZU.delete(d.kasten) : ZU.add(d.kasten); try { localStorage.setItem('lager.zu', JSON.stringify([...ZU])); } catch {} }
}, true);
// Kaufen: Kosten beim Tippen mitrechnen
$('liste').addEventListener('input', e => {
  if (!DIALOG || DIALOG.art !== 'kauf' || (e.target.id !== 'kMenge' && e.target.id !== 'kPreis')) return;
  const m = Math.max(0, Math.floor(+$('kMenge').value) || 0), p = +$('kPreis').value || 0;
  if ($('kKostenA')) $('kKostenA').textContent = DIALOG.ask != null ? geld(m * DIALOG.ask) : '–';
  if ($('kKostenB')) $('kKostenB').textContent = geld(m * p);
});
// Mengen im Verkaufsdialog hart begrenzen: nie mehr als verkaufbar, Schritt nie größer als die Gesamtmenge
$('liste').addEventListener('input', e => {
  const t = e.target; if (!DIALOG || DIALOG.art !== 'endv' || (t.id !== 'eMenge' && t.id !== 'eSchritt')) return;
  const grenze = t.id === 'eMenge' ? DIALOG.max : Math.floor(+$('eMenge').value) || 1;
  const n = Math.floor(+t.value);
  if (t.value !== '' && (!(n >= 1) || n > grenze)) t.value = Math.max(1, Math.min(grenze, n || 1));
  if (t.id === 'eMenge' && +$('eSchritt').value > +t.value) $('eSchritt').value = t.value;
});
$('liste').addEventListener('click', e => {
  const t = e.target.closest('button'); if (!t) return;
  if (t.closest('summary')) e.preventDefault();          // Knopf in der Kopfzeile klappt nicht auf/zu
  if (t.dataset.lat) zeigen(t.dataset.lat, t.dataset.lon);
  else if (t.dataset.verkauf) endOeffnen(t.dataset.verkauf).catch(err => { DIALOG = null; melde(err.message, true); render(); });
  else if (t.dataset.storno) { DIALOG = { art: 'storno', orderId: t.dataset.storno }; render(); window.scrollTo(0, 0); }
  else if (t.dataset.route) {
    const [zu, i] = t.dataset.route.split('|'), r = D.fehlt.filter(x => x.grund !== 'met' && x.grund !== 'moving' && x.zu === zu)[+i];
    const von = D.orte.find(o => o.unitKey === r.hint.key), nach = D.orte.find(o => o.unitKey === r.zuKey);
    if (!von || !nach || !von.pads.length || !nach.pads.length) { melde('Für diese Orte fehlen Ladeplätze.', true); return; }
    DIALOG = { art: 'route', von: von.pads[0], zu: nach.pads[0], vonName: von.name, zuName: nach.name, ware: r.ware, rate: 10 }; render(); window.scrollTo(0, 0);
  }
  else if (t.dataset.rplus) {
    const [von, zu, ware, jetzt, rate, bedarf] = t.dataset.rplus.split('|');
    const name = pad => (D.orte.find(o => o.pads.includes(pad)) || {}).name || '?';
    DIALOG = { art: 'route', von, zu, vonName: name(von), zuName: name(zu), ware, rate: +rate, jetzt: +jetzt, bedarf }; render(); window.scrollTo(0, 0);
  }
  else if (t.dataset.froute) {
    const [fabrik, ware, vonName, rate] = t.dataset.froute.split('|');
    const von = D.orte.find(o => o.name === vonName), nach = D.orte.find(o => o.name === fabrik);
    if (!von || !nach || !von.pads.length || !nach.pads.length) { melde('Für diese Orte fehlen Ladeplätze.', true); return; }
    DIALOG = { art: 'route', von: von.pads[0], zu: nach.pads[0], vonName: von.name, zuName: nach.name, ware, rate: +rate || 10 }; render(); window.scrollTo(0, 0);
  }
  else if (t.dataset.epreis) $('ePreis').value = t.dataset.epreis;
  else if (t.dataset.abholen) chrome.runtime.sendMessage('abholen').catch(() => {});
  else if (t.dataset.kauf) { const [w, m, o] = t.dataset.kauf.split('|'); kaufOeffnen(w, +m, o).catch(err => { DIALOG = null; melde(err.message, true); render(); }); }
  else if (t.dataset.endv) endOeffnen(t.dataset.endv).catch(err => { DIALOG = null; melde(err.message, true); render(); });
  else if (t.dataset.ok) dialogOk(t.dataset.ok);
  else if (t.dataset.abbruch) { DIALOG = null; render(); }
  else if (t.dataset.ausl) { const p = auslagernPlan(t.dataset.ausl); DIALOG = { art: 'auslagern', ort: p.ort, plan: p.plan }; render(); window.scrollTo(0, 0); }
  else if (t.dataset.halten) { const [w, z, p] = t.dataset.halten.split('|'); haltenOeffnen(w, +z, +p).catch(err => { DIALOG = null; melde(err.message, true); render(); }); }
  else if (t.dataset.dross) { const [o, w] = t.dataset.dross.split('|'); drossOeffnen(o, w); }
  else if (t.dataset.an) { const [o, m] = t.dataset.an.split('|'); anOeffnen(o, m); }
  else if (t.dataset.umenge) { DIALOG = { art: 'regelmenge', id: t.dataset.umenge }; render(); window.scrollTo(0, 0); }
  else if (t.dataset.uweg) { UNTER = UNTER.filter(r => r.id !== t.dataset.uweg); chrome.storage.local.set({ unterbieten: UNTER }); melde('Schritt-Verkauf gestoppt. Bereits gestellte Aufträge bleiben am Markt.'); render(); }
});
$('liste').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'autoAb') { chrome.storage.local.set({ autoAbholen: t.checked }); return; }
  if (t.id === 'abAblade') { ABHOL.ablade = { ...ABHOL.ablade, [D.firmaId]: t.value }; chrome.storage.local.set({ abholAblade: ABHOL.ablade }).then(() => chrome.runtime.sendMessage('abholen').catch(() => {})); melde(t.value ? 'Abladeort gespeichert, wird gleich geprüft.' : 'Ware bleibt liegen, wenn sie nirgends gebraucht wird.'); return; }
});
chrome.storage.onChanged.addListener((ch, bereich) => {
  if (bereich !== 'local') return;
  if (ch.unterbieten) UNTER = ch.unterbieten.newValue || [];
  if (ch.autoAbholen) ABHOL.auto = ch.autoAbholen.newValue !== false;
  if (ch.abholLog) ABHOL.log = ch.abholLog.newValue || null;
  if (reiter === 'lager' && ch.unterbieten && !DIALOG) render();
  if (reiter === 'eng' && (ch.autoAbholen || ch.abholLog) && !DIALOG) render();
});

chrome.storage.local.get(null).then(s => {
  for (const [k, v] of Object.entries(s)) if (k.startsWith('firma:')) ALLE[v.firmaId] = v;
  UNTER = s.unterbieten || []; PAUSE = s.pausiert || {};
  ABHOL = { auto: s.autoAbholen !== false, log: s.abholLog || null, ablade: s.abholAblade || {} };
  render();
  aktualisieren();
});
setInterval(() => { if (!document.hidden && !DIALOG) aktualisieren(); }, AUTO_MS);

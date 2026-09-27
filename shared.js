// Gemeinsam für Seitenleiste und Hintergrund. Holt Spieldaten; lehnt der Server die
// Erweiterung ab (kein Cookie), läuft dieselbe Abfrage in einem offenen Spiel-Tab.

// Selbstständig, damit sie auch per chrome.scripting.executeScript im Spiel-Tab laufen kann.
async function crFetchAlle(pfade, pauseMs, kopf) {
  const out = [];
  for (const p of pfade) {
    try {
      const r = await fetch('https://play.capitalrift.com' + p, { credentials: 'include', headers: kopf || undefined, signal: AbortSignal.timeout(60000) });
      let j = null; if (r.status !== 304) try { j = await r.json(); } catch {}
      out.push({ status: r.status, json: j, etag: r.headers.get('etag') });
    } catch (e) { out.push({ status: 0, json: null, fehler: String(e && e.message || e) }); }
    if (pauseMs) await new Promise(res => setTimeout(res, pauseMs));
  }
  return out;
}

// Spielaktion (POST) genau so, wie das Spiel sie selbst schickt: /api/game/<firma><pfad> mit JSON.
// Das Spiel antwortet mit dem ganzen Spielstand (gemessen 2,8 MB). Gebraucht wird meist nur „geklappt ja/nein": Bei Erfolg wird die
// Antwort deshalb nicht heruntergeladen (abgebrochen), außer mitAntwort; Fehlerantworten sind klein und werden immer gelesen.
// kopf: zusätzliche Kopfzeilen (x-cr-slim/x-cr-sec), damit auch eine gebrauchte Antwort klein bleibt.
async function crPost(pfad, body, mitAntwort, kopf) {
  try {
    const r = await fetch('https://play.capitalrift.com' + pfad, {
      method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', ...(kopf || {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    });
    if (r.ok && !mitAntwort) { try { await r.body.cancel(); } catch {} return { status: r.status, json: {} }; }
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, json: j };
  } catch (e) { return { status: 0, json: null, fehler: String(e && e.message || e) }; }
}

// Der 3D-Spiel-Tab kann hängen; nach der Frist gibt es eine klare Meldung statt endlosem Warten.
const crFrist = (p, ms, text) => Promise.race([p, new Promise((_, nein) => setTimeout(() => nein(new Error(text)), ms))]);

async function crSpielTab(nurKarte) {
  const tabs = await chrome.tabs.query({ url: 'https://play.capitalrift.com/*' });
  return nurKarte ? tabs.find(t => !/\/api\//.test(t.url || '')) : tabs[0];
}

// Holt mehrere Pfade nacheinander (mit Pause, damit der Server nicht bremst).
async function api(pfade, pauseMs = 0, kopf) {
  const erste = await crFetchAlle(pfade.slice(0, 1), 0, kopf);
  const abgelehnt = [0, 401, 403].includes(erste[0].status);
  if (!abgelehnt) return pfade.length > 1 ? erste.concat(await crFetchAlle(pfade.slice(1), pauseMs, kopf)) : erste;
  const tab = await crSpielTab(false);
  if (!tab) throw new Error(erste[0].status === 0 ? 'Das Spiel antwortet gerade nicht (' + (erste[0].fehler || 'Zeitüberschreitung') + '). Nächster Versuch in einer Minute.' : 'Nicht angemeldet. Öffne play.capitalrift.com in einem Tab.');
  const [x] = await crFrist(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: crFetchAlle, args: [pfade, pauseMs, kopf || null] }), 70000,
    'Der Spiel-Tab antwortet nicht. Klick einmal in den Spiel-Tab oder lade ihn neu.');
  if (!x || !x.result) throw new Error('Spiel-Tab hat keine Daten geliefert.');
  return x.result;
}

// Aktionen laufen im Spiel-Tab (gleiche Herkunft wie das Spiel selbst); ohne Tab direkt.
// mitAntwort: die Antwort des Spiels wird gebraucht (z. B. batchOp, pending); sie kommt dann schlank (x-cr-slim, x-cr-sec).
async function aktion(pfad, body, mitAntwort) {
  const tab = await crSpielTab(false);
  const m = mitAntwort && /\/game\/([0-9a-fA-F-]{36})/.exec(pfad), c = m && crTeile[m[1]];
  const kopf = mitAntwort ? { 'x-cr-slim': '1', ...(c ? { 'x-cr-sec': Object.entries(c.hashes).map(([k, v]) => k + '=' + v).join(',') } : {}) } : null;
  let res;
  if (tab) {
    // Body als Text übergeben: Chrome lässt null-Werte in args sonst weg (z. B. recipe: null beim Pausieren)
    const [x] = await crFrist(chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'MAIN', func: crPost, args: [pfad, JSON.stringify(body), !!mitAntwort, kopf] }), 70000,
      'Keine Antwort vom Spiel-Tab. Bitte im Spiel prüfen, ob die Aktion angekommen ist, bevor du es nochmal versuchst.');
    res = x && x.result;
  } else res = await crPost(pfad, body, mitAntwort, kopf);
  if (!res) throw new Error('Keine Antwort vom Spiel.');
  if (res.status < 200 || res.status >= 300) throw new Error('Spiel lehnt ab: ' + (res.json && res.json.error || ('HTTP ' + res.status)));
  return res.json;
}

// Spielstand wie das Spiel selbst (Kopfzeilen wie im Spiel-Code BN()/Mj()/QI()):
//   x-cr-slim: 1          → Kataloge (items/upgrades/vehicles) weglassen (braucht hier niemand; die Leiste lädt selbst mit Katalog)
//   x-cr-sec: Teil=Kennung → unveränderte Teile weglassen, stehen in sectionsUnchanged; wir setzen sie aus dem Zwischenspeicher ein
//   if-none-match: ETag   → hat sich gar nichts geändert: HTTP 304 ohne Inhalt, wir nehmen den letzten Stand
//   Ergebnis: 2.838 KB → 132 KB, bei keiner Änderung 0 KB. Fehlt ein gemeldeter Teil, einmal vollständig laden (wie das Spiel: „section_gap").
const crTeile = {};   // id → {hashes, sections, etag, voll}
async function crSpielstand(id) {
  const c = crTeile[id];
  const kopf = { 'x-cr-slim': '1' };
  if (c) { kopf['x-cr-sec'] = Object.entries(c.hashes).map(([k, v]) => k + '=' + v).join(','); if (c.etag) kopf['if-none-match'] = c.etag; }
  let [g] = await api(['/api/game/' + id], 0, kopf);
  if (g.status === 304 && c && c.voll) return { status: 200, json: c.voll, etag: c.etag };
  const j = g.json;
  if (j && Array.isArray(j.sectionsUnchanged) && j.sectionsUnchanged.length) {
    if (j.sectionsUnchanged.some(s => !c || c.sections[s] === undefined)) { delete crTeile[id]; [g] = await api(['/api/game/' + id], 0, { 'x-cr-slim': '1' }); }
    else for (const s of j.sectionsUnchanged) j[s] = c.sections[s];
  }
  const s = g.json;
  if (s && s.sectionHashes) crTeile[id] = { hashes: s.sectionHashes, sections: Object.fromEntries(Object.keys(s.sectionHashes).map(k => [k, s[k]])), etag: g.etag || null, voll: s };
  return g;
}
// Einmal pro Minute gemeinsam für alle Automatiken: wer ist aktiv, der Spielstand und die Logistik (einmal statt je Automatik).
async function crKontext() {
  const [me] = await api(['/api/me']);
  const id = me.json && ((me.json.piloting && me.json.piloting.companyId) || me.json.playerId);
  if (!id) throw new Error('nicht angemeldet');
  const [g, [lg]] = await Promise.all([crSpielstand(id), api(['/api/game/' + id + '/logistics'])]);   // crSpielstand liefert ein Objekt, api eine Liste
  if (!g.json) throw new Error('Spielstand nicht geladen (HTTP ' + g.status + ')');
  return { id, game: g.json, lg };
}

// Nicht abgeholte Ware: Das Spiel liefert immer ALLES, was wartet, an ein Ziel (keine Auswahl möglich).
// Deshalb nur liefern, wenn am Zielort jede wartende Ware fehlt (Anforderung minus Lager > 0); sonst verstopft
// überzählige Ware dort die Ladeplätze. Übersprungen werden Orte mit vollen Ladeplätzen und Namen, die mehrere Orte tragen.
// Ergebnis: {tag, ort, bedarf, waren} oder {warte: Grund}.
function crAbholZiel(pending, endpoints, requests, abladeTag) {
  const waren = {};
  for (const p of pending || []) for (const [k, n] of Object.entries(p.goods || {})) if (n > 0) waren[k.toLowerCase()] = (waren[k.toLowerCase()] || 0) + n;
  const tagOrte = {};
  for (const e of endpoints || []) for (const t of new Set((e.pads || []).map(p => p.name).filter(Boolean))) tagOrte[t] = (tagOrte[t] || 0) + 1;
  const vollAnz = {};
  for (const r of requests || []) if (r.reason === 'pad_full') vollAnz[r.toRef + '|' + r.toUnitKey] = (vollAnz[r.toRef + '|' + r.toUnitKey] || 0) + 1;
  const voll = { has: k => { const e = (endpoints || []).find(x => x.ref + '|' + x.unitKey === k); return (vollAnz[k] || 0) >= Math.max(1, ((e && (e.padCount || (e.pads || []).length)) || 1) / 2); } };
  const irgendwo = {};
  let best = null;
  for (const e of endpoints || []) {
    const tag = (e.pads || []).map(p => p.name).find(Boolean);
    if (!tag || tagOrte[tag] > 1 || voll.has(e.ref + '|' + e.unitKey)) continue;
    let bedarf = 0, alle = true;
    for (const [w, n] of Object.entries(waren)) {
      const fehlt = ((e.requested || {})[w] || 0) - ((e.stock || {})[w] || 0);
      if (fehlt > 0) { irgendwo[w] = true; bedarf += Math.min(n, fehlt); } else alle = false;
    }
    if (alle && bedarf > 0 && (!best || bedarf > best.bedarf)) best = { tag, ort: e.label, bedarf };
  }
  if (best) return { ...best, waren };
  // Abladeort (Einstellung): Ware, die nirgends fehlt, dort einlagern statt oben liegen zu lassen – nie verkaufen
  if (abladeTag) {
    const e = (endpoints || []).find(e => (e.pads || []).some(p => p.name === abladeTag));
    if (!e) return { warte: 'wartet: Abladeort „' + abladeTag + '" nicht gefunden' };
    if (tagOrte[abladeTag] > 1) return { warte: 'wartet: Abladeort „' + abladeTag + '" ist nicht eindeutig (mehrere Orte heißen so)' };
    if (voll.has(e.ref + '|' + e.unitKey)) return { warte: 'wartet: Abladeort ' + e.label + ' ist voll' };
    return { tag: abladeTag, ort: e.label, bedarf: 0, waren, abladen: true };
  }
  const stoert = Object.keys(waren).filter(w => !irgendwo[w]);
  if (!Object.keys(waren).length) return { warte: 'nichts zum Abholen' };
  return { warte: stoert.length
    ? 'wartet: ' + stoert.map(w => waren[w] + ' ' + w).join(', ') + ' würde mitgeliefert, fehlt aber an keinem Ort mit freiem Ladeplatz'
    : 'wartet: kein einzelner Ort braucht alle wartenden Waren zugleich' };
}

// Holt wartende Ware ab und schickt sie per Lkw dorthin, wo sie fehlt. Gibt einen Bericht zurück.
async function crAbholen(ctx) {
  const { id, game, lg: lg0 } = ctx || await crKontext();
  const pending = game.pending || [];
  if (!pending.some(p => p.total > 0)) return { text: 'nichts zum Abholen' };
  if (game.delivery) return { text: 'eine Lieferung ist noch unterwegs, später nochmal' };
  const lg = lg0 || (await api(['/api/game/' + id + '/logistics']))[0];
  const { abholAblade = {} } = await chrome.storage.local.get('abholAblade');
  const ziel = crAbholZiel(pending, lg.json && lg.json.endpoints, lg.json && lg.json.requests, abholAblade[id]);
  if (ziel.warte) return { text: ziel.warte };
  await aktion('/api/game/' + id + '/market/deliver', { dest: { kind: 'tag', tag: ziel.tag } });
  return { text: ziel.abladen ? 'abgeladen bei ' + ziel.ort + ' (wird nirgends gebraucht)' : 'geliefert nach ' + ziel.ort + ' (dort fehlen ' + ziel.bedarf + ')', ziel, geliefert: true };
}

// Unterbieten: Entscheidung für eine Ware. asks aus dem Orderbuch (nur Preis+Menge, ohne Anbieter),
// eigene = deine offenen Verkaufsaufträge dieser Ware [{preis, rest}]. Deine Menge wird je Preis abgezogen.
function crUnterbietEntscheid(asks, eigene, r, youHold) {
  const mein = {};
  for (const o of eigene) mein[o.preis] = (mein[o.preis] || 0) + o.rest;
  const fremd = asks.filter(a => a.qty - (mein[a.price] || 0) > 0).map(a => a.price);
  if (!fremd.length) return { text: 'kein fremdes Angebot' };
  const bestFremd = Math.min(...fremd);
  const meinBest = eigene.length ? Math.min(...eigene.map(o => o.preis)) : Infinity;
  if (meinBest < bestFremd) return { text: 'du bist am günstigsten' };
  const preis = Math.round((bestFremd - r.abstand) * 100) / 100;
  if (preis < r.minPreis) return { text: 'Untergrenze erreicht, fremdes Angebot bei ' + bestFremd };
  const menge = Math.min(r.schritt, youHold, r.max - r.gestellt);
  if (menge <= 0) return { text: r.max - r.gestellt <= 0 ? 'Höchstmenge erreicht' : 'nichts mehr verkaufbar in deinen Lagern' };
  return { preis, menge };
}

// Auffüllen: eigene offene Menge zu genau diesem Preis immer auf r.ziel halten; Verkauftes wird als neuer Auftrag nachgeschoben.
function crHaltenEntscheid(eigene, r, youHold) {
  const offen = eigene.filter(o => Math.abs(o.preis - r.preis) < 0.005).reduce((n, o) => n + o.rest, 0);
  if (offen >= r.ziel) return { text: 'voll: ' + offen + ' von ' + r.ziel + ' offen' };
  const menge = Math.min(r.ziel - offen, youHold, r.max - r.gestellt);
  if (menge <= 0) return { text: r.max - r.gestellt <= 0 ? 'Höchstmenge erreicht' : 'nichts mehr verkaufbar in deinen Lagern' };
  return { preis: r.preis, menge };
}

// Alte, teurere eigene Angebote derselben Ware, die unser neuestes Angebot unterbietet: löschen, sobald die
// 60-Minuten-Sperre des Spiels vorbei ist (plus 1 Minute Luft). Preise einer Auffüllen-Regel bleiben unangetastet.
const CR_SPERRE_MS = 61 * 60000;
function crAltAngebote(orders, C, geschuetzt, jetzt) {
  const offen = orders.filter(o => o.commodity === C && o.side === 'sell' && o.qty - (o.filled || 0) > 0);
  if (offen.length < 2) return { loeschen: [], warten: [] };
  const billigst = Math.min(...offen.map(o => o.price));
  const teurer = offen.filter(o => o.id && o.price > billigst + 0.005 && !geschuetzt.some(p => Math.abs(p - o.price) < 0.005));
  return { loeschen: teurer.filter(o => jetzt - (o.ts || 0) >= CR_SPERRE_MS), warten: teurer.filter(o => jetzt - (o.ts || 0) < CR_SPERRE_MS) };
}

// Jede Minute aus dem Hintergrund: für jede aktive Regel der gerade aktiven Firma prüfen und bei Bedarf
// einen neuen Verkaufsauftrag stellen. Fehler landen im Stand der Regel, damit die Seitenleiste sie zeigt.
async function crUnterbieten(ctx) {
  const { unterbieten = [] } = await chrome.storage.local.get('unterbieten');
  const aktiv = unterbieten.filter(r => r.aktiv);
  if (!aktiv.length) return [];
  const gestellt = [];
  try {
    if (ctx && ctx.fehler) throw ctx.fehler;
    const { id, game } = ctx || await crKontext();
    const orders = (game.orders || []).slice();
    for (const r of aktiv) {
      r.firmaId ??= id;   // alte Regeln ohne Firma gehören ab jetzt zur aktiven
      r.at = Date.now();
      if (r.firmaId !== id) { r.log = 'wartet: gehört zu einer anderen Firma bzw. deinem anderen Spieler'; continue; }
      const C = r.ware.toUpperCase();
      try {
        const [b, s] = await api(['/api/market/book?commodity=' + C, '/api/game/' + id + '/sellable?commodity=' + C], 300);
        const eigene = orders.filter(o => o.commodity === C && o.side === 'sell' && o.qty - (o.filled || 0) > 0).map(o => ({ preis: o.price, rest: o.qty - (o.filled || 0) }));
        const hat = (s.json && s.json.youHold) || 0;
        const e = r.typ === 'halten' ? crHaltenEntscheid(eigene, r, hat) : crUnterbietEntscheid((b.json && b.json.asks) || [], eigene, r, hat);
        if (e.preis) {
          await aktion('/api/game/' + id + '/market/order', { commodity: C, side: 'sell', price: e.preis, qty: e.menge });
          orders.push({ commodity: C, side: 'sell', price: e.preis, qty: e.menge, filled: 0 });   // für eine zweite Regel derselben Ware
          r.gestellt += e.menge;
          r.log = e.menge + ' Stück zu ' + e.preis + ' $ gestellt';
          gestellt.push({ name: r.name, ...e });
        } else r.log = e.text;
        if (r.typ !== 'halten') {
          const geschuetzt = aktiv.filter(h => h.typ === 'halten' && h.ware === r.ware && h.firmaId === id).map(h => h.preis);
          const alt = crAltAngebote(orders, C, geschuetzt, Date.now());
          let weg = 0;
          for (const o of alt.loeschen) {
            try { await aktion('/api/game/' + id + '/market/cancel', { orderId: o.id }); weg++; orders.splice(orders.indexOf(o), 1); } catch {}
          }
          if (weg) r.log += ' · ' + weg + ' alte, teurere Angebote gelöscht';
          if (alt.warten.length) { const ab = Math.min(...alt.warten.map(o => (o.ts || 0) + CR_SPERRE_MS)); r.log += ' · ' + alt.warten.length + ' alte Angebote werden ab ' + new Date(ab).toLocaleTimeString(typeof LOC === 'function' ? LOC() : 'de-DE', { hour: '2-digit', minute: '2-digit' }) + ' gelöscht (Sperre)'; }
        }
      } catch (err) { r.log = 'Fehler: ' + (err && err.message || err); }
    }
  } catch (err) { for (const r of aktiv) { r.log = 'Fehler: ' + (err && err.message || err); r.at = Date.now(); } }
  // Liste neu lesen, damit zwischendurch gelöschte Regeln nicht zurückkommen
  const { unterbieten: jetzt = [] } = await chrome.storage.local.get('unterbieten');
  await chrome.storage.local.set({ unterbieten: jetzt.map(x => aktiv.find(a => a.id === x.id) || x) });
  return gestellt;
}

// frist: nach dieser Zeit nicht mehr wiederholen; beiBremse: wird bei jedem „rate_limited" aufgerufen (Raumsuche drosselt dann)
// abbrechen: Funktion, die true liefert, wenn nicht mehr gewartet werden soll (z. B. Stopp-Knopf); dann kommt die letzte Antwort zurück
async function crHolen(pfad, frist = Infinity, beiBremse, abbrechen) {
  for (let versuch = 0; ; versuch++) {
    const [r] = await api([pfad]);
    if ((r.status !== 429 && !(r.json && r.json.error === 'rate_limited')) || versuch >= 5 || Date.now() + 5000 > frist || (abbrechen && abbrechen())) return r;
    if (beiBremse) beiBremse();
    for (let t = 0; t < 10 && !(abbrechen && abbrechen()); t++) await new Promise(res => setTimeout(res, 500));
  }
}
// Firma wechseln wie das Spiel über /api/company/<id>/pilot. Das Spiel verlangt dafür einen deiner Computer (pieceId); er wird einmal in
// den Räumen deines eigenen Spielers gesucht und gemerkt (storage firmenComputer). firmaId null = eigener Spieler (/api/company/unpilot).
async function crComputerSuchen() {
  const [me] = await api(['/api/me']), pid = me.json && me.json.playerId;
  const [g] = await api(['/api/game/' + pid]);
  for (const l of new Map(((g.json && g.json.leases) || []).map(l => [l.buildingRef, l])).values()) {
    const r = await crHolen('/api/building-furniture?ref=' + encodeURIComponent(l.buildingRef) + '&chunk=' + encodeURIComponent(l.chunkId));
    const c = ((r.json && r.json.furniture) || []).find(x => x.itemId === 'computer');
    if (c) { await chrome.storage.local.set({ firmenComputer: c.id }); return c.id; }
  }
  throw new Error('Kein Computer in deinen eigenen Räumen gefunden. Stell im Spiel einen Computer auf einen Tisch in einem deiner Räume.');
}
// Das Spiel bestätigt den Wechsel sofort, /api/me meldet danach aber ein paar Sekunden abwechselnd alte und neue Firma:
// erst weiter, wenn es dreimal hintereinander die neue meldet (bis ~10 s).
async function crFirmaWechseln(firmaId) {
  await crFirmaWechselnJetzt(firmaId);
  for (let i = 0, gleich = 0; i < 20; i++) {
    const [me] = await api(['/api/me']), p = me.json && me.json.piloting;
    gleich = (firmaId ? p && p.companyId === firmaId : !p) ? gleich + 1 : 0;
    if (gleich >= 3) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Das Spiel hat den Wechsel angenommen, meldet aber noch die alte Firma. Bitte gleich nochmal auf Aktualisieren drücken.');
}
async function crFirmaWechselnJetzt(firmaId) {
  if (!firmaId) return aktion('/api/company/unpilot', {});
  let { firmenComputer: pc } = await chrome.storage.local.get('firmenComputer');
  if (!pc) pc = await crComputerSuchen();
  try { return await aktion('/api/company/' + encodeURIComponent(firmaId) + '/pilot', { pieceId: pc }); }
  catch (e) {   // Computer weg oder nicht mehr deiner: neu suchen, einmal nochmal
    if (!/company_computer|not_at_computer|bad_request|not_found|no_such/.test(String(e && e.message || e))) throw e;
    return aktion('/api/company/' + encodeURIComponent(firmaId) + '/pilot', { pieceId: await crComputerSuchen() });
  }
}

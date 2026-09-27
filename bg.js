// Hintergrund: Seitenleiste per Klick aufs Symbol; jede Minute Abholen und Verkäufe in Schritten (Unterbieten).
importScripts('recipes.js', 'shared.js', 'i18n.js');

// Meldungen in der gewählten Sprache
const melden = (id, o) => chrome.notifications.create(id, { ...o, title: tr(o.title), message: tr(o.message) });

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const planen = () => chrome.alarms.create('minute', { periodInMinutes: 1 });
chrome.runtime.onInstalled.addListener(planen);
chrome.runtime.onStartup.addListener(planen);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'minute') minute(); });
chrome.runtime.onMessage.addListener(m => { if (m === 'abholen') minute(true); if (m === 'unterbieten') minute(); });

// Der Spielstand wird einmal pro Minute geholt, dann starten die aktiven Automatiken, jede mit eigener Sperre:
// dieselbe startet nie doppelt (sonst doppelte Aufträge), die andere läuft trotzdem.
const beschaeftigt = {};
let kontextLaeuft = false;
function starte(name, fn) {
  if (beschaeftigt[name]) return;
  beschaeftigt[name] = true;
  Promise.resolve().then(fn).catch(() => {}).finally(() => { beschaeftigt[name] = false; });
}
async function minute(abholenSofort) {
  if (kontextLaeuft) return;
  kontextLaeuft = true;
  let st, ctx = null, fehler = null, abholen, unter;
  try {
    SPRACHE = (await chrome.storage.local.get('sprache')).sprache || 'de';   // für übersetzte Meldungen
    st = await chrome.storage.local.get(['autoAbholen', 'abholSperre', 'unterbieten', 'abholLog']);
    abholen = st.autoAbholen !== false && (abholenSofort || Date.now() >= (st.abholSperre || 0)) && !beschaeftigt.abholen;
    unter = (st.unterbieten || []).some(r => r.aktiv) && !beschaeftigt.unterbieten;
    if (!abholen && !unter) return;
    try { ctx = await crKontext(); } catch (e) { fehler = e; }
  } finally { kontextLaeuft = false; }
  if (abholen) starte('abholen', () => abholenMit(ctx, fehler, st.abholLog));
  if (unter) starte('unterbieten', () => unterbietenMit(ctx, fehler));
}

// Nicht abgeholte Ware dorthin liefern, wo sie fehlt (abschaltbar in der Seitenleiste). Nach einem Fehler 2 Minuten Pause.
async function abholenMit(ctx, fehler, alt) {
  let log;
  try { if (fehler) throw fehler; log = await crAbholen(ctx); }
  catch (e) { log = { text: 'Fehler: ' + (e && e.message || e) }; await chrome.storage.local.set({ abholSperre: Date.now() + 120000 }); }
  if (!alt || alt.text !== log.text || log.geliefert) await chrome.storage.local.set({ abholLog: { at: Date.now(), text: log.text } });
  if (log.geliefert) melden('abholen-' + Date.now(), {
    type: 'basic', iconUrl: 'icon128.png', priority: 1, title: 'Ware abgeholt',
    message: Object.entries(log.ziel.waren).map(([w, n]) => fmt(n) + ' ' + w).join(', ') + ' → ' + log.ziel.ort,
  });
}

// Verkäufe in Schritten (angelegt über „Verkaufen…“ im Reiter Lager), eine Meldung je neuem Verkaufsauftrag.
// Ohne Spielstand bekommt jede Regel den Fehler als Stand, statt still stehen zu bleiben.
async function unterbietenMit(ctx, fehler) {
  const neu = await crUnterbieten(fehler ? { fehler } : ctx);
  for (const n of neu) melden('unterbieten-' + Date.now() + Math.random(), {
    type: 'basic', iconUrl: 'icon128.png', priority: 1, title: 'Unterboten: ' + n.name,
    message: fmt(n.menge) + ' Stück zu ' + fmt(n.preis) + ' $ zum Verkauf gestellt',
  });
}

const fmt = n => new Intl.NumberFormat(LOC(), { maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

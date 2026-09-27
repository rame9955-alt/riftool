// Sprache: Deutsch ist die Quelle, Englisch wird beim Anzeigen per Wörterbuch übersetzt.
// Seitenleiste: ein MutationObserver übersetzt jeden neu gezeichneten Text. Hintergrund: tr() für Meldungen.
// ponytail: Satz-Übersetzung per Wörterbuch; neue Texte im Code brauchen hier einen Eintrag, sonst bleiben sie deutsch.
let SPRACHE = 'de';
try { SPRACHE = localStorage.getItem('lager.sprache') || 'de'; } catch {}
const LOC = () => SPRACHE === 'en' ? 'en-US' : 'de-DE';

const Z = '([\\d.,]+)';   // Zahl in beiden Schreibweisen
const EN_RE = [
  [new RegExp('Die Quelle dieser Lieferung, (.+?), hat keine (.+?) mehr\\. Lösung: dort mehr herstellen, eine andere Quelle anbinden oder am Markt kaufen\\.'), 'The source of this delivery, $1, has no $2 left. Fix: produce more there, connect another source or buy on the market.'],
  [new RegExp('\\(' + Z + ' Stück\\), wird aber nicht nach (.+?) geliefert\\. Lösung: Route von (.+?) nach (.+?) für (.+?) anlegen\\.'), '($1 units), but it is not delivered to $2. Fix: create a route from $3 to $4 for $5.'],
  [new RegExp('\\(' + Z + ' Stück\\), aber jenseits des Meeres\\. Lösung: Schiff oder Hafen nötig\\.'), '($1 units), but across the sea. Fix: a ship or port is needed.'],
  [/Der Ladeplatz bei (.+?) lehnt ab\. Lösung: Filter des Ladeplatzes prüfen oder volle Ladeplätze leeren\./, 'The loading spot at $1 rejects it. Fix: check the loading spot filter or empty full loading spots.'],
  [/Ein Ladeplatz auf der Strecke (.+?) ist voll, deshalb wird nicht weitergeliefert\. Lösung: Ladeplätze an beiden Orten prüfen und leeren oder weitere Ladeplätze bauen\./, 'A loading spot on the route $1 is full, so nothing more is delivered. Fix: check and empty the loading spots at both ends or build more.'],
  [/^Von (.+?) nach (.+?) für (.+?)\. /, 'From $1 to $2 for $3. '],
  [/^(.+) in (.+) drosseln$/, 'Throttle $1 in $2'],
  [/^(.+) in (.+) einschalten$/, 'Switch on $1 in $2'],
  [/^Mittelpunkt: (.+)$/, 'Center: $1'],
  [/(\d+) Orte · Kacheln (\S+) von (\S+) · Gebäude (\S+) von (\S+)/, '$1 places · tiles $2 of $3 · buildings $4 of $5'],
  [/ · noch ca\. (\d+) (Sek|Min)/, (m, n, e) => ' · about ' + n + (e === 'Sek' ? ' s' : ' min') + ' left'],
  [/ \(Kacheln laden noch\)/, ' (tiles still loading)'],
  [/^Suche in (\d+) Orten, (.+?) km: (\d+) Kacheln, (\d+) Abfragen gleichzeitig\.$/,'Searching $1 places, $2 km: $3 tiles, $4 requests at a time.'],
  [/^Nicht gefunden: (.+)$/, 'Not found: $1'],
  [/Mieter in ca. (.+?) (Std|Tage)/g, (m, n, e) => 'tenant in about ' + n + (e === 'Std' ? ' h' : ' days')],
  [/Mieter in ca. nie/g, 'tenant never'],
  [/^als (.+?) zu /, 'as $1 at '],
  [/^Mieter suchen hier: (.+)$/, 'Tenants looking here: $1'],
  [/ \(gegen (.+?) Räume\)/g, ' (against $1 rooms)'],
  [/^(.+) immer aufgefüllt halten$/, 'Keep $1 topped up'],
  [/^Verkauf (.+): lade Markt und verkaufbare Menge…/, 'Sale $1: loading market and sellable quantity…'],
  [/^Kauf (.+): lade Angebote…/, 'Buy $1: loading offers…'],
  [/^Auffüllen (.+): lade verkaufbare Menge…/, 'Top up $1: loading sellable quantity…'],
  [/^(.+) auslagern$/, 'Clear out $1'],
  [/^(.+) verkaufen$/, 'Sell $1'],
  [/^(.+) kaufen$/, 'Buy $1'],
  [new RegExp('\\(' + Z + ' da, ' + Z + ' je Durchgang\\)'), '($1 on hand, $2 per cycle)'],
  [new RegExp('noch ' + Z + ' Stück'), '$1 units left'],
  [new RegExp('reicht noch ' + Z + ' (Std|Tage|Min)'), 'lasts $1 $2'],
  [new RegExp('leer in ' + Z + ' (Std|Tage|Min)'), 'empty in $1 $2'],
  [new RegExp(Z + ' von ' + Z), '$1 of $2'],
  [/^stellt (.+) her, Rezept nicht in der Wiki-Liste$/, 'makes $1, recipe not in the wiki list'],
  [new RegExp('^✗ ' + Z + ' (.+) fehlen$'), '✗ $1 $2 missing'],
  [new RegExp('nötig ' + Z + ' (.+?) · du hast ' + Z), 'needed $1 $2 · you have $3'],
  [new RegExp('nötig (?:unter|below) ' + Z + ' (.+?) · du hast ' + Z), 'needed below $1 $2 · you have $3'],
  [/^Planer: was brauche ich für X Stück pro Tag\?$/, 'Planner: what do I need for X units per day?'],
];

const EN = Object.entries({
  // Kopf und Reiter
  'Capital Rift Lager': 'Capital Rift Storage', 'Jetzt aktualisieren': 'Refresh now', 'Aktualisieren': 'Refresh', 'lädt…': 'loading…',
  'Bereiche': 'Areas', 'Fabriken': 'Factories', 'Engpässe': 'Shortages', 'Alarme': 'Alerts', 'Personal': 'Staff',
  'Ansicht': 'View', 'Nach Ware': 'By item', 'Nach Ort': 'By location', 'Suchen…': 'Search…', 'Suchen': 'Search', 'Sortieren': 'Sort',
  'Wert': 'Value', 'Anzahl': 'Quantity', 'Stückpreis': 'Unit price', 'Firmen': 'Companies', 'Aktive Firma': 'Active company', 'Alle Firmen': 'All companies',
  'Sofortverkauf berechnen': 'Calculate instant sale', 'Maschinen neu laden': 'Reload machines', 'lädt Maschinen…': 'loading machines…', 'Bargeld': 'Cash',
  'Eigener Spieler': 'Own player', 'Im Spiel zu diesem Ort springen': 'Jump to this location in the game', 'Nicht angemeldet. Öffne play.capitalrift.com in einem Tab.': 'Not logged in. Open play.capitalrift.com in a tab.',
  'Nicht angemeldet. Öffne play.capitalrift.com in einem Tab und melde dich an.': 'Not logged in. Open play.capitalrift.com in a tab and log in.',
  'Spiel-Tab hat keine Daten geliefert.': 'The game tab returned no data.', 'Nichts gefunden.': 'Nothing found.',
  // Alarme und Unterbieten-Formular
  'Ware, z. B. Iron Ore': 'Item, e.g. Iron Ore', 'Ware, z. B. Mining Barrow': 'Item, e.g. Mining Barrow', 'Richtung': 'Direction',
  'steigt über': 'rises above', 'fällt unter': 'falls below', 'Preis $': 'Price $', 'Anlegen': 'Create',
  'Unterbieten: billiger nachlegen, wenn dich jemand unterbietet': 'Undercut: list cheaper when someone undercuts you',
  'immer 1 Cent drunter': 'always 1 cent below', 'Nie unter $': 'Never below $', 'Höchstens Stück': 'Max units',
  'Chrome prüft jede Minute, auch wenn die Leiste zu ist, solange Chrome läuft. Ein Alarm meldet sich einmal und wird wieder scharf, sobald der Preis zurück ist.':
    'Chrome checks every minute, even with the panel closed, as long as Chrome runs. An alert fires once and re-arms when the price returns.',
  'Letzte Prüfung': 'Last check', 'Noch keine Preisalarme.': 'No price alerts yet.', 'ausgelöst': 'triggered',
  'Ware nicht gefunden. Wähle einen Namen aus der Liste.': 'Item not found. Pick a name from the list.', 'Gib einen Preis größer 0 ein.': 'Enter a price above 0.',
  'Stück und Cent müssen mindestens 1 sein.': 'Units and cents must be at least 1.', 'Stück je Schritt muss mindestens 1 sein.': 'Units per step must be at least 1.',
  'Mindestpreis fehlt. Ohne ihn könnten sich zwei Verkäufer bis auf 0 $ runterbieten.': 'Minimum price missing. Without it two sellers could undercut each other down to $0.',
  'Gib an, wie viele Stück höchstens verkauft werden dürfen.': 'Enter the maximum number of units to sell.',
  // Lager
  'Deine offenen Aufträge': 'Your open orders', 'Kauf- und Verkaufsaufträge am Markt': 'Buy and sell orders on the market',
  'Verkäufe in Schritten': 'Step sales', 'jede Minute geprüft, immer 1 Cent unter dem günstigsten fremden Angebot': 'checked every minute, always 1 cent below the cheapest competing offer',
  'keine aktiv. Anlegen über „Verkaufen…" → A': 'none active. Create via "Sell…" → A', 'Stoppen': 'Stop',
  'Nicht gebraucht, verkaufbar': 'Not needed, sellable', 'kein Ort und keine Maschine fordert diese Waren an': 'no location or machine requests these items',
  'Im Verkauf': 'On sale', 'offene Verkaufsaufträge': 'open sell orders', 'Rucksack': 'Backpack', 'trägst du bei dir': 'you carry',
  'Sofort an die Gebote verkauft:': 'Sold instantly to bids:', 'Listenwert': 'List value', 'davon · berechnet': 'of it · calculated',
  'Bisher ist nur eine Firma bekannt. Jede weitere erscheint hier, sobald du sie im Spiel einmal steuerst und die Leiste offen ist.':
    'Only one company known so far. Each further one appears here once you pilot it in the game with the panel open.',
  'Grundstück': 'Land', 'Raum': 'Room', 'Orte': 'locations', 'Zeigen': 'Show', 'Waren': 'items',
  'Auffüllen…': 'Top up…', 'Löschen…': 'Delete…', 'Verkaufen…': 'Sell…', 'Auslagern…': 'Clear out…', 'Kaufen…': 'Buy…',
  'Auftrag löschen?': 'Delete order?', 'Ja, löschen': 'Yes, delete', 'offen à': 'open at',
  // Verkaufen / Kaufen / Auffüllen
  'Verkaufbar laut Spiel:': 'Sellable per game:', '(alle deine Lager zusammen)': '(all your storage combined)', 'günstigstes Angebot': 'cheapest offer',
  'bestes Gebot': 'best bid', 'Bestes Angebot': 'Best offer', 'Preis B = bestes Gebot': 'Price B = best bid', '(verkauft sofort)': '(sells instantly)',
  'Preis B = günstigstes Angebot': 'Price B = cheapest offer', 'Preis B = 1 Cent darunter': 'Price B = 1 cent below', 'Gesamtmenge (höchstens': 'Total quantity (max',
  'A) In Schritten, immer knapp unter dem günstigsten Angebot': 'A) In steps, always just below the cheapest offer',
  'immer 1 Cent unter dem günstigsten fremden Angebot': 'always 1 cent below the cheapest competing offer',
  'Vorschlag: 90 % des günstigsten Angebots': 'Suggestion: 90 % of the cheapest offer', 'In Schritten verkaufen': 'Sell in steps',
  'B) Alles auf einmal zu einem festen Preis': 'B) All at once at a fixed price', 'Gesamtmenge auf einmal verkaufen': 'Sell total quantity at once',
  'C) Immer eine feste Menge am Markt halten (auffüllen)': 'C) Always keep a fixed quantity on the market (top up)',
  'Verkauftes wird jede Minute als neuer Auftrag zum selben Preis nachgeschoben, bis die Gesamtmenge verkauft ist.':
    'Whatever sells is re-listed every minute as a new order at the same price until the total quantity is sold.',
  'Auffüllen starten': 'Start top-up', 'Abbrechen': 'Cancel',
  'Das Spiel meldet 0 verkaufbar: Die Ware liegt in keinem deiner Lager oder steckt schon in einem Verkaufsauftrag.':
    'The game reports 0 sellable: the item is in none of your storage or already in a sell order.',
  'Gekaufte Ware wartet unter „My Orders"; ist das automatische Abholen an, geht sie dorthin, wo sie fehlt.':
    'Bought goods wait under "My Orders"; with auto-collect on they go where they are missing.',
  'Preis je Stück (für Kaufauftrag)': 'Price per unit (for buy order)', 'Preis je Stück': 'Price per unit',
  'Sofort kaufen (Gesamtkosten höchstens 10 % über bestem Angebot × Menge)': 'Buy now (total cost at most 10 % above best offer × quantity)',
  'Kaufauftrag stellen': 'Place buy order',
  'Jede Minute prüft die Erweiterung, wie viel zu diesem Preis noch offen ist, und stellt das Verkaufte als neuen Auftrag nach. Verkaufbar laut Spiel:':
    'Every minute the extension checks how much is still open at this price and re-lists what sold as a new order. Sellable per game:',
  '(alle Lager, ohne was schon am Markt steht).': '(all storage, excluding what is already on the market).',
  'immer offen halten': 'always keep open', 'immer offen': 'always open', 'höchstens insgesamt nachschieben': 'max total to top up',
  'Das Spiel meldet 0 verkaufbar: Es ist nichts mehr zum Nachschieben da.': 'The game reports 0 sellable: nothing left to top up.',
  'Am Markt gerade: günstigstes Verkaufsangebot': 'On the market now: cheapest sell offer', 'höchstes Kaufgebot': 'highest buy bid', 'Wie viele Stück?': 'How many units?',
  'A) Sofort kaufen': 'A) Buy now', 'Kauft jetzt von den günstigsten Verkäufern. Die Ware ist sofort deine. Gibt es beim günstigsten Preis nicht genug, wird der Rest etwas teurer; mehr als 10 % über': 'Buys now from the cheapest sellers. The goods are yours immediately. If there is not enough at the cheapest price, the rest costs a bit more; you never pay more than 10 % above',
  'je Stück im Schnitt zahlst du nie.': 'per unit on average.', 'Jetzt kaufen für ca.': 'Buy now for approx.', 'gerade bietet niemand an': 'nobody is offering right now',
  'B) Kaufauftrag (Buy Order)': 'B) Buy order', 'Du legst fest, was du höchstens je Stück zahlen willst. Gekauft wird erst, wenn jemand zu diesem Preis verkauft. Das kann dauern oder nie passieren, ist dafür meist billiger.': 'You set the most you will pay per unit. It only buys once someone sells at that price. That can take a while or never happen, but is usually cheaper.',
  'Dein Preis je Stück': 'Your price per unit', 'Vorschlag: 1 Cent über dem höchsten Kaufgebot': 'Suggestion: 1 cent above the highest buy bid', 'Kaufauftrag stellen über': 'Place buy order for',
  'Gekaufte Ware landet im Spiel oben bei „Uncollected goods" (My Orders). Ist das automatische Abholen an, bringt die Erweiterung sie dorthin, wo sie fehlt.': 'Bought goods land in the game under "Uncollected goods" (My Orders). With auto-collect on, the extension brings them to where they are missing.',
  'Liefern an': 'Deliver to', '– nicht liefern, oben liegen lassen –': '– do not deliver, leave under Uncollected goods –',
  'Achtung: Beim Liefern schickt das Spiel alles mit, was oben schon wartet:': 'Note: when delivering, the game also sends everything already waiting:',
  'Direkt danach wird geliefert, und zwar an den oben gewählten Ort. Gibt es beim günstigsten Preis nicht genug': 'Delivery follows right away, to the location chosen above. If there is not enough at the cheapest price',
  'Einen Lieferort kann man dem Kaufauftrag im Spiel nicht mitgeben: Die Ware wartet oben bei „Uncollected goods“, bis sie geliefert wird. Ist das automatische Abholen an, übernimmt das die Erweiterung.': 'The game does not allow a delivery location on buy orders: the goods wait under "Uncollected goods" until delivered. With auto-collect on, the extension does that.',
  'ist unterwegs.': 'is on its way.', 'Liefern ging nicht': 'Delivery failed', 'die Ware wartet oben bei „Uncollected goods“.': 'the goods wait under "Uncollected goods".', 'Die Ware wartet oben bei „Uncollected goods“.': 'The goods wait under "Uncollected goods".',
  'alte, teurere Angebote gelöscht': 'old, pricier offers deleted', 'alte Angebote werden ab': 'old offers will be deleted from', 'gelöscht (Sperre)': '(lock)',
  'im Verkauf': 'on sale', 'Stück stehen schon im Verkauf': 'units already on sale', 'Regel aktiv': 'rule active',
  'in Maschinen': 'in machines', 
  'kein Angebot am Markt': 'no offer on the market', 'dein Angebot:': 'your offer:', 'teurere': 'pricier',
  'Im Lager': 'In storage', 'im Lager': 'in storage', 'davon': 'of which', 'gemessen': 'measured',
  '✗ Lager leer': '✗ storage empty', 'Herstellung/Zulauf deckt den Verbrauch gerade so': 'production/inflow barely covers consumption', 
  '⚠ reicht nur noch': '⚠ only lasts', '(unter 24 Std)': '(under 24 h)', 'reicht, Vorrat wächst': 'enough, stock growing', 'reicht noch': 'lasts',
  'Grün: reicht mindestens 24 Stunden oder wächst. Gelb: reicht weniger als 24 Stunden. Rot: im Lager ist nichts mehr.': 'Green: lasts at least 24 hours or grows. Yellow: lasts less than 24 hours. Red: nothing left in storage.',
  'Routen übers Meer gefunden, lade öffentliche Häfen…': 'Sea routes found, loading public ports…', 'Übers Meer:': 'By sea:', 'braucht Häfen an beiden Enden und ein Schiff': 'needs ports at both ends and a ship',
  'Öffentliche Häfen nahe': 'Public ports near', '(deiner)': '(yours)', 'Gebühr': 'Fee', 'Hafen': 'Port',
  'Ob das Spiel die Route von selbst über fremde Häfen führt oder man sie im Spiel wählen muss, ist nicht geprüft. „Gebühr" ist der Wert „fare" des Spiels.': 'Not verified whether the game routes through other players\' ports on its own or whether you must pick them in the game. "Fee" is the game\'s "fare" value.',
  'Menge auffüllen…': 'Top up quantity…', 'Verkaufsmenge auffüllen': 'top up sale quantity', 'Stellt keinen Auftrag, sondern erhöht nur die Gesamtmenge der Regel. Verkauft wird weiter in Schritten wie bisher.': 'Places no order, only raises the rule\'s total quantity. Selling continues in steps as before.',
  'Bisher': 'So far', 'im Lager liegen': 'in storage:', 'Neue Gesamtmenge': 'New total quantity', 'Vorschlag: bisher gestellt + alles im Lager': 'Suggestion: placed so far + everything in storage', 'Menge übernehmen': 'Apply quantity',
  'Gesamtmenge jetzt': 'total quantity now', 'weiter in Schritten.': 'still in steps.', 'Regel nicht mehr da.': 'Rule no longer exists.', 'Die Gesamtmenge muss mindestens': 'The total quantity must be at least', 'sein (schon gestellt).': '(already placed).', 'gehandelt': 'traded',
  'Rechnet die ganze Kette bis zu den Rohstoffen: wie viele Maschinen je Stufe nötig sind, wie viele du hast, und was an Rohstoffen pro Tag gebraucht wird.': 'Calculates the whole chain down to raw materials: how many machines each stage needs, how many you have, and which raw materials are needed per day.',
  'Produkt, z. B. Bucket-Wheel Excavator': 'Product, e.g. Bucket-Wheel Excavator', 'Stück pro Tag': 'Units per day', 'Rechnen': 'Calculate', '✓ genug Maschinen': '✓ enough machines', 'pro Tag': 'per day',
  'Rohstoffe pro Tag': 'Raw materials per day', 'zum Marktpreis zusammen': 'at market price in total', 'Produkt nicht gefunden. Wähle einen Namen aus der Liste.': 'Product not found. Pick a name from the list.',
  'Stück pro Tag muss größer 0 sein.': 'Units per day must be above 0.', 'Für dieses Produkt gibt es kein Rezept, es wird nur gekauft oder abgebaut.': 'This product has no recipe; it can only be bought or mined.',
  'Gewinn je Rezept': 'Profit per recipe', 'Verkaufspreis des Produkts minus Kosten der Zutaten, beides zum aktuellen Marktpreis, bei vollem Betrieb. Löhne, Strom und Transport sind nicht eingerechnet. Wer zum Gebot statt zum Marktpreis verkauft, bekommt weniger.': 'Product sale price minus ingredient cost, both at current market price, at full load. Wages, power and transport are not included. Selling at the bid instead of market price earns less.',
  'Meine Maschinen': 'My machines', 'Alle Rezepte': 'All recipes', 'Alle deine Linien zusammen:': 'All your lines together:', 'je Maschine': 'per machine', 'verkauft': 'sells at', 'Zutaten': 'ingredients', 'Maschinen werden geladen…': 'Loading machines…',
  'Neue Kaufregel': 'New buy rule', 'Jede Minute geprüft, solange Chrome läuft.': 'Checked every minute while Chrome runs.', 'Sniper': 'Sniper', 'Nachkauf': 'Restock',
  ': kauft sofort, sobald jemand zu höchstens deinem Preis anbietet.': ': buys at once as soon as someone offers at or below your price.',
  ': legt einen Kaufauftrag (Buy Order) an, wenn der Bestand unter dein Ziel fällt; Preis 1 Cent über dem höchsten Gebot, nie über deinem Höchstpreis. Beide hören auf, sobald das Ziel erreicht ist.': ': places a buy order when stock falls below your target; price 1 cent above the highest bid, never above your maximum. Both stop once the target is reached.',
  'Nachkauf (Buy Order)': 'Restock (buy order)', 'Sniper (sofort kaufen)': 'Sniper (buy now)', 'Höchstpreis je Stück $': 'Max price per unit $', 'Ziel-Bestand': 'Target stock',
  'Liefern an / Bestand messen bei': 'Deliver to / measure stock at', '– alle Orte, nicht liefern –': '– all locations, do not deliver –', 'Sniper: höchstens Stück pro Minute': 'Sniper: max units per minute', 'Regel anlegen': 'Create rule',
  'Sniper liefert nach dem Kauf nur, wenn oben bei „Uncollected goods" nichts anderes liegt (das Spiel schickt immer alles mit). Ware aus Kaufaufträgen wartet dort, bis sie geliefert wird.': 'Sniper only delivers after buying if nothing else waits under "Uncollected goods" (the game always sends everything). Goods from buy orders wait there until delivered.',
  'Jede Minute geprüft, solange Chrome läuft: Liegt der Lagerbestand unter deinem Ziel, kauft die Regel sofort alle Angebote im Markt, die höchstens deinen Höchstpreis kosten, bis zur eingestellten Menge pro Minute. Es wird kein Kaufauftrag (Buy Order) gestellt. Sie hört auf, sobald das Ziel erreicht ist.': 'Checked every minute while Chrome runs: if storage is below your target, the rule instantly buys all market offers at or below your max price, up to the set amount per minute. No buy order is placed. It stops once the target is reached.',
  'höchstens Stück pro Minute': 'max units per minute', 'sofort kaufen': 'buy instantly', 'Kaufregel…': 'Buy rule…',
  'Gekaufte Ware landet oben bei „Uncollected goods". Die Regel liefert sie gleich, wenn dort nichts anderes liegt (das Spiel schickt immer alles mit), sonst holt das automatische Abholen sie.': 'Bought goods land under "Uncollected goods". The rule delivers them right away if nothing else waits there (the game always sends everything), otherwise auto-collect picks them up.',
  'Aktive Kaufregeln': 'Active buy rules', 'Noch keine.': 'None yet.', 'Nachkauf-Regel…': 'Restock rule…', 'Kaufregel angelegt:': 'Buy rule created:', 'Stand unter „Aktive Kaufregeln".': 'Status under "Active buy rules".',
  'Kaufregel gestoppt. Ein schon gestellter Kaufauftrag bleibt am Markt.': 'Buy rule stopped. A buy order already placed stays on the market.', 'Höchstpreis fehlt. Ohne ihn könnte zu jedem Preis gekauft werden.': 'Max price missing. Without it any price could be paid.',
  'Ziel-Bestand fehlt.': 'Target stock missing.', 'Gewinn': 'Profit', 'Einkauf': 'Buying', 'Ziel erreicht': 'target reached', 'Bargeld-Reserve erreicht': 'cash reserve reached',
  'kein Angebot bis': 'no offer up to', 'günstigstes': 'cheapest', 'Kaufauftrag läuft': 'buy order running', 'Stück sofort gekauft (höchstens': 'units bought now (at most', 'je Stück)': 'per unit)',
  'Lieferung an': 'delivery to', 'wartet oben (andere Ware liegt mit dort)': 'waiting under Uncollected goods (other goods there too)', 'Stück zu höchstens': 'units at most',
  'Ziel-Lagerbestand (ohne Maschinen)': 'Target storage stock (excluding machines)',
  'liegen noch oben bei „Uncollected goods“: erst abholen, dann wird nachgekauft': 'still wait under "Uncollected goods": collect first, then restock', 'aber': 'but',
  'Bearbeiten…': 'Edit…', 'Verkauf in Schritten bearbeiten': 'edit step sale', 'Auffüllen bearbeiten': 'edit top-up', 'Mindestpreis $ (nie unter)': 'Minimum price $ (never below)', 'Änderungen übernehmen': 'Apply changes', 'Änderungen gespeichert, gilt ab der nächsten Minute.': 'changes saved, applies from the next minute.', 'keine Wohnblöcke': 'no apartment blocks',
  'Ändert nur die Regel, stellt keinen Auftrag. Verkauft wird weiter in Schritten, ab der nächsten Minute mit den neuen Werten.': 'Only changes the rule, places no order. Selling continues in steps with the new values from the next minute.',
  'Gebäude suchen, kaufen und vermieten': 'Find, buy and rent out buildings', 'Mittelpunkt': 'Center', 'Umkreis km': 'Radius km', 'Preis ab $': 'Price from $', 'bis höchstens $': 'up to $', 'Gesamtbudget $': 'Total budget $', 'Miete in % der fairen Miete': 'Rent in % of fair rent', 'automatisch kaufen und vermieten': 'buy and rent out automatically', 'Suche starten': 'Start search', 'Treffer': 'Matches', 'Verlauf': 'Log', 'Einheiten': 'units', 'faire Miete': 'fair rent', 'gefunden': 'found', 'Kaufen + vermieten': 'Buy + rent out', 'Gebäude': 'Buildings', 'Kacheln': 'tiles', 'Kachel': 'Tile', 'Gebäude geprüft': 'buildings checked', 'passend': 'matching', 'Fertig:': 'Done:', 'Gestoppt': 'Stopped', 'ausgegeben': 'spent', 'Suche um': 'Searching around', 'Wird gestoppt…': 'Stopping…', 'gekauft': 'bought', 'Einheiten als': 'units offered as', 'Kauf abgelehnt:': 'Purchase rejected:', 'vermieten ging nicht (im Spiel prüfen)': 'renting out failed (check in game)', 'Budget reicht nicht': 'budget insufficient', 'Bargeld-Reserve': 'cash reserve', 'Kein Mittelpunkt gewählt.': 'No center selected.',
  "Meine Räume vermieten": "Rent out my rooms", "Meine Räume": "My rooms", "Mietertyp": "Tenant type", "automatisch (Office, dann Shop, dann Wohnung)": "automatic (office, then shop, then apartment)", "Wohnung": "Apartment", "Lager": "Storage", "Fabrik": "Factory", "Wartezeit höchstens Std": "Max wait hours", "automatisch vermieten": "rent out automatically", "(jede Minute, auch neu gekaufte Räume)": "(every minute, including newly bought rooms)", "Neu laden": "Reload", "laufende Miete": "current rent", "angeboten": "listed", "Nachfrage": "demand", "keine": "none", "niedrig": "low", "mittel": "fair", "hoch": "high", "Vertrag bis": "contract until", "Vermieten": "Rent out", "Neu berechnen": "Recalculate", "privat (von Hand abgeschaltet)": "private (switched off by hand)", "eigenes Lager bzw. Fabrik, wird nicht vermietet": "own storage or factory, not rented out", "Gebäude mit mehreren freien Etagen": "Buildings with several free floors", "Alle kaufen": "Buy all", "zusammen": "together", "Etagen": "floors", "Bietet deine gekauften Räume NPC-Mietern an. Mietertyp und Miete werden so gewählt, dass laut Spiel-Rechnung höchstens die eingestellte Wartezeit bis zum Mieter vergeht, in der Reihenfolge Office, dann Shop, dann Wohnung, dann der Rest, jeweils zur höchsten Miete, die das erlaubt. Geht das in einer Gegend nicht, nimmt sie die schnellste Möglichkeit. Freie Angebote werden nachgezogen, wenn sich der Markt ändert. Nie angefasst werden: vermietete Räume, von dir privat geschaltete, deine Lager- und Fabrik-Orte und Räume mit Möbeln oder Maschinen. Gehört dir das Gebäude nicht, bekommt sein Besitzer 10 % der Miete.": "Offers your bought rooms to NPC tenants. Tenant type and rent are chosen so that, by the game's own calculation, at most the set wait passes until a tenant arrives, in the order office, then shop, then apartment, then the rest, each at the highest rent that allows. If an area cannot manage that, the fastest option is used. Free listings are adjusted when the market changes. Never touched: rented rooms, rooms you set private, your storage and factory locations and rooms with furniture or machines. If you do not own the building, its owner gets 10% of the rent.",
  "Stadt, Adresse oder Koordinaten": "City, address or coordinates", "sonst eigener Ort": "otherwise own location", "z. B. Hamburg oder 53.55, 10.00": "e.g. Hamburg or 53.55, 10.00", "Mittelpunkt nicht gefunden. Stadt anders schreiben oder Koordinaten eingeben.": "Center not found. Spell the city differently or enter coordinates.", "In dieser Gegend gibt es keine NPC-Mieter.": "There are no NPC tenants in this area.",
  '/Min': '/min', '/Tag': '/day',
  'Alle neu berechnen': 'Recalculate all', 'Alle freien Räume werden nacheinander neu berechnet, mit 2 Sekunden Pause. Ergebnis steht gleich oben im Verlauf.': 'All free rooms are recalculated one after another with a 2-second pause. The result appears in the log above shortly.',
  "Frist Std": "Deadline hours", " · Frist noch ": " · deadline in ", " · Frist abgelaufen, wird gewechselt": " · deadline passed, switching type", "Oberste Regel: Ein Angebot bleibt die eingestellte Frist unverändert stehen. Kommt in der Frist kein Mieter, wechselt der Raum auf den nächsten Typ (Office, dann Shop, dann Wohnung, dann Lager, dann Fabrik, danach wieder von vorn) und die Frist startet neu. Beim Anbieten wird der erste Typ dieser Reihenfolge genommen, bei dem laut Spiel-Rechnung ein Mieter innerhalb der Frist kommt, zur höchsten Miete, die das erlaubt; geht das bei keinem, die schnellste Möglichkeit.": "Top rule: a listing stays unchanged for the set deadline. If no tenant arrives in time, the room switches to the next type (office, then shop, then apartment, then storage, then factory, then from the top) and the deadline restarts. When listing, the first type in this order that the game expects to fill within the deadline is used, at the highest rent that allows; if none can, the fastest option.", "Alle freien Räume werden jetzt nacheinander neu angeboten, mit 2 Sekunden Pause, und ihre Frist startet neu. Ergebnis steht gleich oben im Verlauf.": "All free rooms are re-listed now one after another with a 2-second pause, and their deadline restarts. The result appears in the log above shortly.",
  "Mieter spätestens in Std": "Tenant within hours", "keine Nachfrage in dieser Gegend": "no demand in this area", "Jede Minute wird geprüft, ob ein freies Angebot laut Spiel-Rechnung innerhalb der eingestellten Stunden einen Mieter bekommt, zur höchsten Miete, die das schafft. Ist es zu langsam oder könnte die Miete höher sein, wird es neu angeboten: erster Typ der Reihenfolge Office, Shop, Wohnung, Lager, Fabrik, der das schafft; Typen ohne Suchende werden übersprungen. Schafft es keiner, die schnellste Möglichkeit. Gegenden ohne jede Nachfrage werden rot markiert.": "Every minute each free listing is checked: will it get a tenant within the set hours by the game's own calculation, at the highest rent that manages it? If it is too slow or the rent could be higher, it is re-listed: the first type in the order office, shop, apartment, storage, factory that manages it; types with nobody looking are skipped. If none can, the fastest option. Areas with no demand at all are marked red.", "Alle freien Räume werden jetzt nacheinander neu angeboten, mit 2 Sekunden Pause. Ergebnis steht gleich oben im Verlauf.": "All free rooms are re-listed now one after another with a 2-second pause. The result appears in the log above shortly.",
  "vermietet": "rented", "angeboten, noch ohne Mieter": "listed, no tenant yet", "nicht angeboten": "not listed", "eigene Lager/Fabriken": "own storage/factories", "privat": "private", "Miete jetzt": "Rent now", "wenn alles vermietet wäre": "if everything were rented",
  "z. B. Hamburg; Dresden; Oulu oder 53.55, 10.00": "e.g. Hamburg; Dresden; Oulu or 53.55, 10.00", "Das Spiel bremst: nur noch 3 Abfragen gleichzeitig.": "The game is throttling: only 3 requests at a time now.",
  '🎲 Zufällig': '🎲 Random',
  'Nur nicht angebotene anbieten': 'List only unlisted', 'Nur die Räume ohne Angebot werden jetzt zur Miete angeboten, wo möglich ganze Gebäude auf einmal. Angebotene und vermietete Räume bleiben, wie sie sind. Ergebnis steht gleich oben im Verlauf.': 'Only rooms without a listing are now listed for rent, whole buildings at once where possible. Listed and rented rooms stay as they are. The result appears in the log above shortly.',
  'Räume': 'Rooms', 'Große Räume suchen und kaufen': 'Find and buy large rooms', 'Raum ab m²': 'Room from m²', 'Preis je Raum höchstens $': 'Max price per room $', 'Preis je Raum ab $': 'Min price per room $', 'Kaufpreis': 'Price', 'Weiter': 'Resume', 'pausiert': 'paused', 'Suche pausiert.': 'Search paused.', 'Suche geht weiter.': 'Search resumed.', 'automatisch kaufen': 'buy automatically', 'größte zuerst': 'largest first', 'Etage': 'Floor', 'Räume passend': 'rooms matching',
  'Sucht freie Räume in fremden Gebäuden im Umkreis, zum Beispiel ganze Etagen oder Verkaufsflächen. Ein Raum kostet einmalig den angezeigten Preis, danach keine Miete. Mit „automatisch" wird jeder Treffer sofort gekauft. Die Leiste muss dafür offen bleiben.': 'Finds free rooms in other buildings within the radius, for example whole floors or sales floors. A room costs the shown price once, no rent afterwards. With "automatically" every match is bought right away. Keep the panel open for this.',
  'Ausgeschaltet:': 'Switched off:', 'Einschalten…': 'Switch on…', 'Einschalten': 'Switch on', 'Rezept': 'Recipe', 'Maschinen einschalten': 'Switch on machines', 'Kein Rezept gewählt.': 'No recipe selected.', 'eingeschaltet.': 'switched on.', 'Keine ausgeschalteten Maschinen gefunden.': 'No switched-off machines found.', 'Keine Maschine eingeschaltet. Antwort des Spiels:': 'No machine switched on. Game response:',
  'Maschinen sind ausgeschaltet (kein Rezept). Sie bekommen das gewählte Rezept und laufen los, sobald Material da ist.': 'machines are switched off (no recipe). They get the chosen recipe and start as soon as material is there.',
  // Drosseln
  'Maschinen stellen je': 'machines each make', '/Min her.': '/min.', 'Bilanz jetzt': 'Balance now', '(bei vollem Betrieb)': '(at full load)',
  'Pausierte Maschinen lässt das Spiel in Ruhe, Material darin bleibt liegen. „Einschalten…" steht danach an der Fabrik.':
    'The game leaves paused machines alone; material inside stays. "Switch on…" appears at the factory afterwards.',
  'Maschinen pausieren': 'Pause machines', 'Bilanz danach': 'balance afterwards', 'spart je Maschine': 'saves per machine',
  'Pausieren': 'Pause', 'Pausiert:': 'Paused:', 'Wieder an': 'Turn back on', 'Drosseln…': 'Throttle…',
  'Keine Maschine pausiert. Antwort des Spiels:': 'No machine paused. Game response:', 'Abgelehnt:': 'Rejected:',
  'Keine Maschinen mit diesem Rezept gefunden.': 'No machines with this recipe found.',
  // Auslagern
  'Ziel: Lager leer. Umlagern per Route dorthin, wo die Ware fehlt; Ware, die kein Ort anfordert, wird in Schritten verkauft (immer 1 Cent unter dem günstigsten fremden Angebot).':
    'Goal: empty storage. Relocate by route to where items are missing; items no location requests are sold in steps (always 1 cent below the cheapest competing offer).',
  'Umlagern': 'Relocate', 'Bleibt': 'Stays', 'dort fehlen': 'missing there', 'dort wird es verbraucht': 'consumed there', 'Marktpreis': 'Market price',
  'wird hier selbst gebraucht': 'needed here', 'wird woanders gebraucht, dort ist aber schon genug da': 'needed elsewhere, but there is enough there already',
  'wird gebraucht, aber kein Ort in Fahrweite mit Ladeplatz': 'needed, but no reachable location with a loading spot',
  'Verkauf: Stück je Schritt': 'Sale: units per step', 'nie unter % des Marktpreises': 'never below % of market price', 'Plan ausführen': 'Run plan',
  'Schritt-Verkäufe angelegt': 'step sales created', 'wird ausgelagert:': 'is being cleared out:', 'Route nach': 'Route to',
  // Route
  'Liefermenge ändern (bisher': 'Change delivery rate (currently', 'Neue Route anlegen': 'Create new route',
  'Benutzt jeweils den ersten Ladeplatz.': 'Uses the first loading spot on each side.', 'Gebraucht werden': 'Needed:',
  'pro Minute; vorgeschlagen ist das Doppelte, damit sich ein Vorrat aufbaut.': 'per minute; double is suggested so a buffer builds up.',
  'Auf dieser Strecke fährt schon:': 'Already on this route:', 'Das bleibt drin.': 'This stays.', 'Stück pro Minute': 'units per minute',
  'Route anlegen…': 'Create route…', 'Route anlegen': 'Create route', 'Für diese Orte fehlen Ladeplätze.': 'These locations lack loading spots.',
  'Routen konnten nicht geladen werden, bitte nochmal.': 'Routes could not be loaded, please try again.', 'Rate ungültig.': 'Invalid rate.',
  // Fabriken
  'Rechnung pro Minute bei vollem Betrieb aller Maschinen (Rezepte aus der Wiki): eigene Herstellung − Verbrauch + Zulauf per Route = Bilanz. Grün: hält oder wächst. Gelb: sinkt, reicht aber noch über 2 Stunden. Rot: leer in unter 2 Stunden oder schon leer.':
    'Per-minute calculation at full load of all machines (recipes from the wiki): own production − consumption + route inflow = balance. Green: holds or grows. Yellow: falling but lasts over 2 hours. Red: empty in under 2 hours or already empty.',
  '✓ reicht, Vorrat wächst': '✓ enough, stock growing', '✓ reicht': '✓ enough', '✗ fehlt, Maschinen stehen': '✗ missing, machines idle', '✗ fehlt im Lager': '✗ none in storage', 'nur noch Reste in den Maschinen': 'only leftovers in the machines', '⚠ Lager leer, Herstellung deckt den Verbrauch gerade so': '⚠ storage empty, production barely covers consumption',
  '✗ reicht nicht,': '✗ not enough,', '⚠ sinkt,': '⚠ falling,', 'Verbrauch': 'Consumption', 'selbst hergestellt': 'made here', 'Zulauf': 'Inflow',
  'Bestand': 'Stock', 'Bilanz': 'Balance', 'Mehr liefern…': 'Deliver more…', 'Übrig in:': 'Surplus in:', 'Kein Ort in Fahrweite hat etwas übrig.': 'No reachable location has any surplus.',
  'Stellt her:': 'Produces:', 'Gruppen': 'groups', 'kein Rezept eingestellt': 'no recipe set', 'Material fehlt': 'material missing', 'Maschinen stehen': 'machines idle',
  'Engpass:': 'Bottleneck:', 'Fabriken werden geladen…': 'Loading factories…', 'Keine Maschinen gefunden.': 'No machines found.', 'aktiv': 'active',
  // Engpässe und Abholen
  'Probleme': 'problems', 'unterwegs': 'in transit', 'erfüllt': 'fulfilled', 'Spiel meldet:': 'Game reports:', 'ohne Vorrat': 'out of stock',
  'volle Ladeplatz-Reihen': 'full loading rows', 'unversorgt': 'unsupplied', 'Alles wird geliefert.': 'Everything is being delivered.',
  'Nicht abgeholte Ware automatisch dorthin liefern, wo sie gebraucht wird': 'Automatically deliver uncollected goods to where they are needed',
  'Wenn nirgends gebraucht: abladen bei': 'If not needed anywhere: drop off at', '– liegen lassen –': '– leave it –', 'wird nicht verkauft, nur eingelagert': 'not sold, only stored',
  'Ladeplatz': 'loading spot', 'Zuletzt': 'Last', 'Prüft jede Minute.': 'Checks every minute.', 'Jetzt prüfen': 'Check now',
  'nichts zum Abholen': 'nothing to collect', 'eine Lieferung ist noch unterwegs, später nochmal': 'a delivery is still on its way, trying later',
  'würde mitgeliefert, fehlt aber an keinem Ort mit freiem Ladeplatz': 'would be delivered too, but is missing at no location with a free loading spot',
  'kein einzelner Ort braucht alle wartenden Waren zugleich': 'no single location needs all waiting goods at once',
  'geliefert nach': 'delivered to', 'abgeladen bei': 'dropped off at', '(wird nirgends gebraucht)': '(not needed anywhere)', 'Abladeort': 'drop-off location',
  'ist nicht eindeutig (mehrere Orte heißen so)': 'is ambiguous (several locations share this name)', 'nicht gefunden': 'not found', 'ist voll': 'is full',
  'Abladeort gespeichert, wird gleich geprüft.': 'Drop-off location saved, checking now.', 'Ware bleibt liegen, wenn sie nirgends gebraucht wird.': 'Goods stay put when not needed anywhere.',
  'Quelle ist leer': 'source is empty', 'Ladeplatz ist voll': 'loading spot is full', 'Ladeplatz nimmt die Ware nicht an': 'loading spot rejects the item',
  'nur übers Meer erreichbar': 'only reachable by sea', 'Liegt in': 'Stored in', 'Ziel ist nur übers Meer erreichbar. Lösung: Schiffsroute nötig.': 'Destination only reachable by sea. Fix: a sea route is needed.',
  // Personal
  'Mitarbeitern': 'employees', 'Lohn': 'wages', 'Fahrzeuge ohne Fahrer:': 'Vehicles without driver:', 'Speichern': 'Save', 'Noch nichts gespeichert.': 'Nothing saved yet.',
  'Nicht gespeichert: Änderungen gelten erst nach „Speichern".': 'Not saved: changes apply only after "Save".', '✓ Gespeichert': '✓ Saved',
  'Automatik an': 'Automation on', '(prüft jede Minute)': '(checks every minute)', '1. Fahrzeuge ohne Fahrer besetzen': '1. Staff vehicles without a driver',
  '4. Untätige auf den Parkplatz schicken und zurückholen, wenn ein Posten laut Spiel Leute braucht': '4. Send idle staff to the parking post and bring them back when a post needs people',
  'Parkplatz': 'Parking post', '3. Zuerst untätige Mitarbeiter versetzen, erst dann einstellen': '3. Move idle staff first, hire only then', 'je Person': 'per person',
  'Bargeld nie unter $': 'Cash never below $', 'höchstens neu pro Minute': 'max new hires per minute', 'Noch nicht gelaufen.': 'Not run yet.',
  '2. Soll-Zahl je Posten eintragen (leer = keine Regel). Die Automatik bringt den Posten auf diese Zahl.': '2. Enter a target per post (empty = no rule). The automation brings the post to this number.',
  'Soll': 'Target', 'untätig': 'idle', 'blockiert': 'blocked', 'alle arbeiten': 'all working',
  'Diese Einstellungen gehören zu einer anderen Firma bzw. deinem anderen Spieler. Speichern übernimmt sie für die aktive.':
    'These settings belong to another company or your other player. Saving applies them to the active one.',
  'Personal-Einstellungen gespeichert. Die Automatik läuft jetzt damit.': 'Staff settings saved. The automation now runs with them.',
  'versetzt →': 'moved →', 'abgelehnt': 'rejected', 'eingestellt für': 'hired for', 'gestoppt bei': 'stopped at', 'alles besetzt': 'all staffed',
  'Einstellungen pro Minute': 'hires per minute', 'Mitarbeiter erreicht': 'employees reached', 'Bargeld würde unter die Reserve fallen': 'cash would drop below the reserve',
  '(Parkplatz)': '(parking)', 'Fahrzeug ohne Fahrer': 'Vehicle without driver', 'Keine Mitarbeiterdaten.': 'No staff data.',
  'wartet: Einstellungen gehören zu einer anderen Firma bzw. deinem anderen Spieler': 'waiting: settings belong to another company or your other player',
  // Regeln und Meldungen
  'wartet auf erste Prüfung': 'waiting for first check', 'du bist am günstigsten': 'you are the cheapest', 'kein fremdes Angebot': 'no competing offer',
  'Untergrenze erreicht, fremdes Angebot bei': 'floor reached, competing offer at', 'Höchstmenge erreicht': 'maximum reached',
  'nichts mehr verkaufbar in deinen Lagern': 'nothing left to sell in your storage', 'wartet: gehört zu einer anderen Firma bzw. deinem anderen Spieler': 'waiting: belongs to another company or your other player',
  'Stück zu': 'units at', 'nachgeschoben': 'topped up', 'hält': 'keeps', 'offen zu': 'open at', 'gestellt': 'placed', 'nie unter': 'never below',
  'Unterbieten': 'Undercut', 'Auffüllen': 'Top up', 'Cent drunter': 'cents below', 'voll:': 'full:',
  'Schritt-Verkauf gestoppt. Bereits gestellte Aufträge bleiben am Markt.': 'Step sale stopped. Orders already placed stay on the market.',
  'Verkaufsauftrag gestellt:': 'Sell order placed:', 'Kaufauftrag gestellt:': 'Buy order placed:', 'Gekauft:': 'Bought:', 'Auftrag gelöscht.': 'Order deleted.',
  'Route angelegt:': 'Route created:', 'Regel angelegt:': 'Rule created:', 'immer knapp unter dem günstigsten Angebot. Stand im Reiter Alarme.': 'always just below the cheapest offer. Status in the Alerts tab.',
  'es werden jetzt immer': 'now always keeping', 'offen gehalten': 'open', 'insgesamt bis': 'up to a total of', 'Maschinen für': 'machines for',
  'wieder an.': 'back on.', 'pausiert.': 'paused.', 'wird gesendet…': 'sending…', 'Spiel lehnt ab:': 'Game rejects:', 'Keine Antwort vom Spiel.': 'No answer from the game.',
  'Menge ungültig': 'Invalid quantity', 'Preis ungültig.': 'Invalid price.', 'Menge oder Preis ungültig.': 'Invalid quantity or price.',
  'Menge, Preis und Höchstmenge müssen größer 0 sein.': 'Quantity, price and maximum must be above 0.', 'Menge und Preis müssen größer 0 sein.': 'Quantity and price must be above 0.',
  'Stück je Schritt und Prozent prüfen.': 'Check units per step and percent.', 'Das Spiel antwortet gerade nicht': 'The game is not responding right now',
  'Nächster Versuch in einer Minute.': 'Next try in one minute.', 'Zeitüberschreitung': 'timeout', 'Fehler bei': 'Error at', 'Fehler:': 'Error:',
  'Der Spiel-Tab antwortet nicht. Klick einmal in den Spiel-Tab oder lade ihn neu.': 'The game tab is not responding. Click into the game tab once or reload it.',
  'Keine Antwort vom Spiel-Tab. Bitte im Spiel prüfen, ob die Aktion angekommen ist, bevor du es nochmal versuchst.': 'No answer from the game tab. Check in the game whether the action arrived before retrying.',
  'Ware abgeholt': 'Goods collected', 'Unterboten:': 'Undercut:', 'zum Verkauf gestellt': 'listed for sale', 'Preisalarm:': 'Price alert:', 'Mitarbeiter eingestellt': 'employees hired', 'Kosten': 'Cost',
  // Einzelwörter zuletzt (kürzeste Einträge greifen erst, wenn nichts Längeres passt)
  'Menge': 'Quantity', 'Mindestpreis': 'Minimum price', 'Stück je Schritt': 'Units per step', 'Gesamtmenge': 'Total quantity', 'höchstens': 'max',
  'Vorschlag': 'Suggestion', 'Maschinen': 'machines', 'Verkaufen': 'Sell', 'Verkauf': 'Sell', 'Kauf': 'Buy', 'Kaufen': 'Buy', 'Löschen': 'Delete',
  'je Stück': 'per unit', 'Stück': 'units', 'Preis': 'Price', 'Ware': 'Item', 'gesamt': 'total', 'wartet': 'waiting', 'steht still': 'stalled',
  'reicht': 'lasts', 'Stand': 'As of', 'Tage': 'days', 'Std': 'h', 'Min': 'min', 'Tag': 'day', 'unter': 'below', 'über': 'above', 'nach': 'to', 'von': 'from',
  'je': 'each', 'für': 'for', 'bei': 'at', 'und': 'and', 'oder': 'or', 'ohne': 'without', 'noch': 'still', 'offen': 'open', 'pro': 'per', 'mit': 'with',
}).sort((a, b) => b[0].length - a[0].length);

const EN_GANZ = new Map(EN);

// Wortgrenzen, die auch Umlaute kennen
const EN_WORT = EN.map(([de, en]) => [new RegExp('(?<![A-Za-zÄÖÜäöüß])' + de.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-zÄÖÜäöüß])', 'g'), en]);

const TR_CACHE = new Map();   // Text → Übersetzung; höchstens 20.000 Einträge, dann neu
function tr(text) {
  if (SPRACHE !== 'en' || !text || !/[A-Za-zÄÖÜäöüß]/.test(text)) return text;
  const c = TR_CACHE.get(text);
  if (c !== undefined) return c;
  const ganz = EN_GANZ.get(text.trim());   // ganzer Text bekannt: direkt, damit Muster wie „… verkaufen“ nicht falsch greifen
  let t;
  if (ganz) t = text.replace(text.trim(), ganz);
  else {
    t = text;
    for (const [re, en] of EN_RE) t = t.replace(re, en);
    for (const [re, en] of EN_WORT) t = t.replace(re, en);
    t = t.replace(/(\d),(\d)/g, '$1.$2');   // Dezimalkomma aus deutschen Texten (z. B. Log-Einträge) angleichen
  }
  if (TR_CACHE.size > 20000) TR_CACHE.clear();
  TR_CACHE.set(text, t);
  if (t !== text) TR_CACHE.set(t, t);   // die eigene Ausgabe nicht nochmal übersetzen (Beobachter meldet sie als Änderung)
  return t;
}

function uebersetzeDom(root) {
  if (SPRACHE !== 'en' || !root) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const neu = tr(n.nodeValue); if (neu !== n.nodeValue) n.nodeValue = neu; }
  root.querySelectorAll && root.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e => {
    for (const a of ['placeholder', 'title', 'aria-label']) { const v = e.getAttribute(a); if (v) { const neu = tr(v); if (neu !== v) e.setAttribute(a, neu); } }
  });
}

// Seitenleiste: alles, was neu gezeichnet wird, gleich übersetzen (übersetzter Text ändert sich beim zweiten Mal nicht mehr, daher keine Schleife)
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && SPRACHE === 'en') {
  const beob = new MutationObserver(ms => { for (const m of ms) uebersetzeDom(m.type === 'characterData' ? m.target.parentNode : m.target); });
  const start = () => { uebersetzeDom(document.body); document.documentElement.lang = 'en'; beob.observe(document.body, { childList: true, subtree: true, characterData: true }); };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
}

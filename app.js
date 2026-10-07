(() => {
  'use strict';

  const APP_VERSION = '1.0.0';
  const SCHEMA_VERSION = 1;
  const $ = (sel, el = document) => el.querySelector(sel);

  // ---------- constants ----------
  const STORES = ['ingredients', 'recipes', 'weekPlans', 'shoppingItems', 'pantryItems', 'mealLogs', 'settings'];
  const SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  const SLOT_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
  // Same values as Lift Log's session_type, so the two exports join on date.
  const TRAINING = { lift: 'Weights', walk: 'Treadmill', hiit: 'HIIT', rest: 'Rest' };
  const TRAINING_ORDER = ['lift', 'walk', 'hiit', 'rest'];
  const LIFT_LOG_SCHEDULE = { 1: 'lift', 2: 'walk', 3: 'lift', 4: 'hiit', 5: 'lift' };   // from Lift Log's program.js
  const LIFT_LOG_HIIT_FROM = '2026-10-08';
  const TAGS = ['batch', 'quick', 'cook once eat twice', 'rice cooker', 'Costco ready-meal'];
  const LACTOSE = { none: 'Lactose-free', low: 'Low lactose', contains: 'Contains lactose' };
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // index within a week plan
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DEFAULT_SETTINGS = {
    bodyweightKg: 97, proteinTargetGPerKg: 2.0,
    reminderTimes: { evening: '20:00', batchCook: '10:00' },
    stores: ['Costco', 'Butcher', 'Market', 'Supermarket'],
  };

  // ---------- dates & formatting ----------
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(s, n) { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); }
  function todayStr() { return ymd(new Date()); }
  function mondayOf(s) { return addDays(s, -((parseYmd(s).getDay() + 6) % 7)); }
  function nowIso() { return new Date().toISOString(); }
  const fmtDate = s => { const d = parseYmd(s); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };   // ddd d MMM
  const dowOf = s => DOW[parseYmd(s).getDay()];
  function localStamp(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const round = (n, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;
  const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
  const gram = n => (n == null ? '? g' : `${Math.round(n)} g`);
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const clone = o => JSON.parse(JSON.stringify(o));

  // ---------- units ----------
  // g/kg and ml/L are summed together; any other unit (each, tin, pack, loaf…) is summed as-is.
  const BASE = { g: ['g', 1], kg: ['g', 1000], ml: ['ml', 1], l: ['ml', 1000] };
  function norm(qty, unit) {
    const u = (unit || '').trim() || 'each', b = BASE[u.toLowerCase()];
    return b ? { qty: qty * b[1], unit: b[0], measured: true } : { qty, unit: u, measured: false };
  }
  function fmtQty(qty, unit) {
    if (qty == null) return '';
    if (unit === 'g' && qty >= 1000) return `${round(qty / 1000, 2)} kg`;
    if (unit === 'ml' && qty >= 1000) return `${round(qty / 1000, 2)} L`;
    return `${round(qty, 2)} ${unit || ''}`.trim();
  }

  // ---------- IndexedDB ----------
  // Everything is loaded into memory at start (it's one person's data) and written through on change.
  let db;
  const S = {};
  let settings;

  function openDb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('meal-planner', 1);
      r.onupgradeneeded = () => {
        for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  function getAll(store) {
    return new Promise((res, rej) => {
      const q = db.transaction(store).objectStore(store).getAll();
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  }
  function write(store, puts = [], dels = []) {
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite'), os = tx.objectStore(store);
      puts.forEach(p => os.put(p)); dels.forEach(id => os.delete(id));
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    }).catch(e => toast('Could not save on this device: ' + e.message));
  }
  // Stamps and saves records (new ones get an id), keeping the in-memory copy in step.
  function put(store, recs) {
    recs = Array.isArray(recs) ? recs : [recs];
    const t = nowIso();
    for (const r of recs) {
      if (!r.id) { r.id = uuid(); r.createdAt = t; }
      r.updatedAt = t;
      const i = S[store].findIndex(x => x.id === r.id);
      if (i < 0) S[store].push(r); else S[store][i] = r;
    }
    return write(store, recs);
  }
  function remove(store, ids) {
    ids = Array.isArray(ids) ? ids : [ids];
    S[store] = S[store].filter(x => !ids.includes(x.id));
    return write(store, [], ids);
  }
  const byId = (store, id) => S[store].find(x => x.id === id);
  const ingByName = name => S.ingredients.find(i => i.name.trim().toLowerCase() === String(name).trim().toLowerCase());
  const ingName = id => { const i = byId('ingredients', id); return i ? i.name : '(deleted ingredient)'; };
  const sortByName = arr => [...arr].sort((a, b) => a.name.localeCompare(b.name));

  async function seed() {
    const t = nowIso(), SEED = window.SEED;
    const stamp = o => ({ id: uuid(), createdAt: t, updatedAt: t, ...o });
    const ingKey = {};
    const ingredients = SEED.ingredients.map(i => {
      const r = stamp({ name: i.name, defaultUnit: i.unit, store: i.store, aisle: i.aisle, isLocal: !!i.local, lastPrice: null });
      if (i.pantryKey) r.pantryKey = i.pantryKey;
      ingKey[i.key] = r.id; return r;
    });
    const recipes = SEED.recipes.map(r => {
      const rec = stamp({
        name: r.name, servings: r.servings, proteinPerServingG: null, lactose: r.lactose, tags: r.tags, method: r.method || '',
        ingredients: r.ingredients.map(([k, qty, unit]) => ({ ingredientId: ingKey[k], qty, unit })),
      });
      if (r.shake) rec.isShake = true;
      return rec;
    });
    const recId = Object.fromEntries(recipes.map(r => [r.name, r.id]));
    const slot = v => (v.recipe ? { recipeId: recId[v.recipe], servings: 1, cook: v.cook || null }
      : v.leftover ? { leftoverOf: { day: v.leftover[0], slot: v.leftover[1] }, servings: 1, freezer: !!v.freezer }
        : { text: v.text, proteinG: null });
    const template = stamp({
      weekStart: null, templateName: SEED.template.name,
      days: SEED.template.days.map(d => ({ date: null, training: d.training, slots: Object.fromEntries(Object.entries(d.slots).map(([k, v]) => [k, slot(v)])) })),
    });
    const pantry = SEED.pantry.map(([k, qty, unit]) => stamp({ ingredientId: ingKey[k], qty, unit }));
    const st = stamp({ ...clone(DEFAULT_SETTINGS) }); st.id = 'settings';
    await write('ingredients', ingredients); await write('recipes', recipes); await write('weekPlans', [template]);
    await write('pantryItems', pantry); await write('settings', [st]);
  }

  async function loadAll() {
    for (const s of STORES) S[s] = await getAll(s);
    settings = S.settings.find(x => x.id === 'settings');
    settings.reminderTimes = { ...DEFAULT_SETTINGS.reminderTimes, ...(settings.reminderTimes || {}) };
  }
  const saveSettings = () => put('settings', settings);

  // ---------- UI state ----------
  const ui = {
    view: 'today', date: todayStr(), today: todayStr(), week: mondayOf(todayStr()), shopWeek: mondayOf(todayStr()),
    modal: null, recipeQuery: '', recipeTag: '', hideTicked: false,
  };

  // ---------- week plans ----------
  function defaultTraining(date) {
    const t = LIFT_LOG_SCHEDULE[parseYmd(date).getDay()] || 'rest';
    return t === 'hiit' && date < LIFT_LOG_HIIT_FROM ? 'walk' : t;
  }
  const planFor = weekStart => S.weekPlans.find(p => p.weekStart === weekStart) || null;
  const templates = () => S.weekPlans.filter(p => p.templateName).sort((a, b) => a.templateName.localeCompare(b.templateName));
  function blankPlan(weekStart) {
    return {
      weekStart, days: Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        return { date, training: defaultTraining(date), slots: {} };
      }),
    };
  }
  const viewPlan = weekStart => planFor(weekStart) || blankPlan(weekStart);
  const planIsEmpty = p => p.days.every(d => !Object.keys(d.slots).length);
  function locateDay(date) {
    const plan = viewPlan(mondayOf(date));
    return { plan, i: plan.days.findIndex(d => d.date === date) };
  }
  // Copies days (training + slots) from a week or template onto a week's dates.
  function applyDays(weekStart, days) {
    const plan = viewPlan(weekStart);
    plan.days = days.map((d, i) => ({ date: addDays(weekStart, i), training: d.training, slots: clone(d.slots) }));
    put('weekPlans', plan);
  }

  // What a slot means for display, logging and protein.
  function resolveSlot(plan, dayIdx, key) {
    const day = plan.days[dayIdx], s = day && day.slots[key];
    if (!s) return null;
    if (s.leftoverOf) {
      const srcDay = plan.days[s.leftoverOf.day], src = srcDay && srcDay.slots[s.leftoverOf.slot];
      const r = src && src.recipeId ? byId('recipes', src.recipeId) : null;
      const n = s.servings || 1;
      return {
        kind: 'leftover', recipe: r, servings: n, label: r ? r.name : (src && src.text) || 'Leftovers',
        protein: r && r.proteinPerServingG != null ? r.proteinPerServingG * n : null,
        sub: `Leftovers from ${WEEKDAY[s.leftoverOf.day]} ${s.leftoverOf.slot}${s.freezer ? ' · freezer' : ''}`, freezer: !!s.freezer,
      };
    }
    if (s.recipeId) {
      const r = byId('recipes', s.recipeId), n = s.servings || 1;
      if (!r) return { kind: 'text', label: '(deleted recipe)', servings: n, protein: null, sub: '' };
      const cook = s.cook || r.servings;
      const subs = [];
      if (n !== 1) subs.push(`${n} servings`);
      if (cook > n) subs.push(`cook ${cook}`);
      return { kind: 'recipe', recipe: r, servings: n, label: r.name, sub: subs.join(' · '),
        protein: r.proteinPerServingG != null ? r.proteinPerServingG * n : null };
    }
    return { kind: 'text', label: s.text || '', servings: 1, protein: s.proteinG != null ? s.proteinG : null, sub: '' };
  }
  function plannedProtein(plan, i) {
    let total = 0, unknown = false;
    for (const k of SLOTS) { const r = resolveSlot(plan, i, k); if (!r) continue; if (r.protein == null) unknown = true; else total += r.protein; }
    return { total, unknown };
  }

  // ---------- meal log & protein ----------
  const logsFor = date => S.mealLogs.filter(l => l.date === date).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const proteinOn = date => logsFor(date).reduce((t, l) => t + (Number(l.proteinG) || 0), 0);
  const proteinTarget = () => (settings.bodyweightKg ? Math.round(settings.bodyweightKg * settings.proteinTargetGPerKg) : null);
  function addLog(fields) {
    put('mealLogs', { date: ui.date, slot: null, recipeId: null, text: null, servings: 1, proteinG: null, planned: false, extra: false, ...fields });
  }

  // ---------- shopping list ----------
  // Ingredients summed across the week's recipes (scaled by servings cooked), minus pantry stock.
  function needsFor(week) {
    const plan = planFor(week), need = new Map();
    if (plan) for (const day of plan.days) for (const k of SLOTS) {
      const s = day.slots[k]; if (!s || !s.recipeId) continue;
      const r = byId('recipes', s.recipeId); if (!r) continue;
      const f = (s.cook || r.servings) / (r.servings || 1);
      for (const ing of r.ingredients) {
        const n = norm(ing.qty * f, ing.unit), key = ing.ingredientId + '|' + n.unit;
        const cur = need.get(key) || { ingredientId: ing.ingredientId, unit: n.unit, qty: 0, measured: n.measured, recipes: new Set() };
        cur.qty += n.qty; cur.recipes.add(r.name); need.set(key, cur);
      }
    }
    for (const p of S.pantryItems) {
      const n = norm(Number(p.qty) || 0, p.unit), cur = need.get(p.ingredientId + '|' + n.unit);
      if (cur) cur.qty -= n.qty;
    }
    return [...need.values()].filter(x => x.qty > 0.001).map(x => ({ ...x, qty: Math.ceil(x.qty - 0.001) }));
  }
  // Regenerating keeps ticks, prices and hand-added items. A week's first list also brings over
  // last week's unticked hand-added items.
  function generateShopping(week) {
    const old = S.shoppingItems.filter(i => i.weekStart === week);
    const oldGen = new Map(old.filter(i => !i.manual).map(i => [i.ingredientId + '|' + i.unit, i]));
    const items = needsFor(week).map(n => {
      const ing = byId('ingredients', n.ingredientId) || {}, prev = oldGen.get(n.ingredientId + '|' + n.unit);
      oldGen.delete(n.ingredientId + '|' + n.unit);
      return Object.assign(prev || { checked: false, price: ing.lastPrice != null ? ing.lastPrice : null }, {
        weekStart: week, ingredientId: n.ingredientId, text: null, qty: n.qty, unit: n.unit,
        store: ing.store || '', aisle: ing.aisle || '', isLocal: !!ing.isLocal, manual: false, forRecipes: [...n.recipes].join(', '),
      });
    });
    if (!old.length) {
      S.shoppingItems.filter(i => i.weekStart === addDays(week, -7) && i.manual && !i.checked)
        .forEach(i => items.push({ ...clone(i), id: null, createdAt: null, weekStart: week, carried: true }));
    }
    remove('shoppingItems', [...oldGen.values()].map(i => i.id));
    put('shoppingItems', items);
    return items.length;
  }
  // Store/aisle/local follow the ingredient, so fixing an ingredient fixes every list.
  function itemInfo(it) {
    const ing = it.ingredientId && byId('ingredients', it.ingredientId);
    return {
      name: ing ? ing.name : it.text || '(item)', store: (ing ? ing.store : it.store) || 'Other',
      aisle: (ing ? ing.aisle : it.aisle) || '', isLocal: ing ? !!ing.isLocal : !!it.isLocal,
    };
  }
  function storeOrder() {
    const extra = new Set();
    S.ingredients.forEach(i => i.store && !settings.stores.includes(i.store) && extra.add(i.store));
    return [...settings.stores, ...[...extra].sort(), 'Other'];
  }

  // ---------- pantry ----------
  function pantryAdd(ingredientId, qty, unit) {
    const p = S.pantryItems.find(x => x.ingredientId === ingredientId && norm(1, x.unit).unit === norm(1, unit).unit);
    if (p) { p.qty = round((Number(p.qty) || 0) + norm(qty, unit).qty / norm(1, p.unit).qty, 2); put('pantryItems', p); }
    else put('pantryItems', { ingredientId, qty, unit });
  }
  function homeIngredient(key, name, unit) {
    let ing = S.ingredients.find(i => i.pantryKey === key) || ingByName(name);
    if (!ing) { ing = { name, defaultUnit: unit, store: 'Supermarket', aisle: '', isLocal: false, lastPrice: null, pantryKey: key }; put('ingredients', ing); }
    return ing;
  }

  // ---------- reminders ----------
  function atTime(date, hhmm) { const [h, m] = (hhmm || '20:00').split(':').map(Number); const d = parseYmd(date); d.setHours(h, m, 0, 0); return d.getTime(); }
  // Jobs for the evening of `date`, looking at tomorrow's plan.
  function nightBeforeTasks(date) {
    const tmr = addDays(date, 1), { plan, i } = locateDay(tmr), out = [];
    for (const k of SLOTS) {
      const r = resolveSlot(plan, i, k);
      if (!r) continue;
      if (k === 'breakfast' && r.kind === 'recipe' && r.recipe.tags.includes('rice cooker'))
        out.push({ key: 'rice', text: `Load the rice cooker for ${r.label} and set the timer` });
      if (r.kind === 'leftover' && r.freezer)
        out.push({ key: 'freezer-' + k, text: `Move tomorrow's ${k} (${r.label}) from the freezer to the fridge` });
    }
    return out;
  }
  function batchCookTask(date) {
    if (parseYmd(date).getDay() !== 0) return null;
    const plan = planFor(addDays(date, 1));
    const names = [];
    if (plan) plan.days.forEach(d => SLOTS.forEach(k => {
      const s = d.slots[k], r = s && s.recipeId && byId('recipes', s.recipeId);
      if (r && r.tags.includes('batch') && !names.includes(r.name)) names.push(r.name);
    }));
    return { key: 'batch', text: names.length ? `Batch cook for the week: ${names.join(', ')}` : 'Sunday batch cook: plan next week, generate the list and cook the batch meals' };
  }
  function remindersFor(date) {
    const list = nightBeforeTasks(date).map(t => ({ ...t, at: atTime(date, settings.reminderTimes.evening) }));
    const b = batchCookTask(date);
    if (b) list.unshift({ ...b, at: atTime(date, settings.reminderTimes.batchCook) });
    return list;
  }
  const notifyState = () => (!('Notification' in window) ? 'unsupported' : Notification.permission);
  // Fires due reminders while the app is open or in the background. Android can't schedule
  // notifications for a closed web app, so the Today screen and the calendar file are the fallbacks.
  function checkReminders() {
    if (notifyState() !== 'granted') return;
    const today = todayStr(), now = Date.now();
    let sent = {};
    try { sent = JSON.parse(localStorage.getItem('mp.notified') || '{}'); } catch (e) { /* ignore */ }
    for (const r of remindersFor(today)) {
      const id = today + '|' + r.key;
      if (r.at <= now && now - r.at < 3 * 3600000 && !sent[id]) { sent[id] = 1; notify(r.text, id); }
    }
    for (const k of Object.keys(sent)) if (k.slice(0, 10) < addDays(today, -3)) delete sent[k];
    try { localStorage.setItem('mp.notified', JSON.stringify(sent)); } catch (e) { /* ignore */ }
  }
  function notify(body, tag) {
    const opts = { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' };
    if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.ready.then(reg => reg.showNotification('Meal Planner', opts));
    else try { new Notification('Meal Planner', opts); } catch (e) { /* in-app banner covers it */ }
  }
  function remindersIcs() {
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Meal Planner//EN', 'CALSCALE:GREGORIAN'];
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const local = ms => { const d = new Date(ms); return `${ymd(d).replace(/-/g, '')}T${pad(d.getHours())}${pad(d.getMinutes())}00`; };
    let n = 0;
    for (let i = 0; i < 7; i++) {
      const date = addDays(ui.today, i);
      for (const r of remindersFor(date)) {
        n++;
        lines.push('BEGIN:VEVENT', `UID:${date}-${r.key}@meal-planner`, `DTSTAMP:${stamp}`, `DTSTART:${local(r.at)}`, `DTEND:${local(r.at + 15 * 60000)}`,
          `SUMMARY:${r.text.replace(/[,;]/g, m => '\\' + m)}`, 'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Meal Planner', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT');
      }
    }
    lines.push('END:VCALENDAR');
    return { text: lines.join('\r\n'), n };
  }

  // ---------- export / import ----------
  const MEAL_COLS = ['date', 'day', 'slot', 'training', 'planned', 'extra', 'recipe', 'text', 'servings', 'protein_g', 'lactose', 'logged_at'];
  const SHOP_COLS = ['week_start', 'store', 'aisle', 'item', 'qty', 'unit', 'checked', 'price_aud', 'local', 'source', 'for_recipes'];
  function mealRow(l) {
    const r = l.recipeId && byId('recipes', l.recipeId), { plan, i } = locateDay(l.date);
    return {
      date: l.date, day: dowOf(l.date), slot: l.slot || '', training: plan.days[i] ? plan.days[i].training : '', planned: !!l.planned, extra: !!l.extra,
      recipe: r ? r.name : '', text: l.text || '', servings: l.servings, protein_g: l.proteinG == null ? '' : l.proteinG,
      lactose: r ? r.lactose : '', logged_at: localStamp(l.createdAt),
    };
  }
  function shopRow(it) {
    const x = itemInfo(it);
    return {
      week_start: it.weekStart, store: x.store, aisle: x.aisle, item: x.name, qty: it.qty == null ? '' : it.qty, unit: it.unit || '',
      checked: !!it.checked, price_aud: it.price == null ? '' : it.price, local: x.isLocal, source: it.manual ? 'manual' : 'plan', for_recipes: it.forRecipes || '',
    };
  }
  function toCsv(rows, cols) {
    const cell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
  }
  function exportFiles() {
    const base = `meal-planner-${todayStr()}`;
    const slotIdx = s => SLOTS.indexOf(s);
    const logs = [...S.mealLogs].sort((a, b) => a.date.localeCompare(b.date) || slotIdx(a.slot) - slotIdx(b.slot) || a.createdAt.localeCompare(b.createdAt));
    const shop = [...S.shoppingItems].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    const json = {
      app: 'meal-planner', schemaVersion: SCHEMA_VERSION, appVersion: APP_VERSION, exportedAt: nowIso(),
      description: 'Meal Planner data, one array per store. mealLogs: what was eaten (date, slot, planned vs off-plan, proteinG). ' +
        'weekPlans: Monday-start weeks (templateName set = template); day.training uses Lift Log session types (lift/walk/hiit/rest) so it joins Lift Log by date. ' +
        'Slots hold {recipeId, servings, cook}, {leftoverOf:{day 0=Mon, slot}} or {text}. shoppingItems: per week, price in AUD for the line. Quantities are metric.',
      stores: Object.fromEntries(STORES.map(s => [s, S[s]])),
    };
    return [
      { name: `${base}.json`, text: JSON.stringify(json, null, 2), type: 'application/json' },
      { name: `${base}-meal-log.csv`, text: toCsv(logs.map(mealRow), MEAL_COLS), type: 'text/csv' },
      { name: `${base}-shopping.csv`, text: toCsv(shop.map(shopRow), SHOP_COLS), type: 'text/csv' },
    ];
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  const shareFiles = () => exportFiles().map(f => new File([f.text], f.name, { type: f.type }));
  const canShare = () => { try { return !!(navigator.canShare && navigator.canShare({ files: shareFiles() })); } catch (e) { return false; } };

  // Merges by id: whichever copy was updated last wins, so restoring an older file never clobbers newer edits.
  async function importFile(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'meal-planner' || !data.stores) throw new Error('Not a Meal Planner export');
      if (data.schemaVersion > SCHEMA_VERSION) throw new Error('This file is from a newer version of the app; update first');
      const counts = STORES.filter(s => s !== 'settings').map(s => `${(data.stores[s] || []).length} ${s}`).join(', ');
      if (!confirm(`Import ${counts}?\nRecords already here keep whichever copy was changed most recently.`)) return;
      let n = 0;
      for (const s of STORES) {
        const fresh = (data.stores[s] || []).filter(r => r && r.id && (!byId(s, r.id) || (r.updatedAt || '') > (byId(s, r.id).updatedAt || '')));
        n += fresh.length;
        for (const r of fresh) { const i = S[s].findIndex(x => x.id === r.id); if (i < 0) S[s].push(r); else S[s][i] = r; }
        if (fresh.length) await write(s, fresh);
      }
      settings = S.settings.find(x => x.id === 'settings');
      settings.reminderTimes = { ...DEFAULT_SETTINGS.reminderTimes, ...(settings.reminderTimes || {}) };
      closeModal(); toast(`Imported ${n} records`);
    } catch (e) { toast('Import failed: ' + e.message); }
  }

  // ---------- rendering helpers ----------
  const field = (label, inner) => `<label class="field"><span>${label}</span>${inner}</label>`;
  function lactoseBadge(r) {
    if (!r || r.lactose === 'none') return '';
    return `<span class="badge ${r.lactose}">${r.lactose === 'contains' ? '⚠ ' : ''}${LACTOSE[r.lactose]}</span>`;
  }
  const trainingChip = (t, action, extra = '') =>
    `<${action ? 'button' : 'span'} class="training ${t}" ${action ? `data-action="${action}" ${extra}` : ''}>${TRAINING[t] || t}</${action ? 'button' : 'span'}>`;
  const recipeOptions = sel => sortByName(S.recipes).map(r => `<option value="${r.id}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}${r.lactose === 'contains' ? ' ⚠' : ''}</option>`).join('');
  const ingDatalist = () => `<datalist id="ing-names">${sortByName(S.ingredients).map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>`;
  const storeSelect = (m, cur) => `<select data-m="${m}">${[...new Set([...settings.stores, cur].filter(Boolean))].map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
  const aisleList = () => `<datalist id="aisles">${[...new Set(S.ingredients.map(i => i.aisle).filter(Boolean))].sort().map(a => `<option value="${esc(a)}">`).join('')}</datalist>`;

  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.view === ui.view));
    const main = $('#app');
    const views = { today: renderToday, week: renderWeek, shop: renderShop, pantry: renderPantry, recipes: renderRecipes, ingredients: renderIngredients, settings: renderSettings };
    main.innerHTML = (views[ui.view] || renderToday)();
    renderModal();
  }

  // ---------- Today ----------
  function renderToday() {
    const date = ui.date, isToday = date === ui.today;
    const { plan, i } = locateDay(date), day = plan.days[i];
    const logs = logsFor(date), got = proteinOn(date), target = proteinTarget();
    const pct = target ? Math.min(100, got / target * 100) : 0;

    let html = `<div class="day">
      <button class="nav" data-action="day" data-d="-1" aria-label="Previous day">‹</button>
      <div class="day-title"><div class="day-name">${isToday ? 'Today' : dowOf(date)}</div>
        <div class="day-sub">${fmtDate(date)}${!isToday ? ` · <button class="link" data-action="day" data-d="0">back to today</button>` : ''}</div></div>
      <button class="nav" data-action="day" data-d="1" aria-label="Next day">›</button></div>
      <div class="center">${trainingChip(day.training)}</div>`;

    // Reminders that are due and haven't been dealt with by a notification show up top.
    const due = isToday ? remindersFor(date).filter(r => r.at <= Date.now()) : [];
    if (due.length && notifyState() !== 'granted') {
      html += `<div class="card banner"><b>Now</b><ul>${due.map(r => `<li>${esc(r.text)}</li>`).join('')}</ul></div>`;
    }

    html += `<div class="card protein">
      <div class="card-head"><span class="slot-label">Protein</span>${target ? `<span class="muted">target ${target} g</span>` : ''}</div>
      <div class="protein-num">${Math.round(got)}<small> ${target ? `/ ${target} g` : 'g'}</small></div>
      ${target ? `<div class="bar"><div class="bar-fill ${got >= target ? 'over' : ''}" style="width:${pct}%"></div></div>`
        : `<p class="muted">Set your bodyweight to see a target. <button class="link" data-action="view" data-view="settings">Settings</button></p>`}
      <div class="row"><button class="btn primary" data-action="shake">+ Shake</button><button class="btn" data-action="add-food">+ Add food</button></div>
    </div>`;

    for (const k of SLOTS) {
      const r = resolveSlot(plan, i, k);
      const slotLogs = logs.filter(l => l.slot === k && !l.extra);
      if (!r && !slotLogs.length) continue;
      html += `<div class="card"><div class="card-head"><span class="slot-label">${SLOT_LABEL[k]}</span>
        <span class="muted">${r ? gram(r.protein) : ''}</span></div>`;
      if (r) html += `<div class="meal-name">${esc(r.label)} ${lactoseBadge(r.recipe)}</div>${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ''}`;
      if (slotLogs.length) {
        html += slotLogs.map(l => `<div class="row" style="align-items:center"><span class="done-line" style="flex:1">${l.planned ? '✓ Eaten' : `↺ Had ${esc(logLabel(l))}`} · ${gram(l.proteinG)}</span>
          <button class="btn small ghost" data-action="undo-log" data-id="${l.id}">Undo</button></div>`).join('');
      } else {
        html += `<div class="row"><button class="btn primary" data-action="eat" data-slot="${k}">Eaten</button>
          <button class="btn" data-action="swap" data-slot="${k}">Swap</button></div>`;
      }
      html += `</div>`;
    }
    const empty = SLOTS.every(k => !resolveSlot(plan, i, k));
    if (empty) html += `<div class="card empty"><p>Nothing planned for ${isToday ? 'today' : 'this day'}.</p>
      <button class="btn" data-action="goto-week">Plan the week</button></div>`;

    const extras = logs.filter(l => l.extra);
    if (extras.length) {
      html += `<div class="card"><span class="slot-label">Also eaten</span>${extras.map(l => `<div class="row" style="align-items:center">
        <span style="flex:1">${esc(logLabel(l))} <span class="muted">· ${gram(l.proteinG)}</span></span>
        <button class="btn small ghost" data-action="undo-log" data-id="${l.id}">Remove</button></div>`).join('')}</div>`;
    }

    const prep = remindersFor(date);
    if (prep.length) {
      const hm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
      html += `<div class="card prep"><span class="slot-label">${isToday ? "Today's prep" : 'Prep'}</span>
        <ul class="ing-list">${prep.map(t => `<li><b>${hm(t.at)}</b> ${esc(t.text)}</li>`).join('')}</ul></div>`;
    }
    return html;
  }
  function logLabel(l) {
    const r = l.recipeId && byId('recipes', l.recipeId);
    const name = r ? r.name : l.text || 'Food';
    return l.servings && l.servings !== 1 ? `${name} ×${l.servings}` : name;
  }

  // ---------- Week ----------
  function renderWeek() {
    const plan = viewPlan(ui.week), isCurrent = ui.week === mondayOf(ui.today);
    let html = `<div class="day">
      <button class="nav" data-action="week" data-d="-7" aria-label="Previous week">‹</button>
      <div class="day-title"><div class="day-name">Week of ${fmtDate(ui.week)}</div>
        <div class="day-sub">${isCurrent ? 'This week' : `<button class="link" data-action="week" data-d="0">this week</button>`}</div></div>
      <button class="nav" data-action="week" data-d="7" aria-label="Next week">›</button></div>
      <div class="row wrap">
        <button class="btn" data-action="copy-last">Copy last week</button>
        <button class="btn" data-action="use-template">Use template</button>
        <button class="btn" data-action="save-template">Save as template</button>
        <button class="btn primary" data-action="generate">Generate list</button>
      </div>`;
    if (planIsEmpty(plan)) html += `<p class="muted center">Empty week. Copy last week or start from a template, then tap any slot to change it.</p>`;
    plan.days.forEach((d, i) => {
      const p = plannedProtein(plan, i);
      html += `<div class="card"><div class="card-head"><h3>${fmtDate(d.date)}${d.date === ui.today ? ' <span class="today-dot">today</span>' : ''}</h3>
        ${trainingChip(d.training, 'cycle-training', `data-day="${i}"`)}</div>`;
      for (const k of SLOTS) {
        const r = resolveSlot(plan, i, k);
        html += `<button class="slot-row" data-action="edit-slot" data-day="${i}" data-slot="${k}">
          <span class="slot-label">${SLOT_LABEL[k]}</span>
          <span class="val">${r ? `${r.kind === 'leftover' ? `<span class="leftover">${esc(r.label)}</span>` : esc(r.label)} ${lactoseBadge(r.recipe)}
            ${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ''}` : '<span class="empty">+ add</span>'}</span></button>`;
      }
      if (p.total || p.unknown) html += `<div class="sub" style="text-align:right">Planned protein ${Math.round(p.total)} g${p.unknown ? ' + some not set' : ''}</div>`;
      html += `</div>`;
    });
    return html;
  }

  // ---------- Shop ----------
  function renderShop() {
    const week = ui.shopWeek, items = S.shoppingItems.filter(i => i.weekStart === week);
    let html = `<div class="day">
      <button class="nav" data-action="shop-week" data-d="-7" aria-label="Previous week">‹</button>
      <div class="day-title"><div class="day-name">Shopping</div><div class="day-sub">Week of ${fmtDate(week)}</div></div>
      <button class="nav" data-action="shop-week" data-d="7" aria-label="Next week">›</button></div>`;
    const priced = items.filter(i => i.price != null && i.price !== '');
    const total = priced.reduce((t, i) => t + Number(i.price), 0);
    const ticked = priced.filter(i => i.checked).reduce((t, i) => t + Number(i.price), 0);
    const local = priced.filter(i => itemInfo(i).isLocal).reduce((t, i) => t + Number(i.price), 0);
    const left = items.filter(i => !i.checked).length;
    if (items.length) {
      html += `<div class="card"><div class="totals"><span>${left ? `<b>${left}</b> to get` : '<b>All done</b>'} <span class="muted">of ${items.length}</span></span>
        ${priced.length ? `<span><b>${money(total)}</b> <span class="muted">est.</span></span>` : ''}</div>
        ${priced.length ? `<div class="sub">${money(ticked)} in the trolley · ${money(local)} local (${total ? Math.round(local / total * 100) : 0}%)</div>` : ''}
        <button class="btn small ${ui.hideTicked ? 'primary' : ''}" style="margin-top:8px" data-action="hide-ticked">${ui.hideTicked ? 'Show' : 'Hide'} ticked items</button></div>`;
    }
    html += `<div class="row"><button class="btn" data-action="regenerate">${items.length ? 'Regenerate' : 'Generate from plan'}</button>
      <button class="btn" data-action="add-item">+ Add item</button></div>`;
    if (!items.length) return html + `<div class="card empty"><p>No list for this week yet.</p><p class="muted">Plan the week, then tap Generate.</p></div>`;

    for (const store of storeOrder()) {
      const inStore = items.filter(i => itemInfo(i).store === store || (store === 'Other' && !storeOrder().slice(0, -1).includes(itemInfo(i).store)));
      if (!inStore.length) continue;
      const shown = inStore.filter(i => !(ui.hideTicked && i.checked));
      html += `<div class="store-head"><h2>${esc(store)}</h2><span class="muted">${inStore.filter(i => !i.checked).length} left</span></div>`;
      const aisles = [...new Set(shown.map(i => itemInfo(i).aisle))].sort((a, b) => (a || '~').localeCompare(b || '~'));
      for (const a of aisles) {
        const rows = shown.filter(i => itemInfo(i).aisle === a)
          .sort((x, y) => (x.checked - y.checked) || itemInfo(x).name.localeCompare(itemInfo(y).name));
        html += `<div class="aisle">${esc(a || 'Other')}</div>` + rows.map(it => {
          const x = itemInfo(it);
          return `<div class="shop-row"><button class="shop-item ${it.checked ? 'checked' : ''}" data-action="tick" data-id="${it.id}">
            <span class="tick">${it.checked ? '✓' : ''}</span>
            <span class="si-main"><span class="si-name">${esc(x.name)}</span>
              <span class="si-qty">${esc(fmtQty(it.qty, it.unit))}${x.isLocal ? ' · <span class="badge local">local</span>' : ''}${it.carried ? ' · from last week' : ''}</span></span>
            ${it.price != null && it.price !== '' ? `<span class="si-price">${money(it.price)}</span>` : ''}</button>
            <button class="si-more" data-action="edit-item" data-id="${it.id}" aria-label="Edit ${esc(x.name)}">$</button></div>`;
        }).join('');
      }
    }
    return html;
  }

  // ---------- Pantry ----------
  function renderPantry() {
    const rows = [...S.pantryItems].sort((a, b) => ingName(a.ingredientId).localeCompare(ingName(b.ingredientId)));
    let html = `<h1>Pantry</h1>
      <div class="row"><button class="btn" data-action="baked">🍞 Baked sourdough</button><button class="btn" data-action="eggs">🥚 Collected eggs</button></div>
      <p class="muted">What's on hand is taken off the shopping list.</p>`;
    html += rows.map(p => {
      const step = norm(1, p.unit).measured ? (p.unit === 'kg' || p.unit.toLowerCase() === 'l' ? 0.5 : 100) : 1;
      return `<div class="pantry-row"><span class="grow">${esc(ingName(p.ingredientId))}</span>
        <span class="stepper"><button data-action="pantry-step" data-id="${p.id}" data-d="${-step}" aria-label="Less">−</button>
        <button class="qty" data-action="edit-pantry" data-id="${p.id}">${esc(fmtQty(Number(p.qty) || 0, p.unit))}</button>
        <button data-action="pantry-step" data-id="${p.id}" data-d="${step}" aria-label="More">+</button></span></div>`;
    }).join('');
    return html + `<button class="btn wide" data-action="add-pantry">+ Add pantry item</button>`;
  }

  // ---------- Recipes ----------
  function recipeList() {
    const q = ui.recipeQuery.trim().toLowerCase();
    const list = sortByName(S.recipes).filter(r => (!ui.recipeTag || r.tags.includes(ui.recipeTag) || (ui.recipeTag === 'lactose-free' && r.lactose === 'none'))
      && (!q || r.name.toLowerCase().includes(q) || r.ingredients.some(i => ingName(i.ingredientId).toLowerCase().includes(q))));
    if (!list.length) return `<p class="muted center">No recipes match.</p>`;
    return list.map(r => `<button class="list-row" data-action="edit-recipe" data-id="${r.id}"><span class="grow">
      <span class="name">${esc(r.name)}</span> ${lactoseBadge(r)}
      <div class="sub">${r.proteinPerServingG != null ? `${r.proteinPerServingG} g protein` : 'protein not set'} · serves ${r.servings}${r.tags.length ? ' · ' + esc(r.tags.join(', ')) : ''}</div>
    </span><span class="muted">›</span></button>`).join('');
  }
  function renderRecipes() {
    return `<div class="card-head"><h1>Recipes</h1><button class="btn small" data-action="view" data-view="ingredients">Ingredients</button></div>
      <input type="search" id="recipe-q" placeholder="Search recipes or ingredients" value="${esc(ui.recipeQuery)}">
      <div class="chips">${['', ...TAGS, 'lactose-free'].map(t => `<button class="chip ${ui.recipeTag === t ? 'on' : ''}" data-action="recipe-tag" data-tag="${esc(t)}">${t || 'All'}</button>`).join('')}</div>
      <button class="btn primary wide" data-action="new-recipe">+ New recipe</button>
      <div id="recipe-list">${recipeList()}</div>`;
  }
  function renderIngredients() {
    let html = `<div class="card-head"><h1>Ingredients</h1><button class="btn small" data-action="view" data-view="recipes">‹ Recipes</button></div>
      <p class="muted">Store and aisle decide where each item sits on the shopping list.</p>`;
    for (const store of storeOrder()) {
      const list = sortByName(S.ingredients.filter(i => (i.store || 'Other') === store || (store === 'Other' && !storeOrder().includes(i.store))));
      if (!list.length) continue;
      html += `<div class="store-head"><h2>${esc(store)}</h2></div>` + list.map(i => `<button class="list-row" data-action="edit-ingredient" data-id="${i.id}">
        <span class="grow"><span class="name">${esc(i.name)}</span> ${i.isLocal ? '<span class="badge local">local</span>' : ''}
        <div class="sub">${esc(i.aisle || 'no aisle')} · ${esc(i.defaultUnit || '')}${i.lastPrice != null ? ' · ' + money(i.lastPrice) : ''}</div></span><span class="muted">›</span></button>`).join('');
    }
    return html;
  }

  // ---------- Settings ----------
  function renderSettings() {
    const target = proteinTarget(), ns = notifyState();
    const nsText = { granted: 'On: reminders show while the app is open or in the background.', denied: 'Blocked in Chrome settings. Reminders show on the Today screen instead.',
      default: 'Off. Reminders show on the Today screen.', unsupported: 'Not supported here. Reminders show on the Today screen.' }[ns];
    return `<h1>Settings</h1>
      <div class="card"><h3>Protein</h3>
        <div class="row">${field('Bodyweight (kg)', `<input type="number" inputmode="decimal" step="0.1" data-setting="bodyweightKg" value="${esc(settings.bodyweightKg == null ? '' : settings.bodyweightKg)}">`)}
          ${field('Target (g per kg)', `<input type="number" inputmode="decimal" step="0.1" data-setting="proteinTargetGPerKg" value="${esc(settings.proteinTargetGPerKg)}">`)}</div>
        <p class="muted">${target ? `Daily target: <b>${target} g</b>` : 'Enter your bodyweight to set a daily target.'}</p></div>
      <div class="card"><h3>Reminders</h3>
        <div class="row">${field('Night-before tasks', `<input type="time" data-setting="reminderTimes.evening" value="${esc(settings.reminderTimes.evening)}">`)}
          ${field('Sunday batch cook', `<input type="time" data-setting="reminderTimes.batchCook" value="${esc(settings.reminderTimes.batchCook)}">`)}</div>
        <p class="muted">Notifications: ${nsText}</p>
        ${ns === 'default' ? `<button class="btn wide" data-action="enable-notify">Turn on notifications</button>` : ''}
        <button class="btn wide" data-action="ics">Add the next 7 days to my calendar</button>
        <p class="muted">Android can't wake a closed web app at a set time, so the calendar file is the reliable option: open it with Google Calendar once a week.</p></div>
      <div class="card"><h3>Stores</h3>
        ${field('One per line, in the order you shop', `<textarea rows="5" data-setting="stores">${esc(settings.stores.join('\n'))}</textarea>`)}</div>
      <div class="card"><h3>Data</h3>
        <p class="muted">Everything lives on this phone. Export monthly for the Brad's Fitness project, and before changing phones.</p>
        <button class="btn primary wide" data-action="export">Export (JSON + CSV)</button>
        ${canShare() ? `<button class="btn wide" data-action="share">Share export to Drive…</button>` : ''}
        <label class="btn wide">Import from JSON<input type="file" accept="application/json,.json" data-change="import" hidden></label>
        <p class="muted">Meal Planner ${APP_VERSION} · schema ${SCHEMA_VERSION} · ${S.recipes.length} recipes · ${S.mealLogs.length} meals logged</p></div>`;
  }

  // ---------- modals ----------
  function renderModal() {
    const root = $('#modal'), m = ui.modal;
    if (!m) { root.innerHTML = ''; root.hidden = true; return; }
    const scroll = root.firstChild ? root.firstChild.scrollTop : 0;
    root.hidden = false;
    const inner = (MODALS[m.type] || (() => ''))(m);
    root.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${inner}</div>`;
    root.firstChild.scrollTop = scroll;
  }
  function openModal(m) { ui.modal = m; renderModal(); }
  function closeModal() { ui.modal = null; render(); }
  const cancelBtn = (label = 'Cancel') => `<button class="btn ghost" data-action="close-modal">${label}</button>`;

  const MODALS = {
    menu() {
      return `<div class="menu"><h2>Menu</h2>
        <button class="btn wide" data-action="view" data-view="settings">⚙ Settings</button>
        <button class="btn wide" data-action="export">⬇ Export data</button>
        <label class="btn wide">⬆ Import data<input type="file" accept="application/json,.json" data-change="import" hidden></label>
        <button class="btn wide" data-action="view" data-view="ingredients">Ingredients</button>
        ${cancelBtn('Close')}</div>`;
    },
    slot(m) {
      const plan = viewPlan(ui.week), day = plan.days[m.day];
      const sources = [];
      plan.days.forEach((d, i) => SLOTS.forEach((k, j) => {
        if (i > m.day || (i === m.day && j >= SLOTS.indexOf(m.slot))) return;
        const s = d.slots[k];
        if (s && (s.recipeId || s.text)) sources.push({ v: `${i}|${k}`, label: `${WEEKDAY[i]} ${k}: ${s.recipeId ? (byId('recipes', s.recipeId) || {}).name : s.text}` });
      }));
      const r = m.recipeId && byId('recipes', m.recipeId);
      let body = '';
      if (m.mode === 'recipe') {
        body = field('Recipe', `<select data-m="recipeId" data-rerender><option value="">Choose…</option>${recipeOptions(m.recipeId)}</select>`)
          + (r ? `<p>${lactoseBadge(r)} <span class="muted">${r.proteinPerServingG != null ? r.proteinPerServingG + ' g protein per serving' : 'Protein not set yet'} · recipe makes ${r.servings}</span></p>` : '')
          + `<div class="row">${field('Servings eaten', `<input type="number" inputmode="decimal" step="0.5" min="0.5" data-m="servings" data-type="num" value="${esc(m.servings)}">`)}
            ${field('Servings to cook', `<input type="number" inputmode="decimal" step="1" min="1" data-m="cook" data-type="num" value="${esc(m.cook == null ? '' : m.cook)}" placeholder="${r ? r.servings : ''}">`)}</div>
            <p class="muted">The shopping list buys for the servings cooked. Use Leftovers in later slots for the rest.</p>`;
      } else if (m.mode === 'leftover') {
        body = sources.length ? field('Leftovers from', `<select data-m="src" data-rerender><option value="">Choose…</option>${sources.map(s => `<option value="${s.v}" ${s.v === m.src ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>`)
          + field('Servings eaten', `<input type="number" inputmode="decimal" step="0.5" min="0.5" data-m="servings" data-type="num" value="${esc(m.servings)}">`)
          + `<label class="toggle"><input type="checkbox" data-m="freezer" ${m.freezer ? 'checked' : ''}> Coming from the freezer (reminds you the night before)</label>`
          : `<p class="muted">Nothing earlier in this week to use. Plan the meal it comes from first.</p>`;
      } else if (m.mode === 'text') {
        body = field('What', `<input type="text" data-m="text" value="${esc(m.text)}" placeholder="e.g. Eating out, BBQ at Mum's">`)
          + field('Protein estimate (g, optional)', `<input type="number" inputmode="numeric" data-m="proteinG" data-type="num" value="${esc(m.proteinG == null ? '' : m.proteinG)}">`);
      }
      return `<h2>${WEEKDAY[m.day]} ${SLOT_LABEL[m.slot].toLowerCase()} <span class="muted">${fmtDate(day.date)}</span></h2>
        <div class="seg" style="margin-top:12px">${[['recipe', 'Recipe'], ['leftover', 'Leftovers'], ['text', 'Free text']].map(([k, l]) =>
          `<button class="${m.mode === k ? 'on' : ''}" data-action="modal-pick" data-key="mode" data-value="${k}">${l}</button>`).join('')}</div>
        ${body}
        <div class="row"><button class="btn primary" data-action="save-slot">Save</button>
          ${day.slots[m.slot] ? `<button class="btn danger" data-action="clear-slot">Clear</button>` : ''}${cancelBtn()}</div>`;
    },
    log(m) {
      const r = m.mode === 'recipe' && m.recipeId && byId('recipes', m.recipeId);
      const needsProtein = m.mode === 'text' || (r && r.proteinPerServingG == null);
      return `<h2>${m.extra ? 'Add food' : `Swap ${SLOT_LABEL[m.slot].toLowerCase()}`}</h2>
        ${m.extra ? field('Meal', `<div class="seg">${SLOTS.map(k => `<button class="${m.slot === k ? 'on' : ''}" data-action="modal-pick" data-key="slot" data-value="${k}">${SLOT_LABEL[k]}</button>`).join('')}</div>`) : ''}
        <div class="seg" style="margin-top:12px">${[['recipe', 'Recipe'], ['text', 'Something else']].map(([k, l]) =>
          `<button class="${m.mode === k ? 'on' : ''}" data-action="modal-pick" data-key="mode" data-value="${k}">${l}</button>`).join('')}</div>
        ${m.mode === 'recipe' ? field('Recipe', `<select data-m="recipeId" data-rerender><option value="">Choose…</option>${recipeOptions(m.recipeId)}</select>`)
          : field('What', `<input type="text" data-m="text" value="${esc(m.text)}" placeholder="e.g. Sushi from the food court">`)}
        ${r ? `<p>${lactoseBadge(r)}</p>` : ''}
        <div class="row">${field('Servings', `<input type="number" inputmode="decimal" step="0.5" min="0.5" data-m="servings" data-type="num" value="${esc(m.servings)}">`)}
          ${needsProtein ? field(m.mode === 'text' ? 'Protein estimate (g)' : 'Protein per serving (g)', `<input type="number" inputmode="numeric" data-m="proteinG" data-type="num" value="${esc(m.proteinG == null ? '' : m.proteinG)}">`) : ''}</div>
        ${r && needsProtein ? `<p class="muted">Saved to the recipe for next time.</p>` : ''}
        <div class="row"><button class="btn primary" data-action="save-log">Log it</button>${cancelBtn()}</div>`;
    },
    protein(m) {
      const r = byId('recipes', m.recipeId);
      return `<h2>Protein in ${esc(r.name)}</h2>
        <p class="muted">Not set yet. Enter it once and it's saved to the recipe.</p>
        ${field('Protein per serving (g)', `<input type="number" inputmode="numeric" data-m="proteinG" data-type="num" id="f-focus">`)}
        <div class="row"><button class="btn primary" data-action="save-protein">Save and log</button>${cancelBtn()}</div>`;
    },
    recipe(m) {
      const d = m.draft;
      return `<h2>${m.id ? 'Edit recipe' : 'New recipe'}</h2>
        ${field('Name', `<input type="text" data-m="draft.name" value="${esc(d.name)}">`)}
        <div class="row">${field('Serves', `<input type="number" inputmode="numeric" min="1" data-m="draft.servings" data-type="num" value="${esc(d.servings)}">`)}
          ${field('Protein per serving (g)', `<input type="number" inputmode="numeric" data-m="draft.proteinPerServingG" data-type="num" value="${esc(d.proteinPerServingG == null ? '' : d.proteinPerServingG)}">`)}</div>
        ${field('Lactose', `<div class="seg">${Object.keys(LACTOSE).map(k => `<button class="${d.lactose === k ? 'on' : ''}" data-action="modal-pick" data-key="draft.lactose" data-value="${k}">${k === 'none' ? 'None' : k === 'low' ? 'Low' : 'Contains'}</button>`).join('')}</div>`)}
        ${field('Tags', `<div class="tags">${TAGS.map(t => `<button class="chip ${d.tags.includes(t) ? 'on' : ''}" data-action="toggle-tag" data-tag="${esc(t)}">${t}</button>`).join('')}</div>`)}
        <div class="field"><span>Ingredients (for the whole recipe)</span>
          ${d.ingredients.map((x, i) => `<div class="ing-row">
            <input type="text" list="ing-names" data-m="draft.ingredients.${i}.name" data-rerender value="${esc(x.name)}" placeholder="Ingredient">
            <input type="number" inputmode="decimal" data-m="draft.ingredients.${i}.qty" data-type="num" value="${esc(x.qty == null ? '' : x.qty)}" placeholder="Qty">
            <input type="text" data-m="draft.ingredients.${i}.unit" value="${esc(x.unit)}" placeholder="g">
            <button class="x" data-action="del-ing" data-i="${i}" aria-label="Remove">✕</button></div>`).join('')}
          <button class="btn small" data-action="add-ing">+ Ingredient</button>
          <p class="muted">Units: g, kg, ml, L, or anything else (each, tin, pack). New names create a new ingredient.</p></div>
        ${field('Method', `<textarea rows="4" data-m="draft.method">${esc(d.method)}</textarea>`)}
        ${ingDatalist()}
        <div class="row"><button class="btn primary" data-action="save-recipe">Save</button>
          ${m.id ? `<button class="btn danger" data-action="delete-recipe">Delete</button>` : ''}${cancelBtn()}</div>`;
    },
    ingredient(m) {
      const d = m.draft;
      return `<h2>${esc(d.name || 'Ingredient')}</h2>
        ${field('Name', `<input type="text" data-m="draft.name" value="${esc(d.name)}">`)}
        <div class="row">${field('Store', storeSelect('draft.store', d.store))}
          ${field('Aisle', `<input type="text" list="aisles" data-m="draft.aisle" value="${esc(d.aisle)}">`)}</div>
        <div class="row">${field('Default unit', `<input type="text" data-m="draft.defaultUnit" value="${esc(d.defaultUnit)}">`)}
          ${field('Last price ($)', `<input type="number" inputmode="decimal" step="0.01" data-m="draft.lastPrice" data-type="num" value="${esc(d.lastPrice == null ? '' : d.lastPrice)}">`)}</div>
        <label class="toggle"><input type="checkbox" data-m="draft.isLocal" ${d.isLocal ? 'checked' : ''}> Local (bought from a local producer)</label>
        ${aisleList()}
        <div class="row"><button class="btn primary" data-action="save-ingredient">Save</button>
          <button class="btn danger" data-action="delete-ingredient">Delete</button>${cancelBtn()}</div>`;
    },
    item(m) {
      const d = m.draft, ing = d.ingredientId && byId('ingredients', d.ingredientId);
      return `<h2>${m.id ? esc(ing ? ing.name : d.text) : 'Add to list'}</h2>
        ${ing ? '' : field('Item', `<input type="text" list="ing-names" data-m="draft.text" value="${esc(d.text)}" placeholder="e.g. Dishwashing liquid">`)}
        <div class="row">${field('Qty', `<input type="number" inputmode="decimal" data-m="draft.qty" data-type="num" value="${esc(d.qty == null ? '' : d.qty)}">`)}
          ${field('Unit', `<input type="text" data-m="draft.unit" value="${esc(d.unit)}">`)}
          ${field('Price ($)', `<input type="number" inputmode="decimal" step="0.01" data-m="draft.price" data-type="num" value="${esc(d.price == null ? '' : d.price)}">`)}</div>
        <div class="row">${field('Store', storeSelect('draft.store', d.store))}
          ${field('Aisle', `<input type="text" list="aisles" data-m="draft.aisle" value="${esc(d.aisle)}">`)}</div>
        <label class="toggle"><input type="checkbox" data-m="draft.isLocal" ${d.isLocal ? 'checked' : ''}> Local</label>
        ${ing ? `<p class="muted">Store, aisle and local are saved to the ingredient, so future lists use them. For: ${esc(d.forRecipes || '')}</p>` : ''}
        ${ingDatalist()}${aisleList()}
        <div class="row"><button class="btn primary" data-action="save-item">Save</button>
          ${m.id ? `<button class="btn danger" data-action="delete-item">Remove</button>` : ''}${cancelBtn()}</div>`;
    },
    pantry(m) {
      const d = m.draft;
      return `<h2>${m.id ? esc(ingName(d.ingredientId)) : 'Add pantry item'}</h2>
        ${m.id ? '' : field('Item', `<input type="text" list="ing-names" data-m="draft.name" data-rerender value="${esc(d.name)}" placeholder="e.g. Rolled oats">`)}
        <div class="row">${field('Qty on hand', `<input type="number" inputmode="decimal" data-m="draft.qty" data-type="num" value="${esc(d.qty == null ? '' : d.qty)}">`)}
          ${field('Unit', `<input type="text" data-m="draft.unit" value="${esc(d.unit)}">`)}</div>
        ${ingDatalist()}
        <div class="row"><button class="btn primary" data-action="save-pantry">Save</button>
          ${m.id ? `<button class="btn danger" data-action="delete-pantry">Remove</button>` : ''}${cancelBtn()}</div>`;
    },
    eggs() {
      return `<h2>Eggs collected</h2><div class="grid4">${[1, 2, 3, 4, 5, 6, 8, 12].map(n => `<button class="btn" data-action="add-eggs" data-n="${n}">${n}</button>`).join('')}</div>${cancelBtn()}`;
    },
    templates() {
      const list = templates();
      return `<h2>Use a template</h2><p class="muted">Replaces the week of ${fmtDate(ui.week)}.</p>
        ${list.length ? list.map(t => `<div class="row" style="align-items:center"><button class="btn" style="flex:3" data-action="apply-template" data-id="${t.id}">${esc(t.templateName)}</button>
          <button class="btn ghost danger" data-action="delete-template" data-id="${t.id}">Delete</button></div>`).join('') : '<p>No templates yet. Plan a week, then Save as template.</p>'}
        <div class="row">${cancelBtn()}</div>`;
    },
    saveTemplate(m) {
      return `<h2>Save week as template</h2>
        ${field('Name', `<input type="text" data-m="name" value="${esc(m.name)}" placeholder="e.g. Standard week">`)}
        <p class="muted">A template with the same name is replaced.</p>
        <div class="row"><button class="btn primary" data-action="save-template-ok">Save</button>${cancelBtn()}</div>`;
    },
  };

  // Hooks for modal fields whose change affects other fields; returns true if the sheet needs redrawing.
  function onModalChange(key) {
    const m = ui.modal;
    if (m.type === 'slot' && key === 'recipeId') { m.cook = null; return true; }
    if (m.type === 'slot' && key === 'src' && m.src) {
      const [d, k] = m.src.split('|'), s = viewPlan(ui.week).days[d].slots[k], r = s && s.recipeId && byId('recipes', s.recipeId);
      m.freezer = !!(r && r.tags.includes('batch') && m.day - Number(d) >= 3);
      return true;
    }
    if (m.type === 'recipe' && /^draft\.ingredients\.\d+\.name$/.test(key)) {
      const row = getPath(m, key.replace(/\.name$/, '')), ing = ingByName(row.name);
      if (ing && !row.unit) { row.unit = ing.defaultUnit || ''; return true; }
    }
    if (m.type === 'pantry' && key === 'draft.name') {
      const ing = ingByName(m.draft.name);
      if (ing && !m.draft.unit) { m.draft.unit = ing.defaultUnit || ''; return true; }
    }
    return false;
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => o[k], obj); }
  function setPath(obj, path, v) { const ks = path.split('.'), last = ks.pop(); ks.reduce((o, k) => o[k], obj)[last] = v; }

  // ---------- actions ----------
  function startEat(slot) {
    const { plan, i } = locateDay(ui.date), r = resolveSlot(plan, i, slot);
    if (!r) return;
    if (r.recipe && r.recipe.proteinPerServingG == null) return openModal({ type: 'protein', recipeId: r.recipe.id, then: { slot, servings: r.servings, planned: true }, proteinG: null });
    addLog({ slot, recipeId: r.recipe ? r.recipe.id : null, text: r.recipe ? null : r.label, servings: r.servings, proteinG: r.protein, planned: true });
    render();
  }
  function shakeRecipe() { return S.recipes.find(r => r.isShake) || S.recipes.find(r => /shake/i.test(r.name)); }

  const actions = {
    view(el) { ui.view = el.dataset.view; ui.modal = null; if (ui.view === 'today') ui.date = ui.today; render(); window.scrollTo(0, 0); },
    menu() { openModal({ type: 'menu' }); },
    'close-modal'() { closeModal(); },
    'modal-pick'(el) {
      const v = el.dataset.value;
      setPath(ui.modal, el.dataset.key, v);
      renderModal();
    },

    // Today
    day(el) { const d = Number(el.dataset.d); ui.date = d ? addDays(ui.date, d) : ui.today; render(); },
    'goto-week'() { ui.week = mondayOf(ui.date); ui.view = 'week'; render(); },
    eat(el) { startEat(el.dataset.slot); },
    swap(el) { openModal({ type: 'log', slot: el.dataset.slot, extra: false, mode: 'recipe', recipeId: '', text: '', servings: 1, proteinG: null }); },
    'add-food'() {
      const h = new Date().getHours();
      openModal({ type: 'log', slot: h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 19 ? 'dinner' : 'snack', extra: true, mode: 'text', recipeId: '', text: '', servings: 1, proteinG: null });
    },
    shake() {
      const r = shakeRecipe();
      if (!r) return toast('Add a recipe with "shake" in the name first');
      if (r.proteinPerServingG == null) return openModal({ type: 'protein', recipeId: r.id, then: { slot: 'snack', servings: 1, planned: false, extra: true }, proteinG: null });
      addLog({ slot: 'snack', recipeId: r.id, servings: 1, proteinG: r.proteinPerServingG, extra: true });
      toast(`Shake logged: ${r.proteinPerServingG} g`); render();
    },
    'save-protein'() {
      const m = ui.modal, r = byId('recipes', m.recipeId);
      if (!(m.proteinG >= 0) || m.proteinG === null) return toast('Enter the protein per serving');
      r.proteinPerServingG = m.proteinG; put('recipes', r);
      addLog({ ...m.then, recipeId: r.id, proteinG: round(m.proteinG * m.then.servings) });
      closeModal();
    },
    'save-log'() {
      const m = ui.modal, n = Number(m.servings) || 1;
      let fields;
      if (m.mode === 'recipe') {
        const r = byId('recipes', m.recipeId);
        if (!r) return toast('Choose a recipe');
        if (r.proteinPerServingG == null) {
          if (m.proteinG == null) return toast('Enter the protein per serving');
          r.proteinPerServingG = m.proteinG; put('recipes', r);
        }
        fields = { recipeId: r.id, proteinG: round(r.proteinPerServingG * n) };
      } else {
        if (!String(m.text || '').trim()) return toast('Say what you ate');
        fields = { text: m.text.trim(), proteinG: m.proteinG };
      }
      addLog({ ...fields, slot: m.slot, servings: n, planned: false, extra: m.extra });
      closeModal();
    },
    'undo-log'(el) { remove('mealLogs', el.dataset.id); render(); },

    // Week
    week(el) { const d = Number(el.dataset.d); ui.week = d ? addDays(ui.week, d) : mondayOf(ui.today); render(); },
    'cycle-training'(el) {
      const plan = viewPlan(ui.week), d = plan.days[el.dataset.day];
      d.training = TRAINING_ORDER[(TRAINING_ORDER.indexOf(d.training) + 1) % TRAINING_ORDER.length];
      put('weekPlans', plan); render();
    },
    'edit-slot'(el) {
      const day = Number(el.dataset.day), slot = el.dataset.slot, s = viewPlan(ui.week).days[day].slots[slot] || {};
      openModal({
        type: 'slot', day, slot, mode: s.leftoverOf ? 'leftover' : s.text != null ? 'text' : 'recipe',
        recipeId: s.recipeId || '', servings: s.servings || 1, cook: s.cook || null,
        src: s.leftoverOf ? `${s.leftoverOf.day}|${s.leftoverOf.slot}` : '', freezer: !!s.freezer, text: s.text || '', proteinG: s.proteinG == null ? null : s.proteinG,
      });
    },
    'save-slot'() {
      const m = ui.modal, plan = viewPlan(ui.week);
      let v;
      if (m.mode === 'recipe') {
        if (!m.recipeId) return toast('Choose a recipe');
        v = { recipeId: m.recipeId, servings: Number(m.servings) || 1, cook: m.cook || null };
      } else if (m.mode === 'leftover') {
        if (!m.src) return toast('Choose where the leftovers come from');
        const [d, k] = m.src.split('|');
        v = { leftoverOf: { day: Number(d), slot: k }, servings: Number(m.servings) || 1, freezer: !!m.freezer };
      } else {
        if (!String(m.text || '').trim()) return toast('Type what the meal is');
        v = { text: m.text.trim(), proteinG: m.proteinG };
      }
      plan.days[m.day].slots[m.slot] = v;
      put('weekPlans', plan); closeModal();
    },
    'clear-slot'() {
      const m = ui.modal, plan = viewPlan(ui.week);
      delete plan.days[m.day].slots[m.slot];
      put('weekPlans', plan); closeModal();
    },
    'copy-last'() {
      const prev = planFor(addDays(ui.week, -7));
      if (!prev || planIsEmpty(prev)) return toast('Nothing planned last week');
      if (!planIsEmpty(viewPlan(ui.week)) && !confirm('Replace this week with last week\'s plan?')) return;
      applyDays(ui.week, prev.days); render(); toast('Copied last week');
    },
    'use-template'() { openModal({ type: 'templates' }); },
    'apply-template'(el) {
      const t = byId('weekPlans', el.dataset.id);
      if (!planIsEmpty(viewPlan(ui.week)) && !confirm(`Replace this week with "${t.templateName}"?`)) return;
      applyDays(ui.week, t.days); closeModal(); toast(`Applied ${t.templateName}`);
    },
    'delete-template'(el) {
      const t = byId('weekPlans', el.dataset.id);
      if (!confirm(`Delete the template "${t.templateName}"?`)) return;
      remove('weekPlans', t.id); renderModal();
    },
    'save-template'() {
      if (planIsEmpty(viewPlan(ui.week))) return toast('Plan the week first');
      openModal({ type: 'saveTemplate', name: '' });
    },
    'save-template-ok'() {
      const name = String(ui.modal.name || '').trim();
      if (!name) return toast('Give it a name');
      const existing = templates().find(t => t.templateName.toLowerCase() === name.toLowerCase());
      const t = existing || { weekStart: null, templateName: name };
      t.days = viewPlan(ui.week).days.map(d => ({ date: null, training: d.training, slots: clone(d.slots) }));
      put('weekPlans', t); closeModal(); toast(`Saved template "${name}"`);
    },
    generate() {
      if (planIsEmpty(viewPlan(ui.week))) return toast('Plan the week first');
      const n = generateShopping(ui.week);
      ui.shopWeek = ui.week; ui.view = 'shop'; render(); window.scrollTo(0, 0);
      toast(`${n} items on the list`);
    },

    // Shop
    'shop-week'(el) { ui.shopWeek = addDays(ui.shopWeek, Number(el.dataset.d)); render(); },
    regenerate() {
      if (!planFor(ui.shopWeek)) return toast('Nothing planned that week');
      const n = generateShopping(ui.shopWeek); render(); toast(`${n} items, ticks kept`);
    },
    'hide-ticked'() { ui.hideTicked = !ui.hideTicked; render(); },
    tick(el) {
      const it = byId('shoppingItems', el.dataset.id);
      it.checked = !it.checked; put('shoppingItems', it);
      if (navigator.vibrate) try { navigator.vibrate(15); } catch (e) { /* ignore */ }
      render();
    },
    'add-item'() {
      openModal({ type: 'item', id: null, draft: { text: '', qty: null, unit: '', price: null, store: settings.stores[settings.stores.length - 1] || '', aisle: '', isLocal: false } });
    },
    'edit-item'(el) {
      const it = byId('shoppingItems', el.dataset.id), x = itemInfo(it);
      openModal({ type: 'item', id: it.id, draft: { ...clone(it), store: x.store, aisle: x.aisle, isLocal: x.isLocal } });
    },
    'save-item'() {
      const m = ui.modal, d = m.draft;
      const it = m.id ? byId('shoppingItems', m.id) : { weekStart: ui.shopWeek, manual: true, checked: false, ingredientId: null };
      const ing = it.ingredientId && byId('ingredients', it.ingredientId);
      if (!ing && !String(d.text || '').trim()) return toast('What do you need?');
      Object.assign(it, { qty: d.qty, unit: d.unit, price: d.price });
      if (ing) {
        Object.assign(ing, { store: d.store, aisle: d.aisle, isLocal: !!d.isLocal });
        if (d.price != null) ing.lastPrice = d.price;
        put('ingredients', ing);
      } else {
        // A typed name that matches an ingredient takes that ingredient's details.
        const known = ingByName(d.text);
        Object.assign(it, known ? { ingredientId: known.id, text: null } : { text: d.text.trim(), store: d.store, aisle: d.aisle, isLocal: !!d.isLocal });
        if (known && d.price != null) { known.lastPrice = d.price; put('ingredients', known); }
      }
      put('shoppingItems', it); closeModal();
    },
    'delete-item'() { remove('shoppingItems', ui.modal.id); closeModal(); },

    // Pantry
    'pantry-step'(el) {
      const p = byId('pantryItems', el.dataset.id);
      p.qty = Math.max(0, round((Number(p.qty) || 0) + Number(el.dataset.d), 2)); put('pantryItems', p); render();
    },
    'edit-pantry'(el) { const p = byId('pantryItems', el.dataset.id); openModal({ type: 'pantry', id: p.id, draft: clone(p) }); },
    'add-pantry'() { openModal({ type: 'pantry', id: null, draft: { name: '', qty: null, unit: '' } }); },
    'save-pantry'() {
      const m = ui.modal, d = m.draft;
      if (m.id) { const p = byId('pantryItems', m.id); Object.assign(p, { qty: d.qty || 0, unit: d.unit }); put('pantryItems', p); return closeModal(); }
      const name = String(d.name || '').trim();
      if (!name) return toast('Which item?');
      let ing = ingByName(name);
      if (!ing) { ing = { name, defaultUnit: d.unit || 'each', store: settings.stores[settings.stores.length - 1] || '', aisle: '', isLocal: false, lastPrice: null }; put('ingredients', ing); }
      const unit = d.unit || ing.defaultUnit || 'each';
      if (S.pantryItems.some(p => p.ingredientId === ing.id)) pantryAdd(ing.id, d.qty || 0, unit);
      else put('pantryItems', { ingredientId: ing.id, qty: d.qty || 0, unit });
      closeModal();
    },
    'delete-pantry'() { remove('pantryItems', ui.modal.id); closeModal(); },
    baked() { const ing = homeIngredient('sourdough', 'Sourdough', 'loaf'); pantryAdd(ing.id, 1, 'loaf'); toast('+1 sourdough loaf'); render(); },
    eggs() { openModal({ type: 'eggs' }); },
    'add-eggs'(el) { const ing = homeIngredient('eggs', 'Eggs', 'each'); pantryAdd(ing.id, Number(el.dataset.n), 'each'); toast(`+${el.dataset.n} eggs`); closeModal(); },

    // Recipes
    'recipe-tag'(el) { ui.recipeTag = el.dataset.tag; render(); },
    'new-recipe'() {
      openModal({ type: 'recipe', id: null, draft: { name: '', servings: 1, proteinPerServingG: null, lactose: 'none', tags: [], method: '', ingredients: [{ name: '', qty: null, unit: '' }] } });
    },
    'edit-recipe'(el) {
      const r = byId('recipes', el.dataset.id);
      const draft = { ...clone(r), ingredients: r.ingredients.map(x => ({ name: ingName(x.ingredientId), qty: x.qty, unit: x.unit })) };
      openModal({ type: 'recipe', id: r.id, draft });
    },
    'toggle-tag'(el) {
      const tags = ui.modal.draft.tags, t = el.dataset.tag;
      ui.modal.draft.tags = tags.includes(t) ? tags.filter(x => x !== t) : [...tags, t];
      renderModal();
    },
    'add-ing'() { ui.modal.draft.ingredients.push({ name: '', qty: null, unit: '' }); renderModal(); },
    'del-ing'(el) { ui.modal.draft.ingredients.splice(Number(el.dataset.i), 1); renderModal(); },
    'save-recipe'() {
      const m = ui.modal, d = m.draft;
      if (!String(d.name || '').trim()) return toast('Give the recipe a name');
      let created = 0;
      const ingredients = d.ingredients.filter(x => String(x.name || '').trim()).map(x => {
        let ing = ingByName(x.name);
        if (!ing) {
          ing = { name: x.name.trim(), defaultUnit: x.unit || 'g', store: settings.stores[settings.stores.length - 1] || '', aisle: '', isLocal: false, lastPrice: null };
          put('ingredients', ing); created++;
        }
        return { ingredientId: ing.id, qty: Number(x.qty) || 0, unit: (x.unit || ing.defaultUnit || '').trim() };
      });
      const r = m.id ? byId('recipes', m.id) : {};
      Object.assign(r, { name: d.name.trim(), servings: Number(d.servings) || 1, proteinPerServingG: d.proteinPerServingG, lactose: d.lactose, tags: d.tags, method: d.method || '', ingredients });
      put('recipes', r); closeModal();
      if (created) toast(`${created} new ingredient${created > 1 ? 's' : ''}: set the store in Ingredients`);
    },
    'delete-recipe'() {
      const id = ui.modal.id;
      const used = S.weekPlans.some(p => p.days.some(d => Object.values(d.slots).some(s => s.recipeId === id)));
      if (!confirm(used ? 'This recipe is in a week plan or template. Delete it anyway?' : 'Delete this recipe?')) return;
      remove('recipes', id); closeModal();
    },
    'edit-ingredient'(el) { const i = byId('ingredients', el.dataset.id); openModal({ type: 'ingredient', id: i.id, draft: clone(i) }); },
    'save-ingredient'() {
      const m = ui.modal, d = m.draft, i = byId('ingredients', m.id);
      if (!String(d.name || '').trim()) return toast('Name it');
      const clash = ingByName(d.name);
      if (clash && clash.id !== i.id) return toast('Another ingredient already has that name');
      Object.assign(i, { name: d.name.trim(), store: d.store, aisle: (d.aisle || '').trim(), defaultUnit: (d.defaultUnit || '').trim(), lastPrice: d.lastPrice, isLocal: !!d.isLocal });
      put('ingredients', i); closeModal();
    },
    'delete-ingredient'() {
      const id = ui.modal.id;
      if (S.recipes.some(r => r.ingredients.some(x => x.ingredientId === id)) || S.pantryItems.some(p => p.ingredientId === id))
        return toast('Used in a recipe or the pantry; remove it there first');
      if (!confirm('Delete this ingredient?')) return;
      remove('ingredients', id); closeModal();
    },

    // Settings & data
    async 'enable-notify'() {
      try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
      render(); checkReminders();
    },
    ics() {
      const { text, n } = remindersIcs();
      if (!n) return toast('No reminders in the next 7 days');
      download(`meal-planner-reminders-${ui.today}.ics`, text, 'text/calendar'); toast(`${n} reminders exported`);
    },
    export() { exportFiles().forEach((f, i) => setTimeout(() => download(f.name, f.text, f.type), i * 400)); toast('Exporting 3 files'); },
    async share() {
      try { await navigator.share({ files: shareFiles(), title: `Meal Planner export ${ui.today}` }); }
      catch (e) { if (e.name !== 'AbortError') toast('Share failed: ' + e.message); }
    },
  };

  // ---------- toast ----------
  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }

  // ---------- events ----------
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (el && !el.disabled && actions[el.dataset.action]) actions[el.dataset.action](el, e);
    else if (e.target.id === 'modal') closeModal();
  });
  function onField(e) {
    const el = e.target;
    if (el.dataset.m && ui.modal) {
      const v = el.type === 'checkbox' ? el.checked : el.dataset.type === 'num' ? (el.value === '' ? null : Number(el.value)) : el.value;
      setPath(ui.modal, el.dataset.m, v);
      // Selects always redraw the sheet; text fields only when a hook filled in another field.
      // Redraw after the tap that caused the change has moved focus, then put focus back.
      if (e.type === 'change' && el.dataset.rerender !== undefined && (onModalChange(el.dataset.m) || el.tagName === 'SELECT')) {
        setTimeout(() => {
          const f = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.m : null;
          renderModal();
          const back = f && document.querySelector(`#modal [data-m="${f}"]`);
          if (back) back.focus();
        });
      }
    } else if (el.id === 'recipe-q') {
      ui.recipeQuery = el.value; $('#recipe-list').innerHTML = recipeList();
    }
  }
  document.addEventListener('input', onField);
  document.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.change === 'import' && el.files[0]) { importFile(el.files[0]); el.value = ''; return; }
    if (el.dataset.setting) {
      const k = el.dataset.setting;
      let v = el.value.trim();
      if (k === 'stores') v = v.split('\n').map(s => s.trim()).filter(Boolean);
      else if (el.type === 'number') v = v === '' ? null : Number(v);
      if (k === 'proteinTargetGPerKg' && !(v > 0)) v = DEFAULT_SETTINGS.proteinTargetGPerKg;
      setPath(settings, k, v); saveSettings(); render();
      return;
    }
    onField(e);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const t = todayStr();
    if (t !== ui.today) { if (ui.date === ui.today) ui.date = t; ui.today = t; if (!ui.modal) render(); }
    checkReminders();
  });

  // ---------- start ----------
  (async () => {
    try {
      db = await openDb();
      if (!(await getAll('settings')).length) await seed();
      await loadAll();
    } catch (e) {
      $('#app').innerHTML = `<div class="card"><h2>Can't open storage</h2><p class="muted">${esc(e.message)}</p></div>`;
      return;
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    render();
    checkReminders();
    setInterval(checkReminders, 30000);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  })();
})();

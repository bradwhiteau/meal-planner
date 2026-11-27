// Meal Planner regression tests. Open tests.html on localhost and press Run (or add ?auto to run on load).
// Every scenario starts the real app fresh in a frame, in test mode (index.html?test=1): its own database
// (meal-planner-test), its own storage keys, no service worker, and Google Drive faked. Real data is never touched.
//
// When a bug is found, add a scenario (or a check) for it here, so it can't come back unnoticed.
(() => {
  'use strict';
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function until(fn, ms = 3000, what = 'condition') {
    const t = Date.now();
    for (;;) {
      try { const v = fn(); if (v) return v; } catch (e) { /* keep waiting */ }
      if (Date.now() - t > ms) throw new Error('Timed out waiting for ' + what);
      await sleep(25);
    }
  }

  // ---------- dates and fixtures ----------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const monday = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })();
  const day = n => { const d = new Date(monday); d.setDate(d.getDate() + n); return ymd(d); };   // day(0) = this Monday
  const NOW = new Date().toISOString();
  const mk = (id, o) => ({ id, createdAt: NOW, updatedAt: NOW, ...o });
  // A week plan: slotsByDay = { 0: { dinner: {...} }, ... } with 0 = Monday.
  const weekPlan = (id, offset, slotsByDay) => mk(id, {
    weekStart: day(offset * 7),
    days: Array.from({ length: 7 }, (_, i) => ({ date: day(offset * 7 + i), training: 'rest', slots: slotsByDay[i] || {} })),
  });
  // What the plan cooks for a meal's first item (slotCook is keyed date|meal|item id).
  const cookAt = (slotCook, date, k) => { const e = Object.entries(slotCook).find(([key]) => key.startsWith(`${date}|${k}|`)); return e ? e[1] : undefined; };
  let patchN = 0;
  const patch = (upserts, extra = {}) => ({ app: 'meal-planner', schemaVersion: 1, kind: 'patch', patchId: 'test-' + (++patchN) + '-' + Date.now(), upserts, ...extra });

  // ---------- the app under test ----------
  let frame;
  async function freshApp() {
    if (frame) frame.remove();
    await new Promise(res => { const q = indexedDB.deleteDatabase('meal-planner-test'); q.onsuccess = q.onerror = q.onblocked = res; });
    Object.keys(localStorage).filter(k => k.startsWith('mpt.')).forEach(k => localStorage.removeItem(k));
    frame = document.createElement('iframe');
    frame.src = 'index.html?test=1&t=' + Date.now();
    document.getElementById('stage').appendChild(frame);
    await until(() => frame.contentWindow.__mp && frame.contentWindow.__mp.ready, 10000, 'the app to start');
    const w = frame.contentWindow, errors = [];
    w.addEventListener('error', e => errors.push(e.message));
    w.addEventListener('unhandledrejection', e => errors.push(String(e.reason && e.reason.message || e.reason)));
    w.confirm = () => true; w.alert = () => {};
    return ctxFor(w, errors);
  }

  function ctxFor(w, errors) {
    const d = w.document, $ = s => d.querySelector(s), $$ = s => [...d.querySelectorAll(s)];
    const c = {
      w, d, $, $$, errors,
      async click(target, wait = 80) {
        const el = typeof target === 'string' ? await until(() => $(target), 2500, target) : target;
        el.click(); await sleep(wait);
      },
      async set(sel, v) {
        const el = await until(() => $(sel), 2500, sel);
        el.value = v;
        el.dispatchEvent(new w.Event('input', { bubbles: true }));
        el.dispatchEvent(new w.Event('change', { bubbles: true }));
        await sleep(40);
      },
      async untick(sel) {
        const el = await until(() => $(sel), 2500, sel);
        el.checked = false;
        el.dispatchEvent(new w.Event('change', { bubbles: true }));
        await sleep(40);
      },
      async tab(view) { await c.click(`.tabs [data-view="${view}"]`); },
      async settings() { await c.click('[data-action="menu"]', 40); await c.click('#modal [data-view="settings"]'); },
      async importJson(obj, name = 'test.json') {
        await c.click('[data-action="menu"]', 40);
        const input = await until(() => $('#modal input[data-change="import"]'), 2500, 'import');
        const dt = new w.DataTransfer();
        dt.items.add(new w.File([JSON.stringify(obj)], name, { type: 'application/json' }));
        input.files = dt.files;
        input.dispatchEvent(new w.Event('change', { bubbles: true }));
        await sleep(400);
        if (!$('#modal').hidden && $('[data-action="close-modal"]')) $('[data-action="close-modal"]').click();
        await sleep(40);
      },
      toast: () => $('#toast').textContent,
      modalText: () => ($('#modal').hidden ? '' : $('#modal').innerText.replace(/\s*\n\s*/g, ' | ')),
      all: store => new Promise((res, rej) => {
        const q = w.indexedDB.open('meal-planner-test');
        q.onsuccess = () => { const g = q.result.transaction(store).objectStore(store).getAll(); g.onsuccess = () => { q.result.close(); res(g.result); }; };
        q.onerror = () => rej(q.error);
      }),
      // The Larder as sorted lines: "rice:1.5kg@Fridge", "🍲bol×4@Freezer".
      async larder() {
        return (await c.all('pantryItems')).map(p => p.recipeId
          ? `🍲${p.recipeId}×${p.qty}@${p.location || ''}`
          : `${p.ingredientId}:${p.qty}${p.unit}@${p.location || ''}`).sort();
      },
      async go(date) { w.__mp.go(date); await sleep(60); },
      async week(weekStart) { w.__mp.week(weekStart); await sleep(60); },
      async shop(weekStart) { w.__mp.shop(weekStart); await sleep(60); },
      // A Larder location panel (opened, so its rows are visible).
      loc(name) {
        const el = $$('.larder-loc').find(x => x.querySelector('.loc-name').innerText.trim() === name);
        if (el && !el.open) el.open = true;
        return el;
      },
      card: slot => $$('.card.meal').find(x => x.querySelector('.slot-label').innerText.trim().toLowerCase() === slot),
      // A shopping-list line, by name (its store is opened if folded, so the text shows).
      shopRow: name => {
        const r = $$('.shop-row').find(r => r.textContent.includes(name)), st = r && r.closest('.shop-store');
        if (st && !st.open) st.open = true;
        return r;
      },
      store: name => $$('.shop-store').find(x => x.dataset.store === name),
      shopText: name => { const r = c.shopRow(name); return r ? r.innerText.replace(/\s*\n\s*/g, ' | ') : '(no line)'; },
    };
    return c;
  }

  // Fake Google sign-in and Drive inside the app's frame. Any other network call is recorded as unexpected.
  function fakeDrive(c, files = []) {
    const w = c.w, fs = { files: {}, n: 0, writes: [], unexpected: [], perms: [] };
    w.MP_CONFIG.authServer = '';   // never the real sign-in helper; its own scenario sets a fake one
    const add = (parent, name, text, ownedByApp = false, id = null, folder = false) => {
      id = id || 'file' + String(++fs.n).padStart(8, '0');
      fs.files[id] = { id, name, parent, text, mod: new Date(Date.now() + Object.keys(fs.files).length).toISOString(), ownedByApp, folder };
      return id;
    };
    files.forEach(f => add(f.parent, f.name, f.folder ? '' : typeof f.text === 'string' ? f.text : JSON.stringify(f.text), !!f.ownedByApp, f.id, !!f.folder));
    w.google = { accounts: { oauth2: {
      initTokenClient: cfg => ({ requestAccessToken: () => setTimeout(() => cfg.callback({ access_token: 'fake-token', expires_in: 3600 }), 10) }),
      hasGrantedAllScopes: () => true,
    } } };
    const realFetch = w.fetch.bind(w);
    w.fetch = async (url, opts = {}) => {
      url = String(url);
      const json = (o, status = 200) => new w.Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.startsWith('https://accounts.google.com/')) return new w.Response('', { status: 200 });
      if (!url.includes('googleapis.com')) {
        if (/^https?:/.test(url) && !url.startsWith(w.location.origin)) { fs.unexpected.push(url); return json({}, 500); }
        return realFetch(url, opts);
      }
      if ((opts.headers || {}).Authorization !== 'Bearer fake-token') return json({ error: { message: 'no auth' } }, 401);
      const u = new URL(url), q = u.searchParams.get('q') || '';
      let m;
      if (u.pathname === '/drive/v3/about') return json({ user: { emailAddress: 'test@example.com' } });   // which account is signed in
      if (u.pathname === '/drive/v3/files' && q) {
        if ((m = q.match(/'([^']+)' in parents/))) {
          return json({ files: Object.values(fs.files).filter(f => f.parent === m[1])
            .map(f => ({ id: f.id, name: f.name, size: String(f.text.length), modifiedTime: f.mod, mimeType: 'application/json' })) });
        }
        if ((m = q.match(/name = '([^']+)' and mimeType = 'application\/vnd.google-apps.folder'/))) {
          return json({ files: Object.values(fs.files).filter(f => f.folder && f.name === m[1] && f.parent !== 'TRASH').map(f => ({ id: f.id, name: f.name, modifiedTime: f.mod })) });
        }
        return json({ files: [] });
      }
      if (u.pathname === '/drive/v3/files' && opts.method === 'POST') {   // a new folder
        const meta = JSON.parse(opts.body), id = add(null, meta.name, '', true, null, true);
        fs.writes.push('create folder ' + meta.name); return json({ id });
      }
      if ((m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)\/permissions$/)) && opts.method === 'POST') {
        const b = JSON.parse(opts.body); fs.perms.push(`${m[1]} ${b.role} ${b.emailAddress}`); return json({ id: 'perm1' });
      }
      if ((m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/)) && u.searchParams.get('alt') === 'media') return new w.Response(fs.files[m[1]].text);
      if ((m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/)) && opts.method === 'PATCH') {
        const f = fs.files[m[1]]; if (!f.ownedByApp) return json({}, 403);
        if (JSON.parse(opts.body).trashed) f.parent = 'TRASH';
        fs.writes.push('trash ' + f.name); return json({ id: f.id });
      }
      if ((m = u.pathname.match(/^\/upload\/drive\/v3\/files\/(\w+)$/)) && opts.method === 'PATCH') {
        const f = fs.files[m[1]]; if (!f.ownedByApp) return json({}, 403);
        f.text = opts.body; f.mod = new Date().toISOString(); fs.writes.push('update ' + f.name); return json({ id: f.id });
      }
      if (u.pathname === '/upload/drive/v3/files' && opts.method === 'POST') {
        const parts = opts.body.split('\r\n\r\n'), meta = JSON.parse(parts[1].split('\r\n')[0]);
        const id = add(meta.parents[0], meta.name, parts.slice(2).join('\r\n\r\n').replace(/\r\n--[^\r\n]*--$/, ''), true);
        fs.writes.push('create ' + meta.name); return json({ id });
      }
      fs.unexpected.push((opts.method || 'GET') + ' ' + url);
      return json({ error: { message: 'unhandled' } }, 500);
    };
    fs.add = add;
    fs.find = name => Object.values(fs.files).find(f => f.name === name && f.parent !== 'TRASH');
    fs.json = name => { const f = fs.find(name); return f ? JSON.parse(f.text) : null; };
    return fs;
  }
  const INBOX = 'INBOXfolder00001', OUTBOX = 'OUTBOXfolder0001', SHARED = 'SHAREDfolder0001';

  // ---------- checks ----------
  function checker() {
    const list = [];
    const show = v => (typeof v === 'string' ? v : JSON.stringify(v));
    return {
      list,
      eq(label, got, want) { const pass = JSON.stringify(got) === JSON.stringify(want); list.push({ label, pass, detail: pass ? '' : `got ${show(got)}\nwant ${show(want)}` }); },
      ok(label, cond, got) { list.push({ label, pass: !!cond, detail: cond ? '' : `got ${show(got)}` }); },
      has(label, text, part) { const pass = String(text).includes(part); list.push({ label, pass, detail: pass ? '' : `"${part}" not in ${show(text)}` }); },
      lacks(label, text, part) { const pass = !String(text).includes(part); list.push({ label, pass, detail: pass ? '' : `"${part}" unexpectedly in ${show(text)}` }); },
    };
  }

  // ---------- scenarios ----------
  const SCENARIOS = [];
  const scenario = (name, fn) => SCENARIOS.push({ name, fn });

  scenario('Pack sizes, buying into the larder, cooking out of it (1.9)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('rice', { name: 'Jasmine rice', defaultUnit: 'g', store: 'Costco', aisle: '310' }),
        mk('soy', { name: 'Soy sauce', defaultUnit: 'ml', store: 'Supermarket', aisle: '4' })],
      recipes: [mk('bowl', { name: 'Rice bowl', servings: 2, proteinPerServingG: 30, lactose: 'none', tags: [], method: '',
        ingredients: [{ ingredientId: 'rice', qty: 500, unit: 'g' }, { ingredientId: 'soy', qty: 30, unit: 'ml' }] }),
      mk('big', { name: 'Big rice', servings: 1, proteinPerServingG: 30, lactose: 'none', tags: [], method: '',
        ingredients: [{ ingredientId: 'rice', qty: 1.2, unit: 'kg' }] })],
      weekPlans: [weekPlan('w0', 0, { 0: { dinner: { recipeId: 'bowl', servings: 1, cook: null } }, 1: { lunch: { leftoverOf: { day: 0, slot: 'dinner' }, servings: 1 } } }),
        weekPlan('w1', 1, { 2: { dinner: { recipeId: 'big', servings: 1, cook: null } } })],
    }));
    await c.week(day(0)); await c.click('[data-action="generate"]', 300);
    t.eq('List wants 500 g rice', c.shopText('Jasmine rice').split(' | ').slice(0, 2), ['Jasmine rice', '500 g']);
    await c.click(c.shopRow('Jasmine rice').querySelector('[data-action="edit-item"]'));
    await c.set('#modal [data-m="draft.packQty"]', '1'); await c.set('#modal [data-m="draft.packUnit"]', 'kg');
    await c.click('[data-action="save-item"]', 120);
    await c.click(c.shopRow('Jasmine rice').querySelector('[data-action="edit-item"]'));
    await c.set('#modal [data-m="draft.price"]', '4.50');
    await c.click('[data-action="save-item"]', 120);
    t.has('Pack size: buys 1 × 1 kg', c.shopText('Jasmine rice'), '1 × 1 kg');
    t.has('Shows the need under it', c.shopText('Jasmine rice'), 'need 500 g');
    t.eq('Price per pack saved', (await c.all('ingredients')).find(i => i.id === 'rice').packPrice, 4.5);
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.has('Next week\'s list covers this week too: 500 g + 1.2 kg = 2 × 1 kg', c.shopText('Jasmine rice'), '2 × 1 kg');
    t.has('…need 1.7 kg', c.shopText('Jasmine rice'), 'need 1.7 kg');
    t.has('Estimate scales: $9.00', c.shopText('Jasmine rice'), '$9.00');
    t.ok('This week\'s unbought rice line moved onto it', !(await c.all('shoppingItems')).some(i => i.weekStart === day(0) && i.ingredientId === 'rice'));
    await c.shop(day(0)); await c.click('[data-action="regenerate"]', 300);
    await c.click(c.shopRow('Jasmine rice').querySelector('[data-action="tick"]'), 150);
    t.eq('Tick puts 1 kg in the larder', await c.larder(), ['rice:1kg@']);
    await c.click('[data-action="regenerate"]', 300);
    t.ok('Regenerate keeps the ticked line', c.shopRow('Jasmine rice') && c.shopRow('Jasmine rice').querySelector('.shop-item.checked'));
    await c.click(c.shopRow('Jasmine rice').querySelector('[data-action="tick"]'), 150);
    t.eq('Untick takes it back out', await c.larder(), ['rice:0kg@']);
    await c.click(c.shopRow('Jasmine rice').querySelector('[data-action="tick"]'), 150);
    await c.click(c.shopRow('Jasmine rice').querySelector('[data-action="edit-item"]'));
    await c.set('#modal [data-m="draft.boughtQty"]', '2'); await c.set('#modal [data-m="draft.boughtUnit"]', 'kg');
    await c.click('[data-action="save-item"]', 150);
    t.eq('Bought 2 kg while ticked: larder follows', await c.larder(), ['rice:2kg@']);
    t.eq('Changing Bought alone keeps the pack price', (await c.all('ingredients')).find(i => i.id === 'rice').packPrice, 4.5);
    await c.click(c.shopRow('Soy sauce').querySelector('[data-action="tick"]'), 150);
    t.eq('No pack size: tick adds the line amount', await c.larder(), ['rice:2kg@', 'soy:30ml@']);
    await c.click('[data-action="add-item"]');
    await c.set('#modal [data-m="draft.text"]', 'Dog food'); await c.set('#modal [data-m="draft.qty"]', '1'); await c.set('#modal [data-m="draft.unit"]', 'bag');
    await c.click('[data-action="save-item"]', 120);
    await c.click(c.shopRow('Dog food').querySelector('[data-action="tick"]'), 150);
    t.eq('Hand-added non-ingredient never touches the larder', await c.larder(), ['rice:2kg@', 'soy:30ml@']);
    await c.go(day(0));
    await c.click(c.card('dinner').querySelector('[data-action="eat"]'), 120);
    t.has('Cooking 2, eating 1: asks where the other went', c.modalText(), 'Where did the other 1 go?');
    await c.click('[data-action="save-cook"]', 200);
    t.eq('Cooked: ingredients out, a portion in', await c.larder(), ['rice:1.5kg@', 'soy:0ml@', '🍲bowl×1@Fridge']);
    await c.go(day(1));
    await c.click(c.card('lunch').querySelector('[data-action="eat"]'), 150);
    t.eq('Leftovers take the portion, no ingredients', await c.larder(), ['rice:1.5kg@', 'soy:0ml@']);
    await c.go(day(0));
    await c.click(c.card('dinner').querySelector('[data-action="undo-log"]'), 200);
    t.eq('Undo the cook: ingredients back', await c.larder(), ['rice:2kg@', 'soy:30ml@']);
    await c.click(c.card('dinner').querySelector('[data-action="eat"]'), 120);
    await c.click('[data-action="save-cook"]', 200);
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.eq('Next week: 1.5 kg in the larder covers 1.2 kg', c.shopText('Jasmine rice'), '(no line)');
    await c.tab('pantry'); await c.click('[data-action="add-pantry"]');
    await c.set('#modal [data-m="draft.name"]', 'Jasmine rice'); await sleep(60);
    t.eq('Weighed items offer g and kg', [...c.$('#modal [data-m="draft.unit"]').options].map(o => o.textContent), ['g', 'kg']);
    await c.click('[data-action="close-modal"]');
    await c.importJson(patch({ ingredients: [mk('junk', { name: 'Junk test', defaultUnit: 'g', store: 'Supermarket', aisle: '', packQty: 'lots', packUnit: 5, packPrice: -3 })] }));
    const j = (await c.all('ingredients')).find(i => i.id === 'junk');
    t.eq('Junk pack fields dropped, record kept', j ? [j.packQty, j.packUnit, j.packPrice].map(v => v === undefined ? 'dropped' : v) : 'rejected', ['dropped', 'dropped', 'dropped']);
  });

  scenario('Bolognese: batch cook, portions, freezer and next week (2.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('mince', { name: 'Turkey mince', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' }),
        mk('passata', { name: 'Passata', defaultUnit: 'g', store: 'Supermarket', aisle: '4' }),
        mk('oats', { name: 'Steel-cut oats', defaultUnit: 'g', store: 'Supermarket', aisle: '1' })],
      recipes: [mk('bol', { name: 'Bolognese', servings: 6, proteinPerServingG: 45, lactose: 'none', tags: ['batch'], method: '',
        ingredients: [{ ingredientId: 'mince', qty: 1000, unit: 'g' }, { ingredientId: 'passata', qty: 700, unit: 'g' }] }),
      mk('oat', { name: 'Oats', servings: 1, proteinPerServingG: 40, lactose: 'none', tags: [], method: '', ingredients: [{ ingredientId: 'oats', qty: 80, unit: 'g' }] })],
      weekPlans: [weekPlan('w0', 0, {
        0: { breakfast: { recipeId: 'oat', servings: 1, cook: null }, lunch: { recipeId: 'bol', servings: 1, cook: null } },
        1: { dinner: { leftoverOf: { day: 0, slot: 'lunch' }, servings: 1 } },
        3: { dinner: { leftoverOf: { day: 0, slot: 'lunch' }, servings: 1 } } })],
      pantryItems: [mk('p1', { ingredientId: 'mince', qty: 1000, unit: 'g' }), mk('p2', { ingredientId: 'passata', qty: 700, unit: 'g' }),
        mk('p3', { ingredientId: 'oats', qty: 370, unit: 'g' })],
    }));
    await c.go(day(0));
    t.eq('Batch cook says Cooked & eaten', c.card('lunch').querySelector('[data-action="eat"]').innerText, 'Cooked & eaten');
    t.eq('Single serve says Eaten', c.card('breakfast').querySelector('[data-action="eat"]').innerText, 'Eaten');
    // The recipe sheet when cooking: each ingredient for 1 serve and for the whole cook, and why that many.
    await c.click(c.card('lunch').querySelector('[data-action="show-recipe"]'), 60);
    const ingRows = () => c.$$('#modal .ing-table tr').map(r => [...r.children].map(x => x.textContent.trim()).join(' | '));
    t.eq('Cooking sheet: 1 serve and cooking 6, side by side', ingRows(), [' | 1 serve | serves', 'Turkey mince | 166.67 g | 1 kg', 'Passata | 116.67 g | 700 g']);
    t.eq('…the serves box starts at the cook (6)', c.$('#recipe-scale').value, '6');
    t.has('…and says what the 6 are for', c.modalText(), 'Cooking 6 serves | this meal · 2 for leftovers (Tue dinner, Thu dinner) · 3 spare for the larder');
    // Typing a different number of serves rescales the right-hand column, and keeps the box.
    const box = c.$('#recipe-scale');
    await c.set('#recipe-scale', '3');
    t.eq('Typing 3 serves rescales the column', ingRows(), [' | 1 serve | serves', 'Turkey mince | 166.67 g | 500 g', 'Passata | 116.67 g | 350 g']);
    t.ok('…without redrawing the box out from under you', c.$('#recipe-scale') === box);
    await c.set('#recipe-scale', '');
    t.eq('An empty box leaves the column blank', ingRows().slice(1), ['Turkey mince | 166.67 g | ', 'Passata | 116.67 g | ']);
    await c.click('[data-action="close-modal"]');
    await c.click(c.card('breakfast').querySelector('[data-action="show-recipe"]'), 60);
    t.eq('A single serve starts the serves box at the recipe\'s serves', ingRows(), [' | 1 serve | serves', 'Steel-cut oats | 80 g | 80 g']);
    await c.click('[data-action="close-modal"]');
    // The Recipes tab opens the same sheet (box at the recipe's own serves), with Edit for the editor.
    await c.tab('recipes');
    await c.click(c.$$('#recipe-list .list-row').find(b => b.textContent.includes('Bolognese')), 60);
    t.ok('Recipes tab opens the recipe sheet', !!c.$('#modal .ing-table'));
    t.eq('…serves box at the recipe\'s 6', c.$('#recipe-scale').value, '6');
    await c.click('#modal [data-action="edit-recipe"]', 60);
    t.has('Edit opens the recipe editor', c.modalText(), 'Edit recipe');
    await c.click('[data-action="close-modal"]');
    await c.go(day(0));
    await c.click(c.card('breakfast').querySelector('[data-action="eat"]'), 150);
    t.ok('Single serve: no sheet', c.$('#modal').hidden);
    t.eq('Oats: 80 g out', await c.larder(), ['mince:1000g@', 'oats:290g@', 'passata:700g@']);
    await c.click(c.card('lunch').querySelector('[data-action="eat"]'), 120);
    t.has('Sheet suggests 1 to the fridge (for Tue)', c.modalText(), 'Fridge | − | 1 | +');
    t.has('…and 4 to the freezer', c.modalText(), 'Freezer | − | 4 | +');
    await c.click('[data-action="save-cook"]', 200);
    t.eq('Cooked: ingredients out, 5 portions in', await c.larder(), ['mince:0g@', 'oats:290g@', 'passata:0g@', '🍲bol×1@Fridge', '🍲bol×4@Freezer']);
    await c.click(c.card('lunch').querySelector('[data-action="undo-log"]'), 200);
    t.eq('Undo: exactly as before', await c.larder(), ['mince:1000g@', 'oats:290g@', 'passata:700g@']);
    await c.click(c.card('lunch').querySelector('[data-action="eat"]'), 120);
    await c.click('[data-action="save-cook"]', 200);
    await c.go(day(1));
    t.eq('Leftovers say where the portions are, not which meal they came from', c.card('dinner').querySelector('.item-sub').innerText, '1 in the Fridge, 4 in the Freezer');
    await c.click(c.card('dinner').querySelector('[data-action="eat"]'), 150);
    t.eq('Leftovers eat the fridge portion first', await c.larder(), ['mince:0g@', 'oats:290g@', 'passata:0g@', '🍲bol×4@Freezer']);
    await c.go(day(2));
    t.has('Night before Thu: Move to fridge', c.$('.card.prep') ? c.$('.card.prep').innerText : '', 'Move 1 × Bolognese from the freezer to the fridge');
    await c.click('[data-action="move-portions"]', 150);
    t.eq('Moved 1 to the fridge', await c.larder(), ['mince:0g@', 'oats:290g@', 'passata:0g@', '🍲bol×1@Fridge', '🍲bol×3@Freezer']);
    await c.week(day(0));
    t.has('Week: cook slot shows cooked 6', c.$$('.slot-row').map(b => b.innerText).join(' / '), 'cooked 6');
    const nextWeek = (n, leftovers) => patch({ weekPlans: [Object.assign(weekPlan('w1', 1, Object.fromEntries([
      [0, { dinner: { recipeId: 'bol', servings: 1, cook: null } }],
      ...Array.from({ length: leftovers }, (_, i) => [i + 1, { dinner: { leftoverOf: { day: 0, slot: 'dinner' }, servings: 1 } }])])),
      { updatedAt: new Date(Date.now() + n * 1000).toISOString() })] });
    await c.importJson(nextWeek(1, 1));
    await c.week(day(7));
    t.has('Next week needs 2, larder has 3 free: from the larder', c.$$('.slot-row').map(b => b.innerText).join(' / '), 'from the larder');
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.eq('…and nothing to buy for it', c.shopText('Turkey mince'), '(no line)');
    await c.importJson(nextWeek(2, 4));
    await c.week(day(7));
    t.has('Needs 5: covers 3, cooks a full 6, 4 spare', c.$$('.slot-row').map(b => b.innerText).join(' / '), 'larder covers 3 · cooking 6 leaves 4 spare');
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.ok('…and buys the batch', c.shopRow('Turkey mince') && c.shopRow('Passata'));
    const lastThursday = day(-4);   // always old enough to flag, never this Monday's cook (rows would merge)
    await c.tab('pantry'); await c.click('[data-action="add-portion"]');
    await c.set('#modal [data-m="draft.recipeId"]', 'bol'); await c.set('#modal [data-m="draft.qty"]', '2');
    await c.set('#modal [data-m="draft.location"]', 'Fridge'); await c.set('#modal [data-m="draft.cookedOn"]', lastThursday);
    await c.untick('#modal [data-m="justCooked"]');
    await c.click('[data-action="save-portion"]', 150);
    t.has('A closed Fridge shows ⚠ when something needs eating or freezing', c.$$('.larder-loc').find(x => x.querySelector('.loc-name').innerText.trim() === 'Fridge').querySelector('summary').innerText, '⚠');
    await sleep(30);
    t.has('Prepared meal shows in the Fridge with 🍲 and eat or freeze', c.loc('Fridge').innerText, 'eat or freeze');
    await c.go(c.w.__mp.today());
    t.has('Today flags the old fridge portions', c.$('.card.prep') ? c.$('.card.prep').innerText : '', 'eat or freeze');
    // Freeze last Thursday's row (on a Thursday or later, Monday's cook is also old enough to be flagged).
    const oldRow = (await c.all('pantryItems')).find(p => p.recipeId === 'bol' && p.cookedOn === lastThursday);
    await c.click(`[data-action="freeze-portion"][data-id="${oldRow.id}"]`, 150);
    t.ok('Freeze moved them', (await c.larder()).includes(`🍲bol×2@Freezer`));
    await c.click('[data-action="add-to"][data-slot="snack"]', 60);
    await c.click('#modal [data-action="pick-recipe"][data-id="bol"]', 60);
    const fridgeN = async () => (await c.all('pantryItems')).filter(p => p.recipeId === 'bol' && p.location === 'Fridge').reduce((n, p) => n + p.qty, 0);
    const before = await fridgeN(), ingBefore = (await c.larder()).filter(x => !x.startsWith('🍲'));
    await c.click('[data-action="save-log"]', 150);
    const after = await fridgeN(), ingAfter = (await c.larder()).filter(x => !x.startsWith('🍲'));
    t.ok('+ Add food Bolognese takes a fridge portion, no ingredients', before >= 1 && after === before - 1 && JSON.stringify(ingAfter) === JSON.stringify(ingBefore), { before, after });
    await c.go(day(7));
    await c.click(c.card('dinner').querySelector('[data-action="meal-menu"]'), 60);
    await c.click('[data-action="cook-ahead"]', 80);
    t.has('Cooked, eating later: nothing eaten now', c.modalText(), 'Eaten now | − | 0 | +');
    const larderBefore = await c.larder();
    await c.click('[data-action="save-cook"]', 200);
    t.eq('Cooked ahead: Eaten (takes a portion)', c.card('dinner').querySelector('[data-action="eat"]').innerText, 'Eaten');
    await c.click(c.card('dinner').querySelector('[data-action="meal-menu"]'), 60);
    await c.click('[data-action="undo-cook"]', 200);
    t.eq('Undo cooked: larder as before', await c.larder(), larderBefore);
  });

  scenario('Tuna mornay: spares planned in an earlier week cover the next (2.2.1)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('tuna', { name: 'Tinned tuna', defaultUnit: 'tin', store: 'Supermarket', aisle: '5' }),
        mk('mince2', { name: 'Beef mince', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' })],
      recipes: [mk('morn', { name: 'Tuna mornay', servings: 2, proteinPerServingG: 40, lactose: 'contains', tags: [], method: '',
        ingredients: [{ ingredientId: 'tuna', qty: 2, unit: 'tin' }] }),
      mk('bol2', { name: 'Beef bolognese', servings: 6, proteinPerServingG: 45, lactose: 'none', tags: ['batch'], method: '',
        ingredients: [{ ingredientId: 'mince2', qty: 1000, unit: 'g' }] })],
      weekPlans: [weekPlan('w0', 0, {
        5: { dinner: { recipeId: 'bol2', servings: 1, cook: null } },
        6: { lunch: { leftoverOf: { day: 5, slot: 'dinner' }, servings: 1 }, dinner: { recipeId: 'morn', servings: 1, cook: 2 } } }),
      weekPlan('w1', 1, {
        0: { lunch: { recipeId: 'morn', servings: 1, cook: 1 }, dinner: { recipeId: 'bol2', servings: 1, cook: null } },
        1: { dinner: { leftoverOf: { day: 0, slot: 'dinner' }, servings: 1 } },
        2: { dinner: { leftoverOf: { day: 0, slot: 'dinner' }, servings: 1 } } })],
    }));
    const rows = () => c.$$('.slot-row').map(b => b.innerText.replace(/\s*\n\s*/g, ' ')).join(' / ');
    const nextWeek = async (label, before) => {
      await c.week(day(7));
      const alloc = c.w.__mp.alloc(day(7)).slotCook;
      t.eq(`${label}: next Monday's mornay and bolognese cook nothing`, [cookAt(alloc, day(7), 'lunch'), cookAt(alloc, day(7), 'dinner')], [0, 0]);
      t.has(`${label}: Monday lunch reads "from the larder"`, rows(), 'from the larder');
      await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
      // Next week's list also covers what's left of this week, so before cooking it buys this weekend's mornay
      // (2 tins) and batch (1 kg) exactly once, and nothing for next Monday's.
      t.eq(`${label}: tuna on next week's list`, c.shopText('Tinned tuna').split(' | ').slice(0, 2), before ? ['Tinned tuna', '2 tin'] : ['(no line)']);
      t.eq(`${label}: mince on next week's list`, c.shopText('Beef mince').split(' | ').slice(0, 2), before ? ['Beef mince', '1 kg'] : ['(no line)']);
    };
    await c.week(day(0)); await c.click('[data-action="generate"]', 300);
    t.ok('This week buys the Sunday mornay and the Saturday batch', c.shopRow('Tinned tuna') && c.shopRow('Beef mince'));
    await nextWeek('Before cooking', true);
    await c.week(day(0)); await c.click('[data-action="generate"]', 300);
    // Cook both ahead (nothing eaten yet): the portions go into the Larder, and the plan must not count them twice.
    for (const [d, slot] of [[5, 'dinner'], [6, 'dinner']]) {
      await c.go(day(d));
      await c.click(c.card(slot).querySelector('[data-action="meal-menu"]'), 60);
      await c.click('[data-action="cook-ahead"]', 80);
      await c.click('[data-action="save-cook"]', 200);
    }
    t.eq('Cooked ahead: 6 bolognese and 2 mornay in the Larder', (await c.larder()).filter(x => x.startsWith('🍲')).map(x => x.replace(/@.*/, '')).reduce((a, x) => {
      const [, id, n] = x.match(/🍲(\w+)×(\d+)/); a[id] = (a[id] || 0) + Number(n); return a; }, {}), { bol2: 6, morn: 2 });
    await nextWeek('After cooking', false);
    // Still covered exactly: one fewer portion and next week's lunch has to cook again.
    await c.importJson(patch({ pantryItems: (await c.all('pantryItems')).filter(p => p.recipeId === 'morn').map(p => ({ ...p, qty: p.qty - 1, updatedAt: new Date(Date.now() + 5000).toISOString() })) }));
    t.eq('One mornay short: next Monday cooks 1 again', cookAt(c.w.__mp.alloc(day(7)).slotCook, day(7), 'lunch'), 1);
  });

  scenario('Bulgogi: cook what the plan eats, say where the rest goes (2.3.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('bulg', { name: 'Costco beef bulgogi', defaultUnit: 'g', store: 'Costco', aisle: 'Ready meals' }),
        mk('chk', { name: 'Chicken thigh', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' })],
      recipes: [mk('bul', { name: 'Bulgogi', servings: 1, proteinPerServingG: 54, lactose: 'none', tags: ['Costco ready-meal'], method: '',
        ingredients: [{ ingredientId: 'bulg', qty: 300, unit: 'g' }] }),
      mk('old4', { name: 'Old four-serve', servings: 4, proteinPerServingG: 40, lactose: 'none', tags: [], method: '',
        ingredients: [{ ingredientId: 'chk', qty: 800, unit: 'g' }] }),
      mk('cur', { name: 'Curry', servings: 1, proteinPerServingG: 49, lactose: 'none', tags: ['batch'], method: '',
        ingredients: [{ ingredientId: 'chk', qty: 200, unit: 'g' }] })],
      weekPlans: [weekPlan('w0', 0, {
        0: { dinner: { recipeId: 'bul', servings: 1, cook: null }, lunch: { recipeId: 'cur', servings: 1, cook: null },
          breakfast: { recipeId: 'old4', servings: 1, cook: null } },
        1: { lunch: { leftoverOf: { day: 0, slot: 'lunch' }, servings: 1 } },
        2: { dinner: { leftoverOf: { day: 0, slot: 'lunch' }, servings: 1 } },
        3: { dinner: { recipeId: 'bul', servings: 1, cook: null } },
        4: { dinner: { recipeId: 'bul', servings: 1, cook: 3 } },
        5: { lunch: { leftoverOf: { day: 4, slot: 'dinner' }, servings: 1 } } })],
    }));
    const slot = (d, k) => cookAt(c.w.__mp.alloc(day(0)).slotCook, day(d), k);
    t.eq('Single-serve bulgogi with no leftovers cooks 1', slot(0, 'dinner'), 1);
    t.eq('A four-serve recipe eaten once, no leftovers, cooks 1 (not the whole recipe)', slot(0, 'breakfast'), 1);
    t.eq('Curry cooks this meal plus its 2 leftovers', slot(0, 'lunch'), 3);
    t.eq('A typed cook amount wins', slot(4, 'dinner'), 3);
    await c.go(day(0));
    t.eq('Bulgogi card: no cook note, just Eaten', [c.card('dinner').querySelector('.item-sub') ? c.card('dinner').querySelector('.item-sub').innerText : '',
      c.card('dinner').querySelector('[data-action="eat"]').innerText], ['', 'Eaten']);
    t.has('Curry card says where the rest goes', c.card('lunch').innerText, 'cook 3 · 2 for leftovers (Tue lunch, Wed dinner)');
    await c.go(day(4));
    t.has('Cooking extra: leftovers and spare for the larder', c.card('dinner').innerText, 'cook 3 · 1 for leftovers (Sat lunch) · 1 spare for the larder');
    await c.week(day(0));
    t.has('Week view shows the same note', c.$$('.slot-row').map(b => b.innerText.replace(/\s*\n\s*/g, ' ')).join(' / '), 'cook 3 · 2 for leftovers (Tue lunch, Wed dinner)');
    await c.click('[data-action="generate"]', 300);
    t.eq('Buys bulgogi by weight for 5 meals: 1.5 kg', c.shopText('Costco beef bulgogi').split(' | ').slice(0, 2), ['Costco beef bulgogi', '1.5 kg']);
    await c.click(c.shopRow('Costco beef bulgogi').querySelector('[data-action="tick"]'), 150);
    await c.click(c.shopRow('Costco beef bulgogi').querySelector('[data-action="edit-item"]'));
    await c.set('#modal [data-m="draft.boughtQty"]', '2.35'); await c.set('#modal [data-m="draft.boughtUnit"]', 'kg');
    await c.click('[data-action="save-item"]', 150);
    t.eq('Bought 2.35 kg: the larder holds what was actually bought', (await c.larder()).filter(x => x.startsWith('bulg')), ['bulg:2350g@']);
  });

  scenario('Cook once, eat twice: a cook covers the same recipe\'s meals in the next few days, across weeks (2.13.0)', async (c, t) => {
    // Brad's Sunday: tuna mornay for dinner and again for Monday lunch (next week's plan). The app said to cook 1.
    await c.importJson(patch({
      ingredients: [mk('tuna', { name: 'Tinned tuna', defaultUnit: 'tin', store: 'Supermarket', aisle: '5' }),
        mk('oats', { name: 'Steel-cut oats', defaultUnit: 'g', store: 'Supermarket', aisle: '1' }),
        mk('chk', { name: 'Chicken thigh', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' })],
      recipes: [mk('morn', { name: 'Tuna mornay', servings: 1, proteinPerServingG: 59, lactose: 'contains', tags: [], method: '',
        ingredients: [{ ingredientId: 'tuna', qty: 1, unit: 'tin' }] }),
      mk('oat', { name: 'Oats', servings: 1, proteinPerServingG: 42, lactose: 'none', tags: ['rice cooker'], method: '', ingredients: [{ ingredientId: 'oats', qty: 80, unit: 'g' }] }),
      mk('stew', { name: 'Chicken stew', servings: 1, proteinPerServingG: 50, lactose: 'none', tags: [], method: '', ingredients: [{ ingredientId: 'chk', qty: 200, unit: 'g' }] })],
      weekPlans: [weekPlan('w0', 0, {
        6: { breakfast: { recipeId: 'oat', servings: 1, cook: null }, lunch: { recipeId: 'stew', servings: 1, cook: null }, dinner: { recipeId: 'morn', servings: 1, cook: null } } }),
      weekPlan('w1', 1, {
        0: { breakfast: { recipeId: 'oat', servings: 1, cook: null }, lunch: { recipeId: 'morn', servings: 1, cook: null } },
        1: { dinner: { recipeId: 'stew', servings: 1, cook: 3 } },
        2: { dinner: { recipeId: 'stew', servings: 1, cook: null } },
        3: { dinner: { recipeId: 'morn', servings: 1, cook: null } } })],
    }));
    const at = (d, k) => cookAt(c.w.__mp.alloc(day(0)).slotCook, day(d), k);
    t.eq('Sunday dinner cooks 2: itself and Monday lunch, across the week boundary', at(6, 'dinner'), 2);
    t.eq('Monday lunch cooks nothing', at(7, 'lunch'), 0);
    t.eq('Thursday\'s mornay is past the fridge days: cooks its own', at(10, 'dinner'), 1);
    t.eq('Rice-cooker oats cook each morning', [at(6, 'breakfast'), at(7, 'breakfast')], [1, 1]);
    t.eq('A typed cook amount is never pulled into an earlier cook, and stops the look-ahead', [at(6, 'lunch'), at(8, 'dinner')], [1, 3]);
    t.eq('…and later meals eat from it', at(9, 'dinner'), 0);
    await c.go(day(6));
    t.has('Sunday card says what the 2 are for', c.card('dinner').innerText, 'cook 2 · 1 for leftovers (Mon lunch)');
    t.has('Now doc says it too', c.w.__mp.nowDoc(), 'Tuna mornay (contains lactose) (cook 2 · 1 for leftovers (Mon lunch)) — 59 g protein');
    await c.week(day(0));
    t.has('Week: Sunday counts two cooks', c.$$('.cook-line').map(x => x.innerText).join(' / '), '🍳 Chicken stew ×1, Tuna mornay ×2 · 2 cooks this day');
    await c.week(day(7));
    const rows = () => c.$$('.slot-row').map(b => b.innerText.replace(/\s*\n\s*/g, ' ')).join(' / ');
    t.has('Week: Monday lunch eats Sunday\'s cook', rows(), 'Contains lactose leftovers from Sun dinner');
    t.has('Week: Thursday cooks its own, with no talk of the larder', rows(), 'DINNER Tuna mornay ⚠ Contains lactose + / SNACK');
    t.ok('Week: no cook line on Monday (oats don\'t count)', !c.$$('.card').some(x => x.innerText.includes('Mon') && x.querySelector('.cook-line')));
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.eq('List buys 3 tins: 2 on Sunday, 1 on Thursday', c.shopText('Tinned tuna').split(' | ').slice(0, 2), ['Tinned tuna', '3 tin']);
    // Cooked only 1 after all: Monday lunch has to cook its own.
    await c.importJson(patch({ pantryItems: [mk('t1', { ingredientId: 'tuna', qty: 3, unit: 'tin' })] }));
    await c.go(day(6));
    await c.click(c.card('dinner').querySelector('[data-action="eat"]'), 120);
    t.has('Cook sheet suggests 2, eat 1', c.modalText(), 'Where did the other 1 go?');
    await c.click('#modal [data-action="cook-step"][data-key="made"][data-d="-1"]', 60);
    await c.click('[data-action="save-cook"]', 200);
    t.eq('Made 1: Monday lunch cooks 1', at(7, 'lunch'), 1);
    await c.go(day(7));
    t.eq('…and its card says Eaten (cook), not leftovers', [c.card('lunch').querySelector('[data-action="eat"]').innerText, (c.card('lunch').querySelector('.item-sub') || { innerText: '' }).innerText], ['Eaten', '']);
  });

  scenario('Bulgogi night before: take frozen ingredients out, and the recipe\'s own note (2.9.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('bulg', { name: 'Costco beef bulgogi', defaultUnit: 'g', store: 'Costco', aisle: 'Ready meals', location: 'Chest Freezer' }),
        mk('rice', { name: 'Jasmine rice', defaultUnit: 'g', store: 'Costco', aisle: '310', location: 'Pantry Shelf 1' }),
        mk('peas', { name: 'Frozen peas', defaultUnit: 'g', store: 'Supermarket', aisle: 'Frozen', location: 'Freezer', cookFromFrozen: true }),
        mk('pies', { name: 'Party pies', defaultUnit: 'pack', store: 'Supermarket', aisle: 'Frozen', location: 'Freezer', cookFromFrozen: 'yes' })],
      recipes: [mk('bul', { name: 'Bulgogi', servings: 1, proteinPerServingG: 54, lactose: 'none', tags: ['Costco ready-meal'], method: '', nightBefore: 'Cook the rice',
        ingredients: [{ ingredientId: 'bulg', qty: 300, unit: 'g' }, { ingredientId: 'rice', qty: 100, unit: 'g' }] }),
      mk('fr', { name: 'Fried rice', servings: 2, proteinPerServingG: 20, lactose: 'none', tags: [], method: '', nightBefore: 7,
        ingredients: [{ ingredientId: 'peas', qty: 200, unit: 'g' }, { ingredientId: 'rice', qty: 200, unit: 'g' }] }),
      mk('pie', { name: 'Pie night', servings: 4, proteinPerServingG: 20, lactose: 'none', tags: [], method: '',
        ingredients: [{ ingredientId: 'pies', qty: 1.5, unit: 'pack' }] })],
      pantryItems: [mk('p1', { ingredientId: 'bulg', qty: 1, unit: 'kg', location: 'Chest Freezer' }),
        mk('p2', { ingredientId: 'bulg', qty: 100, unit: 'g', location: 'Fridge' }),
        mk('p3', { ingredientId: 'rice', qty: 2000, unit: 'g', location: 'Pantry Shelf 1' }),
        mk('p4', { ingredientId: 'peas', qty: 500, unit: 'g', location: 'Freezer' }),
        mk('p5', { ingredientId: 'pies', qty: 3, unit: 'pack', location: '' })],
      weekPlans: [weekPlan('w0', 0, {
        2: { dinner: { recipeId: 'bul', servings: 1, cook: null } },
        3: { dinner: { recipeId: 'fr', servings: 2, cook: null } },
        4: { dinner: { recipeId: 'pie', servings: 4, cook: null } } })],
    }));
    const ings = await c.all('ingredients'), recs = await c.all('recipes');
    t.eq('Import keeps cookFromFrozen: true, drops a junk value', [ings.find(i => i.id === 'peas').cookFromFrozen, 'cookFromFrozen' in ings.find(i => i.id === 'pies')], [true, false]);
    t.eq('Import keeps a Night before note, drops a junk one', [recs.find(r => r.id === 'bul').nightBefore, 'nightBefore' in recs.find(r => r.id === 'fr')], ['Cook the rice', false]);
    const prep = () => (c.$('.card.prep') ? c.$('.card.prep').innerText : '');
    await c.go(day(1));
    t.has('Night before the bulgogi: the recipe\'s note', prep(), "Cook the rice (for tomorrow's Bulgogi)");
    t.has('…and take out what the fridge is short (300 g less 100 g already there)', prep(), 'Take 200 g Costco beef bulgogi out of the Chest Freezer to thaw in the fridge');
    t.ok('Rice in the pantry: no thaw reminder', !prep().includes('Jasmine rice'));
    await c.click('[data-action="thaw-stock"]', 150);
    t.eq('Move to fridge moves the 200 g', (await c.larder()).filter(x => x.startsWith('bulg')), ['bulg:0.8kg@Chest Freezer', 'bulg:300g@Fridge']);
    t.ok('…and the reminder goes', !prep().includes('Take') && !c.$('[data-action="thaw-stock"]'));
    t.has('The note stays', prep(), 'Cook the rice');
    await c.go(day(2));
    t.ok('Frozen peas are cooked from frozen: no reminder', !prep().includes('Frozen peas'));
    await c.go(day(3));
    t.has('Count units take whole packs: 1.5 → 2, from the ingredient\'s usual freezer', prep(), 'Take 2 pack Party pies out of the Freezer to thaw in the fridge');
    await c.importJson(patch({ ingredients: [mk('pies', { name: 'Party pies', defaultUnit: 'pack', store: 'Supermarket', aisle: 'Frozen', location: 'Freezer', cookFromFrozen: true,
      updatedAt: new Date(Date.now() + 5000).toISOString() })] }));
    await c.go(day(3));
    t.ok('Ticking Cook from frozen stops it', !prep().includes('Party pies'));
    // Once the bulgogi is cooked, the night before has nothing left to say about it.
    await c.go(day(2));
    await c.click(c.card('dinner').querySelector('[data-action="eat"]'), 150);
    if (!c.$('#modal').hidden && c.$('[data-action="save-cook"]')) await c.click('[data-action="save-cook"]', 150);
    await c.go(day(1));
    t.ok('Cooked: no note or thaw for it', !prep().includes('Bulgogi') && !prep().includes('bulgogi'));
    t.eq('Cooking took the fridge bulgogi first', (await c.larder()).filter(x => x.startsWith('bulg')), ['bulg:0.8kg@Chest Freezer', 'bulg:0g@Fridge']);
  });

  scenario('Ice cream: a recipe eaten from frozen stays in the freezer (2.10.0)', async (c, t) => {
    const cream = (eatFrozen, updatedAt) => mk('ice', { name: 'Ice cream (CREAMi)', servings: 1, proteinPerServingG: 28, lactose: 'low', tags: [], method: '',
      eatFrozen, ingredients: [{ ingredientId: 'wpi', qty: 30, unit: 'g' }], ...(updatedAt ? { updatedAt } : {}) });
    await c.importJson(patch({
      ingredients: [mk('wpi', { name: 'WPI protein powder', defaultUnit: 'g', store: 'Costco', aisle: '1', location: 'Pantry Shelf 4' })],
      recipes: [cream(true), mk('junk', { name: 'Junk flag', servings: 1, lactose: 'none', tags: [], method: '', eatFrozen: 'yes', ingredients: [] })],
      pantryItems: [mk('p1', { ingredientId: 'wpi', qty: 500, unit: 'g', location: 'Pantry Shelf 4' })],
      weekPlans: [weekPlan('w0', 0, {
        0: { snack: { id: 'ic', recipeId: 'ice', servings: 1, cook: null } },
        2: { snack: { leftoverOf: { day: 0, slot: 'snack', item: 'ic' }, servings: 1 } } })],
    }));
    const recs = await c.all('recipes');
    t.eq('Import keeps eatFrozen: true, drops a junk value', [recs.find(r => r.id === 'ice').eatFrozen, 'eatFrozen' in recs.find(r => r.id === 'junk')], [true, false]);
    await c.go(day(0));
    await c.click(c.card('snack').querySelector('[data-action="eat"]'), 120);
    t.has('Cook sheet puts nothing in the fridge, even for Wednesday', c.modalText(), 'Fridge | − | 0 | +');
    t.has('…and the spare in the freezer', c.modalText(), 'Freezer | − | 1 | +');
    await c.click('[data-action="save-cook"]', 200);
    t.eq('The spare serve is in the freezer', (await c.larder()).filter(x => x.startsWith('🍲')), ['🍲ice×1@Freezer']);
    const prep = () => (c.$('.card.prep') ? c.$('.card.prep').innerText : '');
    await c.go(day(1));
    t.ok('Night before: no move-to-fridge for ice cream', !prep().includes('Ice cream') && !c.$('[data-action="move-portions"]'));
    await c.importJson(patch({ recipes: [cream(false, new Date(Date.now() + 5000).toISOString())] }));
    await c.go(day(1));
    t.has('Without the tick it would move it (as for any frozen meal)', prep(), 'Move 1 × Ice cream (CREAMi) from the freezer to the fridge');
  });

  scenario('Off-plan cook: + Prepared meal takes the ingredients (2.14.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('oat', { name: 'Oat Milk', defaultUnit: 'ml', store: 'Supermarket', aisle: '2', location: 'Fridge' })],
      recipes: [mk('ice', { name: 'Ice cream (CREAMi)', servings: 1, proteinPerServingG: 28, lactose: 'low', tags: [], method: '',
        eatFrozen: true, ingredients: [{ ingredientId: 'oat', qty: 125, unit: 'ml' }] })],
      pantryItems: [mk('p1', { ingredientId: 'oat', qty: 1000, unit: 'ml', location: 'Fridge' })],
    }));
    const add = async tick => {
      await c.tab('pantry'); await c.click('[data-action="add-portion"]');
      await c.set('#modal [data-m="draft.recipeId"]', 'ice'); await c.set('#modal [data-m="draft.qty"]', '2');
      await c.set('#modal [data-m="draft.location"]', 'Freezer');
      const box = c.$('#modal [data-m="justCooked"]');
      t.ok('Just cooked it: there, and ticked to start with', !!box && box.checked);
      if (!tick) await c.untick('#modal [data-m="justCooked"]');
      await c.click('[data-action="save-portion"]', 150);
    };
    await add(true);
    t.eq('Ticked: 2 portions in, 250 ml oat milk out', await c.larder(), ['oat:750ml@Fridge', '🍲ice×2@Freezer']);
    await add(false);
    t.eq('Unticked: portions only, the larder untouched', await c.larder(), ['oat:750ml@Fridge', '🍲ice×4@Freezer']);
    await c.click(c.$('[data-action="edit-portion"]'));
    t.ok('Editing a prepared meal has no tick', !c.$('#modal [data-m="justCooked"]'));
  });

  scenario('Shake and eggs: several items in one meal (2.5.0)', async (c, t) => {
    const shakeEggs = updatedAt => patch({ weekPlans: [Object.assign(weekPlan('w0', 0, {
      0: { breakfast: [{ id: 'sh', recipeId: 'shake', servings: 1, cook: null }, { id: 'eg', recipeId: 'egg', servings: 1, cook: null }],
        dinner: [{ text: 'Side salad', proteinG: 5 }, { id: 'cu', recipeId: 'cur', servings: 1, cook: null }] },
      1: { lunch: [{ leftoverOf: { day: 0, slot: 'dinner', item: 'cu' }, servings: 1 }] },
      2: { breakfast: { recipeId: 'shake', servings: 1, cook: null } } }), updatedAt ? { updatedAt } : {})] });
    await c.importJson(patch({
      ingredients: [mk('whey', { name: 'Whey protein', defaultUnit: 'g', store: 'Costco', aisle: '1' }),
        mk('eggs', { name: 'Eggs', defaultUnit: 'each', store: 'Costco', aisle: '2' }),
        mk('chk2', { name: 'Chicken breast', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' })],
      recipes: [mk('shake', { name: 'Shake', servings: 1, proteinPerServingG: 50, lactose: 'low', tags: [], method: '', ingredients: [{ ingredientId: 'whey', qty: 40, unit: 'g' }] }),
        mk('egg', { name: 'Eggs on toast', servings: 1, proteinPerServingG: 18, lactose: 'none', tags: [], method: '', ingredients: [{ ingredientId: 'eggs', qty: 3, unit: 'each' }] }),
        mk('cur', { name: 'Curry', servings: 1, proteinPerServingG: 49, lactose: 'none', tags: [], method: '', ingredients: [{ ingredientId: 'chk2', qty: 200, unit: 'g' }] })],
    }));
    await c.importJson(shakeEggs());
    const plan = async () => (await c.all('weekPlans')).find(p => p.id === 'w0');
    let w0 = await plan();
    t.ok('A meal written the old way (one item, no list) becomes a list of one with an id',
      Array.isArray(w0.days[2].slots.breakfast) && w0.days[2].slots.breakfast.length === 1 && !!w0.days[2].slots.breakfast[0].id);
    t.eq('Items keep their ids; one without gets its own', [w0.days[0].slots.breakfast.map(x => x.id), typeof w0.days[0].slots.dinner[0].id], [['sh', 'eg'], 'string']);
    t.eq('Leftovers point at the second item of a meal: curry cooks 2', c.w.__mp.alloc(day(0)).slotCook[`${day(0)}|dinner|cu`], 2);
    await c.week(day(0)); await c.click('[data-action="generate"]', 300);
    t.eq('The list buys for every item: 80 g whey (Mon + Wed), 3 eggs, 400 g chicken',
      [c.shopText('Whey protein').split(' | ')[1], c.shopText('Eggs').split(' | ')[1], c.shopText('Chicken breast').split(' | ')[1]], ['80 g', '3 each', '400 g']);

    // Today: each item ticks on its own.
    await c.go(day(0));
    const eats = () => [...c.card('breakfast').querySelectorAll('[data-action="eat"]')].map(b => b.dataset.item);
    t.eq('Breakfast shows both items, each with its own Eaten', eats(), ['sh', 'eg']);
    t.has('…and both counted in the meal\'s protein', c.card('breakfast').querySelector('.card-head').innerText, '68 g');
    await c.click(c.card('breakfast').querySelector('[data-action="eat"][data-item="eg"]'), 150);
    let logs = await c.all('mealLogs');
    t.eq('Eaten on the eggs logs the eggs only', logs.map(l => [l.slot, l.item, l.recipeId, l.planned]), [['breakfast', 'eg', 'egg', true]]);
    t.eq('…and the shake is still to eat', eats(), ['sh']);
    await c.click(c.card('breakfast').querySelector('[data-action="meal-menu"][data-item="sh"]'), 60);
    await c.click('#modal [data-action="skip"]', 120);
    logs = await c.all('mealLogs');
    t.ok('Didn\'t eat the shake: skipped on its own item', logs.some(l => l.item === 'sh' && l.skipped) && eats().length === 0);
    await c.click([...c.card('breakfast').querySelectorAll('.item.done')].find(x => x.innerText.includes('Eggs')).querySelector('[data-action="undo-log"]'), 150);
    t.eq('Undo the eggs: eggs back to eat, the shake stays skipped', eats(), ['eg']);

    // The Now doc (today on) lists each item and how it went: next Monday, shake skipped, eggs still to eat.
    await c.importJson(patch({ weekPlans: [weekPlan('w1', 1, { 0: { breakfast: [{ id: 'n1', recipeId: 'shake', servings: 1 }, { id: 'n2', recipeId: 'egg', servings: 1 }] } })],
      mealLogs: [mk('nl', { date: day(7), slot: 'breakfast', item: 'n1', text: 'Skipped', servings: 1, proteinG: 0, planned: false, extra: false, skipped: true })] }));
    t.has('Now doc lists each item and how it went', c.w.__mp.nowDoc(), 'Shake — 50 g protein — skipped; Eggs on toast — 18 g protein</li>');

    // A patch rewriting the week without ids keeps the items' ids, so ticks stay put.
    const noIds = shakeEggs(new Date(Date.now() + 5000).toISOString());
    noIds.upserts.weekPlans[0].days[0].slots.breakfast.forEach(x => delete x.id);
    await c.importJson(noIds);
    w0 = await plan();
    t.eq('Rewritten without ids: the shake and eggs keep theirs', w0.days[0].slots.breakfast.map(x => x.id), ['sh', 'eg']);
    await c.go(day(0));
    t.eq('…so the skipped shake is still skipped', eats(), ['eg']);

    // A log from before 2.5.0 (no item) belongs to that meal's item.
    await c.importJson(patch({ mealLogs: [mk('oldlog', { date: day(2), slot: 'breakfast', recipeId: 'shake', text: null, servings: 1, proteinG: 50, planned: true, extra: false })] }));
    const oldLog = (await c.all('mealLogs')).find(l => l.id === 'oldlog');
    t.eq('An old log without an item ticks off that meal\'s item', oldLog.item, w0.days[2].slots.breakfast[0].id);
    await c.go(day(2));
    t.eq('…so Wednesday\'s shake isn\'t waiting to be eaten', eats(), []);

    // Week: + adds another item to a meal; Remove takes one out.
    await c.week(day(0));
    t.has('Week shows both breakfast items', c.$$('.slot-row')[0].innerText, 'Shake');
    t.has('…on separate lines', c.$$('.slot-row')[0].innerText, 'Eggs on toast');
    await c.click('.slot-row.multi .add-to[data-day="0"][data-slot="breakfast"]', 60);
    t.has('+ opens "Add to Mon breakfast"', c.modalText(), 'Add to Mon breakfast');
    await c.click('#modal [data-action="pick-recipe"][data-id="cur"]', 60);
    await c.click('[data-action="save-slot"]', 120);
    w0 = await plan();
    t.eq('Saved as a third item, the others untouched', w0.days[0].slots.breakfast.map(x => x.recipeId), ['shake', 'egg', 'cur']);
    await c.click(`[data-action="edit-slot"][data-item="${w0.days[0].slots.breakfast[2].id}"]`, 60);
    await c.click('[data-action="clear-slot"]', 120);
    t.eq('Remove takes out just that item', (await plan()).days[0].slots.breakfast.map(x => x.id), ['sh', 'eg']);
    await c.click('[data-action="edit-slot"][data-day="1"][data-slot="lunch"]', 60);
    t.eq('Leftovers sheet names the exact item they come from', c.$('#modal [data-m="src"]').value, '0|dinner|cu');
    await c.click('[data-action="close-modal"]');
    // Tuesday's leftovers of Monday's curry, which was never cooked: none to eat (unless Monday is still to come).
    await c.go(day(1));
    const lunchSub = c.card('lunch').querySelector('.item-sub');
    t.eq('Leftovers whose cook never happened: none in the larder, flagged',
      [lunchSub.innerText, lunchSub.classList.contains('warn-text')], day(0) >= c.w.__mp.today() ? ['from the larder once cooked', false] : ['none in the larder', true]);

    // The phone: plans and logs saved before 2.5.0 are brought up to date when the app opens.
    await new Promise((res, rej) => {
      const q = c.w.indexedDB.open('meal-planner-test');
      q.onsuccess = () => {
        const tx = q.result.transaction(['weekPlans', 'mealLogs'], 'readwrite');
        tx.objectStore('weekPlans').put(weekPlan('old', 2, { 0: { lunch: { recipeId: 'cur', servings: 1, cook: null } }, 1: { dinner: { leftoverOf: { day: 0, slot: 'lunch' }, servings: 1 } } }));
        tx.objectStore('mealLogs').put(mk('ol', { date: day(14), slot: 'lunch', recipeId: 'cur', servings: 1, proteinG: 49, planned: true, extra: false }));
        tx.oncomplete = () => { q.result.close(); res(); }; tx.onerror = () => rej(tx.error);
      };
    });
    c.w.location.reload(); await sleep(400);
    await until(() => c.w.__mp && c.w.__mp.ready, 10000, 'the app to reopen');
    const old = (await c.all('weekPlans')).find(p => p.id === 'old'), lunch = old.days[0].slots.lunch;
    t.ok('On opening, an old saved plan becomes lists with ids, its leftovers pointing at the item',
      Array.isArray(lunch) && !!lunch[0].id && old.days[1].slots.dinner[0].leftoverOf.item === lunch[0].id);
    t.eq('…and an old saved log points at its item', (await c.all('mealLogs')).find(l => l.id === 'ol').item, lunch[0].id);
  });

  scenario('Kitty litter: "Keep at least" tops up the list (2.4.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('litter', { name: 'Kitty litter', defaultUnit: 'bag', store: 'Pet shop', aisle: '', location: 'Pantry Ground' }),
        mk('rice2', { name: 'Basmati rice', defaultUnit: 'g', store: 'Supermarket', aisle: '3', packQty: 1, packUnit: 'kg', keepQty: 2, keepUnit: 'kg' }),
        mk('junk2', { name: 'Junk keep', defaultUnit: 'g', store: 'Supermarket', aisle: '', keepQty: 'lots', keepUnit: 3 })],
      recipes: [mk('rb', { name: 'Rice bowl XL', servings: 1, proteinPerServingG: 30, lactose: 'none', tags: [], method: '',
        ingredients: [{ ingredientId: 'rice2', qty: 1200, unit: 'g' }] })],
      weekPlans: [weekPlan('wk0', 0, { 1: { dinner: { recipeId: 'rb', servings: 1, cook: null } } })],
      pantryItems: [mk('pl', { ingredientId: 'litter', qty: 2, unit: 'bag', location: 'Pantry Ground' }),
        mk('pr', { ingredientId: 'rice2', qty: 1.5, unit: 'kg', location: 'Pantry Shelf 1' })],
    }));
    const junk = (await c.all('ingredients')).find(i => i.id === 'junk2');
    t.eq('Junk "Keep at least" dropped, record kept', junk ? [junk.keepQty, junk.keepUnit].map(v => v === undefined ? 'dropped' : v) : 'rejected', ['dropped', 'dropped']);
    // Name suggestions are the app's own (no <datalist>, whose popup Android Chrome left floating after a redraw).
    await c.tab('pantry'); await c.click('[data-action="add-pantry"]');
    const nameBox = c.$('#modal [data-m="draft.name"]');
    nameBox.value = 'kit'; nameBox.dispatchEvent(new c.w.Event('input', { bubbles: true })); await sleep(40);
    t.eq('Typing "kit" suggests Kitty litter', c.$$('#modal .suggest button').map(b => b.innerText), ['Kitty litter']);
    t.ok('No native datalist anywhere in the sheet', !c.$('#modal datalist') && !c.$('#modal input[list]'));
    await c.click(c.$('#modal .suggest button'), 150);
    t.eq('Tapping it fills the name, unit and location', [c.$('#modal [data-m="draft.name"]').value, c.$('#modal [data-m="draft.unit"]').value,
      c.$('#modal [data-m="draft.location"]').value, !!c.$('#modal .suggest')], ['Kitty litter', 'bag', 'Pantry Ground', false]);
    await c.click('[data-action="close-modal"]');
    // Set it from the Larder, where the stock is.
    await c.tab('pantry');
    await c.click(c.loc('Pantry Ground').querySelector('[data-action="edit-pantry"]'));
    await c.set('#modal [data-m="draft.keepQty"]', '2');
    t.eq('Unit offers bag', c.$('#modal [data-m="draft.keepUnit"]').value, 'bag');
    await c.click('[data-action="save-pantry"]', 150);
    const lit = (await c.all('ingredients')).find(i => i.id === 'litter');
    t.eq('Saved on the item: keep at least 2 bags', [lit.keepQty, lit.keepUnit], [2, 'bag']);
    const minLine = () => { const m = c.loc('Pantry Ground').querySelector('.qty .min'); return m ? [m.innerText, m.classList.contains('warn-text')] : null; };
    t.eq('Under the amount: Min: 2 bag (not flagged at 2)', minLine(), ['Min: 2 bag', false]);
    // Search: only matching rows, only locations that have one; fold state isn't remembered.
    c.loc('Pantry Ground').open = false; await sleep(60);      // closed, so a search opening it would show
    const folds = localStorage.getItem('mpt.larderOpen');
    await c.set('#larder-q', 'LITT');
    const shown = () => c.$$('.larder-loc').map(x => x.querySelector('.loc-name').innerText.trim() + ':' + [...x.querySelectorAll('.pantry-row .larder-name')].map(b => b.childNodes[0].textContent.trim()).join(','));
    t.eq('Search "LITT": just Pantry Ground, just the litter', shown(), ['Pantry Ground:Kitty litter']);
    const buttonsShown = () => !!c.$('.larder-actions').offsetParent;
    t.ok('While searching, the heading and buttons step aside (results fit above the keyboard)', !buttonsShown());
    t.ok('…opened without being typed into it again', c.$('#larder-q') && c.$('#larder-q').value === 'LITT');
    await c.set('#larder-q', 'zzz');
    t.has('No match says so', c.$('#larder-body').innerText, 'Nothing in the larder matches');
    await c.set('#larder-q', '');
    c.$('#larder-q').blur(); await sleep(30);
    t.ok('Cleared and left: the buttons are back', buttonsShown());
    t.eq('Cleared: every location back', shown().map(x => x.split(':')[0]), ['Pantry Shelf 1', 'Pantry Ground']);
    t.eq('Searching didn\'t change which locations stay open', localStorage.getItem('mpt.larderOpen'), folds);
    await c.shop(day(0)); await c.click('[data-action="regenerate"]', 300);
    t.eq('2 bags in the Larder: nothing to buy', c.shopText('Kitty litter'), '(no line)');
    t.has('Rice: 1.2 kg for the bowl + keep 2 kg − 1.5 kg on hand = 2 × 1 kg', c.shopText('Basmati rice'), '2 × 1 kg');
    t.has('…and says why', c.shopText('Basmati rice'), 'keep at least 2 kg');
    // Finish a bag.
    await c.tab('pantry');
    await c.click(c.loc('Pantry Ground').querySelector('[data-action="pantry-step"][data-d="-1"]'), 120);
    t.eq('Down to 1: Min: 2 bag turns orange', minLine(), ['Min: 2 bag', true]);
    await c.shop(day(0)); await c.click('[data-action="regenerate"]', 300);
    t.eq('Down to 1: one bag goes on the list', c.shopText('Kitty litter').split(' | ').slice(0, 2), ['Kitty litter', '1 bag']);
    t.has('…marked keep at least', c.shopText('Kitty litter'), 'keep at least 2 bag');
    t.has('Now doc mentions the minimum', c.w.__mp.nowDoc(), 'Kitty litter 1 bag (keep at least 2 bag, below it)');
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.eq('Next week\'s list takes it over, once', c.shopText('Kitty litter').split(' | ').slice(0, 2), ['Kitty litter', '1 bag']);
    await c.shop(day(0)); await c.click('[data-action="regenerate"]', 300);
    t.eq('This week\'s list doesn\'t add it again while next week\'s has it', c.shopText('Kitty litter'), '(no line)');
    await c.shop(day(7));
    await c.click(c.shopRow('Kitty litter').querySelector('[data-action="tick"]'), 150);
    t.ok('Bought: back to 2 bags', (await c.larder()).includes('litter:2bag@Pantry Ground'), await c.larder());
    await c.click('[data-action="regenerate"]', 300);
    t.eq('Regenerated: just the ticked line', c.$$('.shop-row').filter(r => r.textContent.includes('Kitty litter')).map(r => !!r.querySelector('.shop-item.checked')), [true]);
    // Clearing it.
    await c.tab('pantry');
    await c.click(c.loc('Pantry Ground').querySelector('[data-action="edit-pantry"]'));
    await c.set('#modal [data-m="draft.keepQty"]', '');
    await c.click('[data-action="save-pantry"]', 150);
    t.eq('Blank clears it', (await c.all('ingredients')).find(i => i.id === 'litter').keepQty, undefined);
    // A week with no meals planned still gets its top-ups.
    await c.tab('pantry');
    await c.click(c.loc('Pantry Ground').querySelector('[data-action="edit-pantry"]'));
    await c.set('#modal [data-m="draft.keepQty"]', '3');
    await c.click('[data-action="save-pantry"]', 150);
    await c.shop(day(14)); await c.click('[data-action="regenerate"]', 300);
    t.eq('Nothing planned in 2 weeks: still tops up to 3', c.shopText('Kitty litter').split(' | ').slice(0, 2), ['Kitty litter', '1 bag']);
  });

  scenario('One list: generate any time, it covers everything up to that week (2.6.0)', async (c, t) => {
    // Brad's Sunday: this week's list (Sunday's mornay, cat biscuits, soy top-up) and next week's list were separate,
    // so the cat biscuits were only on the first. Now the later list takes in the earlier one.
    await c.importJson(patch({
      ingredients: [mk('cat', { name: 'Cat biscuits', defaultUnit: 'pack', store: 'PetStock', aisle: '', keepQty: 2, keepUnit: 'pack' }),
        mk('soy3', { name: 'Soy sauce', defaultUnit: 'ml', store: 'Supermarket', aisle: 'Pantry', keepQty: 160, keepUnit: 'ml' }),
        mk('corn', { name: 'Cornflour', defaultUnit: 'g', store: 'Supermarket', aisle: '7' }),
        mk('chk3', { name: 'Chicken thigh fillets', defaultUnit: 'g', store: 'Supermarket', aisle: 'Meat' })],
      recipes: [mk('tm', { name: 'Tuna mornay', servings: 1, proteinPerServingG: 55, lactose: 'contains', tags: [], method: '', ingredients: [{ ingredientId: 'corn', qty: 15, unit: 'g' }] }),
        mk('bb', { name: 'Burrito bowl', servings: 1, proteinPerServingG: 67, lactose: 'none', tags: [], method: '',
          ingredients: [{ ingredientId: 'chk3', qty: 600, unit: 'g' }, { ingredientId: 'soy3', qty: 30, unit: 'ml' }] })],
      weekPlans: [weekPlan('ow0', 0, { 6: { dinner: { recipeId: 'tm', servings: 1, cook: null } } }),
        weekPlan('ow1', 1, { 0: { dinner: { recipeId: 'bb', servings: 1, cook: null } } })],
      pantryItems: [mk('pc', { ingredientId: 'cat', qty: 1, unit: 'pack', location: 'Storage' }),
        mk('ps', { ingredientId: 'soy3', qty: 40, unit: 'ml', location: 'Fridge' })],
    }));
    const qty = name => c.shopText(name).split(' | ').slice(0, 2);
    const unbought = async week => (await c.all('shoppingItems')).filter(i => i.weekStart === week && !i.checked);
    await c.shop(day(0)); await c.click('[data-action="regenerate"]', 300);
    t.eq('This week: cat biscuits, soy top-up, cornflour', [qty('Cat biscuits'), qty('Soy sauce'), qty('Cornflour')],
      [['Cat biscuits', '1 pack'], ['Soy sauce', '120 ml'], ['Cornflour', '15 g']]);
    await c.click('[data-action="add-item"]');
    await c.set('#modal [data-m="draft.text"]', 'Dog treats'); await c.set('#modal [data-m="draft.qty"]', '1'); await c.set('#modal [data-m="draft.unit"]', 'pack');
    await c.click('[data-action="save-item"]', 120);
    await c.click(c.shopRow('Cornflour').querySelector('[data-action="tick"]'), 150);
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.eq('Next week\'s list keeps the cat biscuits', qty('Cat biscuits'), ['Cat biscuits', '1 pack']);
    t.eq('…soy: 30 ml for the bowl + top-up to 160 ml − 40 ml = 150 ml, once', qty('Soy sauce'), ['Soy sauce', '150 ml']);
    t.eq('…and next week\'s chicken', qty('Chicken thigh fillets'), ['Chicken thigh fillets', '600 g']);
    t.eq('Bought cornflour isn\'t bought again', qty('Cornflour'), ['(no line)']);
    t.has('Hand-added item carried over', c.shopText('Dog treats'), 'carried over');
    t.eq('Nothing left unbought on this week\'s list', (await unbought(day(0))).length, 0);
    t.ok('The ticked cornflour stays on this week\'s list', (await c.all('shoppingItems')).some(i => i.weekStart === day(0) && i.ingredientId === 'corn' && i.checked));
    await c.click('[data-action="regenerate"]', 300);
    t.eq('Regenerating doesn\'t duplicate it', c.$$('.shop-row').filter(r => r.innerText.includes('Dog treats')).length, 1);
    t.has('Header says what it covers', c.$('.day-sub').innerText, 'covers now to');
    t.eq('Shop tab opens on the list to shop from', c.w.__mp.shopListWeek(), day(7));
    const doc = c.w.__mp.nowDoc();
    t.has('Now doc shows the list with the cat biscuits', doc, 'Cat biscuits — 1 pack');
    t.eq('…and only that one', (doc.match(/Shopping list, week of/g) || []).length, 1);
    // A hand-added item for this week (e.g. a quick add) left behind after the list was generated still moves on.
    await c.shop(day(0));
    await c.click('[data-action="add-item"]');
    await c.set('#modal [data-m="draft.text"]', 'Milk'); await c.set('#modal [data-m="draft.qty"]', '1'); await c.set('#modal [data-m="draft.unit"]', 'L');
    await c.click('[data-action="save-item"]', 120);
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    t.has('Regenerating picks it up', c.shopText('Milk'), 'carried over');
    // Generating this week's list on its own still works, and doesn't repeat what next week's has.
    await c.shop(day(0)); await c.click('[data-action="regenerate"]', 300);
    t.eq('This week again: cornflour is ticked, no repeat top-ups', [qty('Cat biscuits'), qty('Soy sauce')], [['(no line)'], ['(no line)']]);
    // A quick add from Claude (written for this week's Monday) lands on the list being shopped from.
    await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
    fakeDrive(c, [{ parent: INBOX, name: 'patch-quick-add.json', text: patch({ shoppingItems: [mk('qa', { weekStart: day(0), ingredientId: null, text: 'Bin bags', qty: 1, unit: 'pack', store: 'Supermarket', aisle: '', checked: false, price: null, isLocal: false, manual: true, forRecipes: '' })] }, { note: 'Add bin bags' }) }]);
    await c.settings();
    await c.set('[data-drive="inboxId"]', INBOX); await c.set('[data-drive="outboxId"]', OUTBOX);
    await c.click('[data-action="drive-test"]', 1500);
    t.eq('Quick add went onto next week\'s list', ((await c.all('shoppingItems')).find(i => i.id === 'qa') || {}).weekStart, day(7));
  });

  scenario('Pepsi Max: one item in two places (2.0.2)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('pepsi', { name: 'Pepsi Max (375 mL can)', defaultUnit: 'each', store: 'Supermarket', aisle: '7', location: 'Pantry Ground' })],
      recipes: [mk('can', { name: 'Pepsi Max', servings: 1, proteinPerServingG: 0, lactose: 'none', tags: [], method: '', ingredients: [{ ingredientId: 'pepsi', qty: 1, unit: 'each' }] })],
    }));
    const addTo = async (qty, loc) => {
      await c.tab('pantry'); await c.click('[data-action="add-pantry"]');
      await c.set('#modal [data-m="draft.name"]', 'Pepsi Max (375 mL can)');
      await c.set('#modal [data-m="draft.qty"]', String(qty)); await c.set('#modal [data-m="draft.location"]', loc);
      await c.click('[data-action="save-pantry"]', 150);
    };
    await addTo(5, 'Fridge');
    await addTo(30, 'Pantry Ground');
    t.eq('5 in the Fridge and 30 on Pantry Ground, separately', await c.larder(), ['pepsi:30each@Pantry Ground', 'pepsi:5each@Fridge']);
    await addTo(1, 'Fridge');
    t.eq('Adding 1 more to the Fridge joins the same row (6)', await c.larder(), ['pepsi:30each@Pantry Ground', 'pepsi:6each@Fridge']);
    await c.tab('pantry');
    t.eq('Larder actions sit at the top', c.$$('.larder-actions .btn').map(b => b.innerText.trim()), ['+ Add to larder', '🍲 + Prepared meal', '🍞 Baked sourdough', '🥚 Collected eggs']);
    t.ok('Locations start closed', c.$$('.larder-loc').length === 2 && c.$$('.larder-loc').every(x => !x.open), c.$$('.larder-loc').map(x => x.open));
    c.loc('Fridge').dispatchEvent(new c.w.Event('toggle'));   // what the browser fires when it's tapped open
    await c.click(c.loc('Fridge').querySelector('[data-action="pantry-step"][data-d="-1"]'), 120);
    t.ok('An opened location stays open after + / −', c.$$('.larder-loc').find(x => x.querySelector('.loc-name').innerText === 'Fridge').open);
    t.eq('…and the − worked', await c.larder(), ['pepsi:30each@Pantry Ground', 'pepsi:5each@Fridge']);
    await c.go(c.w.__mp.today());
    await c.click('[data-action="add-to"][data-slot="snack"]', 60);
    await c.click('#modal [data-action="pick-recipe"][data-id="can"]', 60);
    await c.click('[data-action="save-log"]', 150);
    t.eq('Drinking one takes it from the fridge', await c.larder(), ['pepsi:30each@Pantry Ground', 'pepsi:4each@Fridge']);
    await c.click('[data-action="undo-log"]', 150);
    t.eq('Undo puts it back in the fridge', await c.larder(), ['pepsi:30each@Pantry Ground', 'pepsi:5each@Fridge']);
    await c.importJson(patch({ shoppingItems: [mk('si', { weekStart: day(0), ingredientId: 'pepsi', text: null, qty: 24, unit: 'each', checked: false, manual: false })] }));
    await c.shop(day(0));
    await c.click('[data-action="tick"]', 150);
    t.eq('Ticking 24 adds them to the usual spot', await c.larder(), ['pepsi:54each@Pantry Ground', 'pepsi:5each@Fridge']);
    await c.click('[data-action="tick"]', 150);
    t.eq('Unticking takes them from the same spot', await c.larder(), ['pepsi:30each@Pantry Ground', 'pepsi:5each@Fridge']);
    await c.tab('pantry');
    await c.click(c.loc('Fridge').querySelector('[data-action="edit-pantry"]'));
    await c.set('#modal [data-m="draft.location"]', 'Pantry Ground');
    await c.click('[data-action="save-pantry"]', 150);
    t.eq('Moving the fridge row onto Pantry Ground merges them', await c.larder(), ['pepsi:35each@Pantry Ground']);
    // Move: 6 of the 35 cans into the fridge, without retyping the item.
    const moveFrom = async (loc, n, to) => {
      await c.tab('pantry');
      await c.click(c.loc(loc).querySelector('[data-action="edit-pantry"]'));
      await c.click('#modal [data-action="move-open"]', 60);
      if (n === 'all') await c.click('#modal [data-action="move-all"]', 40); else await c.set('#modal [data-m="n"]', String(n));
      await c.click(`#modal [data-action="move-to"][data-loc="${to}"]`, 150);
    };
    await moveFrom('Pantry Ground', 6, 'Fridge');
    t.eq('Move 6 to the Fridge: 29 left on Pantry Ground, 6 in the Fridge', await c.larder(), ['pepsi:29each@Pantry Ground', 'pepsi:6each@Fridge']);
    await moveFrom('Pantry Ground', 6, 'Fridge');
    t.eq('Moving 6 more joins the Fridge row (12)', await c.larder(), ['pepsi:12each@Fridge', 'pepsi:23each@Pantry Ground']);
    await moveFrom('Fridge', 'all', 'Pantry Ground');
    t.eq('Moving all of it back leaves no empty Fridge row', await c.larder(), ['pepsi:35each@Pantry Ground']);
    // Prepared meals move the same way and keep their cook date.
    await c.importJson(patch({ pantryItems: [mk('pp', { recipeId: 'can', qty: 3, unit: 'portion', location: 'Freezer', cookedOn: day(0) })] }));
    await c.tab('pantry');
    await c.click(c.loc('Freezer').querySelector('[data-action="edit-portion"]'));
    await c.click('#modal [data-action="move-open"]', 60);
    await c.click('#modal [data-action="move-to"][data-loc="Fridge"]', 150);
    const meals = (await c.all('pantryItems')).filter(x => x.recipeId === 'can').map(x => `${x.qty}@${x.location}:${x.cookedOn === day(0)}`).sort();
    t.eq('A prepared meal moves 1 to the Fridge, keeping its cook date', meals, ['1@Fridge:true', '2@Freezer:true']);
    await c.click('[data-action="add-pantry"]');
    await c.set('#modal [data-m="draft.name"]', 'Pepsi Max (375 mL can)'); await sleep(60);
    const unitEl = c.$('#modal [data-m="draft.unit"]');
    t.eq('Larder unit is a dropdown offering only units that match (each)', [unitEl.tagName, [...unitEl.options].map(o => o.textContent)], ['SELECT', ['each']]);
    await c.click('[data-action="close-modal"]');
    await c.importJson(patch({ pantryItems: [mk('odd', { ingredientId: 'pepsi', qty: 3, unit: 'cans', location: 'Fridge' })] }));
    await c.tab('pantry');
    await c.click(c.loc('Fridge').querySelector('[data-action="edit-pantry"][data-id="odd"]'));
    t.eq('An odd unit already set is kept but labelled', [...c.$('#modal [data-m="draft.unit"]').options].map(o => o.textContent), ['each', "cans (doesn't match recipes)"]);
    await c.click('[data-action="close-modal"]');
    // Rename from the Larder (2.12.0): Edit ingredient renames the same ingredient, no duplicate.
    const before = (await c.all('ingredients')).length;
    await c.tab('pantry');
    await c.click(c.loc('Fridge').querySelector('[data-action="edit-pantry"][data-id="odd"]'));
    await c.click('#modal [data-action="edit-ingredient"]', 60);
    await c.set('#modal [data-m="draft.name"]', 'Pepsi Max can');
    await c.click('#modal [data-action="save-ingredient"]', 150);
    const ings = await c.all('ingredients');
    t.eq('Edit ingredient from a Larder row renames it in place', [ings.length, (ings.find(i => i.id === 'pepsi') || {}).name], [before, 'Pepsi Max can']);
    t.ok('The Larder shows the new name', c.loc('Fridge').innerText.includes('Pepsi Max can'), c.loc('Fridge').innerText);
    t.ok('…and the recipe uses it', (await c.all('recipes')).find(r => r.id === 'can').ingredients[0].ingredientId === 'pepsi');
  });

  scenario('Store folds: each store opens and shuts, remembered (2.8.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('milk', { name: 'Milk', defaultUnit: 'L', store: 'Supermarket', aisle: '2' }),
        mk('bread', { name: 'Bread', defaultUnit: 'each', store: 'Supermarket', aisle: '3' }),
        mk('steak', { name: 'Steak', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' })],
      shoppingItems: [mk('s1', { weekStart: day(0), ingredientId: 'milk', text: null, qty: 2, unit: 'L', checked: false, manual: false }),
        mk('s2', { weekStart: day(0), ingredientId: 'bread', text: null, qty: 1, unit: 'each', checked: false, manual: false }),
        mk('s3', { weekStart: day(0), ingredientId: 'steak', text: null, qty: 500, unit: 'g', checked: false, manual: false })],
    }));
    await c.shop(day(0));
    const opens = () => c.$$('.shop-store').map(x => x.dataset.store + ':' + (x.open ? 'open' : 'shut'));
    const head = name => c.store(name).querySelector('summary').innerText.replace(/\s+/g, ' ');
    t.eq('Every store starts open', opens(), ['Butcher:open', 'Supermarket:open']);
    c.store('Butcher').querySelector('summary').click(); await sleep(60);
    t.eq('Tapping a store\'s heading shuts it', opens(), ['Butcher:shut', 'Supermarket:open']);
    t.has('…and the heading still shows its progress', head('Butcher'), '0 of 1 in trolley');
    await c.click('[data-action="tick"][data-id="s1"]', 150);
    t.eq('Ticking something keeps the folds as they were', opens(), ['Butcher:shut', 'Supermarket:open']);
    await c.shop(day(7)); await c.shop(day(0));
    t.eq('Leaving and coming back keeps them too', opens(), ['Butcher:shut', 'Supermarket:open']);
    await c.click('[data-action="tick"][data-id="s2"]', 150);
    t.eq('Ticking the last thing in a store shuts it', opens(), ['Butcher:shut', 'Supermarket:shut']);
    t.has('…marked done', head('Supermarket'), '✓ 2 of 2');
    await c.click('[data-action="tick"][data-id="s2"]', 150);
    t.eq('Unticking leaves it as it is', opens(), ['Butcher:shut', 'Supermarket:shut']);
    t.has('One button: Expand all (everything is shut)', c.$('[data-action="shop-fold-all"]').innerText, 'Expand all');
    await c.click('[data-action="shop-fold-all"]', 100);
    t.eq('Expand all opens every store', opens(), ['Butcher:open', 'Supermarket:open']);
    t.has('…and the button now says Collapse all', c.$('[data-action="shop-fold-all"]').innerText, 'Collapse all');
    await c.click('[data-action="shop-fold-all"]', 100);
    t.eq('Collapse all shuts every store', opens(), ['Butcher:shut', 'Supermarket:shut']);
    t.eq('Kept on this device', JSON.parse(localStorage.getItem('mpt.shopClosed')).sort(), ['Butcher', 'Supermarket']);
    c.store('Butcher').querySelector('summary').click(); await sleep(60);
    await c.shop(day(7)); await c.shop(day(0));
    t.eq('Opening one by hand is remembered', opens(), ['Butcher:open', 'Supermarket:shut']);
  });

  scenario('Two Woolworths: aisles kept per branch, picked on the list (2.17.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('milk', { name: 'Milk', defaultUnit: 'L', store: 'Supermarket', aisle: '2' }),
        mk('bread', { name: 'Bread', defaultUnit: 'each', store: 'Supermarket', aisle: '3' }),
        mk('steak', { name: 'Steak', defaultUnit: 'g', store: 'Butcher', aisle: 'Meat' }),
        mk('junk', { name: 'Junk', defaultUnit: 'each', store: 'Supermarket', aisle: '4', aisles: 'not an object' })],
      shoppingItems: [mk('s1', { weekStart: day(0), ingredientId: 'milk', text: null, qty: 2, unit: 'L', checked: false, manual: false }),
        mk('s2', { weekStart: day(0), ingredientId: 'bread', text: null, qty: 1, unit: 'each', checked: false, manual: false }),
        mk('s3', { weekStart: day(0), ingredientId: 'steak', text: null, qty: 500, unit: 'g', checked: false, manual: false }),
        mk('s4', { weekStart: day(0), ingredientId: null, text: 'Foil', store: 'Supermarket', aisle: '9', checked: false, manual: true })],
    }));
    t.ok('A bad aisles field from a file is dropped', !('aisles' in (await c.all('ingredients')).find(i => i.id === 'junk')));
    const heads = store => [...c.store(store).querySelectorAll('.aisle')].map(a => a.textContent);
    await c.shop(day(0));
    t.ok('No branches set up: no "Shopping at" anywhere', !c.$('.branch-pick'));
    t.eq('Aisles as before', heads('Supermarket'), ['Aisle 2', 'Aisle 3', 'Aisle 9']);

    await c.settings();
    await c.set('[data-setting="branches"]', 'Supermarket: Mundaring, Kalamunda\nButcher: Only one');
    const st = (await c.all('settings'))[0];
    t.eq('Branches saved; a store with one branch is ignored', st.branches, { Supermarket: ['Mundaring', 'Kalamunda'] });

    await c.shop(day(0));
    t.ok('Supermarket asks which branch', !!c.store('Supermarket').querySelector('select[data-shop-at]'));
    t.ok('…the Butcher doesn\'t', !c.store('Butcher').querySelector('.branch-pick'));
    t.eq('Starts at the first branch, with the aisles you already had', [c.$('[data-shop-at]').value, ...heads('Supermarket')], ['Mundaring', 'Aisle 2', 'Aisle 3', 'Aisle 9']);

    await c.set('[data-shop-at="Supermarket"]', 'Kalamunda');
    t.eq('At Kalamunda nothing is mapped yet', heads('Supermarket'), ['Not mapped at Kalamunda yet']);
    t.has('…each item shows its Mundaring aisle as a hint', c.shopText('Milk'), 'Mundaring: Aisle 2');
    t.eq('The choice is kept with the data', (await c.all('settings'))[0].shopAt, { Supermarket: 'Kalamunda' });

    await c.click('[data-action="edit-item"][data-id="s1"]', 60);
    t.has('The aisle box says which branch it\'s for', c.modalText(), 'Aisle at Kalamunda');
    await c.set('#modal [data-m="draft.aisle"]', '7');
    await c.click('#modal [data-action="save-item"]', 80);
    await c.click('[data-action="edit-item"][data-id="s4"]', 60);
    await c.set('#modal [data-m="draft.aisle"]', '12');
    await c.click('#modal [data-action="save-item"]', 80);
    const milk = (await c.all('ingredients')).find(i => i.id === 'milk');
    t.eq('Kalamunda\'s aisle is saved beside Mundaring\'s', [milk.aisle, milk.aisles], ['2', { Kalamunda: '7' }]);
    t.eq('Mapped items sort into Kalamunda\'s aisles', heads('Supermarket'), ['Aisle 7', 'Aisle 12', 'Not mapped at Kalamunda yet']);
    t.eq('…and a hand-added item keeps both too', (await c.all('shoppingItems')).filter(i => i.id === 's4').map(i => [i.aisle, i.aisles]), [['9', { Kalamunda: '12' }]]);

    await c.set('[data-shop-at="Supermarket"]', 'Mundaring');
    t.eq('Back at Mundaring, its aisles are untouched', heads('Supermarket'), ['Aisle 2', 'Aisle 3', 'Aisle 9']);
    t.eq('The Butcher never changed', heads('Butcher'), ['Meat']);
  });

  scenario('Flavours: WPI kept by flavour, any one makes the shake (2.18.0)', async (c, t) => {
    await c.importJson(patch({
      ingredients: [mk('wpi', { name: 'WPI', defaultUnit: 'g', store: 'Costco', aisle: '1', flavours: ['Chocolate', 'Vanilla'], location: 'Pantry Shelf 1' }),
        mk('oats', { name: 'Oats', defaultUnit: 'g', store: 'Costco', aisle: '2', location: 'Pantry Shelf 1' })],
      recipes: [mk('shake', { name: 'WPI shake', servings: 1, proteinPerServingG: 36, lactose: 'low', tags: [], method: '', isShake: true,
        ingredients: [{ ingredientId: 'wpi', qty: 40, unit: 'g' }, { ingredientId: 'oats', qty: 30, unit: 'g' }] })],
      pantryItems: [mk('p1', { ingredientId: 'wpi', qty: 500, unit: 'g', location: 'Pantry Shelf 1', flavour: 'Chocolate' }),
        mk('p2', { ingredientId: 'wpi', qty: 1000, unit: 'g', location: 'Pantry Shelf 1', flavour: 'Vanilla' }),
        mk('p3', { ingredientId: 'oats', qty: 1000, unit: 'g', location: 'Pantry Shelf 1', flavour: 42 })],
      weekPlans: [weekPlan('w0', 0, { 0: { breakfast: [{ id: 'sh', recipeId: 'shake', servings: 1, cook: null }] } })],
      shoppingItems: [mk('s1', { weekStart: day(0), ingredientId: 'wpi', text: null, qty: 1000, unit: 'g', checked: false, manual: false })],
    }));
    const stock = async () => (await c.all('pantryItems')).filter(p => p.ingredientId === 'wpi').map(p => `${p.flavour || '-'}:${p.qty}`).sort();
    t.ok('A flavour that isn\'t text is dropped from a file', !('flavour' in (await c.all('pantryItems')).find(p => p.id === 'p3')));

    await c.tab('pantry');
    const shelf = c.loc('Pantry Shelf 1').innerText;
    t.ok('The larder lists each flavour on its own', shelf.includes('Chocolate') && shelf.includes('Vanilla'));
    t.ok('…an ingredient without flavours looks as before', !/flavour not set/.test(shelf));

    // Eating the shake takes from the flavour with the least left (finish the open bag).
    await c.go(day(0));
    await c.click(c.card('breakfast').querySelector('[data-action="eat"][data-item="sh"]'), 150);
    t.eq('The shake took 40 g of Chocolate (the one with less left)', await stock(), ['Chocolate:460', 'Vanilla:1000']);
    const pick = () => c.card('breakfast').querySelector('select[data-flavour-log]');
    t.eq('The eaten shake says which flavour it took', pick() && pick().value, 'Chocolate');
    t.ok('…but not for oats, which has no flavours', !c.card('breakfast').querySelector('select[data-ing="oats"]'));
    await c.set('select[data-flavour-log]', 'Vanilla');
    t.eq('Switching to Vanilla puts the Chocolate back and takes Vanilla', await stock(), ['Chocolate:500', 'Vanilla:960']);
    t.eq('…and the card now says Vanilla', pick().value, 'Vanilla');
    await c.click(c.card('breakfast').querySelector('[data-action="undo-log"]'), 150);
    t.eq('Undo puts the Vanilla back', await stock(), ['Chocolate:500', 'Vanilla:1000']);

    // Shopping: say which flavour was bought; a new one joins the list.
    await c.shop(day(0));
    await c.click('[data-action="edit-item"][data-id="s1"]', 60);
    await c.set('#modal [data-m="draft.flavour"]', 'Cookies');
    await c.click('#modal [data-action="save-item"]', 80);
    t.has('The line shows the flavour it\'ll go in as', c.shopText('WPI'), 'Cookies');
    await c.click('[data-action="tick"][data-id="s1"]', 150);
    t.eq('Ticked: in the larder as Cookies', await stock(), ['Chocolate:500', 'Cookies:1000', 'Vanilla:1000']);
    let wpi = (await c.all('ingredients')).find(i => i.id === 'wpi');
    t.eq('Cookies joins WPI\'s flavours and is remembered for next time', [wpi.flavours, wpi.lastFlavour], [['Chocolate', 'Vanilla', 'Cookies'], 'Cookies']);
    await c.click('[data-action="edit-item"][data-id="s1"]', 60);
    await c.set('#modal [data-m="draft.flavour"]', 'Vanilla');
    await c.click('#modal [data-action="save-item"]', 80);
    t.eq('Changing the flavour after ticking moves the stock', await stock(), ['Chocolate:500', 'Cookies:0', 'Vanilla:2000']);

    // The larder sheet and the ingredient sheet.
    await c.tab('pantry');
    await c.click(c.loc('Pantry Shelf 1').querySelector('[data-action="edit-pantry"][data-id="p1"]'), 60);
    t.eq('The larder sheet has the flavour', c.$('#modal [data-m="draft.flavour"]').value, 'Chocolate');
    await c.click('#modal [data-action="edit-ingredient"]', 60);
    t.eq('The ingredient sheet lists its flavours, one per line', c.$('#modal [data-m="draft.flavoursText"]').value, 'Chocolate\nVanilla\nCookies');
    await c.set('#modal [data-m="draft.flavoursText"]', 'Chocolate\nVanilla');
    await c.click('#modal [data-action="save-ingredient"]', 80);
    wpi = (await c.all('ingredients')).find(i => i.id === 'wpi');
    t.eq('…and saves them from there', wpi.flavours, ['Chocolate', 'Vanilla']);
  });

  scenario('Use by: dates on larder stock, amber when close, red past use-by (2.19.0)', async (c, t) => {
    const off = n => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return ymd(d); };
    await c.importJson(patch({
      ingredients: ['milk', 'chicken', 'rice', 'oats', 'jam'].map(id => mk(id, { name: id[0].toUpperCase() + id.slice(1), defaultUnit: 'g', store: 'Supermarket', aisle: '1' })),
      pantryItems: [mk('p-milk', { ingredientId: 'milk', qty: 1000, unit: 'g', location: 'Fridge', useBy: off(2) }),
        mk('p-chicken', { ingredientId: 'chicken', qty: 500, unit: 'g', location: 'Fridge', useBy: off(-1) }),
        mk('p-rice', { ingredientId: 'rice', qty: 1000, unit: 'g', location: 'Pantry Shelf 1', bestBefore: off(-1) }),
        mk('p-oats', { ingredientId: 'oats', qty: 1000, unit: 'g', location: 'Pantry Shelf 1', useBy: off(30) }),
        mk('p-jam', { ingredientId: 'jam', qty: 300, unit: 'g', location: 'Pantry Shelf 1', useBy: 'soon', bestBefore: 12 })],
    }));
    const jam = (await c.all('pantryItems')).find(p => p.id === 'p-jam');
    t.ok('Dates that aren\'t YYYY-MM-DD are dropped from a file', !('useBy' in jam) && !('bestBefore' in jam));
    await c.tab('pantry');
    const row = id => c.$(`[data-action="edit-pantry"][data-id="${id}"]`).closest('.pantry-row');
    const level = id => (row(id).className.match(/date-(warn|bad)/) || [])[1] || '';
    c.loc('Fridge'); c.loc('Pantry Shelf 1');
    t.eq('Use by in 2 days: amber; past use by: red; past best before: amber; a month away: plain',
      ['p-milk', 'p-chicken', 'p-rice', 'p-oats'].map(level), ['warn', 'bad', 'warn', '']);
    t.has('The row says when', row('p-chicken').innerText, '(passed)');
    t.has('…and a far-off date still shows, quietly', row('p-oats').innerText, 'use by');
    const flag = loc => { const s = c.$$('.larder-loc').find(x => x.querySelector('.loc-name').innerText.trim() === loc).querySelector('summary [title]'); return s ? s.className : ''; };
    t.eq('Location headings flag it: red where something is past use-by, amber otherwise', [flag('Fridge'), flag('Pantry Shelf 1')], ['fail-text', 'warn-text']);

    // The larder sheet: dates by hand, one big Save, quiet links.
    await c.click(row('p-oats').querySelector('[data-action="edit-pantry"]'), 60);
    t.eq('The sheet has one big button (Save)', c.$$('#modal .btn').map(b => b.innerText.trim()), ['Save']);
    t.ok('…Move… beside Location, ✎ beside the title, Remove and Cancel as text',
      !!c.$('#modal .field-head [data-action="move-open"]') && !!c.$('#modal h2 [data-action="edit-ingredient"]')
      && !!c.$('#modal .sheet-foot [data-action="delete-pantry"]') && !!c.$('#modal .sheet-foot [data-action="close-modal"]'));
    await c.set('#modal [data-m="draft.useBy"]', off(1));
    await c.click('#modal [data-action="save-pantry"]', 80);
    t.eq('Set use by tomorrow: oats turn amber', level('p-oats'), 'warn');
    t.has('…and say "tomorrow"', row('p-oats').innerText, 'use by tomorrow');

    // Moving stock keeps its dates.
    await c.click(row('p-milk').querySelector('[data-action="edit-pantry"]'), 60);
    await c.click('#modal [data-action="move-open"]', 60);
    await c.click('#modal [data-action="move-all"]', 40);
    await c.click('#modal [data-action="move-to"][data-loc="Freezer"]', 80);
    const milk = (await c.all('pantryItems')).filter(p => p.ingredientId === 'milk' && p.qty > 0);
    t.eq('Moved to the freezer with its use-by date', milk.map(p => [p.location, p.useBy]), [['Freezer', off(2)]]);

    const doc = c.w.__mp.nowDoc();
    t.has('The Now doc lists what to use soon or check', doc, 'Use soon or check');
    t.ok('…with the overdue one marked passed', /Chicken, Fridge: use by [^<]*\(passed\)/.test(doc));
    t.ok('…and nothing that isn\'t close', !/Jam,/.test(doc));
  });

  scenario('A meal card holding only extra food (crash fixed in 2.0.2)', async (c, t) => {
    await c.importJson(patch({ recipes: [mk('tea', { name: 'Tea', servings: 1, proteinPerServingG: 1, lactose: 'none', tags: [], method: '', ingredients: [] })] }));
    await c.go(c.w.__mp.today());
    await c.click('[data-action="add-to"][data-slot="lunch"]', 60);
    await c.click('#modal [data-action="modal-pick"][data-key="slot"][data-value="lunch"]', 40);
    await c.click('#modal [data-action="modal-pick"][data-key="mode"][data-value="text"]', 40);
    await c.set('#modal [data-m="text"]', 'Glass of orange juice'); await c.set('#modal [data-m="proteinG"]', '2');
    await c.click('[data-action="save-log"]', 150);
    t.ok('The sheet closed', c.$('#modal').hidden);
    t.ok('Protein summary sits at the top, beside the training tag', c.$('.today-head .protein-num') && c.$('.today-head .training'));
    t.eq('All four meals show, each with its +', c.$$('.card.meal').map(x => x.querySelector('.slot-label').innerText.trim().toLowerCase() + (x.querySelector('[data-action="add-to"]') ? '+' : '')),
      ['breakfast+', 'lunch+', 'dinner+', 'snack+']);
    t.ok('No + Shake / + Add food buttons any more', !c.$('[data-action="shake"]') && !c.$('[data-action="add-food"]'));
    t.has('Lunch card shows the extra', c.card('lunch') ? c.card('lunch').innerText : '(no lunch card)', 'Glass of orange juice');
    t.has('Protein total counts it', c.$('.protein-num').innerText, '2');
  });

  scenario('Protein summary: eaten, planned and target (2.15.0)', async (c, t) => {
    const r = (id, name, g) => mk(id, { name, servings: 1, proteinPerServingG: g, lactose: 'none', tags: [], method: '', ingredients: [] });
    await c.importJson(patch({
      recipes: [r('oat', 'Oats', 42), r('stew', 'Chicken stew', 50), r('bul', 'Bulgogi', 54), r('egg', 'Eggs', 13), r('shk', 'Shake', 30), r('ice', 'Ice cream', 28)],
      weekPlans: [weekPlan('w0', 0, { 0: { breakfast: [{ id: 'b', recipeId: 'oat', servings: 1 }], lunch: [{ id: 'l', recipeId: 'stew', servings: 1 }],
        dinner: [{ id: 'd', recipeId: 'bul', servings: 1 }], snack: [{ id: 'e', recipeId: 'egg', servings: 1 }, { id: 's', recipeId: 'shk', servings: 1 }] } })],
      mealLogs: [mk('l1', { date: day(0), slot: 'snack', item: 'e', recipeId: 'egg', servings: 1, proteinG: 13, planned: true, extra: false }),
        mk('l2', { date: day(0), slot: 'snack', recipeId: 'ice', servings: 1, proteinG: 28, planned: false, extra: true })],
    }));
    await c.settings(); await c.set('[data-setting="bodyweightKg"]', '97');
    await c.go(day(0));
    const head = () => c.$('.today-head .protein').innerText.replace(/\s+/g, ' ');
    t.has('Eaten so far: eggs + ice cream', c.$('.protein-eaten').innerText, '41');
    t.has('The day\'s plan: every meal card added up (42 + 50 + 54 + 71)', head(), '217 g planned');
    t.has('The target shows once, top right', c.$('.protein-target').innerText, 'target 194 g');
    t.ok('…and not again beside the eaten number', !c.$('.protein-num').innerText.includes('194'));
    const cards = c.$$('.card.meal').reduce((n, x) => n + Number(x.querySelector('.card-head .muted').innerText.replace(/\D/g, '')), 0);
    t.eq('Planned matches the meal cards', cards, 217);
    t.ok('Bar: plan past the target, target marked', c.$('.bar-plan.enough') && c.$('.bar-target'));
    await c.click(c.card('breakfast').querySelector('[data-action="eat"][data-item="b"]'), 150);
    t.has('Eating breakfast moves eaten on', c.$('.protein-eaten').innerText, '83');
    t.has('…but not the plan', head(), '217 g planned');
  });

  scenario('Import and inbox rules: merge, once only, bad files', async (c, t) => {
    const recipe = mk('r1', { name: 'Original', servings: 1, proteinPerServingG: 10, lactose: 'none', tags: [], method: '', ingredients: [] });
    const p1 = patch({ recipes: [recipe] });
    await c.importJson(p1);
    t.has('A patch imports', c.toast(), 'Imported');
    await c.importJson(p1);
    t.eq('The same patch again changes nothing', c.toast(), 'Nothing new in that file');
    await c.importJson(patch({ recipes: [{ ...recipe, name: 'Older copy', updatedAt: '2020-01-01T00:00:00Z' }] }));
    t.eq('An older copy never overwrites newer data', (await c.all('recipes')).find(r => r.id === 'r1').name, 'Original');
    await c.importJson(patch({ recipes: [{ ...recipe, name: 'Newer copy', updatedAt: new Date(Date.now() + 60000).toISOString() }] }));
    t.eq('A newer copy is taken', (await c.all('recipes')).find(r => r.id === 'r1').name, 'Newer copy');
    await c.importJson(patch({ users: [{ id: 'x', updatedAt: NOW }] }));
    t.has('Unknown store rejected', c.toast(), 'Unknown store "users"');
    await c.importJson({ app: 'something-else', stores: {} });
    t.has('Another app\'s file rejected', c.toast(), 'Not a Meal Planner file');
    await c.importJson({ app: 'meal-planner', schemaVersion: 1, exportedAt: NOW, stores: { recipes: [mk('r2', { name: 'From an export', servings: 1, ingredients: [] })] } });
    t.ok('A full export (no kind) is accepted', (await c.all('recipes')).some(r => r.id === 'r2'));
    await c.importJson(patch({}, { deletes: { recipes: ['r2'] } }));
    t.ok('Deletes remove only the listed id', !(await c.all('recipes')).some(r => r.id === 'r2') && (await c.all('recipes')).some(r => r.id === 'r1'));
    await c.importJson(patch({ recipes: [mk('bad', { servings: 1, ingredients: [] })] }));
    t.has('A record missing required fields is rejected', c.toast(), 'missing required fields');
  });

  scenario('Drive mailbox: inbox auto-apply and review, outbox writes', async (c, t) => {
    await c.importJson(patch({ recipes: [mk('r1', { name: 'Curry', servings: 4, proteinPerServingG: null, lactose: 'none', tags: [], method: '', ingredients: [] }),
      mk('r2', { name: 'Old recipe', servings: 1, proteinPerServingG: 10, lactose: 'none', tags: [], method: '', ingredients: [] })],
      shoppingItems: [mk('lw1', { weekStart: day(-7), text: 'Still to buy from last week', manual: true, checked: false }),
        mk('lw2', { weekStart: day(-14), text: 'Bought a fortnight ago', manual: true, checked: true })] }));
    const later = new Date(Date.now() + 60000).toISOString();
    const fs = fakeDrive(c, [
      { parent: INBOX, name: 'patch-protein.json', text: patch({ recipes: [mk('r1', { name: 'Curry', servings: 4, proteinPerServingG: 38, lactose: 'none', tags: [], method: '', ingredients: [], updatedAt: later })] }, { note: 'Protein for the curry', author: 'claude' }) },
      { parent: INBOX, name: 'patch-quick-add.json', text: patch({ shoppingItems: [mk('q1', { weekStart: day(0), text: 'Kitty litter', manual: true, checked: false, qty: 1, unit: 'bag' })] }, { note: 'Add kitty litter' }) },
      { parent: INBOX, name: 'patch-delete.json', text: patch({}, { deletes: { recipes: ['r2'] }, note: 'Remove the old recipe' }) },
      { parent: INBOX, name: 'bad.json', text: { app: 'meal-planner', schemaVersion: 1, kind: 'patch', patchId: 'bad', upserts: { users: [] } } },
      { parent: INBOX, name: 'patch-food-photo.json', text: patch({ mealLogs: [mk('food1', { date: c.w.__mp.today(), slot: 'snack', recipeId: null, text: 'Protein yoghurt (170 g tub)', servings: 1, proteinG: 15, planned: false, extra: true })] }, { note: 'Logged from a photo' }) },
      { parent: INBOX, name: 'patch-food-swap.json', text: patch({ mealLogs: [mk('food2', { date: c.w.__mp.today(), slot: 'lunch', recipeId: null, text: 'Sushi instead', servings: 1, proteinG: 20, planned: false, extra: false })] }, { note: 'Had sushi instead of lunch' }) },
      { parent: INBOX, name: 'patch-food-typo.json', text: patch({ mealLogs: [mk('food3', { date: c.w.__mp.today(), slot: 'snack', recipeId: null, text: 'Typo bar', servings: 1, proteinG: 900, planned: false, extra: true })] }, { note: 'Typo protein' }) },
    ]);
    await c.settings();
    await c.set('[data-drive="inboxId"]', INBOX);
    await c.set('[data-drive="outboxId"]', 'https://drive.google.com/drive/folders/' + OUTBOX + '?usp=sharing');
    await c.click('[data-action="drive-test"]', 1500);
    t.ok('latest.json written to the outbox', fs.json('latest.json') && fs.json('latest.json').app === 'meal-planner');
    t.ok("Today's snapshot written", fs.find(`meal-planner-${c.w.__mp.today()}.json`));
    const doc = () => (fs.find('Meal Planner Now') || {}).text || '';
    t.ok('"Meal Planner Now" Google Doc written for Claude to read', doc().includes('<h1>Meal Planner Now</h1>'));
    t.has('…with the shopping list', doc(), 'Kitty litter');
    t.has('…and the days by date', doc(), 'Meals by day');
    t.has("…and last week's list while it still has unbought items", doc(), 'Still to buy from last week');
    t.lacks('…but not older, finished lists', doc(), 'Bought a fortnight ago');
    t.eq('Recipe patch applied without asking', (await c.all('recipes')).find(r => r.id === 'r1').proteinPerServingG, 38);
    t.ok('Quick shopping add applied without asking', (await c.all('shoppingItems')).some(i => i.text === 'Kitty litter'));
    const logs = await c.all('mealLogs');
    t.ok('Food logged by Claude (e.g. from a label photo) applied without asking', logs.some(l => l.id === 'food1' && l.proteinG === 15));
    t.ok('A swap of a planned meal still waits for Apply', !logs.some(l => l.id === 'food2') && c.modalText().includes('Had sushi instead of lunch'));
    t.ok('An implausible protein figure still waits for Apply', !logs.some(l => l.id === 'food3') && c.modalText().includes('Typo protein'));
    const inbox = c.modalText();
    t.has('The delete waits for review', inbox, 'Remove the old recipe');
    t.has('The bad file is shown with the reason', inbox, 'Unknown store');
    t.lacks('Auto-applied files are not in the review list', inbox, 'Protein for the curry');
    const cards = c.$$('#modal .card');
    await c.click(cards.find(x => x.innerText.includes('Remove the old recipe')).querySelector('[data-action="inbox-apply"]'), 200);
    t.ok('Apply ran the delete', !(await c.all('recipes')).some(r => r.id === 'r2'));
    await c.click(c.$$('#modal .card').find(x => x.innerText.includes('bad.json')).querySelector('[data-action="inbox-skip"]'), 120);
    while (c.$('#modal [data-action="inbox-skip"]')) await c.click('#modal [data-action="inbox-skip"]', 100);
    t.ok('Inbox empty after Apply and Skip', c.$('#modal').hidden || !c.$('#modal .card'));
    await c.settings();
    await c.click('[data-action="drive-sync"]', 1200);
    t.ok('Checking again brings nothing back', c.$('#modal').hidden && !/Inbox \d/.test(c.$('#drive-chip').textContent), c.$('#drive-chip').textContent);
    await c.go(c.w.__mp.today());
    await c.click('[data-action="add-to"][data-slot="snack"]', 60);
    await c.click('#modal [data-action="modal-pick"][data-key="mode"][data-value="text"]', 40);
    await c.set('#modal [data-m="text"]', 'Chicken wrap'); await c.set('#modal [data-m="proteinG"]', '35');
    await c.click('[data-action="save-log"]', 150);
    await c.settings();
    await c.click('[data-action="drive-write"]', 800);
    t.ok('latest.json now includes the new meal', fs.json('latest.json').stores.mealLogs.some(l => l.text === 'Chicken wrap'));
    t.has('"Meal Planner Now" updated with it too', doc(), 'Chicken wrap');
    t.eq('Doc updated in place, not duplicated', Object.values(fs.files).filter(f => f.name === 'Meal Planner Now').length, 1);
    const ls = JSON.parse(c.w.localStorage.getItem('mpt.drive'));
    ls.nowDocAt = new Date(Date.now() - 2 * 86400000).toISOString();
    c.w.localStorage.setItem('mpt.drive', JSON.stringify(ls));
    const before = fs.writes.length;
    c.d.dispatchEvent(new c.w.Event('visibilitychange')); await sleep(900);
    t.ok('First open on a new day refreshes the doc, with nothing else changed', fs.writes.slice(before).includes('update Meal Planner Now'), fs.writes.slice(before));
    t.eq('No calls outside the fake Drive', fs.unexpected, []);
  });

  scenario('View-only device: shows the phone\'s data, never writes', async (c, t) => {
    const phone = { app: 'meal-planner', schemaVersion: 1, exportedAt: NOW, stores: {
      recipes: [mk('r1', { name: 'From the phone', servings: 1, proteinPerServingG: 30, lactose: 'none', tags: [], method: '', ingredients: [] })],
      shoppingItems: [mk('s1', { weekStart: day(0), text: 'Milk', manual: true, checked: false })],
      pantryItems: [mk('p1', { recipeId: 'r1', qty: 2, unit: 'portion', location: 'Fridge', cookedOn: day(0) })],
      settings: [mk('settings', { stores: ['Costco', 'Supermarket'], locations: ['Fridge', 'Freezer'], bodyweightKg: 97, proteinTargetGPerKg: 2 })],
    } };
    const fs = fakeDrive(c, [{ parent: OUTBOX, name: 'latest.json', text: phone }]);
    await c.settings();
    await c.click('[data-action="drive-role"][data-value="viewer"]', 80);
    t.ok('View-only needs no inbox field', !c.$('[data-drive="inboxId"]'));
    await c.set('[data-drive="outboxId"]', OUTBOX);
    await c.click('[data-action="drive-sync"]', 800);
    t.has('Loaded the phone\'s data', c.toast(), "Updated with the phone's latest data");
    t.ok('Recipes replaced with the phone\'s', (await c.all('recipes')).map(r => r.name).join() === 'From the phone');
    t.ok('Prepared meals came across', (await c.larder()).includes('🍲r1×2@Fridge'));
    t.ok('Editing is hidden', c.d.body.classList.contains('viewer'));
    await c.shop(day(0));
    await c.click('[data-action="tick"]', 80);
    t.has('Ticking is blocked', c.toast(), 'View-only device');
    t.eq('Nothing written to Drive', fs.writes, []);
    await c.settings();
    await c.click('[data-action="drive-role"][data-value="main"]', 80);
    t.ok('Switching back to Main phone shows the inbox field', !!c.$('[data-drive="inboxId"]'));
    t.eq('…without writing anything yet', fs.writes, []);
    t.eq('No calls outside the fake Drive', fs.unexpected, []);
  });

  scenario('Sign-in helper: each phone signs in once, then never needs a popup (2.21.0)', async (c, t) => {
    const fs = fakeDrive(c, [{ id: SHARED, name: 'Meal Planner shared', folder: true }]);
    c.w.MP_CONFIG.authServer = 'https://auth.test/';
    // Google's popup sign-in, counted; and a fake helper in front of the fake Drive.
    let popups = 0;
    const gis = c.w.google.accounts.oauth2.initTokenClient;
    c.w.google.accounts.oauth2.initTokenClient = cfg => { popups++; return gis(cfg); };
    const calls = [], driveFetch = c.w.fetch;
    let helperUp = true, blips = 0;
    c.w.fetch = async (url, opts = {}) => {
      url = String(url);
      if (!url.startsWith('https://auth.test/')) return driveFetch(url, opts);
      if (!helperUp) throw new TypeError('Load failed');
      if (url.endsWith('/redeem') && blips > 0) { blips--; throw new TypeError('Load failed'); }
      const path = new URL(url).pathname, key = ((opts.headers || {}).Authorization || '').slice(7);
      calls.push(`${path} ${key}`);
      const json = (o, status = 200) => new c.w.Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
      if (path === '/redeem') return key === 'once-1' ? json({ key: 'device-key', email: 'alex@example.com', access_token: 'fake-token', expires_in: 3600 }) : json({ error: 'code expired' }, 401);
      if (path === '/token') return key === 'device-key' ? json({ access_token: 'fake-token', expires_in: 3600 }) : json({ error: 'unknown device' }, 401);
      if (path === '/signout') return new c.w.Response(null, { status: 204 });
      return json({}, 404);
    };

    await c.settings();
    t.has('Settings says the helper is ready', c.$('#app').innerText, 'sign in once to use it');
    await c.set('[data-hh="hhWho"]', 'Alex');
    await c.click('[data-action="hh-find"]', 300);
    const nav = c.w.__mp.helperNav() || '';
    t.ok('Signing in goes to the helper (same window, no popup)', nav.startsWith('https://auth.test/start?state='), nav);
    t.ok('…asking to come back to this page', nav.includes('&return=' + encodeURIComponent(c.w.location.href.split('#')[0])), nav);
    t.eq('…and no Google popup', popups, 0);
    const state = new URL(nav || 'https://x/').searchParams.get('state');

    await c.w.__mp.helperReturn('#mp-auth-state=someone-elses&mp-auth-code=once-1');
    t.has("A sign-in this phone didn't start is ignored", c.toast(), "didn't come from this phone");
    t.ok('…without collecting its code', !calls.some(x => x.startsWith('/redeem')), calls);

    blips = 2;   // 2.21.2: the connection drops for a moment just after coming back from Google
    await c.w.__mp.helperReturn(`#mp-auth-state=${state}&mp-auth-code=once-1`);
    await sleep(100);
    t.has('Back from Google: signed in', c.toast(), 'stays signed in');
    t.eq('…keeping only the helper key on the phone', c.w.localStorage.getItem('mpt.authKey'), 'device-key');
    t.ok('…and a token to use now', c.w.__mp.signedIn());
    await c.click('[data-action="hh-find"]', 1200);
    t.has('Then sharing carries on as before', c.$('#app').innerText, 'Stop sharing');

    // An hour later (or after the phone closed the app): a fresh token comes from the helper, no tap needed.
    c.w.__mp.forgetToken();
    c.w.__mp.quietSignIn();
    await sleep(200);
    t.ok('When the token runs out, the app quietly gets a new one from the helper', c.w.__mp.signedIn() && calls.includes('/token device-key'), calls);
    t.eq('…still with no Google popup', popups, 0);

    // The helper is down: the app says so, then falls back to Google's popup.
    helperUp = false;
    c.w.__mp.forgetToken();
    await c.click('#drive-chip', 200);
    t.has('If the helper is down, the app says so', c.toast(), "Couldn't reach the sign-in helper");
    await c.click('#drive-chip', 600);
    t.ok("…and the next tap uses Google's sign-in instead", popups === 1 && c.w.__mp.signedIn(), popups);

    // Signing out tells the helper to forget this phone.
    helperUp = true;
    const b = c.w.document.createElement('button');
    b.dataset.action = 'drive-signout';
    c.$('#app').appendChild(b);
    await c.click(b, 200);
    t.ok('Signing out tells the helper to forget this phone', calls.includes('/signout device-key'), calls);
    t.eq('…and the key is gone from the phone', c.w.localStorage.getItem('mpt.authKey'), null);
    t.eq('No calls outside the fakes', fs.unexpected, []);
  });

  scenario('Two phones: a shared household folder keeps both in step (2.20.0)', async (c, t) => {
    const OLD = new Date(Date.now() - 3600000).toISOString(), LATER = new Date(Date.now() + 60000).toISOString();
    const rice = mk('i1', { name: 'Rice', defaultUnit: 'g', store: 'Supermarket', aisle: '', isLocal: false, lastPrice: null });
    const curry = name => ({ name, servings: 1, proteinPerServingG: 30, lactose: 'none', tags: [], method: '', ingredients: [{ ingredientId: 'i1', qty: 2000, unit: 'g' }] });
    await c.importJson(patch({ ingredients: [rice],
      recipes: [mk('r1', curry('Curry')), mk('r2', { name: 'Old recipe', servings: 1, proteinPerServingG: 10, lactose: 'none', tags: [], method: '', ingredients: [] })],
      weekPlans: [weekPlan('lastwk', -1, { 6: { dinner: [{ id: 'd1', recipeId: 'r1', servings: 1, cook: null }] } })],
      shoppingItems: [mk('s1', { weekStart: day(0), ingredientId: null, text: 'Bin bags', qty: 1, unit: 'pack', manual: true, checked: false })] }));
    // Sam's phone, already in the shared folder: some changes newer than ours, one older, and one deletion.
    const sam = (extra = {}) => ({ app: 'meal-planner', schemaVersion: 1, exportedAt: LATER,
      household: { deviceId: 'samphone0001', who: 'Sam', deleted: { shoppingItems: { s1: LATER } } },
      stores: {
        recipes: [mk('r1', { ...curry("Curry (Sam's way)"), updatedAt: LATER }),
          mk('r2', { name: 'Old recipe (stale copy)', servings: 1, proteinPerServingG: 10, lactose: 'none', tags: [], method: '', ingredients: [], updatedAt: OLD })],
        shoppingItems: [mk('s2', { weekStart: day(0), ingredientId: null, text: 'Milk', qty: 2, unit: 'L', manual: true, checked: false, updatedAt: LATER }), ...(extra.shop || [])],
      } });
    const fs = fakeDrive(c, [{ id: SHARED, name: 'Meal Planner shared', folder: true }, { parent: SHARED, name: 'household-samphone0001.json', text: sam() }]);
    await c.settings();
    t.has('Settings offers sharing', c.$('#app').innerText, 'Share with someone');
    await c.set('[data-hh="hhWho"]', 'Alex');
    await c.click('[data-action="hh-find"]', 1500);
    t.has("Found the folder and took in Sam's changes", c.toast(), 'Updated from Sam');
    const recipes = await c.all('recipes');
    t.eq("Sam's newer edit wins", (recipes.find(r => r.id === 'r1') || {}).name, "Curry (Sam's way)");
    t.eq("Sam's older copy doesn't overwrite ours", (recipes.find(r => r.id === 'r2') || {}).name, 'Old recipe');
    const shop = await c.all('shoppingItems');
    t.ok("Sam's new item came across", shop.some(i => i.text === 'Milk'));
    t.ok('…and the item Sam deleted is gone here too', !shop.some(i => i.id === 's1'));
    const mine = Object.values(fs.files).find(f => /^household-(?!samphone)/.test(f.name));
    t.ok('This phone wrote its own file in the shared folder', mine && mine.parent === SHARED);
    const my = mine ? JSON.parse(mine.text) : { household: {}, stores: {} };
    t.eq('…saying who it is', my.household.who, 'Alex');
    t.ok('…with everything on this phone', (my.stores.recipes || []).some(r => r.name === "Curry (Sam's way)"));
    t.ok("…and what's been deleted, passing on Sam's deletion too", !!((my.household.deleted || {}).shoppingItems || {}).s1);
    t.ok("Sam's file is never written", !fs.writes.some(x => x.includes('samphone')), fs.writes);
    await c.settings();
    t.has('Settings says who we share with', c.$('#app').innerText, 'With Sam');
    const kept = JSON.parse(c.w.localStorage.getItem('mpt.tok') || '{}');
    t.ok('The sign-in is kept on the phone, so reopening the app (iPhones close it often) needs no tap', kept.t === 'fake-token' && kept.exp > Date.now() + 3000000, kept);

    // A deletion here sticks, even though Sam's file still has an old copy.
    await c.importJson(patch({}, { deletes: { recipes: ['r2'] } }));
    await c.settings();
    await c.click('[data-action="hh-sync"]', 1200);
    t.ok('Our deletion is in our file', !!(((JSON.parse((fs.find((mine || {}).name) || { text: '{"household":{}}' }).text).household.deleted || {}).recipes || {}).r2));
    const sf = fs.find('household-samphone0001.json');
    sf.text = JSON.stringify(sam({ shop: [mk('s3', { weekStart: day(0), ingredientId: null, text: 'Eggs', qty: 12, unit: 'each', manual: true, checked: false, updatedAt: new Date(Date.now() + 120000).toISOString() })] }));
    sf.mod = new Date(Date.now() + 5000).toISOString();
    await c.click('[data-action="hh-sync"]', 1200);
    t.ok("Sam's next change arrives", (await c.all('shoppingItems')).some(i => i.text === 'Eggs'));
    t.ok("…but Sam's stale copy doesn't bring back what we deleted", !(await c.all('recipes')).some(r => r.id === 'r2'));

    // Both phones starting the same week, or generating the same list, make the same records.
    await c.week(day(0));
    await c.click('[data-action="copy-last"]', 150);
    t.ok("A new week's plan has the week's own id", (await c.all('weekPlans')).some(p => p.id === 'week-' + day(0)));
    await c.click('[data-action="generate"]', 300);
    const line = (await c.all('shoppingItems')).find(i => i.ingredientId === 'i1' && i.weekStart === day(0));
    t.ok('A new list line has an id from its week and ingredient', line && line.id === `gen-${day(0)}-i1-g`, line && line.id);
    await sleep(30);
    await c.click('[data-action="regenerate"]', 300);
    const again = (await c.all('shoppingItems')).find(i => i.id === (line || {}).id);
    t.eq("Regenerating leaves an unchanged line's timestamp alone (so it can't undo Sam's tick)", again && again.updatedAt, line && line.updatedAt);
    await c.shop(day(0));
    await c.click(c.shopRow('Rice').querySelector('[data-action="tick"]'), 150);
    const row = (await c.all('pantryItems')).find(p => p.ingredientId === 'i1');
    t.ok('Bought rice goes in a larder row named for its spot, so both phones add to the same row', row && row.id.startsWith('larder-i1-'), row && row.id);

    // Stop, then start a new folder and invite someone.
    await c.settings();
    await c.click('[data-action="hh-stop"]', 100);
    t.has('Stopped sharing', c.$('#app').innerText, 'Share with someone');
    await c.click('[data-action="hh-create"]', 1000);
    t.ok('Started a new shared folder', fs.writes.includes('create folder Meal Planner shared'), fs.writes);
    await c.set('[data-hh-email]', 'sam@example.com');
    await c.click('[data-action="hh-invite"]', 300);
    t.ok('Invited Sam to it as an editor', fs.perms.some(x => x.endsWith('writer sam@example.com')), fs.perms);
    t.eq('No calls outside the fake Drive', fs.unexpected, []);
  });

  // ---------- runner ----------
  async function runAll() {
    // Test the files on disk, not an old copy: drop any service worker and offline cache on this (local) origin.
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    for (const f of ['index.html', 'app.js', 'styles.css', 'config.js']) await fetch(f, { cache: 'reload' }).catch(() => {});
    const results = document.getElementById('results'), summary = document.getElementById('summary'), status = document.getElementById('status');
    results.innerHTML = ''; summary.textContent = ''; summary.className = '';
    let pass = 0, fail = 0;
    const out = [];
    // tests.html?auto&only=Two%20phones runs just the scenarios whose name contains that text.
    const only = new URLSearchParams(location.search).get('only');
    for (const sc of SCENARIOS.filter(x => !only || x.name.toLowerCase().includes(only.toLowerCase()))) {
      status.textContent = 'Running: ' + sc.name;
      const t = checker(), started = Date.now();
      let c;
      try {
        c = await freshApp();
        await sc.fn(c, t);
      } catch (e) {
        t.list.push({ label: 'Scenario ran to the end', pass: false, detail: String(e && e.stack || e) });
      }
      if (c) t.list.push({ label: 'No errors inside the app', pass: !c.errors.length, detail: c.errors.join('\n') });
      const ok = t.list.every(x => x.pass);
      t.list.forEach(x => (x.pass ? pass++ : fail++));
      out.push({ name: sc.name, ok, checks: t.list });
      const el = document.createElement('div');
      el.className = 'scenario';
      el.innerHTML = `<h2><span>${ok ? '<span class="ok">✓</span>' : '<span class="bad">✗</span>'} ${sc.name}</span>
        <span class="muted">${t.list.filter(x => x.pass).length}/${t.list.length} · ${((Date.now() - started) / 1000).toFixed(1)} s</span></h2>`
        + t.list.map(x => `<div class="check ${x.pass ? '' : 'fail'}"><span>${x.pass ? '✓' : '✗'}</span><span>${escapeHtml(x.label)}</span>
          ${x.detail ? `<span class="detail">${escapeHtml(x.detail)}</span>` : ''}</div>`).join('');
      results.appendChild(el);
    }
    if (frame) { frame.remove(); frame = null; }
    await new Promise(res => { const q = indexedDB.deleteDatabase('meal-planner-test'); q.onsuccess = q.onerror = q.onblocked = res; });
    Object.keys(localStorage).filter(k => k.startsWith('mpt.')).forEach(k => localStorage.removeItem(k));
    status.textContent = '';
    summary.textContent = fail ? `${fail} failed, ${pass} passed` : `All ${pass} checks passed`;
    summary.className = fail ? 'fail' : 'pass';
    window.__results = { pass, fail, scenarios: out, done: true };
    return window.__results;
  }
  const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  window.runMealPlannerTests = runAll;
  const button = document.getElementById('run');
  if (!LOCAL) {
    button.disabled = true;
    document.getElementById('status').textContent = 'Tests only run on localhost (python -m http.server 8766 in the meal-planner folder).';
  } else {
    button.addEventListener('click', () => { button.disabled = true; runAll().finally(() => { button.disabled = false; }); });
    if (/[?&]auto\b/.test(location.search)) runAll();
  }
})();

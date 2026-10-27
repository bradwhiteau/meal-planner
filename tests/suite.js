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
      shopRow: name => $$('.shop-row').find(r => r.innerText.includes(name)),
      shopText: name => { const r = c.shopRow(name); return r ? r.innerText.replace(/\s*\n\s*/g, ' | ') : '(no line)'; },
    };
    return c;
  }

  // Fake Google sign-in and Drive inside the app's frame. Any other network call is recorded as unexpected.
  function fakeDrive(c, files = []) {
    const w = c.w, fs = { files: {}, n: 0, writes: [], unexpected: [] };
    const add = (parent, name, text, ownedByApp = false) => {
      const id = 'f' + (++fs.n);
      fs.files[id] = { id, name, parent, text, mod: new Date(Date.now() + fs.n).toISOString(), ownedByApp };
      return id;
    };
    files.forEach(f => add(f.parent, f.name, typeof f.text === 'string' ? f.text : JSON.stringify(f.text), !!f.ownedByApp));
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
        return json({ files: [] });
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
  const INBOX = 'INBOXfolder00001', OUTBOX = 'OUTBOXfolder0001';

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
    t.has('Next week 1.2 kg: 2 × 1 kg', c.shopText('Jasmine rice'), '2 × 1 kg');
    t.has('Estimate scales: $9.00', c.shopText('Jasmine rice'), '$9.00');
    await c.shop(day(0));
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
    t.has('Leftover shows portions in the larder', c.card('dinner').innerText, '5 in the larder');
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
    const fourDaysAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 4); return ymd(d); })();
    await c.tab('pantry'); await c.click('[data-action="add-portion"]');
    await c.set('#modal [data-m="draft.recipeId"]', 'bol'); await c.set('#modal [data-m="draft.qty"]', '2');
    await c.set('#modal [data-m="draft.location"]', 'Fridge'); await c.set('#modal [data-m="draft.cookedOn"]', fourDaysAgo);
    await c.click('[data-action="save-portion"]', 150);
    t.has('A closed Fridge shows ⚠ when something needs eating or freezing', c.$$('.larder-loc').find(x => x.querySelector('.loc-name').innerText.trim() === 'Fridge').querySelector('summary').innerText, '⚠');
    await sleep(30);
    t.has('Prepared meal shows in the Fridge with 🍲 and eat or freeze', c.loc('Fridge').innerText, 'eat or freeze');
    await c.go(c.w.__mp.today());
    t.has('Today flags the old fridge portions', c.$('.card.prep') ? c.$('.card.prep').innerText : '', 'eat or freeze');
    await c.click('[data-action="freeze-portion"]', 150);
    t.ok('Freeze moved them', (await c.larder()).includes(`🍲bol×2@Freezer`));
    await c.click('[data-action="add-to"][data-slot="snack"]', 60);
    await c.click('#modal [data-action="pick-recipe"][data-id="bol"]', 60);
    const before = (await c.larder()).filter(x => x.startsWith('🍲'));
    await c.click('[data-action="save-log"]', 150);
    const after = (await c.larder()).filter(x => x.startsWith('🍲'));
    t.ok('+ Add food Bolognese takes a fridge portion, no ingredients', before.includes('🍲bol×1@Fridge') && !after.some(x => x.includes('@Fridge')), { before, after });
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
    const nextWeek = async label => {
      await c.week(day(7));
      const alloc = c.w.__mp.alloc(day(7)).slotCook;
      t.eq(`${label}: next Monday's mornay and bolognese cook nothing`, [alloc[day(7) + '|lunch'], alloc[day(7) + '|dinner']], [0, 0]);
      t.has(`${label}: Monday lunch reads "from the larder"`, rows(), 'from the larder');
      await c.shop(day(7)); await c.click('[data-action="regenerate"]', 300);
      t.eq(`${label}: no tuna on next week's list`, c.shopText('Tinned tuna'), '(no line)');
      t.eq(`${label}: no mince on next week's list`, c.shopText('Beef mince'), '(no line)');
    };
    await c.week(day(0)); await c.click('[data-action="generate"]', 300);
    t.ok('This week buys the Sunday mornay and the Saturday batch', c.shopRow('Tinned tuna') && c.shopRow('Beef mince'));
    await nextWeek('Before cooking');
    // Cook both ahead (nothing eaten yet): the portions go into the Larder, and the plan must not count them twice.
    for (const [d, slot] of [[5, 'dinner'], [6, 'dinner']]) {
      await c.go(day(d));
      await c.click(c.card(slot).querySelector('[data-action="meal-menu"]'), 60);
      await c.click('[data-action="cook-ahead"]', 80);
      await c.click('[data-action="save-cook"]', 200);
    }
    t.eq('Cooked ahead: 6 bolognese and 2 mornay in the Larder', (await c.larder()).filter(x => x.startsWith('🍲')).map(x => x.replace(/@.*/, '')).reduce((a, x) => {
      const [, id, n] = x.match(/🍲(\w+)×(\d+)/); a[id] = (a[id] || 0) + Number(n); return a; }, {}), { bol2: 6, morn: 2 });
    await nextWeek('After cooking');
    // Still covered exactly: one fewer portion and next week's lunch has to cook again.
    await c.importJson(patch({ pantryItems: (await c.all('pantryItems')).filter(p => p.recipeId === 'morn').map(p => ({ ...p, qty: p.qty - 1, updatedAt: new Date(Date.now() + 5000).toISOString() })) }));
    t.eq('One mornay short: next Monday cooks 1 again', c.w.__mp.alloc(day(7)).slotCook[day(7) + '|lunch'], 1);
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
    for (const sc of SCENARIOS) {
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

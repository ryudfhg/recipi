// ======== モード判定 ========
const IS_LOCAL = location.protocol === 'file:'
  || location.hostname === 'localhost'
  || location.hostname === '127.0.0.1';

// ======== Firebase Realtime Database API ========
// ハッシュ形式: #{urlsafe_base64(firebaseUrl)}:{randomKey}

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function getRawHash() {
  return location.hash.replace('#', '') || null;
}

function getFirebaseUrl() {
  const hash = getRawHash();
  if (!hash || !hash.includes(':')) return null;
  const b64 = hash.split(':')[0];
  try {
    return atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  } catch { return null; }
}

function getDataKey() {
  const hash = getRawHash();
  if (!hash) return null;
  const idx = hash.indexOf(':');
  return idx >= 0 ? hash.slice(idx + 1) : hash;
}

async function fetchData() {
  if (IS_LOCAL) { loadLocal(); return; }
  const fbUrl = getFirebaseUrl();
  const key   = getDataKey();
  if (!fbUrl || !key) {
    loadLocalSilent();
    return;
  }
  showSync('データを読み込み中…');
  let res;
  try {
    res = await fetch(`${fbUrl}/${key}.json`);
  } catch(e) {
    const msg = `[読込] ネットワークエラー: ${e.message}`;
    console.error(msg, e);
    showSync(msg, true);
    setTimeout(hideSync, 6000);
    loadLocalSilent();
    return;
  }
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch(_) {}
    const msg = `[読込] HTTP ${res.status} ${res.statusText}${body ? ' / ' + body.slice(0,80) : ''}`;
    console.error(msg);
    showSync(msg, true);
    setTimeout(hideSync, 6000);
    loadLocalSilent();
    return;
  }
  let data;
  try {
    data = await res.json();
  } catch(e) {
    const msg = `[読込] JSONパースエラー: ${e.message}`;
    console.error(msg, e);
    showSync(msg, true);
    setTimeout(hideSync, 6000);
    loadLocalSilent();
    return;
  }
  if (data && typeof data === 'object') {
    meals     = data.meals     || {};
    stocks    = data.stocks    || [];
    shopItems = data.shopItems || [];
    recipes   = data.recipes   || [];
    saveLocal();
  }
  hideSync();
  renderAll();
}

async function pushData() {
  if (IS_LOCAL) { saveLocal(); return; }
  const fbUrl = getFirebaseUrl();
  const key   = getDataKey();
  if (!fbUrl || !key) { saveLocal(); return; }
  showSync('保存中…');
  let res;
  try {
    res = await fetch(`${fbUrl}/${key}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meals, stocks, shopItems, recipes })
    });
  } catch(e) {
    saveLocal();
    const msg = `[保存] ネットワークエラー: ${e.message}`;
    console.error(msg, e);
    showSync(msg, true);
    setTimeout(hideSync, 6000);
    return;
  }
  if (!res.ok) {
    saveLocal();
    let body = '';
    try { body = await res.text(); } catch(_) {}
    const msg = `[保存] HTTP ${res.status} ${res.statusText}${body ? ' / ' + body.slice(0,80) : ''}`;
    console.error(msg);
    showSync(msg, true);
    setTimeout(hideSync, 6000);
    return;
  }
  showSync('保存しました ✓');
  setTimeout(hideSync, 1500);
}

async function setupBlob() {
  const urlInput = document.getElementById('firebase-url-input');
  const fbUrl = (urlInput ? urlInput.value.trim() : '').replace(/\/$/, '');
  if (!fbUrl) {
    showToast('Firebase データベースURLを入力してください', 'error'); return;
  }
  if (!fbUrl.startsWith('https://')) {
    showToast('https:// で始まるURLを入力してください', 'error'); return;
  }
  const btn = document.getElementById('setup-btn');
  btn.disabled = true;
  btn.textContent = '作成中…';
  const key  = generateId();
  const b64  = btoa(fbUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  location.hash = `${b64}:${key}`;
  document.getElementById('setup-overlay').classList.add('hidden');
  await pushData();
  copyURL();
  showToast('セットアップ完了！URLをパートナーに共有してください');
}

// ======== ローカルストレージ（file://用） ========
function saveLocal() {
  localStorage.setItem('app_data', JSON.stringify({ meals, stocks, shopItems, recipes }));
}
function loadLocal() {
  loadLocalSilent();
  renderAll();
}
function loadLocalSilent() {
  const data = JSON.parse(localStorage.getItem('app_data') || '{}');
  meals     = data.meals     || {};
  stocks    = data.stocks    || [];
  shopItems = data.shopItems || [];
  recipes   = data.recipes   || [];
  renderAll();
}

// ======== 同期バー ========
function showSync(msg, isError = false) {
  const bar = document.getElementById('sync-bar');
  bar.textContent = msg;
  bar.className = 'sync-bar' + (isError ? ' error' : '');
}
function hideSync() {
  document.getElementById('sync-bar').classList.add('hidden');
}

// ======== タブ切り替え ========
const TITLES = { menu: '献立', stock: '在庫管理', shopping: '買い物リスト', recipes: 'レシピ', settings: '設定' };

function switchTab(name, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  btn.classList.add('active');
  document.getElementById('header-title').textContent = TITLES[name];
  document.getElementById('stock-fab').classList.toggle('hidden', name !== 'stock');
  document.getElementById('shopping-fab').classList.toggle('hidden', name !== 'shopping');
  if (name === 'settings') updateSettingsView();
}

function renderAll() {
  renderCalendar();
  renderStocks();
  renderShopItems();
  renderRecipes();
}

// ======== カテゴリ管理 ========
const DEFAULT_CATEGORIES = ['野菜', '肉・魚', '乳製品', '調味料', 'その他'];

function getCategories() {
  const s = localStorage.getItem('ingCategories');
  return s ? JSON.parse(s) : [...DEFAULT_CATEGORIES];
}

function saveCategories(cats) {
  localStorage.setItem('ingCategories', JSON.stringify(cats));
}

function addCategory() {
  const name = document.getElementById('new-cat-input').value.trim();
  if (!name) return;
  const cats = getCategories();
  if (cats.includes(name)) { showToast('既に存在します', 'error'); return; }
  cats.push(name);
  saveCategories(cats);
  document.getElementById('new-cat-input').value = '';
  renderCatSettings();
  populateShopCatSelect();
  populateIngCatSelect();
  showToast(`「${name}」を追加しました`);
}

function removeCategory(name) {
  const cats = getCategories().filter(c => c !== name);
  if (!cats.length) { showToast('カテゴリは最低1つ必要です', 'error'); return; }
  saveCategories(cats);
  renderCatSettings();
  populateShopCatSelect();
  populateIngCatSelect();
}

function renderCatSettings() {
  const el = document.getElementById('cat-settings-list');
  if (!el) return;
  const cats = getCategories();
  el.innerHTML = cats.map(c => `
    <div class="cat-settings-item">
      <span class="cat-settings-name">${esc(c)}</span>
      <button class="del-btn" onclick="removeCategory('${esc(c)}')">✕</button>
    </div>
  `).join('');
}

function populateShopCatSelect() {
  const sel = document.getElementById('shop-category');
  if (!sel) return;
  const prev = sel.value;
  const cats = getCategories();
  sel.innerHTML = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function populateIngCatSelect(selectedVal) {
  const wrap   = document.getElementById('ing-cat-btns');
  const hidden = document.getElementById('ing-cat');
  if (!wrap || !hidden) return;
  const cats = getCategories();
  const val  = selectedVal !== undefined ? selectedVal : (hidden.value || cats[0] || '');
  hidden.value = cats.includes(val) ? val : (cats[0] || '');
  wrap.innerHTML = cats.map(c =>
    `<button type="button" class="tap-btn ${hidden.value === c ? 'active' : ''}"
      onclick="selectIngCat('${esc(c)}')">${esc(c)}</button>`
  ).join('');
}

function selectIngCat(name) {
  document.getElementById('ing-cat').value = name;
  populateIngCatSelect(name);
}

// ======== 名前設定 ========
function getNames() {
  return {
    p1: localStorage.getItem('p1Name') || '自分',
    p2: localStorage.getItem('p2Name') || 'パートナー'
  };
}

function saveNames() {
  const p1 = document.getElementById('p1-name-input').value.trim() || '自分';
  const p2 = document.getElementById('p2-name-input').value.trim() || 'パートナー';
  localStorage.setItem('p1Name', p1);
  localStorage.setItem('p2Name', p2);
  renderCalendar();
  showToast('名前を保存しました');
}

// ======== カレンダー ========
let calYear, calMonth;

// ======== 祝日計算 ========
const _holidayCache = {};

function getHolidays(year) {
  if (_holidayCache[year]) return _holidayCache[year];
  const h = {};

  function set(m, d) {
    if (d < 1 || d > 31) return;
    h[`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`] = true;
  }
  function nthMon(month, nth) { // nth月曜日
    const d = new Date(year, month - 1, 1);
    return 1 + ((1 - d.getDay() + 7) % 7) + (nth - 1) * 7;
  }

  // 固定
  set(1,1); set(2,11); set(2,23); set(4,29);
  set(5,3); set(5,4);  set(5,5);  set(8,11);
  set(11,3); set(11,23);

  // ハッピーマンデー
  set(1,  nthMon(1,2));   // 成人の日
  set(7,  nthMon(7,3));   // 海の日
  set(9,  nthMon(9,3));   // 敬老の日
  set(10, nthMon(10,2));  // スポーツの日

  // 春分・秋分（近似式）
  const dy = year - 1980;
  set(3, Math.floor(20.8431 + 0.242194 * dy - Math.floor(dy / 4)));
  set(9, Math.floor(23.2488 + 0.242194 * dy - Math.floor(dy / 4)));

  // 振替休日（日曜祝日 → 翌月曜）
  Object.keys(h).forEach(k => {
    const d = new Date(k + 'T00:00:00');
    if (d.getDay() === 0) {
      let sub = new Date(d);
      sub.setDate(sub.getDate() + 1);
      while (h[sub.toISOString().slice(0,10)]) sub.setDate(sub.getDate() + 1);
      h[sub.toISOString().slice(0,10)] = true;
    }
  });

  _holidayCache[year] = h;
  return h;
}
let meals     = {};
let stocks    = [];
let shopItems = [];
let recipes   = [];
let editingKey = null;
// 編集中の出席状態（ボトムシート用一時変数）
let sheetAttend = {
  morning: { p1: true, p2: true },
  noon:    { p1: true, p2: true },
  night:   { p1: true, p2: true }
};


function initCalendar() {
  const now = new Date();
  calYear  = now.getFullYear();
  calMonth = now.getMonth();
  renderCalendar();
}

function changeMonth(delta) {
  calMonth += delta;
  if (calMonth > 11) { calMonth = 0;  calYear++; }
  if (calMonth < 0)  { calMonth = 11; calYear--; }
  renderCalendar();
}

function renderCalendar() {
  document.getElementById('cal-title').textContent = `${calYear}年${calMonth + 1}月`;
  const grid     = document.getElementById('cal-grid');
  const first    = new Date(calYear, calMonth, 1);
  const last     = new Date(calYear, calMonth + 1, 0);
  const startDow = first.getDay();

  let cells = '';
  for (let i = 0; i < startDow; i++) {
    cells += cellHTML(new Date(calYear, calMonth, -startDow + i + 1), true);
  }
  for (let d = 1; d <= last.getDate(); d++) {
    cells += cellHTML(new Date(calYear, calMonth, d), false);
  }
  const remain = (startDow + last.getDate()) % 7;
  if (remain !== 0) {
    for (let i = 1; i <= 7 - remain; i++) {
      cells += cellHTML(new Date(calYear, calMonth + 1, i), true);
    }
  }
  grid.innerHTML = cells;
}

function getMealSlot(dateKey, slot) {
  const day = meals[dateKey];
  if (!day || !day[slot]) return { names: [], p1: true, p2: true };
  const m = day[slot];
  // 旧フォーマット（文字列）の互換対応
  if (typeof m === 'string') return { names: m ? [m] : [], p1: true, p2: true };
  // 新フォーマット: names[]
  if (Array.isArray(m.names)) return { names: m.names, p1: m.p1 !== false, p2: m.p2 !== false };
  // 旧フォーマット（name単体）の互換対応
  return { names: m.name ? [m.name] : [], p1: m.p1 !== false, p2: m.p2 !== false };
}

function cellHTML(date, otherMonth) {
  const key      = dateKey(date);
  const dow      = date.getDay();
  const today    = new Date(); today.setHours(0, 0, 0, 0);
  const isToday   = date.getTime() === today.getTime();
  const isHoliday = !!getHolidays(date.getFullYear())[key];
  const names    = getNames();
  const p1Initial = (names.p1 || '自')[0];
  const p2Initial = (names.p2 || 'パ')[0];

  const cls = [
    'cal-cell',
    otherMonth  ? 'other-month' : '',
    isToday     ? 'today'       : '',
    isHoliday   ? 'holiday'     : '',
    dow === 0   ? 'sunday'      : '',
    dow === 6   ? 'saturday'    : '',
  ].filter(Boolean).join(' ');

  let preview = '';
  ['morning','noon','night'].forEach(slot => {
    const m = getMealSlot(key, slot);
    if (!m.names.length) return;
    const icon = slot === 'morning' ? '🌅' : slot === 'noon' ? '☀️' : '🌙';
    const b1 = `<span class="att-badge ${m.p1 ? 'att-p1' : 'att-off'}">${p1Initial}</span>`;
    const b2 = `<span class="att-badge ${m.p2 ? 'att-p2' : 'att-off'}">${p2Initial}</span>`;
    const nameDisp = m.names[0] + (m.names.length > 1 ? ` +${m.names.length - 1}` : '');
    preview += `<div class="cal-meal-preview"><span class="preview-icon">${icon}</span><span class="preview-name">${esc(nameDisp)}</span>${b1}${b2}</div>`;
  });

  return `<div class="${cls}" onclick="openSheet('${key}', ${date.getMonth()+1}, ${date.getDate()})">
    <div class="cal-day">${date.getDate()}</div>
    ${preview}
  </div>`;
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ======== ボトムシート ========
function getMealSlotNames(slot) {
  const el = document.getElementById(`meal-names-${slot}`);
  return el ? JSON.parse(el.dataset.values || '[]') : [];
}

function renderSlotRecipeTags(slot, nameArr) {
  if (!nameArr.length) return '';
  return nameArr.map((n, i) =>
    `<span class="recipe-tag">${esc(n)}<button class="recipe-tag-del" onclick="removeRecipeFromSlot('${slot}',${i})">✕</button></span>`
  ).join('');
}

function removeRecipeFromSlot(slot, index) {
  const el = document.getElementById(`meal-names-${slot}`);
  if (!el) return;
  const arr = JSON.parse(el.dataset.values || '[]');
  arr.splice(index, 1);
  el.dataset.values = JSON.stringify(arr);
  el.innerHTML = renderSlotRecipeTags(slot, arr) +
    `<button class="add-recipe-btn" onclick="openRecipePicker('${slot}')">＋ レシピを追加</button>`;
}

function buildMealEditorBlocks(key, names) {
  const slotDefs = [
    { slot: 'morning', icon: '🌅', label: '朝' },
    { slot: 'noon',    icon: '☀️', label: '昼' },
    { slot: 'night',   icon: '🌙', label: '夜' },
  ];
  const container = document.getElementById('meal-editor-blocks');
  container.dataset.editKey = key;
  const defaultServ = getDefaultServings();
  container.innerHTML = slotDefs.map(({ slot, icon, label }) => {
    const m = getMealSlot(key, slot);
    const namesJson = esc(JSON.stringify(m.names));
    return `
    <div class="meal-block">
      <div class="meal-row">
        <span class="meal-icon">${icon}</span>
        <label class="meal-label-txt">${label}</label>
        <div class="meal-recipes-col" id="meal-names-${slot}" data-values="${namesJson}">
          ${renderSlotRecipeTags(slot, m.names)}
          <button class="add-recipe-btn" onclick="openRecipePicker('${slot}')">＋ レシピを追加</button>
        </div>
      </div>
      <div class="servings-row-slot">
        <label class="servings-slot-label">🛒</label>
        <input type="number" id="servings-${slot}" min="1" inputmode="numeric"
          class="field servings-slot-input" value="${defaultServ}">
        <span class="servings-slot-unit">人分</span>
        <button class="servings-slot-add-btn" onclick="addSlotToShopList('${slot}')">この${label}を追加</button>
      </div>
      <div class="attend-row">
        <button class="attend-btn ${m.p1 ? 'on' : 'off'}" id="attend-${slot}-p1" onclick="toggleAttend('${slot}','p1')">
          <span class="attend-name" id="label-${slot}-p1">${esc(names.p1)}</span>
          <span class="attend-state">${m.p1 ? '要る' : 'いらない'}</span>
        </button>
        <button class="attend-btn ${m.p2 ? 'on' : 'off'}" id="attend-${slot}-p2" onclick="toggleAttend('${slot}','p2')">
          <span class="attend-name" id="label-${slot}-p2">${esc(names.p2)}</span>
          <span class="attend-state">${m.p2 ? '要る' : 'いらない'}</span>
        </button>
      </div>
    </div>`;
  }).join('');

  // sheetAttend を同期
  slotDefs.forEach(({ slot }) => {
    const m = getMealSlot(key, slot);
    sheetAttend[slot] = { p1: m.p1, p2: m.p2 };
  });
}

function openSheet(key, month, day) {
  editingKey = key;
  const names = getNames();
  buildMealEditorBlocks(key, names);
  document.getElementById('sheet-date').textContent = `${month}月${day}日の献立`;
  document.getElementById('sheet-overlay').classList.remove('hidden');
  document.getElementById('meal-sheet').classList.remove('hidden');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.add('hidden');
  document.getElementById('meal-sheet').classList.add('hidden');
  editingKey = null;
}

function toggleAttend(slot, person) {
  sheetAttend[slot][person] = !sheetAttend[slot][person];
  updateAttendBtn(slot, person, sheetAttend[slot][person]);
}

function updateAttendBtn(slot, person, isOn) {
  const btn = document.getElementById(`attend-${slot}-${person}`);
  if (!btn) return;
  btn.className = 'attend-btn ' + (isOn ? 'on' : 'off');
  btn.querySelector('.attend-state').textContent = isOn ? '要る' : 'いらない';
}

function getDefaultServings() {
  return parseInt(localStorage.getItem('defaultServings')) || 2;
}

function saveDefaultServings() {
  const v = parseInt(document.getElementById('default-servings-input').value);
  if (!v || v < 1) { showToast('1以上の数値を入力してください', 'error'); return; }
  localStorage.setItem('defaultServings', v);
  showToast(`デフォルト人数を${v}人に設定しました`);
}

// 分数・小数文字列 → 数値。失敗時は NaN
function toNum(str) {
  if (!str && str !== 0) return NaN;
  const s = String(str).trim();
  if (s === '' || s === '少々' || s === '適量' || s === '—') return 0;
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    return b ? a / b : NaN;
  }
  return parseFloat(s);
}

// 数値 → 表示文字列（整数なら整数、小数は小数点以下2桁まで）
function fmtQty(n) {
  if (!isFinite(n) || n === 0) return '0';
  return parseFloat(n.toFixed(2)).toString();
}

async function addMealDayToShopList() {
  const SLOTS = ['morning', 'noon', 'night'];
  const slotData = SLOTS.map(slot => ({
    names:    getMealSlotNames(slot),
    servings: parseInt(document.getElementById(`servings-${slot}`)?.value) || getDefaultServings()
  })).filter(s => s.names.length > 0);

  if (!slotData.length) { showToast('献立が選択されていません', 'error'); return; }

  // name+unit をキーにして必要量を集計するマップ
  const needed = {}; // key -> { name, unit, cat, qty }

  slotData.forEach(({ names, servings }) => {
    names.forEach(name => {
      const recipe = recipes.find(r => r.name === name);
      if (!recipe || !recipe.ingredients.length) return;
      const recipeServings = recipe.servings || 2;
      const ratio = servings / recipeServings;

      recipe.ingredients.forEach(ing => {
        const rawQty = toNum(ing.qty);
        const scaled = isNaN(rawQty) || rawQty === 0 ? 0 : rawQty * ratio;
        const key    = `${ing.name}__${ing.unit || ''}`;
        if (needed[key]) {
          needed[key].qty += scaled;
        } else {
          needed[key] = { name: ing.name, unit: ing.unit || '', cat: ing.cat || 'その他', qty: scaled };
        }
      });
    });
  });

  if (!Object.keys(needed).length) {
    showToast('材料が登録されたレシピがありません', 'error'); return;
  }

  // 在庫を引いて不足分のみリストへ
  let added = 0;
  let skipped = 0;
  Object.values(needed).forEach(item => {
    // 同じ名前・単位の在庫を合算
    const inStock = stocks
      .filter(s => s.name === item.name && (s.unit || '') === item.unit)
      .reduce((sum, s) => sum + (toNum(String(s.qty)) || 0), 0);

    const required = item.qty - inStock;

    if (required <= 0) {
      skipped++;
      return; // 在庫で足りる
    }

    const qtyStr = fmtQty(required);
    // 既存の買い物リストに同じ名前・単位があれば加算
    const existing = shopItems.find(i => i.name === item.name && i.unit === item.unit && !i.checked);
    if (existing) {
      const prev = toNum(existing.qty) || 0;
      existing.qty = fmtQty(prev + required);
    } else {
      shopItems.push({
        id:      Date.now() + Math.random(),
        name:    item.name,
        qty:     qtyStr,
        unit:    item.unit,
        cat:     item.cat,
        checked: false
      });
    }
    added++;
  });

  renderShopItems();
  await pushData();

  const msgs = [];
  if (added)   msgs.push(`${added}件追加`);
  if (skipped) msgs.push(`${skipped}件は在庫で充足`);
  showToast(msgs.join('・') || '変化なし');
}

async function addSlotToShopList(slot) {
  const names = getMealSlotNames(slot);
  if (!names.length) { showToast('レシピが選択されていません', 'error'); return; }

  const servings = parseInt(document.getElementById(`servings-${slot}`)?.value) || getDefaultServings();
  const needed = {};

  names.forEach(name => {
    const recipe = recipes.find(r => r.name === name);
    if (!recipe || !recipe.ingredients.length) return;
    const ratio = servings / (recipe.servings || 2);
    recipe.ingredients.forEach(ing => {
      const rawQty = toNum(ing.qty);
      const scaled = isNaN(rawQty) || rawQty === 0 ? 0 : rawQty * ratio;
      const key = `${ing.name}__${ing.unit || ''}`;
      if (needed[key]) needed[key].qty += scaled;
      else needed[key] = { name: ing.name, unit: ing.unit || '', cat: ing.cat || 'その他', qty: scaled };
    });
  });

  if (!Object.keys(needed).length) { showToast('材料が登録されたレシピがありません', 'error'); return; }

  let added = 0, skipped = 0;
  Object.values(needed).forEach(item => {
    const inStock = stocks
      .filter(s => s.name === item.name && (s.unit || '') === item.unit)
      .reduce((sum, s) => sum + (toNum(String(s.qty)) || 0), 0);
    const required = item.qty - inStock;
    if (required <= 0) { skipped++; return; }
    const existing = shopItems.find(i => i.name === item.name && i.unit === item.unit && !i.checked);
    if (existing) existing.qty = fmtQty((toNum(existing.qty) || 0) + required);
    else shopItems.push({ id: Date.now() + Math.random(), name: item.name, qty: fmtQty(required), unit: item.unit, cat: item.cat, checked: false });
    added++;
  });

  renderShopItems();
  await pushData();
  const msgs = [];
  if (added)   msgs.push(`${added}件追加`);
  if (skipped) msgs.push(`${skipped}件は在庫で充足`);
  showToast(msgs.join('・') || '変化なし');
}

async function saveMeal() {
  if (!editingKey) return;
  const slotsNames = {
    morning: getMealSlotNames('morning'),
    noon:    getMealSlotNames('noon'),
    night:   getMealSlotNames('night'),
  };
  const hasAny = Object.values(slotsNames).some(arr => arr.length > 0);

  if (hasAny) {
    meals[editingKey] = {};
    ['morning','noon','night'].forEach(slot => {
      meals[editingKey][slot] = {
        names: slotsNames[slot],
        p1:    sheetAttend[slot].p1,
        p2:    sheetAttend[slot].p2
      };
    });
  } else {
    delete meals[editingKey];
  }

  closeSheet();
  renderCalendar();
  await pushData();
}

function suggestMeals() {
  if (!recipes.length) { showToast('レシピタブでレシピを追加してください', 'error'); return; }
  const pick = () => recipes[Math.floor(Math.random() * recipes.length)].name;
  ['morning','noon','night'].forEach(slot => {
    const name = pick();
    const el = document.getElementById(`meal-names-${slot}`);
    if (el) {
      const arr = [name];
      el.dataset.values = JSON.stringify(arr);
      el.innerHTML = renderSlotRecipeTags(slot, arr) +
        `<button class="add-recipe-btn" onclick="openRecipePicker('${slot}')">＋ レシピを追加</button>`;
    }
    sheetAttend[slot] = { p1: true, p2: true };
    updateAttendBtn(slot, 'p1', true);
    updateAttendBtn(slot, 'p2', true);
  });
}

// ======== 在庫 ========
const STOCK_CATS = ['食材', '調味料', '冷凍ストック'];
let stockCatFilter    = 'all';
let stockStatusFilter = 'all';

function openStockSheet(editId = null) {
  const s = editId ? stocks.find(s => s.id === editId) : null;
  document.getElementById('stock-edit-id').value   = editId || '';
  document.getElementById('stock-sheet-title').textContent = s ? '在庫を編集' : '在庫を追加';
  document.getElementById('stock-sheet-btn').textContent  = s ? '保存する' : '追加する';
  document.getElementById('stock-cat-select').value = s ? (s.cat || '食材') : '食材';
  document.getElementById('stock-name').value   = s ? s.name   : '';
  document.getElementById('stock-qty').value    = s ? s.qty    : '';
  document.getElementById('stock-unit').value   = s ? (s.unit || 'g') : 'g';
  document.getElementById('stock-expiry').value = s ? s.expiry : '';
  document.getElementById('stock-sheet-overlay').classList.remove('hidden');
  document.getElementById('stock-sheet').classList.remove('hidden');
}
function closeStockSheet() {
  document.getElementById('stock-sheet-overlay').classList.add('hidden');
  document.getElementById('stock-sheet').classList.add('hidden');
}

// parseQty は toNum の別名（後方互換）
function parseQty(str) { return toNum(str); }

async function saveStockFromSheet() {
  const editId = document.getElementById('stock-edit-id').value;
  const cat    = document.getElementById('stock-cat-select').value;
  const name   = document.getElementById('stock-name').value.trim();
  const qtyStr = document.getElementById('stock-qty').value.trim();
  const unit   = document.getElementById('stock-unit').value;
  const expiry = document.getElementById('stock-expiry').value;
  if (!name)              { showToast('名前を入力してください', 'error'); return; }
  if (!qtyStr)            { showToast('数量を入力してください', 'error'); return; }
  const qty = parseQty(qtyStr);
  if (isNaN(qty))         { showToast('数量が正しくありません（例: 1/3）', 'error'); return; }

  if (editId) {
    const s = stocks.find(s => s.id === Number(editId));
    if (s) Object.assign(s, { cat, name, qty, unit, expiry });
  } else {
    stocks.push({ id: Date.now(), cat, name, qty, qtyStr, unit, expiry });
  }
  renderStocks();
  closeStockSheet();
  await pushData();
  showToast(editId ? '更新しました' : `「${name}」を追加しました`);
}

async function adjustStockQty(id, delta) {
  const s = stocks.find(s => s.id === id);
  if (!s) return;
  const newQty = Math.max(0, (parseQty(String(s.qty)) || 0) + delta);
  s.qty = newQty;
  s.qtyStr = String(newQty);
  renderStocks();
  await pushData();
}

async function addStockToShopList(id) {
  const s = stocks.find(s => s.id === id);
  if (!s) return;
  const cats = getCategories();
  shopItems.push({
    id:      Date.now() + Math.random(),
    name:    s.name,
    qty:     '1',
    unit:    s.unit || '',
    cat:     cats.includes(s.cat) ? s.cat : (cats[0] || 'その他'),
    checked: false,
    stockId: s.id   // 在庫との紐付け
  });
  renderShopItems();
  await pushData();
  showToast(`「${s.name}」を買い物リストに追加しました`);
}

async function deleteStock(id) {
  stocks = stocks.filter(s => s.id !== id);
  renderStocks();
  await pushData();
}

function getStatus(s) {
  const today = new Date(); today.setHours(0,0,0,0);
  if (s.expiry) {
    const diff = (new Date(s.expiry) - today) / 86400000;
    if (diff <= 3) return 'expiring';
  }
  if (s.qty <= 1) return 'low';
  return 'ok';
}

function filterStockCat(f, btn) {
  stockCatFilter = f;
  document.querySelectorAll('#cat-filters .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderStocks();
}

function filterStockStatus(f, btn) {
  stockStatusFilter = f;
  document.querySelectorAll('#status-filters .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderStocks();
}

function renderStocks() {
  const list = document.getElementById('stock-list');

  // カテゴリ・状態フィルター適用
  let filtered = stocks.map(s => ({ ...s, cat: s.cat || '食材' })); // 旧データ互換
  if (stockCatFilter    !== 'all') filtered = filtered.filter(s => s.cat === stockCatFilter);
  if (stockStatusFilter === 'low')      filtered = filtered.filter(s => getStatus(s) === 'low');
  if (stockStatusFilter === 'expiring') filtered = filtered.filter(s => getStatus(s) === 'expiring');

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-card">在庫がありません</div>';
    return;
  }

  // カテゴリ別にグループ化（すべて表示のときのみ）
  if (stockCatFilter === 'all') {
    const groups = {};
    STOCK_CATS.forEach(c => { groups[c] = []; });
    filtered.forEach(s => {
      const c = s.cat || '食材';
      if (groups[c]) groups[c].push(s); else groups['食材'].push(s);
    });
    list.innerHTML = STOCK_CATS.map(cat => {
      if (!groups[cat].length) return '';
      return `<div class="stock-group">
        <div class="stock-group-label">${cat}</div>
        ${groups[cat].map(s => stockCardHTML(s)).join('')}
      </div>`;
    }).join('');
  } else {
    list.innerHTML = filtered.map(s => stockCardHTML(s)).join('');
  }
}

function stockCardHTML(s) {
  const st = getStatus(s);
  const badgeCls = { ok:'badge-ok', low:'badge-low', expiring:'badge-expiring' }[st];
  const badgeTxt = { ok:'良好', low:'残り少ない', expiring:'期限間近' }[st];
  const qtyDisp  = s.qtyStr || String(s.qty);
  const expLabel = s.expiry ? `期限 ${s.expiry}` : '';
  return `<div class="stock-card">
    <div class="stock-info" onclick="openStockSheet(${s.id})">
      <div class="stock-name">${esc(s.name)}</div>
      <div class="stock-meta">${expLabel}</div>
    </div>
    <div class="stock-qty-ctrl">
      <button class="qty-btn" onclick="adjustStockQty(${s.id},-1)">−</button>
      <span class="qty-val">${esc(qtyDisp)}<small>${esc(s.unit||'')}</small></span>
      <button class="qty-btn" onclick="adjustStockQty(${s.id}, 1)">＋</button>
    </div>
    <div class="stock-actions">
      <span class="badge ${badgeCls}">${badgeTxt}</span>
      <button class="icon-action-btn" onclick="addStockToShopList(${s.id})" title="買い物リストへ">🛒</button>
      <button class="del-btn" onclick="deleteStock(${s.id})">🗑</button>
    </div>
  </div>`;
}

// ======== 買い物リスト ========
function openShopSheet() {
  ['shop-item','shop-qty'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('shop-unit').value = '個';
  populateShopCatSelect();
  document.getElementById('shop-sheet-overlay').classList.remove('hidden');
  document.getElementById('shop-sheet').classList.remove('hidden');
}
function closeShopSheet() {
  document.getElementById('shop-sheet-overlay').classList.add('hidden');
  document.getElementById('shop-sheet').classList.add('hidden');
}

async function addShopItem() {
  const name = document.getElementById('shop-item').value.trim();
  const qty  = document.getElementById('shop-qty').value.trim() || '1';
  const unit = document.getElementById('shop-unit').value;
  const cat  = document.getElementById('shop-category').value;
  if (!name) { showToast('商品名を入力してください', 'error'); return; }
  shopItems.push({ id: Date.now(), name, qty, unit, cat, checked: false });
  renderShopItems();
  closeShopSheet();
  await pushData();
}

async function toggleShopItem(id) {
  const item = shopItems.find(i => i.id === id);
  if (!item) return;
  const nowChecked = !item.checked;
  item.checked = nowChecked;

  // 在庫と紐付いている場合、チェック→在庫数を購入分(qty)増やす
  if (item.stockId) {
    const stock = stocks.find(s => s.id === item.stockId);
    if (stock) {
      const add    = parseQty(item.qty) || 1;
      const before = parseQty(String(stock.qty)) || 0;
      const delta  = nowChecked ? add : -add;
      const newQty = Math.max(0, before + delta);
      stock.qty    = newQty;
      stock.qtyStr = String(newQty);
      renderStocks();
    }
  }

  renderShopItems();
  await pushData();
}

async function clearChecked() {
  const before = shopItems.length;
  shopItems = shopItems.filter(i => !i.checked);
  renderShopItems();
  if (before !== shopItems.length) await pushData();
  showToast(before !== shopItems.length ? `${before - shopItems.length}件を削除しました` : '削除するアイテムがありません');
}

async function moveToStock() {
  const bought = shopItems.filter(i => i.checked);
  if (!bought.length) { showToast('チェック済みがありません', 'error'); return; }
  bought.forEach(i => {
    stocks.push({ id: Date.now() + Math.random(), name: i.name, qty: parseFloat(i.qty) || 1, unit: i.unit, expiry: '' });
  });
  shopItems = shopItems.filter(i => !i.checked);
  renderStocks();
  renderShopItems();
  await pushData();
  showToast(`${bought.length}件を在庫に移動しました`);
}

function renderShopItems() {
  const container = document.getElementById('shopping-list');
  if (!shopItems.length) {
    container.innerHTML = '<div class="empty-card">買い物リストは空です</div>';
    return;
  }
  const groups = {};
  shopItems.forEach(i => {
    if (!groups[i.cat]) groups[i.cat] = [];
    groups[i.cat].push(i);
  });
  container.innerHTML = Object.entries(groups).map(([cat, items]) => `
    <div class="shop-category-group">
      <div class="category-label">${esc(cat)}</div>
      ${items.map(i => `
        <div class="shop-card ${i.checked ? 'checked' : ''}" onclick="toggleShopItem(${i.id})">
          <input type="checkbox" ${i.checked ? 'checked' : ''} onclick="event.stopPropagation();toggleShopItem(${i.id})">
          <span class="shop-name">${esc(i.name)}</span>
          <span class="shop-qty">${esc(i.qty)} ${esc(i.unit)}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

// ======== レシピカテゴリ ========
const DEFAULT_RECIPE_CATS = ['主菜', '副菜', '汁物', '主食', 'デザート', 'その他'];

function getRecipeCategories() {
  const s = localStorage.getItem('recipeCats');
  return s ? JSON.parse(s) : [...DEFAULT_RECIPE_CATS];
}

function populateRecipeCatBtns(selectedVal) {
  const wrap = document.getElementById('r-category-btns');
  const hidden = document.getElementById('r-category');
  if (!wrap || !hidden) return;
  const cats = getRecipeCategories();
  const val  = selectedVal !== undefined ? selectedVal : (hidden.value || cats[0] || '');
  hidden.value = cats.includes(val) ? val : (cats[0] || '');
  wrap.innerHTML = cats.map(c =>
    `<button type="button" class="tap-btn ${hidden.value === c ? 'active' : ''}"
      onclick="selectRecipeCat('${esc(c)}')">${esc(c)}</button>`
  ).join('');
}

function selectRecipeCat(name) {
  document.getElementById('r-category').value = name;
  populateRecipeCatBtns(name);
}

// ======== レシピピッカー ========
let pickerSlot = null; // 'morning' | 'noon' | 'night'

function openRecipePicker(slot) {
  pickerSlot = slot;
  const slotLabel = { morning:'朝食', noon:'昼食', night:'夕食' }[slot];
  document.getElementById('picker-title').textContent = `${slotLabel}のレシピを選ぶ`;
  renderPickerCatTabs('all');
  document.getElementById('picker-overlay').classList.remove('hidden');
  document.getElementById('recipe-picker').classList.remove('hidden');
}

function closeRecipePicker() {
  document.getElementById('picker-overlay').classList.add('hidden');
  document.getElementById('recipe-picker').classList.add('hidden');
  pickerSlot = null;
}

function renderPickerCatTabs(activeCat) {
  const cats = ['すべて', ...getRecipeCategories()];
  const tabs  = document.getElementById('picker-cat-tabs');
  tabs.innerHTML = cats.map(c => `
    <button class="picker-cat-tab ${c === activeCat || (activeCat === 'all' && c === 'すべて') ? 'active' : ''}"
      onclick="renderPickerCatTabs('${esc(c)}')">${esc(c)}</button>
  `).join('');

  const filterCat = activeCat === 'すべて' ? 'all' : activeCat;
  const list = filterCat === 'all' ? recipes : recipes.filter(r => (r.category || 'その他') === filterCat);
  const grid = document.getElementById('picker-recipe-grid');

  if (!list.length) {
    grid.innerHTML = '<div class="empty-card">レシピがありません</div>';
    return;
  }

  grid.innerHTML = list.map(r => {
    const catLabel = r.category || 'その他';
    const cookLabel = (() => {
      const m = parseInt(r.cookTime);
      if (!m) return '';
      return m < 60 ? `${m}分` : `${Math.floor(m/60)}h${m%60?m%60+'m':''}`;
    })();
    return `<div class="picker-card ${pickerSelectedName(r.name) ? 'selected' : ''}"
      onclick="selectRecipeForSlot('${esc(r.name)}')">
      <div class="picker-card-name">${esc(r.name)}</div>
      <div class="picker-card-meta">
        <span class="picker-cat-badge">${esc(catLabel)}</span>
        ${cookLabel ? `<span class="picker-info">⏱${esc(cookLabel)}</span>` : ''}
        ${r.servings ? `<span class="picker-info">${r.servings}人分</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function pickerSelectedName(name) {
  if (!pickerSlot) return false;
  const el = document.getElementById(`meal-names-${pickerSlot}`);
  if (!el) return false;
  return JSON.parse(el.dataset.values || '[]').includes(name);
}

function selectRecipeForSlot(name) {
  if (!pickerSlot || !name) return;
  const el = document.getElementById(`meal-names-${pickerSlot}`);
  if (el) {
    const arr = JSON.parse(el.dataset.values || '[]');
    if (!arr.includes(name)) {
      arr.push(name);
      el.dataset.values = JSON.stringify(arr);
      el.innerHTML = renderSlotRecipeTags(pickerSlot, arr) +
        `<button class="add-recipe-btn" onclick="openRecipePicker('${pickerSlot}')">＋ レシピを追加</button>`;
    }
  }
  closeRecipePicker();
}

// ======== レシピ ========
let tempIngredients = [];
let tempSteps       = [];

function openRecipeSheet() {
  tempIngredients = [];
  tempSteps       = [];
  ['r-name','r-cook-time','r-storage','step-text','ing-name','ing-qty'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('r-servings').value = '2';
  document.getElementById('ing-unit').value = 'g';
  renderTempIngredients();
  renderTempSteps();
  populateIngCatSelect();
  populateRecipeCatBtns();
  document.getElementById('recipe-sheet-overlay').classList.remove('hidden');
  document.getElementById('recipe-sheet').classList.remove('hidden');
}

function closeRecipeSheet() {
  document.getElementById('recipe-sheet-overlay').classList.add('hidden');
  document.getElementById('recipe-sheet').classList.add('hidden');
}

function addTempIngredient() {
  const name = document.getElementById('ing-name').value.trim();
  const qty  = document.getElementById('ing-qty').value.trim();
  const unit = document.getElementById('ing-unit').value.trim();
  const cat  = document.getElementById('ing-cat').value;
  if (!name) { showToast('材料名を入力してください', 'error'); return; }
  tempIngredients.push({ id: Date.now(), name, qty, unit, cat });
  renderTempIngredients();
  ['ing-name','ing-qty','ing-unit'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ing-name').focus();
}

function removeTempIngredient(id) {
  tempIngredients = tempIngredients.filter(i => i.id !== id);
  renderTempIngredients();
}

function renderTempIngredients() {
  const el = document.getElementById('temp-ingredients');
  if (!tempIngredients.length) { el.innerHTML = ''; return; }
  el.innerHTML = tempIngredients.map(i =>
    `<div class="temp-item">
      <span class="temp-item-text">${esc(i.name)} ${esc(i.qty)}${esc(i.unit)} <small class="temp-cat">${esc(i.cat)}</small></span>
      <button class="del-btn" onclick="removeTempIngredient(${i.id})">✕</button>
    </div>`
  ).join('');
}

function addTempStep() {
  const text = document.getElementById('step-text').value.trim();
  if (!text) { showToast('手順を入力してください', 'error'); return; }
  tempSteps.push({ id: Date.now(), text });
  renderTempSteps();
  document.getElementById('step-text').value = '';
  document.getElementById('step-text').focus();
}

function removeTempStep(id) {
  tempSteps = tempSteps.filter(s => s.id !== id);
  renderTempSteps();
}

function moveTempStep(id, dir) {
  const idx = tempSteps.findIndex(s => s.id === id);
  const to  = idx + dir;
  if (to < 0 || to >= tempSteps.length) return;
  [tempSteps[idx], tempSteps[to]] = [tempSteps[to], tempSteps[idx]];
  renderTempSteps();
}

function renderTempSteps() {
  const el = document.getElementById('temp-steps');
  if (!tempSteps.length) { el.innerHTML = ''; return; }
  el.innerHTML = tempSteps.map((s, i) =>
    `<div class="temp-item">
      <span class="temp-step-num">${i + 1}</span>
      <span class="temp-item-text">${esc(s.text)}</span>
      <div class="step-order-btns">
        <button class="order-btn" onclick="moveTempStep(${s.id},-1)" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="order-btn" onclick="moveTempStep(${s.id}, 1)" ${i === tempSteps.length-1 ? 'disabled' : ''}>↓</button>
      </div>
      <button class="del-btn" onclick="removeTempStep(${s.id})">✕</button>
    </div>`
  ).join('');
}

async function saveRecipe() {
  const name = document.getElementById('r-name').value.trim();
  if (!name) { showToast('レシピ名を入力してください', 'error'); return; }
  recipes.push({
    id:          Date.now(),
    name,
    category:    document.getElementById('r-category').value,
    servings:    parseInt(document.getElementById('r-servings').value) || 2,
    cookTime:    document.getElementById('r-cook-time').value.trim(),
    storageTime: document.getElementById('r-storage').value.trim(),
    ingredients: [...tempIngredients],
    steps:       [...tempSteps],
    open:        false
  });
  closeRecipeSheet();
  renderRecipes();
  await pushData();
  showToast(`「${name}」を追加しました`);
}

async function deleteRecipe(id) {
  recipes = recipes.filter(r => r.id !== id);
  renderRecipes();
  await pushData();
}

function toggleRecipe(id) {
  const r = recipes.find(r => r.id === id);
  if (r) r.open = !r.open;
  renderRecipes();
}

async function addIngredientsToShopList(recipeId) {
  const r = recipes.find(r => r.id === recipeId);
  if (!r || !r.ingredients.length) { showToast('材料が登録されていません', 'error'); return; }

  const buyServings    = getDefaultServings();
  const recipeServings = r.servings || 2;
  const ratio          = buyServings / recipeServings;

  let added = 0, skipped = 0;
  r.ingredients.forEach(ing => {
    const rawQty = toNum(ing.qty);
    const scaled = isNaN(rawQty) || rawQty === 0 ? 0 : rawQty * ratio;
    const inStock = stocks
      .filter(s => s.name === ing.name && (s.unit || '') === (ing.unit || ''))
      .reduce((sum, s) => sum + (toNum(String(s.qty)) || 0), 0);
    const required = scaled - inStock;

    if (required <= 0) { skipped++; return; }

    const existing = shopItems.find(i => i.name === ing.name && i.unit === (ing.unit || '') && !i.checked);
    if (existing) {
      existing.qty = fmtQty((toNum(existing.qty) || 0) + required);
    } else {
      shopItems.push({
        id:      Date.now() + Math.random(),
        name:    ing.name,
        qty:     fmtQty(required),
        unit:    ing.unit || '',
        cat:     ing.cat || 'その他',
        checked: false
      });
    }
    added++;
  });

  renderShopItems();
  await pushData();
  const msgs = [];
  if (added)   msgs.push(`${added}件追加`);
  if (skipped) msgs.push(`${skipped}件は在庫で充足`);
  showToast(msgs.join('・') || '変化なし');
}

function renderRecipes() {
  const list = document.getElementById('recipe-list');
  if (!recipes.length) {
    list.innerHTML = '<div class="empty-card">レシピがありません</div>';
    return;
  }
  list.innerHTML = recipes.map(r => {
    const cookLabel = (() => {
      const m = parseInt(r.cookTime);
      if (!m) return '';
      return m < 60 ? `⏱ ${m}分` : `⏱ ${Math.floor(m/60)}時間${m%60 ? m%60+'分' : ''}`;
    })();
    const infos = [
      r.servings    ? `${r.servings}人分`    : '',
      cookLabel,
      r.storageTime ? `📦 ${r.storageTime}` : '',
    ].filter(Boolean);

    return `
    <div class="recipe-card">
      <div class="recipe-header" onclick="toggleRecipe(${r.id})">
        <div class="recipe-header-left">
          <span class="recipe-name">${esc(r.name)}</span>
          ${infos.length ? `<div class="recipe-infos">${infos.map(t => `<span class="recipe-info-chip">${esc(t)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="recipe-header-right">
          <button class="del-btn" onclick="event.stopPropagation();deleteRecipe(${r.id})">🗑</button>
          <span class="recipe-arrow">${r.open ? '▲' : '▼'}</span>
        </div>
      </div>
      ${r.open ? `
        <div class="recipe-body">
          ${r.ingredients && r.ingredients.length ? `
            <div class="recipe-section">
              <div class="recipe-section-title">材料（${r.servings || 2}人分）</div>
              <ul class="ing-list">
                ${r.ingredients.map(i =>
                  `<li><span class="ing-cat-dot" data-cat="${esc(i.cat)}"></span>${esc(i.name)} <span class="ing-amount">${esc(i.qty)}${esc(i.unit)}</span></li>`
                ).join('')}
              </ul>
            </div>` : ''}
          ${r.steps && r.steps.length ? `
            <div class="recipe-section">
              <div class="recipe-section-title">手順</div>
              <ol class="step-list">
                ${r.steps.map(s => `<li>${esc(s.text)}</li>`).join('')}
              </ol>
            </div>` : ''}
          <button class="accent-btn full" onclick="addIngredientsToShopList(${r.id})">🛒 材料を買い物リストへ</button>
        </div>
      ` : ''}
    </div>`;
  }).join('');
}

// ======== 設定タブ ========
function updateSettingsView() {
  renderCatSettings();
  const fbUrl = getFirebaseUrl();
  const key   = getDataKey();
  const names = getNames();
  const display = fbUrl
    ? `${fbUrl.replace('https://', '')} / key: ${key.slice(0, 8)}…`
    : '（未接続）';
  document.getElementById('blob-id-display').textContent = display;
  document.getElementById('p1-name-input').value = names.p1 === '自分'       ? '' : names.p1;
  document.getElementById('p2-name-input').value = names.p2 === 'パートナー' ? '' : names.p2;
  document.getElementById('default-servings-input').value = getDefaultServings();
}

async function manualFetch() {
  if (IS_LOCAL) { showToast('ローカルモードのため同期不要'); return; }
  await fetchData();
  showToast('同期しました');
}

function changeBlobId() {
  const val = document.getElementById('new-blob-id').value.trim();
  if (!val) { showToast('共有URLを入力してください', 'error'); return; }
  // フルURLでもハッシュ部分だけでも受け付ける
  let hash = val.includes('#') ? val.split('#')[1] : val;
  if (!hash) { showToast('URLが正しくありません', 'error'); return; }
  location.hash = hash;
  document.getElementById('new-blob-id').value = '';
  fetchData();
  showToast('接続しました');
  updateSettingsView();
}

function resetBlob() {
  if (!confirm('新しいデータを作成しますか？\n現在のデータとの接続は切れます。')) return;
  location.hash = '';
  meals = {}; stocks = []; shopItems = []; recipes = [];
  document.getElementById('setup-overlay').classList.remove('hidden');
  const btn = document.getElementById('setup-btn');
  btn.disabled = false;
  btn.textContent = 'データを作成';
}

function copyURL() {
  const url = location.href;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url).then(() => showToast('URLをコピーしました'));
  }
}

// ======== ユーティリティ ========
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escNL(s) {
  return esc(s).replace(/\n/g, '<br>');
}

let toastTimer;
function showToast(msg, type = '') {
  clearTimeout(toastTimer);
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  document.body.appendChild(t);
  toastTimer = setTimeout(() => t.remove(), 2500);
}

// ======== 初期化 ========
populateShopCatSelect();
initCalendar();

if (IS_LOCAL) {
  loadLocal();
} else if (getFirebaseUrl()) {
  fetchData();
} else {
  document.getElementById('setup-overlay').classList.remove('hidden');
}

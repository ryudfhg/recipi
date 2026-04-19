// ======== SVGアイコン定数 ========
const SVG = {
  // 朝食（日の出）
  morning: `<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="4.22" y1="6.22" x2="5.64" y2="7.64"/><line x1="2" y1="14" x2="4" y2="14"/><line x1="20" y1="14" x2="22" y2="14"/><line x1="18.36" y1="7.64" x2="19.78" y2="6.22"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`,
  // 昼食（太陽）
  noon: `<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  // 夕食（月）
  night: `<svg class="slot-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
};

// ======== モード判定 ========
const IS_LOCAL = location.protocol === 'file:'
  || location.hostname === 'localhost'
  || location.hostname === '127.0.0.1';

// ======== Firebase Realtime Database API ========
// ハッシュ形式: #{urlsafe_base64(firebaseUrl)}:{randomKey}
// 接続情報は localStorage にも保存し、ハッシュが消えても復元できるようにする

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function getRawHash() {
  return location.hash.replace('#', '') || null;
}

// ハッシュからFirebase URLを解析
function parseFirebaseUrlFromHash(hash) {
  if (!hash || !hash.includes(':')) return null;
  const b64 = hash.split(':')[0];
  try {
    // URL-safe base64 → 標準base64 + パディング補完
    let std = b64.replace(/-/g, '+').replace(/_/g, '/');
    const pad = std.length % 4;
    if (pad === 2) std += '==';
    else if (pad === 3) std += '=';
    const decoded = atob(std);
    // https:// で始まる場合のみ有効とみなす
    if (!decoded.startsWith('https://')) return null;
    return decoded;
  } catch { return null; }
}

// ハッシュからkeyを解析
function parseKeyFromHash(hash) {
  if (!hash) return null;
  const idx = hash.indexOf(':');
  return idx >= 0 ? hash.slice(idx + 1) : hash;
}

// 接続情報をlocalStorageに保存（ハッシュが消えても復元できる）
function saveConnectionInfo(fbUrl, key) {
  localStorage.setItem('fbUrl', fbUrl);
  localStorage.setItem('fbKey', key);
  // ハッシュも維持（URLシェア用）
  const b64 = btoa(fbUrl).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  if (location.hash !== `#${b64}:${key}`) {
    history.replaceState(null, '', `#${b64}:${key}`);
  }
}

function clearConnectionInfo() {
  localStorage.removeItem('fbUrl');
  localStorage.removeItem('fbKey');
  localStorage.removeItem('fbHash'); // 旧形式互換
}

// 有効なFirebase URLを取得（ハッシュ → localStorage の順で探す）
function getFirebaseUrl() {
  const hash = getRawHash();
  const fromHash = parseFirebaseUrlFromHash(hash);
  if (fromHash) return fromHash;
  return localStorage.getItem('fbUrl') || null;
}

// 有効なkeyを取得（ハッシュ → localStorage の順で探す）
function getDataKey() {
  const hash = getRawHash();
  if (parseFirebaseUrlFromHash(hash)) {
    return parseKeyFromHash(hash);
  }
  return localStorage.getItem('fbKey') || null;
}

// 最後に同期したデータのJSON文字列（変更検知用）
let lastSyncJSON = null;
// 自動ポーリング用タイマー
let autoSyncTimer = null;
const AUTO_SYNC_MS = 30 * 1000; // 30秒

function applyData(data) {
  meals     = data.meals     || {};
  stocks    = data.stocks    || [];
  shopItems = data.shopItems || [];
  recipes   = data.recipes   || [];
  if (data.ingCategories) localStorage.setItem('ingCategories', JSON.stringify(data.ingCategories));
  if (data.stockCats)     localStorage.setItem('stockCats',     JSON.stringify(data.stockCats));
  if (data.recipeCats)    localStorage.setItem('recipeCats',    JSON.stringify(data.recipeCats));
  lastSyncJSON = JSON.stringify({ meals, stocks, shopItems, recipes,
    ingCategories: getCategories(), stockCats: getStockCategories(), recipeCats: getRecipeCategories() });
  saveLocal();
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
    applyData(data);
  }
  hideSync();
  renderAll();
  startAutoSync();
}

// バックグラウンドポーリング：変化があった時だけ再レンダリング
async function pollSync() {
  if (!getFirebaseUrl()) return;
  const fbUrl = getFirebaseUrl();
  const key   = getDataKey();
  try {
    const res = await fetch(`${fbUrl}/${key}.json`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data || typeof data !== 'object') return;
    const newJSON = JSON.stringify({
      meals:         data.meals         || {},
      stocks:        data.stocks        || [],
      shopItems:     data.shopItems     || [],
      recipes:       data.recipes       || [],
      ingCategories: data.ingCategories || [],
      stockCats:     data.stockCats     || [],
      recipeCats:    data.recipeCats    || [],
    });
    if (newJSON === lastSyncJSON) return; // 変化なし
    applyData(data);
    renderAll();
    showToast('データを更新しました');
  } catch { /* ネットワーク不調は無視 */ }
}

function startAutoSync() {
  stopAutoSync();
  if (IS_LOCAL) return;
  autoSyncTimer = setInterval(pollSync, AUTO_SYNC_MS);
}

function stopAutoSync() {
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
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
      body: JSON.stringify({ meals, stocks, shopItems, recipes,
        ingCategories: getCategories(), stockCats: getStockCategories(), recipeCats: getRecipeCategories() })
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
  // 自分の保存内容をキャッシュ（ポーリングで自己更新を誤検知しないよう）
  lastSyncJSON = JSON.stringify({ meals, stocks, shopItems, recipes,
    ingCategories: getCategories(), stockCats: getStockCategories(), recipeCats: getRecipeCategories() });
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
  const key = generateId();
  saveConnectionInfo(fbUrl, key);
  document.getElementById('setup-overlay').classList.add('hidden');
  await pushData();
  copyURL();
  showToast('セットアップ完了！URLをパートナーに共有してください');
}

// ======== ローカルストレージ（file://用） ========
function saveLocal() {
  localStorage.setItem('app_data', JSON.stringify({ meals, stocks, shopItems, recipes,
    ingCategories: getCategories(), stockCats: getStockCategories(), recipeCats: getRecipeCategories() }));
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
  if (data.ingCategories) localStorage.setItem('ingCategories', JSON.stringify(data.ingCategories));
  if (data.stockCats)     localStorage.setItem('stockCats',     JSON.stringify(data.stockCats));
  if (data.recipeCats)    localStorage.setItem('recipeCats',    JSON.stringify(data.recipeCats));
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

// ======== 買い物アクションシート ========
function toggleShopActionSheet() {
  const sheet = document.getElementById('shop-action-sheet');
  const overlay = document.getElementById('shop-action-overlay');
  const isHidden = sheet.classList.contains('hidden');
  sheet.classList.toggle('hidden', !isHidden);
  overlay.classList.toggle('hidden', !isHidden);
}

function closeShopActionSheet() {
  document.getElementById('shop-action-sheet')?.classList.add('hidden');
  document.getElementById('shop-action-overlay')?.classList.add('hidden');
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
  // フィルターボタン：在庫タブとレシピタブで表示
  const filterBtn = document.getElementById('filter-btn');
  const showFilter = name === 'stock' || name === 'recipes';
  filterBtn.classList.toggle('hidden', !showFilter);
  if (name !== 'stock') {
    document.getElementById('stock-filter-panel').classList.add('hidden');
  }
  if (name !== 'recipes') {
    document.getElementById('recipe-filter-panel').classList.add('hidden');
  }
  if (!showFilter) filterBtn.classList.remove('active');
  // 買い物アクションボタン：買い物タブのみ表示
  document.getElementById('shop-action-btn').classList.toggle('hidden', name !== 'shopping');
  if (name !== 'shopping') closeShopActionSheet();
  if (name === 'settings') updateSettingsView();
}

function toggleFilterPanel() {
  // 現在アクティブなタブに対応するパネルを切り替え
  const activeTab = document.querySelector('.tab.active');
  const panelId = activeTab && activeTab.id === 'tab-recipes'
    ? 'recipe-filter-panel' : 'stock-filter-panel';
  const panel = document.getElementById(panelId);
  const btn   = document.getElementById('filter-btn');
  const isOpen = !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isOpen);
  btn.classList.toggle('active', !isOpen);
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
  pushData();
}

function removeCategory(name) {
  const cats = getCategories().filter(c => c !== name);
  if (!cats.length) { showToast('カテゴリは最低1つ必要です', 'error'); return; }
  saveCategories(cats);
  renderCatSettings();
  populateShopCatSelect();
  populateIngCatSelect();
  pushData();
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

  const slotLabels = { morning: '朝飯', noon: '昼飯', night: '夕飯' };
  let preview = '';
  ['morning','noon','night'].forEach(slot => {
    const m = getMealSlot(key, slot);
    // レシピなし かつ 両者とも「要る」なら表示不要
    if (!m.names.length && m.p1 && m.p2) return;
    const b1 = !m.p1 ? `<span class="att-badge att-off">${p1Initial}</span>` : '';
    const b2 = !m.p2 ? `<span class="att-badge att-off">${p2Initial}</span>` : '';
    const nameDisp = m.names.length
      ? m.names[0] + (m.names.length > 1 ? ` +${m.names.length - 1}` : '')
      : '';
    preview += `<div class="cal-meal-preview">
      <div class="preview-header">
        <span class="preview-icon">${SVG[slot]}</span>
        <span class="preview-label">${slotLabels[slot]}</span>
        ${b1}${b2}
      </div>
      ${nameDisp ? `<div class="preview-name">${esc(nameDisp)}</div>` : ''}
    </div>`;
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
    `<span class="recipe-tag"><span class="recipe-tag-name" onclick="openRecipePreview('${slot}',${i})">${esc(n)}</span><button class="recipe-tag-del" onclick="removeRecipeFromSlot('${slot}',${i})">✕</button></span>`
  ).join('');
}

function removeRecipeFromSlot(slot, index) {
  const el = document.getElementById(`meal-names-${slot}`);
  if (!el) return;
  const arr = JSON.parse(el.dataset.values || '[]');
  arr.splice(index, 1);
  el.dataset.values = JSON.stringify(arr);
  refreshMealSlotUI(slot);
}

function buildMealEditorBlocks(key, names) {
  const slotDefs = [
    { slot: 'morning', icon: SVG.morning, label: '朝飯' },
    { slot: 'noon',    icon: SVG.noon,    label: '昼飯' },
    { slot: 'night',   icon: SVG.night,   label: '夕飯' },
  ];
  const container = document.getElementById('meal-editor-blocks');
  container.dataset.editKey = key;
  const defaultServ = getDefaultServings();
  container.innerHTML = slotDefs.map(({ slot, icon, label }) => {
    const m = getMealSlot(key, slot);
    const namesJson = esc(JSON.stringify(m.names));
    const previewTxt = m.names.length ? esc(m.names.join('・')) : '';
    return `
    <div class="meal-block" id="meal-block-${slot}">
      <div class="meal-slot-header meal-slot-toggle" onclick="toggleMealBlock('${slot}')">
        <span class="meal-icon">${icon}</span>
        <span class="meal-label-txt">${label}</span>
        <span class="meal-header-preview" id="meal-preview-${slot}">${previewTxt}</span>
        <span class="meal-block-chevron" id="meal-chevron-${slot}">▶</span>
      </div>
      <div class="meal-block-body hidden" id="meal-block-body-${slot}">
        <div class="meal-recipes-col" id="meal-names-${slot}" data-values="${namesJson}">
          ${renderSlotRecipeTags(slot, m.names)}
          <button class="add-recipe-btn" onclick="openRecipePicker('${slot}')">＋ レシピを追加</button>
        </div>

        <div class="servings-row-slot">
          <label class="servings-slot-label">🛒</label>
          <input type="number" id="servings-${slot}" min="1" inputmode="numeric"
            class="field servings-slot-input" value="${defaultServ}">
          <span class="servings-slot-unit">人分</span>
          <button class="servings-slot-add-btn" onclick="addSlotToShopList('${slot}')">買い物リストに追加</button>
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
      </div>
    </div>`;
  }).join('');

  // sheetAttend を同期
  slotDefs.forEach(({ slot }) => {
    const m = getMealSlot(key, slot);
    sheetAttend[slot] = { p1: m.p1, p2: m.p2 };
  });
}

function toggleMealBlock(slot) {
  const body    = document.getElementById(`meal-block-body-${slot}`);
  const chevron = document.getElementById(`meal-chevron-${slot}`);
  if (!body) return;
  const isOpen = !body.classList.contains('hidden');
  body.classList.toggle('hidden', isOpen);
  chevron.textContent = isOpen ? '▶' : '▼';
}

// ======== 全画面レシピプレビュー ========
let rpSlot = null;

function openRecipePreview(slot, initialIdx) {
  rpSlot = slot;
  const el = document.getElementById(`meal-names-${slot}`);
  const names = el ? JSON.parse(el.dataset.values || '[]') : [];
  const slotLabel = { morning: '朝飯', noon: '昼飯', night: '夕飯' }[slot] || '';

  document.getElementById('rp-title').textContent = slotLabel;

  // タブ生成
  const tabsEl = document.getElementById('rp-tabs');
  tabsEl.innerHTML = names.map((n, i) =>
    `<button class="rp-tab${i === initialIdx ? ' active' : ''}" onclick="switchRpTab(${i})">${esc(n)}</button>`
  ).join('');

  // パネル生成
  const contentEl = document.getElementById('rp-content');
  contentEl.innerHTML = names.map((n, i) => {
    const r = recipes.find(r => r.name === n);
    return `<div class="rp-panel${i === initialIdx ? '' : ' hidden'}" id="rp-panel-${i}">${r ? recipeViewHTML(r) : '<p class="rv-empty">レシピが見つかりません</p>'}</div>`;
  }).join('');

  // 献立シートを先に閉じてからプレビューを全面表示
  document.getElementById('sheet-overlay').classList.add('hidden');
  document.getElementById('meal-sheet').classList.add('hidden');
  document.getElementById('recipe-preview-screen').classList.remove('hidden');
}

function closeRecipePreview() {
  document.getElementById('recipe-preview-screen').classList.add('hidden');
  rpSlot = null;
}

function switchRpTab(idx) {
  document.querySelectorAll('.rp-tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  document.querySelectorAll('.rp-panel').forEach((p, i) => p.classList.toggle('hidden', i !== idx));
  document.getElementById('rp-content').scrollTop = 0;
}

function recipeViewHTML(r) {
  // メタ情報チップ
  const chips = [];
  if (r.servings)    chips.push(`<span class="rp-meta-chip">🍽 ${r.servings}人分</span>`);
  if (r.cookTime)    chips.push(`<span class="rp-meta-chip">⏱ ${parseInt(r.cookTime) < 60 ? parseInt(r.cookTime)+'分' : Math.floor(parseInt(r.cookTime)/60)+'時間'+(parseInt(r.cookTime)%60 ? parseInt(r.cookTime)%60+'分' : '')}</span>`);
  if (r.storageTime) chips.push(`<span class="rp-meta-chip">📦 ${esc(r.storageTime)}</span>`);

  const banner = `
    <div class="rp-banner">
      <div class="rp-recipe-name">${esc(r.name)}</div>
      ${chips.length ? `<div class="rp-meta-chips">${chips.join('')}</div>` : ''}
    </div>`;

  // 材料
  let ingsHTML = '';
  if ((r.ingredients || []).length) {
    // カテゴリでグループ化
    const groups = {};
    (r.ingredients || []).forEach(i => {
      const cat = i.cat || 'その他';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(i);
    });
    const rows = Object.entries(groups).map(([cat, items]) =>
      items.map(i => `
        <div class="rp-ing-row">
          <span class="ing-cat-dot" data-cat="${esc(cat)}"></span>
          <span class="rp-ing-name">${esc(i.name)}</span>
          <span class="rp-ing-qty">${esc(i.qty)}${esc(i.unit)}</span>
        </div>`).join('')
    ).join('');
    ingsHTML = `
      <div class="rp-section">
        <div class="rp-section-label">
          <span class="rp-section-icon">🥬</span>材料
          <span class="rp-section-sub">（${r.servings || 2}人分）</span>
        </div>
        <div class="rp-ing-grid">${rows}</div>
      </div>`;
  }

  // 手順
  let stepsHTML = '';
  if ((r.steps || []).length) {
    const stepItems = (r.steps || []).map((s, i) => `
      <div class="rp-step">
        <div class="rp-step-num">${i + 1}</div>
        <div class="rp-step-text">${esc(s.text)}</div>
      </div>`).join('');
    stepsHTML = `
      <div class="rp-section">
        <div class="rp-section-label"><span class="rp-section-icon">📋</span>手順</div>
        <div class="rp-steps">${stepItems}</div>
      </div>`;
  }

  if (!ingsHTML && !stepsHTML) {
    return banner + `<div class="rp-empty-body"><p class="rp-empty-msg">材料・手順が未登録です</p></div>`;
  }
  return banner + ingsHTML + stepsHTML;
}

// レシピタグとヘッダープレビューを一括更新
function refreshMealSlotUI(slot) {
  const el = document.getElementById(`meal-names-${slot}`);
  if (!el) return;
  const arr = JSON.parse(el.dataset.values || '[]');
  el.innerHTML = renderSlotRecipeTags(slot, arr) +
    `<button class="add-recipe-btn" onclick="openRecipePicker('${slot}')">＋ レシピを追加</button>`;
  const preview = document.getElementById(`meal-preview-${slot}`);
  if (preview) preview.textContent = arr.length ? arr.join('・') : '';
}

function openSheet(key, month, day) {
  editingKey = key;
  const names = getNames();
  buildMealEditorBlocks(key, names);
  document.getElementById('sheet-date').textContent = `${month}月${day}日の献立`;
  const rp = document.getElementById('add-result-panel');
  if (rp) { rp.innerHTML = ''; rp.classList.add('hidden'); }
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
// 分数ショートカット：入力欄が空なら直接セット、数値が入っていれば + して表示
function appendFrac(inputId, frac) {
  const el = document.getElementById(inputId);
  if (!el) return;
  const cur = el.value.trim();
  if (!cur) {
    el.value = frac;
  } else {
    const sum = toNum(cur) + toNum(frac);
    if (!isNaN(sum)) el.value = fmtQty(sum);
    else el.value = frac;
  }
  el.focus();
}

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

// 食材をまとめて買い物リストに追加し、結果を返す
// neededMap: { key -> { name, unit, cat, qty } }
// returns: { addedItems: [{name,qty,unit}], skipped: number }
function applyNeededToShopList(neededMap) {
  const addedItems = [];
  let skipped = 0;
  Object.values(neededMap).forEach(item => {
    // 調味料カテゴリは献立からの追加対象外
    if ((item.cat || '') === '調味料') return;
    const inStock = stocks
      .filter(s => s.name === item.name && (s.unit || '') === item.unit)
      .reduce((sum, s) => sum + (toNum(String(s.qty)) || 0), 0);
    const required = item.qty - inStock;
    if (required <= 0) { skipped++; return; }
    const qtyStr = fmtQty(required);
    const existing = shopItems.find(i => i.name === item.name && i.unit === item.unit && !i.checked);
    if (existing) {
      const prev = toNum(existing.qty) || 0;
      existing.qty = fmtQty(prev + required);
    } else {
      shopItems.push({ id: Date.now() + Math.random(), name: item.name, qty: qtyStr, unit: item.unit, cat: item.cat, checked: false });
    }
    addedItems.push({ name: item.name, qty: qtyStr, unit: item.unit });
  });
  return { addedItems, skipped };
}

function showAddResultPanel(rows) {
  // rows: [{ label, servings, addedItems, skipped }]
  const panel = document.getElementById('add-result-panel');
  if (!panel) return;
  if (!rows.length) { panel.classList.add('hidden'); return; }
  const hasAny = rows.some(r => r.addedItems.length > 0 || r.skipped > 0);
  if (!hasAny) { panel.classList.add('hidden'); return; }
  panel.innerHTML = rows.map(r => {
    const itemList = r.addedItems.map(i =>
      `<span class="result-item">${esc(i.name)}${i.qty && i.qty !== '0' ? ` ${esc(i.qty)}${esc(i.unit)}` : ''}</span>`
    ).join('');
    const stockNote = r.skipped ? `<span class="result-stock">在庫充足 ${r.skipped}件</span>` : '';
    return `<div class="result-row">
      <span class="result-label">${esc(r.label)} ${r.servings}人分</span>
      <div class="result-items">${itemList || '<span class="result-none">材料なし</span>'}${stockNote}</div>
    </div>`;
  }).join('');
  panel.classList.remove('hidden');
}

async function addMealDayToShopList() {
  const SLOTS = ['morning', 'noon', 'night'];
  const slotLabels = { morning: '朝食', noon: '昼食', night: '夕食' };
  const slotData = SLOTS.map(slot => ({
    slot,
    label:    slotLabels[slot],
    names:    getMealSlotNames(slot),
    servings: parseInt(document.getElementById(`servings-${slot}`)?.value) || getDefaultServings()
  })).filter(s => s.names.length > 0);

  if (!slotData.length) { showToast('献立が選択されていません', 'error'); return; }

  const needed = {};
  slotData.forEach(({ names, servings }) => {
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
  });

  if (!Object.keys(needed).length) { showToast('材料が登録されたレシピがありません', 'error'); return; }

  const { addedItems, skipped } = applyNeededToShopList(needed);
  renderShopItems();
  await pushData();

  // 全スロットまとめて1行で表示
  const allServings = [...new Set(slotData.map(s => s.servings))];
  const servLabel = allServings.length === 1 ? allServings[0] : slotData.map(s => s.servings).join('/');
  showAddResultPanel([{ label: '全スロット', servings: servLabel, addedItems, skipped }]);
}

async function addSlotToShopList(slot) {
  const names = getMealSlotNames(slot);
  if (!names.length) { showToast('レシピが選択されていません', 'error'); return; }

  const slotLabels = { morning: '朝食', noon: '昼食', night: '夕食' };
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

  const { addedItems, skipped } = applyNeededToShopList(needed);
  renderShopItems();
  await pushData();
  showAddResultPanel([{ label: slotLabels[slot] || slot, servings, addedItems, skipped }]);
}

async function saveMeal() {
  if (!editingKey) return;
  const slotsNames = {
    morning: getMealSlotNames('morning'),
    noon:    getMealSlotNames('noon'),
    night:   getMealSlotNames('night'),
  };
  const hasAny = ['morning','noon','night'].some(slot =>
    slotsNames[slot].length > 0 || !sheetAttend[slot].p1 || !sheetAttend[slot].p2
  );

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


// ======== 在庫 ========
const DEFAULT_STOCK_CATS = ['食材', '調味料', '冷凍ストック'];
let stockCatFilter    = 'all';
let recipeCatFilter   = 'all';

function filterRecipeCat(f, btn) {
  recipeCatFilter = f;
  document.querySelectorAll('#recipe-cat-filters .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  renderRecipes();
}

function renderRecipeCatFilters() {
  const container = document.getElementById('recipe-cat-filters');
  if (!container) return;
  const cats = getRecipeCategories();
  container.innerHTML =
    `<button class="chip ${recipeCatFilter === 'all' ? 'active' : ''}" onclick="filterRecipeCat('all',this)">すべて</button>`
    + cats.map(c =>
      `<button class="chip ${recipeCatFilter === c ? 'active' : ''}" onclick="filterRecipeCat('${esc(c)}',this)">${esc(c)}</button>`
    ).join('');
}
let stockStatusFilter = 'all';

function getStockCategories() {
  const s = localStorage.getItem('stockCats');
  return s ? JSON.parse(s) : [...DEFAULT_STOCK_CATS];
}

function saveStockCategories(cats) {
  localStorage.setItem('stockCats', JSON.stringify(cats));
}

function addStockCategory() {
  const name = document.getElementById('new-stock-cat-input').value.trim();
  if (!name) return;
  const cats = getStockCategories();
  if (cats.includes(name)) { showToast('既に存在します', 'error'); return; }
  cats.push(name);
  saveStockCategories(cats);
  document.getElementById('new-stock-cat-input').value = '';
  renderStockCatSettings();
  renderStockCatFilters();
  populateStockCatSelect();
  showToast(`「${name}」を追加しました`);
  pushData();
}

function removeStockCategory(name) {
  const cats = getStockCategories().filter(c => c !== name);
  if (!cats.length) { showToast('カテゴリは最低1つ必要です', 'error'); return; }
  saveStockCategories(cats);
  renderStockCatSettings();
  renderStockCatFilters();
  populateStockCatSelect();
  pushData();
}

function renderStockCatSettings() {
  const el = document.getElementById('stock-cat-settings-list');
  if (!el) return;
  const cats = getStockCategories();
  el.innerHTML = cats.map(c => `
    <div class="cat-settings-item">
      <span class="cat-settings-name">${esc(c)}</span>
      <button class="del-btn" onclick="removeStockCategory('${esc(c)}')">✕</button>
    </div>
  `).join('');
}

function populateStockCatSelect() {
  const sel = document.getElementById('stock-cat-select');
  if (!sel) return;
  const prev = sel.value;
  const cats = getStockCategories();
  sel.innerHTML = cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;
}

function renderStockCatFilters() {
  const container = document.getElementById('cat-filters');
  if (!container) return;
  const cats = getStockCategories();
  container.innerHTML = `<button class="chip ${stockCatFilter === 'all' ? 'active' : ''}" onclick="filterStockCat('all',this)">すべて</button>`
    + cats.map(c => `<button class="chip ${stockCatFilter === c ? 'active' : ''}" onclick="filterStockCat('${esc(c)}',this)">${esc(c)}</button>`).join('');
}

function openStockSheet(editId = null) {
  populateStockCatSelect();
  const cats = getStockCategories();
  const s = editId ? stocks.find(s => s.id === editId) : null;
  document.getElementById('stock-edit-id').value   = editId || '';
  document.getElementById('stock-sheet-title').textContent = s ? '在庫を編集' : '在庫を追加';
  document.getElementById('stock-sheet-btn').textContent  = s ? '保存する' : '追加する';
  document.getElementById('stock-cat-select').value = s ? (s.cat || cats[0] || '食材') : (cats[0] || '食材');
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
  if (!confirm(`「${s.name}」を買い物リストに追加しますか？`)) return;
  const cats = getCategories();
  shopItems.push({
    id:      Date.now() + Math.random(),
    name:    s.name,
    qty:     '1',
    unit:    s.unit || '',
    cat:     cats.includes(s.cat) ? s.cat : (cats[0] || 'その他'),
    checked: false,
    stockId: s.id
  });
  renderShopItems();
  await pushData();
  showToast(`「${s.name}」を買い物リストに追加しました`);
}

async function deleteStock(id) {
  const s = stocks.find(s => s.id === id);
  if (!s) return;
  if (!confirm(`「${s.name}」を削除しますか？`)) return;
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
  if (s.qty < 1) return 'low';
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
    const stockCats = getStockCategories();
    const groups = {};
    stockCats.forEach(c => { groups[c] = []; });
    filtered.forEach(s => {
      const c = s.cat || stockCats[0] || '食材';
      if (groups[c]) groups[c].push(s); else { groups[c] = [s]; }
    });
    list.innerHTML = stockCats.map(cat => {
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
      <button class="icon-action-btn" onclick="addStockToShopList(${s.id})" title="買い物リストへ"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></button>
      <button class="del-btn" onclick="deleteStock(${s.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg></button>
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
  closeShopActionSheet();
  const before = shopItems.length;
  shopItems = shopItems.filter(i => !i.checked);
  renderShopItems();
  if (before !== shopItems.length) await pushData();
  showToast(before !== shopItems.length ? `${before - shopItems.length}件を削除しました` : '削除するアイテムがありません');
}

async function addCheckedToStock() {
  closeShopActionSheet();
  const bought = shopItems.filter(i => i.checked);
  if (!bought.length) { showToast('チェック済みのアイテムがありません', 'error'); return; }
  bought.forEach(i => {
    const existing = stocks.find(s => s.name === i.name && (s.unit || '') === (i.unit || ''));
    if (existing) {
      existing.qty = (toNum(String(existing.qty)) || 0) + (toNum(i.qty) || 1);
    } else {
      stocks.push({ id: Date.now() + Math.random(), name: i.name, qty: toNum(i.qty) || 1, unit: i.unit || '', expiry: '', cat: i.cat || '' });
    }
  });
  shopItems = shopItems.filter(i => !i.checked);
  renderStocks();
  renderShopItems();
  await pushData();
  showToast(`${bought.length}件を在庫に追加しました`);
}

async function moveToStock() {
  closeShopActionSheet();
  const bought = shopItems.filter(i => i.checked);
  if (bought.length) {
    bought.forEach(i => {
      stocks.push({ id: Date.now() + Math.random(), name: i.name, qty: parseFloat(i.qty) || 1, unit: i.unit, expiry: '' });
    });
    shopItems = shopItems.filter(i => !i.checked);
    renderStocks();
    renderShopItems();
    await pushData();
    showToast(`${bought.length}件を在庫に移動しました`);
  }
  // チェック済みがなくても在庫タブへ移動
  const stockNavBtn = document.querySelector('.nav-btn[data-tab="stock"]');
  if (stockNavBtn) switchTab('stock', stockNavBtn);
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

function saveRecipeCategories(cats) {
  localStorage.setItem('recipeCats', JSON.stringify(cats));
}

function addRecipeCategory() {
  const name = document.getElementById('new-recipe-cat-input').value.trim();
  if (!name) return;
  const cats = getRecipeCategories();
  if (cats.includes(name)) { showToast('既に存在します', 'error'); return; }
  cats.push(name);
  saveRecipeCategories(cats);
  document.getElementById('new-recipe-cat-input').value = '';
  renderRecipeCatSettings();
  populateRecipeCatBtns();
  renderPickerCatTabs('all');
  showToast(`「${name}」を追加しました`);
  pushData();
}

function removeRecipeCategory(name) {
  const cats = getRecipeCategories().filter(c => c !== name);
  if (!cats.length) { showToast('カテゴリは最低1つ必要です', 'error'); return; }
  saveRecipeCategories(cats);
  renderRecipeCatSettings();
  populateRecipeCatBtns();
  renderPickerCatTabs('all');
  pushData();
}

function renderRecipeCatSettings() {
  const el = document.getElementById('recipe-cat-settings-list');
  if (!el) return;
  const cats = getRecipeCategories();
  el.innerHTML = cats.map(c => `
    <div class="cat-settings-item">
      <span class="cat-settings-name">${esc(c)}</span>
      <button class="del-btn" onclick="removeRecipeCategory('${esc(c)}')">✕</button>
    </div>
  `).join('');
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
      refreshMealSlotUI(pickerSlot);
    }
  }
  closeRecipePicker();
}

// ======== レシピ ========
let tempIngredients = [];
let tempSteps       = [];

function openRecipeSheet(editId = null) {
  const r = editId != null ? recipes.find(r => r.id === editId) : null;
  document.getElementById('recipe-edit-id').value = r ? r.id : '';
  document.getElementById('recipe-sheet-title').textContent = r ? 'レシピを編集' : 'レシピを追加';

  tempIngredients = r ? (r.ingredients || []).map(i => ({ ...i })) : [];
  tempSteps       = r ? (r.steps || []).map(s => ({ ...s }))       : [];

  document.getElementById('r-name').value      = r ? r.name        : '';
  document.getElementById('r-servings').value  = r ? r.servings    : '2';
  document.getElementById('r-cook-time').value = r ? (r.cookTime || '') : '';
  document.getElementById('r-storage').value   = r ? (r.storageTime || '') : '';
  ['step-text','ing-name','ing-qty'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('ing-unit').value = 'g';

  renderTempIngredients();
  renderTempSteps();
  populateIngCatSelect();
  populateRecipeCatBtns(r ? r.category : undefined);
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
  const editIdRaw = document.getElementById('recipe-edit-id').value;
  const editId    = editIdRaw ? Number(editIdRaw) : null;

  if (editId) {
    const idx = recipes.findIndex(r => r.id === editId);
    if (idx >= 0) {
      recipes[idx] = {
        ...recipes[idx],
        name,
        category:    document.getElementById('r-category').value,
        servings:    parseInt(document.getElementById('r-servings').value) || 2,
        cookTime:    document.getElementById('r-cook-time').value.trim(),
        storageTime: document.getElementById('r-storage').value.trim(),
        ingredients: [...tempIngredients],
        steps:       [...tempSteps],
      };
    }
    closeRecipeSheet();
    renderRecipes();
    await pushData();
    showToast(`「${name}」を更新しました`);
  } else {
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
}

async function deleteRecipe(id) {
  const r = recipes.find(r => r.id === id);
  if (!r) return;
  if (!confirm(`「${r.name}」を削除しますか？`)) return;
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
  if (!confirm(`「${r.name}」の材料を買い物リストに追加しますか？`)) return;

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

function recipeCardHTML(r) {
    const ICON_CLOCK = `<svg style="width:12px;height:12px;vertical-align:middle;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 15"/></svg>`;
    const ICON_BOX   = `<svg style="width:12px;height:12px;vertical-align:middle;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
    const ICON_TRASH = `<svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
    const ICON_EDIT  = `<svg style="width:15px;height:15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const ICON_SHOP  = `<svg style="width:15px;height:15px;flex-shrink:0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`;
    const ICON_UP    = `<svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>`;
    const ICON_DOWN  = `<svg style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

    const cookLabel = (() => {
      const m = parseInt(r.cookTime);
      if (!m) return '';
      const txt = m < 60 ? `${m}分` : `${Math.floor(m/60)}時間${m%60 ? m%60+'分' : ''}`;
      return `${ICON_CLOCK} ${txt}`;
    })();
    const infos = [
      r.servings    ? `${r.servings}人分`           : '',
      cookLabel,
      r.storageTime ? `${ICON_BOX} ${r.storageTime}` : '',
    ].filter(Boolean);

    return `
    <div class="recipe-card">
      <div class="recipe-header" onclick="toggleRecipe(${r.id})">
        <div class="recipe-header-left">
          <span class="recipe-name">${esc(r.name)}</span>
          ${infos.length ? `<div class="recipe-infos">${infos.map(t => `<span class="recipe-info-chip">${t}</span>`).join('')}</div>` : ''}
        </div>
        <div class="recipe-header-right">
          <button class="del-btn" onclick="event.stopPropagation();openRecipeSheet(${r.id})">${ICON_EDIT}</button>
          <button class="del-btn" onclick="event.stopPropagation();deleteRecipe(${r.id})">${ICON_TRASH}</button>
          <span class="recipe-arrow">${r.open ? ICON_UP : ICON_DOWN}</span>
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
          <button class="accent-btn full icon-btn-txt" onclick="addIngredientsToShopList(${r.id})">${ICON_SHOP} 材料を買い物リストへ</button>
        </div>
      ` : ''}
    </div>`;
}

function renderRecipes() {
  const list = document.getElementById('recipe-list');
  if (!recipes.length) {
    list.innerHTML = '<div class="empty-card">レシピがありません</div>';
    return;
  }

  const cats = getRecipeCategories();
  const filtered = recipeCatFilter === 'all'
    ? recipes
    : recipes.filter(r => (r.category || 'その他') === recipeCatFilter);

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-card">該当するレシピがありません</div>';
    return;
  }

  if (recipeCatFilter === 'all') {
    // カテゴリごとにグループ化
    const groups = {};
    cats.forEach(c => { groups[c] = []; });
    filtered.forEach(r => {
      const c = r.category || 'その他';
      if (groups[c]) groups[c].push(r);
      else { groups[c] = [r]; }
    });
    list.innerHTML = cats.map(cat => {
      if (!groups[cat] || !groups[cat].length) return '';
      return `<div class="recipe-group">
        <div class="recipe-group-label">${esc(cat)}</div>
        ${groups[cat].map(r => recipeCardHTML(r)).join('')}
      </div>`;
    }).join('');
  } else {
    list.innerHTML = filtered.map(r => recipeCardHTML(r)).join('');
  }
}

// ======== 設定タブ ========
function toggleDataSettings() {
  const section = document.getElementById('data-settings-section');
  const label   = document.getElementById('data-settings-toggle-label');
  if (!section) return;
  const isOpen = !section.classList.contains('hidden');
  section.classList.toggle('hidden', isOpen);
  label.textContent = isOpen ? '▶ データ・接続設定' : '▼ データ・接続設定';
}

function updateSettingsView() {
  renderCatSettings();
  renderRecipeCatSettings();
  renderStockCatSettings();
  const fbUrl = getFirebaseUrl();
  const key   = getDataKey();
  const names = getNames();
  const display = (fbUrl && key)
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
  const restoredUrl = parseFirebaseUrlFromHash(hash);
  const restoredKey = parseKeyFromHash(hash);
  if (restoredUrl && restoredKey) saveConnectionInfo(restoredUrl, restoredKey);
  document.getElementById('new-blob-id').value = '';
  fetchData();
  showToast('接続しました');
  updateSettingsView();
}

function resetBlob() {
  if (!confirm('新しいデータを作成しますか？\n現在のデータとの接続は切れます。')) return;
  location.hash = '';
  clearConnectionInfo();
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
renderStockCatFilters();
renderRecipeCatFilters();
initCalendar();

if (IS_LOCAL) {
  loadLocal();
} else {
  // getFirebaseUrl() は ハッシュ → localStorage の順で探すので
  // ハッシュが消えていても localStorage から復元される
  if (getFirebaseUrl()) {
    // ハッシュにある場合は localStorage も最新に更新しておく
    const h = getRawHash();
    if (h) {
      const u = parseFirebaseUrlFromHash(h);
      const k = parseKeyFromHash(h);
      if (u && k) saveConnectionInfo(u, k);
    }
    fetchData();
  } else {
    document.getElementById('setup-overlay').classList.remove('hidden');
  }
}

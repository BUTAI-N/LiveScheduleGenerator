/* ============================================================
   BUTAI LIVE Schedule - アプリ本体（状態 / UI / 保存 / 書き出し）
   ============================================================ */
(function () {
  'use strict';

  const P = window.Presets;
  const R = window.Renderer;
  const { SIZES, SAFE_ZONE, FONT_GROUPS, FONTS, COLOR_GROUPS, COLORS, LAYOUTS, WEEKDAY_JA } = P;
  // 古い presets.js がキャッシュされていても落ちないよう、既定値を持っておく
  const MEMO_PRESETS = P.MEMO_PRESETS || ['雑談', 'ゲーム', '作業', '歌枠', 'ASMR'];
  const { isDark, mix, clamp } = R.util;

  const STORAGE_KEY = 'butai_live_schedule_v1';
  const VERSION = 3;
  const MAX_SLOTS = 3;                                    // 1日あたりの配信枠の上限
  const HOURS = Array.from({ length: 30 }, (_, i) => i);  // 0〜29時（24以降は深夜＝翌日の時刻）
  const MINUTES = ['00', '10', '20', '30', '40', '50'];   // 10分刻み

  const DEFAULTS = {
    version: VERSION,
    mode: 'fromToday',   // 'fromToday' | 'week'
    weekStart: 1,        // 0=日 1=月 ... 6=土
    weekOffset: 0,       // 0=今週（保存しない）
    days: 7,             // fromToday の日数（1〜7）
    layout: 'cute',
    color: 'tiktok-pastel',
    font: 'mplus-rounded',
    size: '1080x1920',
    weekdayLang: 'ja',   // 'ja' | 'en'
    koro: 'both',        // 「頃」の付け方: 'both' | 'start' | 'none'
    hourStyle: 'hm',     // 時間の表記: 'hm'（20:00）| 'hour'（分が00なら 20時）
    title: '配信スケジュール',
    subtitle: '',
    note: '',
    offLabel: 'おやすみ',
    showSafeZone: true,
    customColors: { bg: '#1a1a2e', accent: '#ff4fa3', text: '#ffffff' },
    entries: {},         // { 'YYYY-MM-DD': { off, slots: [{ start, end, memo }] } }
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- 日付ユーティリティ ---------- */
  function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const yyyymmdd = (d) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  const fmtDateJa = (d) => `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_JA[d.getDay()]})`;

  /* ---------- 入力データ（1日 = off + 最大3枠） ---------- */
  const emptySlot = () => ({ start: '', end: '', memo: '' });
  const emptyEntry = () => ({ off: false, slots: [emptySlot()] });

  // "HH:MM" に正規化（10分刻みに丸め、0〜29時）。不正なら ''
  function normalizeTime(t) {
    const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(t || '').trim());
    if (!m) return '';
    let h = parseInt(m[1], 10), mi = parseInt(m[2], 10);
    if (Number.isNaN(h) || Number.isNaN(mi)) return '';
    mi = Math.round(mi / 10) * 10;
    if (mi >= 60) { mi = 0; h += 1; }
    if (h < 0 || h > 29) return '';
    return `${pad2(h)}:${pad2(mi)}`;
  }
  function normalizeEntry(e) {
    if (!e || typeof e !== 'object') return emptyEntry();
    let slots;
    if (Array.isArray(e.slots)) {
      slots = e.slots.map((sl) => ({
        start: normalizeTime(sl && sl.start),
        end: normalizeTime(sl && sl.end),
        memo: String((sl && sl.memo) || ''),
      }));
    } else {
      // 旧形式（1日1枠：{start,end,memo,off}）からの移行
      slots = [{ start: normalizeTime(e.start), end: normalizeTime(e.end), memo: String(e.memo || '') }];
    }
    slots = slots.slice(0, MAX_SLOTS);
    if (!slots.length) slots = [emptySlot()];
    return { off: !!e.off, slots };
  }
  const isEmptyEntry = (e) => !e.off && e.slots.every((sl) => !sl.start && !sl.end && !sl.memo.trim());

  /* ---------- 状態 ---------- */
  function sanitize(s) {
    if (!FONTS.some((f) => f.id === s.font)) s.font = DEFAULTS.font;
    if (s.color !== 'custom' && !COLORS.some((c) => c.id === s.color)) s.color = DEFAULTS.color;
    if (!SIZES.some((z) => z.id === s.size)) s.size = DEFAULTS.size;
    if (!LAYOUTS.some((l) => l.id === s.layout)) s.layout = DEFAULTS.layout;
    if (!['week', 'fromToday'].includes(s.mode)) s.mode = DEFAULTS.mode;
    // 旧設定の 'auto' もここで日本語に寄せる
    if (!['ja', 'en'].includes(s.weekdayLang)) s.weekdayLang = 'ja';
    if (!['both', 'start', 'none'].includes(s.koro)) s.koro = 'both';
    if (!['hm', 'hour'].includes(s.hourStyle)) s.hourStyle = 'hm';
    s.days = clamp(parseInt(s.days, 10) || 7, 1, 7);
    s.weekStart = [0, 1, 2, 3, 4, 5, 6].includes(Number(s.weekStart)) ? Number(s.weekStart) : 1;
    s.weekOffset = 0;
    const entries = {};
    Object.keys(s.entries && typeof s.entries === 'object' ? s.entries : {}).forEach((k) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) entries[k] = normalizeEntry(s.entries[k]);
    });
    s.entries = entries;
    s.customColors = Object.assign({}, DEFAULTS.customColors, s.customColors || {});
    ['title', 'subtitle', 'note', 'offLabel'].forEach((k) => { if (typeof s[k] !== 'string') s[k] = DEFAULTS[k]; });
    s.showSafeZone = !!s.showSafeZone;
    s.version = VERSION;
    return s;
  }
  function load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    // v1 → v2：期間モードのデフォルトを「今日から◯日間」に変更
    if (!saved.version) saved.mode = 'fromToday';
    return sanitize(Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), saved));
  }
  let state = load();

  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        pruneEntries();
        const data = Object.assign({}, state);
        delete data.weekOffset;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) { console.warn('保存に失敗しました', e); }
    }, 150);
  }
  // 古い入力（90日以上前）や空の入力は捨てる
  function pruneEntries() {
    const limit = isoKey(addDays(startOfToday(), -90));
    Object.keys(state.entries).forEach((k) => {
      if (k < limit || isEmptyEntry(state.entries[k])) delete state.entries[k];
    });
  }

  const getEntry = (key) => normalizeEntry(state.entries[key]);      // 常にコピーを返す
  function setEntry(key, e) { state.entries[key] = normalizeEntry(e); }
  function updateSlot(key, idx, patch) {
    const e = getEntry(key);
    if (!e.slots[idx]) return;
    Object.assign(e.slots[idx], patch);
    setEntry(key, e);
  }

  function buildDays() {
    const today = startOfToday();
    let start, n;
    if (state.mode === 'week') {
      const diff = (today.getDay() - state.weekStart + 7) % 7;
      start = addDays(today, -diff + state.weekOffset * 7);
      n = 7;
    } else {
      start = today;
      n = clamp(state.days, 1, 7);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = addDays(start, i);
      const dow = d.getDay();
      out.push({ date: d, key: isoKey(d), m: d.getMonth() + 1, d: d.getDate(), dow, weekend: dow === 0 || dow === 6, entry: getEntry(isoKey(d)) });
    }
    return out;
  }
  const filenameFor = (days) => `LiveSchedule_${yyyymmdd(days[0].date)}.png`;

  /* ---------- パレット ---------- */
  function customPalette(c) {
    const dark = isDark(c.bg);
    return {
      id: 'custom', name: 'カスタム',
      bg: [c.bg, mix(c.bg, dark ? '#000000' : '#ffffff', 0.3)],
      card: dark ? mix(c.bg, '#ffffff', 0.09) : '#ffffff',
      text: c.text,
      sub: mix(c.text, c.bg, 0.4),
      accent: c.accent,
      accent2: mix(c.accent, dark ? '#ffffff' : '#000000', 0.3),
    };
  }
  function currentPalette() {
    if (state.color === 'custom') return customPalette(state.customColors);
    return COLORS.find((c) => c.id === state.color) || COLORS[0];
  }
  const currentFont = () => FONTS.find((f) => f.id === state.font) || FONTS[0];
  const currentSize = () => SIZES.find((z) => z.id === state.size) || SIZES[0];
  const currentLayout = () => LAYOUTS.find((l) => l.id === state.layout) || LAYOUTS[0];

  function buildModel() {
    return {
      size: currentSize(), pal: currentPalette(), font: currentFont(), layout: state.layout,
      days: buildDays(),
      title: state.title.trim(), subtitle: state.subtitle.trim(), note: state.note.trim(),
      offLabel: state.offLabel.trim() || 'おやすみ',
      weekdayLang: state.weekdayLang,
      koro: state.koro,
      hourStyle: state.hourStyle,
    };
  }

  /* ---------- 描画 ---------- */
  const canvas = $('#canvas');
  let renderToken = 0, renderQueued = false;
  // 連続した変更を1回の描画にまとめる。タブが隠れていて rAF が止まっていても timer 側で描く
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    const run = () => { if (!renderQueued) return; renderQueued = false; doRender(); };
    requestAnimationFrame(run);
    setTimeout(run, 120);
  }
  async function doRender() {
    const model = buildModel();
    const my = ++renderToken;
    updateStage(model);
    R.render(canvas, model); // まず即描画（フォント未読込ならフォールバックで）
    try {
      const spec = `${model.font.weight} 40px "${model.font.family}"`;
      await document.fonts.load(spec, R.collectText(model));
    } catch (e) { /* フォント読込失敗時はフォールバックのまま */ }
    if (my !== renderToken) return;
    R.render(canvas, model); // フォント読込後に再描画
  }
  function updateStage(model) {
    const stage = $('#stage');
    stage.style.setProperty('--ar', `${model.size.w} / ${model.size.h}`);
    stage.style.setProperty('--ar-num', String(model.size.w / model.size.h));
    const sz = $('#safeZone');
    const show = state.showSafeZone && model.size.story;
    sz.hidden = !show;
    if (show) {
      $('#szTop').style.height = `${(SAFE_ZONE.top / 1920) * 100}%`;
      $('#szBottom').style.height = `${(SAFE_ZONE.bottom / 1920) * 100}%`;
      $('#szRight').style.width = `${(SAFE_ZONE.right / 1080) * 100}%`;
    }
  }

  /* ---------- 時刻ピッカー（時 0〜29 / 分 10分刻み） ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function tpHTML(cls, value) {
    const [h, m] = value ? value.split(':') : ['', ''];
    const hv = h === '' ? '' : String(parseInt(h, 10));
    const hOpts = ['<option value="">--</option>']
      .concat(HOURS.map((x) => `<option value="${x}"${String(x) === hv ? ' selected' : ''}>${x}</option>`)).join('');
    const mOpts = ['<option value="">--</option>']
      .concat(MINUTES.map((x) => `<option value="${x}"${x === m ? ' selected' : ''}>${x}</option>`)).join('');
    return `<span class="tp ${cls}">` +
      `<select class="tp-h" aria-label="時">${hOpts}</select><b>:</b>` +
      `<select class="tp-m" aria-label="分"${hv === '' ? ' disabled' : ''}>${mOpts}</select></span>`;
  }
  // ピッカーの値を "HH:MM" で返す（時が未選択なら ''）。分の有効/無効も更新する
  function tpRead(tp) {
    const hSel = tp.querySelector('.tp-h'), mSel = tp.querySelector('.tp-m');
    if (hSel.value === '') { mSel.value = ''; mSel.disabled = true; return ''; }
    mSel.disabled = false;
    if (mSel.value === '') mSel.value = '00';
    return `${pad2(parseInt(hSel.value, 10))}:${mSel.value}`;
  }

  /* ---------- UI: 期間 ---------- */
  function weekOffsetLabel(o) {
    if (o === 0) return '今週';
    if (o === 1) return '来週';
    if (o === -1) return '先週';
    return o > 0 ? `${o}週後` : `${-o}週前`;
  }
  function renderPeriodUI() {
    $('#todayLabel').textContent = fmtDateJa(startOfToday());
    $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.mode));
    $('#weekOpts').hidden = state.mode !== 'week';
    $('#daysOpts').hidden = state.mode !== 'fromToday';
    $('#weekStart').value = String(state.weekStart);
    $$('#daysSeg button').forEach((b) => b.classList.toggle('active', Number(b.dataset.days) === state.days));
    $('#weekLabel').textContent = weekOffsetLabel(state.weekOffset);
    $('#thisWeek').hidden = state.weekOffset === 0;
    $('#copyPrev').hidden = state.mode !== 'week';
    const days = buildDays();
    $('#rangeLabel').textContent = `${fmtDateJa(days[0].date)} 〜 ${fmtDateJa(days[days.length - 1].date)}（${days.length}日間）`;
    $('#filenameHint').textContent = `ファイル名：${filenameFor(days)}`;
  }

  /* ---------- UI: スケジュール入力 ---------- */
  // 配信内容のドロップダウン。プリセット以外の文字が入っていれば「カスタム」を選択状態にする
  function memoSelectHTML(memo) {
    const isCustom = !!memo && !MEMO_PRESETS.includes(memo);
    const opts = ['<option value="">（内容なし）</option>']
      .concat(MEMO_PRESETS.map((p) => `<option value="${escapeHtml(p)}"${memo === p ? ' selected' : ''}>${escapeHtml(p)}</option>`))
      .concat([`<option value="__custom__"${isCustom ? ' selected' : ''}>カスタム（自由入力）</option>`]);
    return `<select class="in-memo-sel" aria-label="配信内容">${opts.join('')}</select>`;
  }
  function slotHTML(sl, idx, count) {
    const isCustom = !!sl.memo && !MEMO_PRESETS.includes(sl.memo);
    return `<div class="slot" data-idx="${idx}">
      <div class="slot-times">
        ${tpHTML('tp-start', sl.start)}<span class="tilde">～</span>${tpHTML('tp-end', sl.end)}
      </div>
      <div class="slot-memo">
        ${memoSelectHTML(sl.memo)}
        ${count > 1 ? '<button type="button" class="slot-del" aria-label="この枠を削除" title="この枠を削除">×</button>' : ''}
      </div>
      <input type="text" class="in-memo" maxlength="40" placeholder="内容を入力（例：コラボ配信）" value="${escapeHtml(isCustom ? sl.memo : '')}"${isCustom ? '' : ' hidden'}>
    </div>`;
  }
  function rowHTML(day) {
    const e = day.entry;
    return `<div class="day-head">
        <span class="day-wd wd-${day.dow}">${WEEKDAY_JA[day.dow]}</span>
        <span class="day-date">${day.m}/${day.d}</span>
        <label class="check off-check"><input type="checkbox" class="in-off"${e.off ? ' checked' : ''}><span>休み</span></label>
      </div>
      <div class="slots">
        ${e.slots.map((sl, i) => slotHTML(sl, i, e.slots.length)).join('')}
        ${e.slots.length < MAX_SLOTS ? '<button type="button" class="btn small ghost slot-add">＋配信枠を追加</button>' : ''}
      </div>`;
  }
  function renderDayList() {
    const list = $('#dayList');
    list.innerHTML = '';
    buildDays().forEach((day) => {
      const row = document.createElement('div');
      row.className = 'day-row' + (day.entry.off ? ' is-off' : '');
      row.dataset.key = day.key;
      row.innerHTML = rowHTML(day);
      list.appendChild(row);
    });
  }
  function rerenderRow(key) {
    const row = $(`#dayList .day-row[data-key="${key}"]`);
    const day = buildDays().find((d) => d.key === key);
    if (!row || !day) return;
    row.innerHTML = rowHTML(day);
    row.classList.toggle('is-off', day.entry.off);
  }

  /* ---------- UI: デザイン ---------- */
  function renderLayoutUI() {
    const grid = $('#layoutGrid');
    grid.innerHTML = '';
    LAYOUTS.forEach((l) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'layout-card' + (l.id === state.layout ? ' active' : '');
      b.dataset.id = l.id;
      b.innerHTML = `<span class="lc-emoji">${l.emoji}</span><span class="lc-label">${l.label}</span>`;
      grid.appendChild(b);
    });
    $('#layoutName').textContent = currentLayout().label;
  }
  function renderHourStyleUI() {
    $$('#hourStyleSeg button').forEach((b) => b.classList.toggle('active', b.dataset.v === state.hourStyle));
    const hourOnly = state.hourStyle === 'hour';
    const a = R.timeLabel({ start: '20:00', end: '22:00' }, state.koro, hourOnly);
    const b = R.timeLabel({ start: '20:30', end: '' }, state.koro, hourOnly);
    $('#hourStyleSample').textContent = `例：${a} ／ ${b}`;
  }
  function renderWeekdayUI() {
    $$('#wdSeg button').forEach((b) => b.classList.toggle('active', b.dataset.v === state.weekdayLang));
    $('#wdName').textContent = state.weekdayLang === 'en' ? '英語' : '日本語';
  }
  function applySwatchStyle(b, c) {
    b.style.setProperty('--c0', c.bg[0]);
    b.style.setProperty('--c1', c.bg[1]);
    b.style.setProperty('--ca', c.accent);
    b.style.setProperty('--cb', c.accent2);
  }
  function swatchEl(c) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch' + (state.color === c.id ? ' active' : '');
    b.dataset.id = c.id;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    applySwatchStyle(b, c);
    return b;
  }
  function renderColorUI() {
    const wrap = $('#colorGroups');
    wrap.innerHTML = '';
    COLOR_GROUPS.forEach((gr) => {
      const h = document.createElement('div'); h.className = 'group-label'; h.textContent = gr.label; wrap.appendChild(h);
      const row = document.createElement('div'); row.className = 'swatches';
      COLORS.filter((c) => c.group === gr.id).forEach((c) => row.appendChild(swatchEl(c)));
      wrap.appendChild(row);
    });
    const h = document.createElement('div'); h.className = 'group-label'; h.textContent = 'オリジナル（自分で色を選ぶ）'; wrap.appendChild(h);
    const row = document.createElement('div'); row.className = 'swatches';
    const cs = swatchEl(customPalette(state.customColors)); cs.classList.add('swatch-custom'); row.appendChild(cs);
    wrap.appendChild(row);
    $('#customColors').hidden = state.color !== 'custom';
    $('#ccBg').value = state.customColors.bg;
    $('#ccAccent').value = state.customColors.accent;
    $('#ccText').value = state.customColors.text;
    $('#colorName').textContent = currentPalette().name;
  }
  function renderFontUI() {
    const wrap = $('#fontGroups');
    wrap.innerHTML = '';
    FONT_GROUPS.forEach((gr) => {
      const h = document.createElement('div'); h.className = 'group-label'; h.textContent = gr.label; wrap.appendChild(h);
      const row = document.createElement('div'); row.className = 'chips';
      FONTS.filter((f) => f.group === gr.id).forEach((f) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (f.id === state.font ? ' active' : '');
        b.dataset.id = f.id;
        b.style.fontFamily = `"${f.family}", sans-serif`;
        b.style.fontWeight = String(f.weight);
        b.textContent = f.label;
        b.title = f.desc;
        row.appendChild(b);
      });
      wrap.appendChild(row);
    });
    const f = currentFont();
    $('#fontDesc').textContent = `${f.label} — ${f.desc}`;
  }
  function renderTextUI() {
    $('#title').value = state.title;
    $('#subtitle').value = state.subtitle;
    $('#note').value = state.note;
    $('#offLabel').value = state.offLabel;
    $$('#koroSeg button').forEach((b) => b.classList.toggle('active', b.dataset.v === state.koro));
    const hourOnly = state.hourStyle === 'hour';
    const a = R.timeLabel({ start: '21:00', end: '' }, state.koro, hourOnly);
    const b = R.timeLabel({ start: '21:00', end: '23:00' }, state.koro, hourOnly);
    $('#koroSample').textContent = `例：${a} ／ ${b}`;
  }
  function renderSizeUI() {
    $('#sizeSel').value = state.size;
    const z = currentSize();
    $('#sizeNote').textContent = z.story
      ? `${z.note}。TikTokのUIが重なる上下の領域を避けて配置します。`
      : `${z.note}。ストーリーズ以外の投稿向けサイズです。`;
    $('#showSafeZone').checked = state.showSafeZone;
  }

  function renderAll() {
    renderPeriodUI(); renderDayList(); renderLayoutUI(); renderHourStyleUI(); renderWeekdayUI();
    renderColorUI(); renderFontUI(); renderTextUI(); renderSizeUI();
  }
  // 期間が変わったとき（入力欄の作り直しが必要）
  function periodChanged() { renderPeriodUI(); renderDayList(); save(); requestRender(); }

  /* ---------- 静的な選択肢の生成 ---------- */
  function buildStaticOptions() {
    const ws = $('#weekStart');
    [1, 0, 6, 2, 3, 4, 5].forEach((s) => {
      const o = document.createElement('option');
      o.value = String(s);
      o.textContent = `${WEEKDAY_JA[s]}〜${WEEKDAY_JA[(s + 6) % 7]}（${WEEKDAY_JA[s]}曜はじまり）`;
      ws.appendChild(o);
    });
    const ds = $('#daysSeg');
    for (let i = 1; i <= 7; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.days = String(i); b.textContent = `${i}日`; ds.appendChild(b);
    }
    const ss = $('#sizeSel');
    SIZES.forEach((z) => { const o = document.createElement('option'); o.value = z.id; o.textContent = `${z.label}　${z.note}`; ss.appendChild(o); });
  }

  /* ---------- 書き出し ---------- */
  let lastExport = null;
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  function triggerDownload(ex) {
    const a = document.createElement('a');
    a.href = ex.url; a.download = ex.name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function exportImage() {
    const btns = [$('#exportBtn'), $('#exportBtn2')];
    btns.forEach((b) => { b.disabled = true; });
    try {
      await doRender();
      const name = filenameFor(buildDays());
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('toBlob failed');
      if (lastExport) URL.revokeObjectURL(lastExport.url);
      lastExport = { blob, name, url: URL.createObjectURL(blob) };
      showExportModal(lastExport);
      if (!isTouch()) { triggerDownload(lastExport); toast(`${name} を保存しました`); }
    } catch (e) {
      console.error(e);
      toast('書き出しに失敗しました');
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  }
  function showExportModal(ex) {
    $('#exportImg').src = ex.url;
    $('#exportName').textContent = ex.name;
    const dl = $('#downloadLink'); dl.href = ex.url; dl.download = ex.name;
    let canShare = false;
    let file = null;
    try {
      file = new File([ex.blob], ex.name, { type: 'image/png' });
      canShare = !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] }));
    } catch (e) { canShare = false; }
    const sb = $('#shareBtn');
    sb.hidden = !canShare;
    sb.onclick = async () => { try { await navigator.share({ files: [file], title: ex.name }); } catch (e) { /* キャンセル */ } };
    $('#exportModal').hidden = false;
  }

  /* ---------- トースト ---------- */
  let toastTimer = 0;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ---------- イベント ---------- */
  let todayKey = isoKey(startOfToday());
  function bindEvents() {
    // 期間
    $('#modeSeg').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.mode = b.dataset.mode; periodChanged(); });
    $('#weekStart').addEventListener('change', (ev) => { state.weekStart = Number(ev.target.value); periodChanged(); });
    $('#prevWeek').addEventListener('click', () => { state.weekOffset -= 1; periodChanged(); });
    $('#nextWeek').addEventListener('click', () => { state.weekOffset += 1; periodChanged(); });
    $('#thisWeek').addEventListener('click', () => { state.weekOffset = 0; periodChanged(); });
    $('#daysSeg').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.days = Number(b.dataset.days); periodChanged(); });

    // 入力（イベント委譲：入力中はリストを作り直さない）
    const list = $('#dayList');
    list.addEventListener('change', (ev) => {
      const row = ev.target.closest('.day-row'), slot = ev.target.closest('.slot');
      if (!row || !slot) return;
      const key = row.dataset.key, idx = Number(slot.dataset.idx);
      const tp = ev.target.closest('.tp');
      if (tp) {
        const val = tpRead(tp);
        updateSlot(key, idx, tp.classList.contains('tp-start') ? { start: val } : { end: val });
      } else if (ev.target.classList.contains('in-memo-sel')) {
        const input = slot.querySelector('.in-memo');
        if (ev.target.value === '__custom__') {
          // カスタム：自由入力欄を出して、そこに入力した文字をそのまま内容にする
          input.hidden = false;
          input.value = '';
          updateSlot(key, idx, { memo: '' });
          input.focus();
        } else {
          input.hidden = true;
          input.value = '';
          updateSlot(key, idx, { memo: ev.target.value });
        }
      } else return;
      save(); requestRender();
    });
    list.addEventListener('input', (ev) => {
      const t = ev.target, row = t.closest('.day-row'); if (!row) return;
      const key = row.dataset.key;
      if (t.classList.contains('in-memo')) {
        updateSlot(key, Number(t.closest('.slot').dataset.idx), { memo: t.value });
      } else if (t.classList.contains('in-off')) {
        const e = getEntry(key); e.off = t.checked; setEntry(key, e);
        row.classList.toggle('is-off', t.checked);
      } else return;
      save(); requestRender();
    });
    list.addEventListener('click', (ev) => {
      const row = ev.target.closest('.day-row'); if (!row) return;
      const key = row.dataset.key;
      if (ev.target.closest('.slot-add')) {
        const e = getEntry(key);
        if (e.slots.length >= MAX_SLOTS) return;
        e.slots.push(emptySlot()); setEntry(key, e);
        rerenderRow(key); save(); requestRender();
      } else if (ev.target.closest('.slot-del')) {
        const idx = Number(ev.target.closest('.slot').dataset.idx);
        const e = getEntry(key);
        if (e.slots.length <= 1) return;
        e.slots.splice(idx, 1); setEntry(key, e);
        rerenderRow(key); save(); requestRender();
      }
    });

    $('#copyPrev').addEventListener('click', () => {
      let n = 0;
      buildDays().forEach((d) => {
        const src = state.entries[isoKey(addDays(d.date, -7))];
        if (src) { setEntry(d.key, src); n++; }
      });
      renderDayList(); save(); requestRender();
      toast(n ? `前の週から${n}日分コピーしました` : '前の週に入力がありません');
    });
    $('#clearAll').addEventListener('click', () => {
      if (!window.confirm('この期間の入力をすべてクリアしますか？')) return;
      buildDays().forEach((d) => { delete state.entries[d.key]; });
      renderDayList(); save(); requestRender();
    });

    // デザイン
    $('#layoutGrid').addEventListener('click', (ev) => { const b = ev.target.closest('.layout-card'); if (!b) return; state.layout = b.dataset.id; renderLayoutUI(); save(); requestRender(); });
    $('#wdSeg').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.weekdayLang = b.dataset.v; renderWeekdayUI(); save(); requestRender(); });
    $('#hourStyleSeg').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.hourStyle = b.dataset.v; renderHourStyleUI(); renderTextUI(); save(); requestRender(); });
    $('#colorGroups').addEventListener('click', (ev) => { const b = ev.target.closest('.swatch'); if (!b) return; state.color = b.dataset.id; renderColorUI(); save(); requestRender(); });
    [['ccBg', 'bg'], ['ccAccent', 'accent'], ['ccText', 'text']].forEach(([id, key]) => {
      $('#' + id).addEventListener('input', (ev) => {
        state.customColors[key] = ev.target.value;
        state.color = 'custom';
        const sw = $('.swatch-custom'); if (sw) applySwatchStyle(sw, customPalette(state.customColors));
        save(); requestRender();
      });
    });
    $('#fontGroups').addEventListener('click', (ev) => { const b = ev.target.closest('.chip'); if (!b) return; state.font = b.dataset.id; renderFontUI(); save(); requestRender(); });

    // テキスト
    ['title', 'subtitle', 'note', 'offLabel'].forEach((key) => {
      $('#' + key).addEventListener('input', (ev) => { state[key] = ev.target.value; save(); requestRender(); });
    });
    $('#koroSeg').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (!b) return; state.koro = b.dataset.v; renderTextUI(); renderHourStyleUI(); save(); requestRender(); });

    // プレビュー / 書き出し
    $('#showSafeZone').addEventListener('change', (ev) => { state.showSafeZone = ev.target.checked; save(); requestRender(); });
    $('#sizeSel').addEventListener('change', (ev) => { state.size = ev.target.value; renderSizeUI(); save(); requestRender(); });
    $('#exportBtn').addEventListener('click', exportImage);
    $('#exportBtn2').addEventListener('click', exportImage);
    $('#toTop').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    $('#closeModal').addEventListener('click', () => { $('#exportModal').hidden = true; });
    $('#exportModal').addEventListener('click', (ev) => { if (ev.target === ev.currentTarget) $('#exportModal').hidden = true; });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('#exportModal').hidden = true; });

    // リセット
    $('#resetBtn').addEventListener('click', () => {
      if (!window.confirm('デザイン設定と入力内容をすべてリセットしますか？')) return;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
      state = sanitize(JSON.parse(JSON.stringify(DEFAULTS)));
      renderAll(); requestRender(); toast('リセットしました');
    });

    // 他タブでの変更や、保存直前にページを閉じたときの取りこぼし防止
    window.addEventListener('pagehide', () => { clearTimeout(saveTimer); try { pruneEntries(); const data = Object.assign({}, state); delete data.weekOffset; localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* noop */ } });
    // フォントが読み込まれたら描き直す
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', requestRender);
    // 日付が変わったとき（深夜をまたいで開いたままの場合）
    setInterval(() => { const k = isoKey(startOfToday()); if (k !== todayKey) { todayKey = k; periodChanged(); } }, 60 * 1000);
  }

  /* ---------- 初期化 ---------- */
  function injectFonts() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = P.googleFontsUrl();
    document.head.appendChild(link);
  }
  function init() {
    injectFonts();
    buildStaticOptions();
    renderAll();
    bindEvents();
    requestRender();
    save(); // 旧バージョンから移行した設定をこの時点で書き戻す
  }
  init();
})();

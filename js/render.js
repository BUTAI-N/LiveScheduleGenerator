/* ============================================================
   BUTAI LIVE Schedule - Canvas レンダラー
   プレビューと書き出しで同じ描画関数を使う（WYSIWYG）
   ============================================================ */
(function (global) {
  'use strict';

  const EMOJI_STACK = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

  function fontString(font, size, weight) {
    const w = weight || font.weight || 400;
    return `${w} ${Math.max(1, Math.round(size))}px "${font.family}", "Noto Sans JP", ${EMOJI_STACK}, sans-serif`;
  }

  /* ---------- 色ユーティリティ ---------- */
  function hexToRgb(hex) {
    let h = String(hex || '#000000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  }
  function rgba(hex, a) {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function luminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function isDark(hex) { return luminance(hex) < 0.4; }
  // アクセント色の上に載せる文字色（白 or 黒）
  function onColor(hex) { return luminance(hex) > 0.45 ? '#1a1a1a' : '#ffffff'; }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // 描画のたびに装飾がチラつかないよう、シード付き乱数を使う
  function mulberry32(seed) {
    return function () {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 図形 ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function skewRect(ctx, x, y, w, h, skew) {
    ctx.beginPath();
    ctx.moveTo(x + skew, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w - skew, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
  }
  function heart(ctx, x, y, w) {
    const h = w * 0.92;
    const top = y - h * 0.55;
    ctx.beginPath();
    ctx.moveTo(x, top + h);
    ctx.bezierCurveTo(x - w * 0.55, top + h * 0.62, x - w * 0.55, top + h * 0.02, x, top + h * 0.28);
    ctx.bezierCurveTo(x + w * 0.55, top + h * 0.02, x + w * 0.55, top + h * 0.62, x, top + h);
    ctx.closePath();
  }
  function star(ctx, cx, cy, r, inner) {
    inner = inner || 0.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * inner;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }
  function sparkle(ctx, cx, cy, r) {
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx, cy, cx + r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy + r);
    ctx.quadraticCurveTo(cx, cy, cx - r, cy);
    ctx.quadraticCurveTo(cx, cy, cx, cy - r);
    ctx.closePath();
  }

  /* ---------- テキストユーティリティ ---------- */
  // maxW に収まるまでフォントサイズを縮める。ctx.font を設定した状態で返す
  function fitSize(ctx, text, maxW, size, minSize, font, weight) {
    let s = size;
    ctx.font = fontString(font, s, weight);
    while (s > minSize && ctx.measureText(text).width > maxW) {
      s -= Math.max(1, s * 0.04);
      ctx.font = fontString(font, s, weight);
    }
    return Math.max(s, minSize);
  }
  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    const chars = Array.from(text);
    while (chars.length && ctx.measureText(chars.join('') + '…').width > maxW) chars.pop();
    return chars.join('') + '…';
  }
  function setLetterSpacing(ctx, px) {
    if ('letterSpacing' in ctx) { try { ctx.letterSpacing = `${px}px`; } catch (e) { /* noop */ } }
  }

  /* ---------- 時刻・枠のテキスト ---------- */
  // hourOnly: 分が00のときだけ「20時」と書く（20:30 はそのまま）
  function formatTime(t, hourOnly) {
    if (!t) return '';
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!m) return t;
    const h = String(parseInt(m[1], 10)); // 09:00 → 9:00
    return hourOnly && m[2] === '00' ? `${h}時` : `${h}:${m[2]}`;
  }
  // koro: 'both'（開始・終了に頃） | 'start'（開始のみ） | 'none'
  function timeLabel(slot, koro, hourOnly) {
    const s = formatTime(slot.start, hourOnly), en = formatTime(slot.end, hourOnly);
    if (!s) return '';
    const k1 = koro === 'none' ? '' : '頃';
    const k2 = koro === 'both' ? '頃' : '';
    return en ? `${s}${k1}～${en}${k2}` : `${s}${k1}～`; // 終了なし → 「21:00頃～」
  }
  // 入力のある枠だけを、開始時刻の早い順（時刻なしは最後）に並べて返す
  function activeSlots(e) {
    return (e.slots || [])
      .filter((sl) => sl.start || (sl.memo || '').trim())
      .sort((a, b) => (a.start || '99:99').localeCompare(b.start || '99:99'));
  }
  // 1枠分の表示文字列：「雑談 20:00頃～」。時間だけ／内容だけの場合はそのまま
  function slotText(sl, model) {
    const time = timeLabel(sl, model.koro, model.hourStyle === 'hour');
    const memo = (sl.memo || '').trim();
    if (memo && time) return `${memo} ${time}`;
    return memo || time;
  }

  /* ---------- 行レイアウトの自動調整 ----------
     予定が詰まっても文字が小さくなりすぎたり、空白が目立ったりしないように：
      1. 全行で共通の文字サイズ f を、上限から下げながら「全部収まる」最大値にする
      2. 1日に複数枠あるときは横に並べられるだけ並べ、入らない分だけ折り返す
      3. 曜日・日付ラベルは「縦積み」と「横並び」を両方試し、f を大きく取れる方を使う
      4. 余った高さは各行に均等に配り（1行の上限あり）、ブロック全体を上下中央に置く
      5. 内容は行の中で中央寄せ（短い予定でも左右の空白が偏らない）
  ------------------------------------------------- */
  const LINE_H = 1.28;  // 行送り（f 倍）
  const ITEM_GAP = 0.9; // 同じ行に並ぶ枠と枠の間隔（f 倍）
  const MAX_F = 54;     // 文字サイズの上限（u 倍）
  const MIN_F = 16;     // 文字サイズの下限（u 倍）
  const PAD_Y = 18;     // 行の上下の余白（u 倍）

  // 各日の表示テキスト（休み・未定は1項目、薄い色）
  function dayItems(g) {
    return g.days.map((d) => {
      if (d.entry.off) return { texts: [g.model.offLabel], muted: true };
      const sl = activeSlots(d.entry);
      if (!sl.length) return { texts: ['未定'], muted: true };
      return { texts: sl.map((s) => slotText(s, g.model)), muted: false };
    });
  }

  // ラベル（曜日＋日付）の寸法。mode: 'stack'（縦積み）| 'row'（横並び）
  // style: 'circle'（丸バッジ）| 'tag'（斜めタグ）| 'text'（文字のみ）
  function measureLabel(g, f, mode, style) {
    const { ctx, u, font, days } = g;
    const wdBoxH = clamp(f * 1.05, 30 * u, 62 * u);
    const dateSize = clamp(f * 0.8, 20 * u, 44 * u);
    const wdSize = g.lang === 'en' ? wdBoxH * 0.46 : wdBoxH * 0.62;
    ctx.font = fontString(font, wdSize);
    const wdW = Math.max(...days.map((d) => ctx.measureText(d.wd).width));
    const wdBoxW = style === 'text' ? wdW : Math.max(wdBoxH, wdW + 22 * u);
    ctx.font = fontString(font, dateSize);
    const dateW = Math.max(...days.map((d) => ctx.measureText(d.dateText).width));
    const gap = (mode === 'stack' ? 5 : 10) * u;
    const base = { mode, style, wdBoxH, wdBoxW, wdSize, dateSize, dateW, gap };
    return mode === 'stack'
      ? Object.assign(base, { w: Math.max(wdBoxW, dateW), h: wdBoxH + gap + dateSize })
      : Object.assign(base, { w: wdBoxW + gap + dateW, h: Math.max(wdBoxH, dateSize * 1.15) });
  }

  // 枠の幅の配列を、contentW に入るだけ横に並べて行に分ける（貪欲法）
  function packLines(widths, f, contentW) {
    const lines = [];
    let cur = [], curW = 0;
    widths.forEach((w, i) => {
      const add = cur.length ? ITEM_GAP * f + w : w;
      if (cur.length && curW + add > contentW) { lines.push(cur); cur = []; curW = 0; }
      cur.push(i);
      curW += cur.length > 1 ? ITEM_GAP * f + w : w;
    });
    if (cur.length) lines.push(cur);
    return lines;
  }

  // 行の並びを決める。rowLeft はラベル左端、rowRight は内容右端の x
  // opt: { gapU, maxRowU, labelStyle, labelGapU }
  function planRows(g, top, bottom, rowLeft, rowRight, opt) {
    const { ctx, u, font } = g;
    const items = dayItems(g);
    const n = items.length;
    const gap = opt.gapU * u;
    const availH = Math.max(0, bottom - top);
    const padY = PAD_Y * u;
    const minF = MIN_F * u;

    // 文字サイズ f とラベル形式 mode で各行を組む。収まらなければ null（force 時は無理やり組む）
    // packMode: 'one'（1日の枠を必ず1行に並べる）| 'pack'（入るだけ並べ、あとは折り返す）
    const build = (f, mode, packMode, force) => {
      const lab = measureLabel(g, f, mode, opt.labelStyle);
      const contentLeft = rowLeft + lab.w + opt.labelGapU * u;
      const contentW = rowRight - contentLeft;
      if (contentW < 120 * u && !force) return null;
      ctx.font = fontString(font, f);
      const lineH = f * LINE_H;
      const rows = [];
      let total = 0;
      for (const it of items) {
        let widths = it.texts.map((t) => ctx.measureText(t).width);
        if (widths.some((w) => w > contentW)) {
          if (!force) return null;                             // 1枠でも入らない → f を下げる
          widths = widths.map((w) => Math.min(w, contentW));   // 描画時に省略記号
        }
        let lines;
        if (packMode === 'one') {
          const oneW = widths.reduce((a, w) => a + w, 0) + ITEM_GAP * f * (widths.length - 1);
          if (oneW > contentW && !force) return null;               // 1行に入らない → この f では不可
          lines = [widths.map((_, i) => i)];
        } else {
          lines = packLines(widths, f, contentW);
        }
        const h = Math.max(padY * 2 + lines.length * lineH, lab.h + padY * 1.2);
        rows.push({ texts: it.texts, muted: it.muted, widths, lines, h });
        total += h;
      }
      if (!force && total + gap * (n - 1) > availH) return null;
      return { f, lab, packMode, contentLeft, contentW: Math.max(contentW, 1), rows, total, lineH };
    };
    // ラベル形式ごとに、収まる最大の f を探す
    const search = (mode, packMode) => {
      for (let f = MAX_F * u; f >= minF; f -= Math.max(0.5 * u, f * 0.03)) {
        const p = build(f, mode, packMode, false);
        if (p) return p;
      }
      return null;
    };
    // 候補：ラベル形式（縦積み/横並び）× 並べ方（全日1行/折り返し）
    const cand = (mode) => ({ one: search(mode, 'one'), pack: search(mode, 'pack') });
    const S = cand('stack'), Rw = cand('row');
    const best = (c) => c.pack || c.one; // 折り返し案は1行案を含むので、こちらが純粋な最大文字サイズ
    // 1) ラベル形式：折り返し案同士で比べ、横並びは文字が8%以上大きく取れるときだけ採用
    let C = S;
    if (best(Rw) && (!best(S) || best(Rw).f > best(S).f * 1.08)) C = Rw;
    // 2) 並べ方：「全日1行」で揃えられて文字の縮小が1割以内なら、行が揃い横幅も使えるそちらを優先
    let plan = C.pack;
    if (C.one && (!plan || C.one.f >= plan.f * 0.9)) plan = C.one;
    // 調整用の診断情報（Renderer.lastPlan で参照できる。文字サイズは u=1 換算）
    const info = (p) => (p ? { f: p.f / u, pack: p.packMode, contentW: p.contentW / u, labelW: p.lab.w / u, lines: p.rows.map((r) => r.lines.length) } : null);
    if (global.Renderer) global.Renderer.lastPlan = { availH: availH / u, stack: { one: info(S.one), pack: info(S.pack) }, row: { one: info(Rw.one), pack: info(Rw.pack) }, chosen: plan ? { label: plan.lab.mode, pack: plan.packMode, f: plan.f / u } : null };
    if (!plan) {
      // 最小サイズでも入らない（極端に小さいキャンバスなど）：行の高さを縮めて詰める
      plan = build(minF, 'row', 'pack', true);
      const room = availH - gap * (n - 1);
      if (plan.total > room && plan.total > 0) {
        const k = room / plan.total;
        plan.rows.forEach((r) => { r.h *= k; });
        plan.total = room;
      }
    }

    // 余った高さを均等に配る（1行の高さには上限）。残りはブロック全体を上下中央に
    const maxRow = opt.maxRowU * u;
    const per = Math.max(0, availH - (plan.total + gap * (n - 1))) / n;
    let used = 0;
    plan.rows.forEach((r) => { r.h = Math.min(r.h + per, Math.max(maxRow, r.h)); used += r.h; });
    let y = top + Math.max(0, availH - (used + gap * (n - 1))) / 2;
    plan.rows.forEach((r) => { r.y = y; y += r.h + gap; });
    return plan;
  }

  // 曜日＋日付ラベルを描く。x は左端、cy は行の中央
  function drawLabel(g, day, x, cy, lab) {
    const { ctx, u, pal, font } = g;
    const badge = day.weekend ? pal.accent2 : pal.accent;
    const dim = day.entry.off;
    let wdCx, wdCy, dateX, dateY, dateAlign;
    if (lab.mode === 'stack') {
      const top = cy - lab.h / 2;
      wdCx = x + lab.w / 2; wdCy = top + lab.wdBoxH / 2;
      dateX = wdCx; dateY = top + lab.wdBoxH + lab.gap + lab.dateSize / 2; dateAlign = 'center';
    } else {
      wdCx = x + lab.wdBoxW / 2; wdCy = cy;
      dateX = x + lab.wdBoxW + lab.gap; dateY = cy; dateAlign = 'left';
    }
    ctx.textBaseline = 'middle';
    // 曜日
    if (lab.style === 'circle') {
      ctx.fillStyle = dim ? rgba(badge, 0.45) : badge;
      if (lab.wdBoxW <= lab.wdBoxH + 1) { ctx.beginPath(); ctx.arc(wdCx, wdCy, lab.wdBoxH / 2, 0, Math.PI * 2); ctx.fill(); }
      else { roundRect(ctx, wdCx - lab.wdBoxW / 2, wdCy - lab.wdBoxH / 2, lab.wdBoxW, lab.wdBoxH, lab.wdBoxH / 2); ctx.fill(); }
      ctx.fillStyle = onColor(badge);
    } else if (lab.style === 'tag') {
      ctx.fillStyle = dim ? rgba(badge, 0.5) : badge;
      skewRect(ctx, wdCx - lab.wdBoxW / 2, wdCy - lab.wdBoxH / 2, lab.wdBoxW, lab.wdBoxH, 7 * u);
      ctx.fill();
      ctx.fillStyle = onColor(badge);
    } else {
      ctx.fillStyle = dim ? rgba(badge, 0.6) : badge;
    }
    ctx.font = fontString(font, lab.wdSize);
    ctx.textAlign = 'center';
    ctx.fillText(day.wd, wdCx, wdCy + lab.wdSize * 0.05);
    // 日付
    ctx.font = fontString(font, lab.dateSize);
    ctx.fillStyle = dim ? pal.sub : pal.text;
    ctx.textAlign = dateAlign;
    ctx.fillText(day.dateText, dateX, dateY + lab.dateSize * 0.05);
  }

  // 配信内容（複数枠は横並び、入らなければ折り返し）を行の中で中央寄せに描く
  function drawContent(g, row, plan, cy) {
    const { ctx, u, pal, font } = g;
    const f = plan.f, lineH = plan.lineH;
    ctx.font = fontString(font, f);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    let y = cy - (row.lines.length * lineH) / 2 + lineH / 2;
    row.lines.forEach((line) => {
      const lineW = line.reduce((a, i) => a + row.widths[i], 0) + ITEM_GAP * f * (line.length - 1);
      let x = plan.contentLeft + (plan.contentW - lineW) / 2;
      line.forEach((i, k) => {
        if (k > 0) {
          // 枠と枠の区切り（細い縦線）
          ctx.fillStyle = rgba(pal.accent, 0.55);
          ctx.fillRect(x - (ITEM_GAP * f) / 2 - 1.5 * u, y - f * 0.4, 3 * u, f * 0.8);
        }
        ctx.fillStyle = row.muted ? pal.sub : pal.text;
        const text = row.widths[i] >= plan.contentW - 0.5 ? ellipsize(ctx, row.texts[i], plan.contentW) : row.texts[i];
        ctx.fillText(text, x, y + f * 0.04);
        x += row.widths[i] + ITEM_GAP * f;
      });
      y += lineH;
    });
  }

  /* ============================================================
     レイアウト①：かわいい
     ============================================================ */
  function renderCute(g) {
    const { ctx, W, H, u, pal, font, model, days, hs } = g;
    const padX = g.padX, contentW = W - padX * 2;

    // 背景（パステルグラデーション）
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, pal.bg[0]);
    grad.addColorStop(1, pal.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ふんわり丸い光
    ctx.save();
    ctx.globalAlpha = g.dark ? 0.16 : 0.32;
    ctx.fillStyle = pal.accent2;
    ctx.beginPath(); ctx.arc(W * 0.92, H * 0.06, 300 * u, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = pal.accent;
    ctx.beginPath(); ctx.arc(W * 0.06, H * 0.94, 330 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // ハート・星・きらきら
    const rnd = mulberry32(20260920);
    ctx.save();
    for (let i = 0; i < 28; i++) {
      const x = rnd() * W, y = rnd() * H, sz = (16 + rnd() * 36) * u, k = rnd();
      ctx.globalAlpha = (g.dark ? 0.10 : 0.14) + rnd() * 0.16;
      ctx.fillStyle = k < 0.5 ? pal.accent : pal.accent2;
      if (k < 0.4) heart(ctx, x, y, sz);
      else if (k < 0.75) star(ctx, x, y, sz * 0.6, 0.5);
      else sparkle(ctx, x, y, sz * 0.7);
      ctx.fill();
    }
    ctx.restore();

    // ---- ヘッダー ----
    let y = g.safeTop;
    if (model.title) {
      const titleSize = fitSize(ctx, model.title, contentW - 170 * u, 84 * u * hs, 36 * u, font);
      const tw = ctx.measureText(model.title).width;
      const pillH = titleSize * 1.6, pillW = tw + 120 * u;
      const pillX = (W - pillW) / 2, pillY = y;
      ctx.save();
      ctx.shadowColor = rgba(pal.accent, g.dark ? 0.5 : 0.35);
      ctx.shadowBlur = 30 * u;
      ctx.shadowOffsetY = 10 * u;
      ctx.fillStyle = pal.card;
      roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.restore();
      // 点線の内枠
      ctx.save();
      ctx.strokeStyle = rgba(pal.accent, 0.65);
      ctx.lineWidth = 4 * u;
      ctx.setLineDash([12 * u, 10 * u]);
      roundRect(ctx, pillX + 10 * u, pillY + 10 * u, pillW - 20 * u, pillH - 20 * u, (pillH - 20 * u) / 2);
      ctx.stroke();
      ctx.restore();
      ctx.font = fontString(font, titleSize);
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.title, W / 2, pillY + pillH / 2 + titleSize * 0.04);
      // 両脇のハート
      ctx.fillStyle = pal.accent;
      heart(ctx, pillX - 42 * u, pillY + pillH / 2, 46 * u); ctx.fill();
      ctx.fillStyle = pal.accent2;
      heart(ctx, pillX + pillW + 42 * u, pillY + pillH / 2, 46 * u); ctx.fill();
      y = pillY + pillH + 24 * u;
    }
    if (model.subtitle) {
      const ss = fitSize(ctx, model.subtitle, contentW, 42 * u * hs, 24 * u, font);
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.subtitle, W / 2, y + ss * 0.6);
      y += ss * 1.3 + 8 * u;
    }
    {
      const rs = fitSize(ctx, g.rangeText, contentW, 36 * u * hs, 22 * u, font);
      ctx.fillStyle = pal.sub;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.rangeText, W / 2, y + rs * 0.6);
      y += rs * 1.4 + 22 * u;
    }
    const headerBottom = y;

    // ---- フッター（一言メモ） ----
    let footerTop = H - g.safeBottom;
    const footerH = 88 * u;
    if (model.note) footerTop -= footerH;

    // ---- 日付カード ----
    const plan = planRows(g, headerBottom, footerTop, padX + 22 * u, padX + contentW - 26 * u,
      { gapU: 18, maxRowU: 210, labelStyle: 'circle', labelGapU: 18 });
    plan.rows.forEach((row, i) => {
      const day = days[i], e = day.entry;
      const ry = row.y, rh = row.h, cy = ry + rh / 2;
      // カード
      ctx.save();
      ctx.shadowColor = g.dark ? 'rgba(0,0,0,0.45)' : rgba(pal.accent, 0.22);
      ctx.shadowBlur = 24 * u;
      ctx.shadowOffsetY = 8 * u;
      ctx.fillStyle = e.off ? rgba(pal.card, 0.55) : pal.card;
      roundRect(ctx, padX, ry, contentW, rh, Math.min(40 * u, rh / 2));
      ctx.fill();
      ctx.restore();

      drawLabel(g, day, padX + 22 * u, cy, plan.lab);
      drawContent(g, row, plan, cy);
    });

    // ---- フッター ----
    if (model.note) {
      const ns = fitSize(ctx, model.note, contentW - 90 * u, 32 * u, 18 * u, font);
      const nw = ctx.measureText(model.note).width;
      const ph = ns * 1.9, pw = nw + 70 * u, px = (W - pw) / 2, py = footerTop + (footerH - ph) / 2 + 12 * u;
      ctx.fillStyle = rgba(pal.card, 0.85);
      roundRect(ctx, px, py, pw, ph, ph / 2);
      ctx.fill();
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.note, W / 2, py + ph / 2 + ns * 0.04);
    }
  }

  /* ============================================================
     レイアウト②：かっこいい
     ============================================================ */
  function renderCool(g) {
    const { ctx, W, H, u, pal, font, model, days, hs } = g;
    const padX = g.padX, contentW = W - padX * 2;

    // 背景
    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, pal.bg[0]);
    grad.addColorStop(1, pal.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ネオンの光
    ctx.save();
    let rg = ctx.createRadialGradient(W * 0.88, H * 0.1, 0, W * 0.88, H * 0.1, 560 * u);
    rg.addColorStop(0, rgba(pal.accent, g.dark ? 0.42 : 0.28));
    rg.addColorStop(1, rgba(pal.accent, 0));
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    rg = ctx.createRadialGradient(W * 0.1, H * 0.92, 0, W * 0.1, H * 0.92, 600 * u);
    rg.addColorStop(0, rgba(pal.accent2, g.dark ? 0.34 : 0.22));
    rg.addColorStop(1, rgba(pal.accent2, 0));
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // 斜めライン
    ctx.save();
    ctx.globalAlpha = g.dark ? 0.07 : 0.09;
    ctx.strokeStyle = pal.text;
    ctx.lineWidth = 2 * u;
    for (let x = -H; x < W + H; x += 46 * u) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.6, H); ctx.stroke();
    }
    ctx.restore();

    // コーナーブラケット
    {
      const L = 90 * u, t = 8 * u, m = 40 * u;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = pal.accent;
      ctx.fillRect(m, m, L, t); ctx.fillRect(m, m, t, L);
      ctx.fillStyle = pal.accent2;
      ctx.fillRect(W - m - L, H - m - t, L, t); ctx.fillRect(W - m - t, H - m - L, t, L);
      ctx.restore();
    }

    // ---- ヘッダー（左寄せ） ----
    let y = g.safeTop;
    if (model.title) {
      const titleSize = fitSize(ctx, model.title, contentW - 40 * u, 92 * u * hs, 40 * u, font);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.save();
      ctx.shadowColor = rgba(pal.accent, 0.75);
      ctx.shadowBlur = 26 * u;
      ctx.fillStyle = pal.text;
      ctx.fillText(model.title, padX + 28 * u, y + titleSize * 0.58);
      ctx.restore();
      ctx.fillStyle = pal.accent;
      skewRect(ctx, padX, y + titleSize * 0.12, 14 * u, titleSize * 0.92, 5 * u);
      ctx.fill();
      y += titleSize * 1.18 + 12 * u;
    }
    {
      const subSize = 36 * u * hs;
      const rangeSize = 32 * u * hs;
      ctx.textBaseline = 'middle';
      ctx.font = fontString(font, rangeSize);
      const rangeW = ctx.measureText(g.rangeText).width;
      ctx.fillStyle = pal.sub;
      ctx.textAlign = 'right';
      ctx.fillText(g.rangeText, W - padX, y + subSize * 0.6);
      if (model.subtitle) {
        fitSize(ctx, model.subtitle, contentW - rangeW - 30 * u, subSize, 22 * u, font);
        ctx.fillStyle = pal.accent;
        ctx.textAlign = 'left';
        ctx.fillText(model.subtitle, padX, y + subSize * 0.6);
      }
      y += subSize * 1.3 + 12 * u;
      const lg = ctx.createLinearGradient(padX, 0, W - padX, 0);
      lg.addColorStop(0, pal.accent);
      lg.addColorStop(1, rgba(pal.accent2, 0.25));
      ctx.fillStyle = lg;
      ctx.fillRect(padX, y, contentW, 4 * u);
      y += 4 * u + 26 * u;
    }
    const headerBottom = y;

    let footerTop = H - g.safeBottom;
    const footerH = 80 * u;
    if (model.note) footerTop -= footerH;

    // ---- 日付カード（斜め） ----
    const skew = 22 * u;
    const plan = planRows(g, headerBottom, footerTop, padX + skew + 18 * u, padX + contentW - skew - 20 * u,
      { gapU: 16, maxRowU: 200, labelStyle: 'tag', labelGapU: 18 });
    plan.rows.forEach((row, i) => {
      const day = days[i], e = day.entry;
      const ry = row.y, rh = row.h, cy = ry + rh / 2;
      const rx = padX, rw = contentW;
      const badge = day.weekend ? pal.accent2 : pal.accent;

      ctx.save();
      ctx.fillStyle = e.off ? rgba(pal.card, 0.5) : pal.card;
      skewRect(ctx, rx, ry, rw, rh, skew);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.text, 0.08);
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      ctx.restore();

      // ネオンの帯
      ctx.save();
      ctx.shadowColor = badge;
      ctx.shadowBlur = e.off ? 0 : 20 * u;
      ctx.fillStyle = e.off ? rgba(badge, 0.5) : badge;
      skewRect(ctx, rx, ry, 14 * u, rh, skew);
      ctx.fill();
      ctx.restore();

      drawLabel(g, day, rx + skew + 18 * u, cy, plan.lab);
      drawContent(g, row, plan, cy);
    });

    if (model.note) {
      const ns = fitSize(ctx, model.note, contentW - 40 * u, 30 * u, 18 * u, font);
      const ny = footerTop + footerH / 2 + 10 * u;
      ctx.fillStyle = pal.accent;
      ctx.fillRect(padX, ny - 8 * u, 16 * u, 16 * u);
      ctx.fillStyle = pal.sub;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.note, padX + 30 * u, ny + ns * 0.04);
    }
  }

  /* ============================================================
     レイアウト③：シンプル
     ============================================================ */
  function renderSimple(g) {
    const { ctx, W, H, u, pal, font, model, days, hs } = g;
    const padX = g.padX, contentW = W - padX * 2;

    ctx.fillStyle = pal.bg[0];
    ctx.fillRect(0, 0, W, H);
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, rgba(pal.bg[1], 0));
    grad.addColorStop(1, rgba(pal.bg[1], 1));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ---- ヘッダー（中央） ----
    let y = g.safeTop;
    ctx.fillStyle = pal.accent;
    roundRect(ctx, W / 2 - 30 * u, y, 60 * u, 8 * u, 4 * u);
    ctx.fill();
    y += 8 * u + 28 * u;
    if (model.title) {
      const titleSize = fitSize(ctx, model.title, contentW, 78 * u * hs, 36 * u, font);
      ctx.fillStyle = pal.text;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.title, W / 2, y + titleSize * 0.55);
      y += titleSize * 1.15 + 10 * u;
    }
    if (model.subtitle) {
      const ss = fitSize(ctx, model.subtitle, contentW, 38 * u * hs, 22 * u, font);
      ctx.fillStyle = pal.sub;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.subtitle, W / 2, y + ss * 0.6);
      y += ss * 1.3 + 6 * u;
    }
    {
      const rs = fitSize(ctx, g.rangeText, contentW, 34 * u * hs, 22 * u, font);
      ctx.fillStyle = pal.accent;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.rangeText, W / 2, y + rs * 0.6);
      y += rs * 1.3 + 30 * u;
    }
    const headerBottom = y;

    let footerTop = H - g.safeBottom;
    const footerH = 80 * u;
    if (model.note) footerTop -= footerH;

    // ---- 行（罫線区切り） ----
    const plan = planRows(g, headerBottom, footerTop, padX + 2 * u, padX + contentW - 2 * u,
      { gapU: 0, maxRowU: 210, labelStyle: 'text', labelGapU: 18 });
    const line = rgba(pal.sub, 0.35);
    if (plan.rows.length) {
      ctx.fillStyle = line;
      ctx.fillRect(padX, plan.rows[0].y, contentW, 2 * u);
    }
    plan.rows.forEach((row, i) => {
      const day = days[i];
      const ry = row.y, rh = row.h, cy = ry + rh / 2;
      ctx.fillStyle = line;
      ctx.fillRect(padX, ry + rh - 2 * u, contentW, 2 * u);

      drawLabel(g, day, padX + 2 * u, cy, plan.lab);
      drawContent(g, row, plan, cy);
    });

    if (model.note) {
      const ns = fitSize(ctx, model.note, contentW, 30 * u, 18 * u, font);
      ctx.fillStyle = pal.sub;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(model.note, W / 2, footerTop + footerH / 2 + 10 * u + ns * 0.04);
    }
  }

  const RENDERERS = { cute: renderCute, cool: renderCool, simple: renderSimple };

  /* ============================================================
     エントリーポイント
     model = { size:{w,h,story}, pal, font, layout, koro, hourStyle,
               days:[{m,d,dow,weekend,entry:{off,slots:[{start,end,memo}]}}],
               title, subtitle, note, offLabel, weekdayLang }
     ============================================================ */
  function resolveLang(model) {
    return model.weekdayLang === 'en' ? 'en' : 'ja';
  }

  function buildRangeText(days, layout, WD, lang) {
    // 英語の曜日は空白区切り、日本語はカッコ書き（「9.27 日」だと読みにくいため）
    const f = (d) => {
      const date = layout === 'cool' ? `${d.m}.${d.d}` : `${d.m}/${d.d}`;
      return lang === 'en' ? `${date} ${WD[d.dow]}` : `${date}(${WD[d.dow]})`;
    };
    if (days.length === 1) return f(days[0]);
    return `${f(days[0])} ${layout === 'cool' ? '-' : '〜'} ${f(days[days.length - 1])}`;
  }

  function render(canvas, model) {
    const W = model.size.w, H = model.size.h;
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    setLetterSpacing(ctx, 0);

    const u = W / 1080;
    const story = !!model.size.story;
    const lang = resolveLang(model);
    const WD = lang === 'en' ? global.Presets.WEEKDAY_EN : global.Presets.WEEKDAY_JA;
    const days = model.days.map((d) => Object.assign({}, d, {
      wd: WD[d.dow],
      dateText: model.layout === 'cool' ? `${d.m}.${d.d}` : `${d.m}/${d.d}`,
    }));

    const g = {
      ctx, W, H, u, model, days, lang,
      pal: model.pal,
      font: model.font,
      // ストーリーズではTikTokのUI（上 約200px / 下 約300px）を避けて配置
      safeTop: (story ? 225 : 84) * u,
      safeBottom: (story ? 325 : 84) * u,
      padX: (story ? 84 : 64) * u,
      hs: story ? 1 : 0.82, // ヘッダー文字の縮小率（正方形などで）
      dark: isDark(model.pal.bg[0]),
      rangeText: buildRangeText(days, model.layout, WD, lang),
    };
    (RENDERERS[model.layout] || renderSimple)(g);
  }

  // フォント読み込み用：描画に使う文字を集める
  function collectText(model) {
    const parts = [model.title, model.subtitle, model.note, model.offLabel, '未定頃時', '0123456789:～〜/.()- …'];
    parts.push(global.Presets.WEEKDAY_JA.join(''), global.Presets.WEEKDAY_EN.join(''));
    model.days.forEach((d) => {
      (d.entry.slots || []).forEach((sl) => { parts.push(sl.memo || '', sl.start || '', sl.end || ''); });
    });
    return Array.from(new Set(Array.from(parts.join('')))).join('');
  }

  global.Renderer = {
    render, fontString, collectText, timeLabel,
    util: { hexToRgb, rgba, luminance, isDark, onColor, mix, clamp },
  };
})(window);

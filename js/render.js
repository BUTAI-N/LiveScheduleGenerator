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

  /* ---------- 共通部品 ---------- */
  // 行の高さ・開始位置を計算。weights が大きい行（枠が多い日）ほど高くする。
  // 少ない日数のときは大きめの行で上下中央に。
  function rowGeometry(g, top, bottom, weights, gapU, maxRowU) {
    const n = weights.length;
    const gap = gapU * g.u;
    const avail = Math.max(0, bottom - top);
    const sumW = weights.reduce((a, b) => a + b, 0) || 1;
    let unit = (avail - gap * (n - 1)) / sumW;
    unit = Math.min(unit, maxRowU * g.u);
    const total = unit * sumW + gap * (n - 1);
    let y = top + (avail - total) / 2;
    const rows = weights.map((w) => { const r = { y, h: unit * w }; y += unit * w + gap; return r; });
    return { rows, unit, scale: clamp(unit / (150 * g.u), 0.6, 1.25) };
  }

  function formatTime(t) {
    if (!t) return '';
    return /^0\d:/.test(t) ? t.slice(1) : t; // 09:00 → 9:00
  }
  // koro: 'both'（開始・終了に頃） | 'start'（開始のみ） | 'none'
  function timeLabel(slot, koro) {
    const s = formatTime(slot.start), en = formatTime(slot.end);
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
  function slotCount(e) { return e.off ? 1 : Math.max(1, activeSlots(e).length); }
  function rowWeights(days) { return days.map((d) => 1 + 0.55 * (slotCount(d.entry) - 1)); }

  // 曜日（上）＋日付（下）を縦に並べて描き、コンテンツ領域の左端になる x を返す
  // style: 'circle'（丸バッジ） | 'tag'（斜めタグ） | 'text'（文字のみ）
  function drawDayLabel(g, day, leftX, cy, rh, s, style) {
    const { ctx, u, pal, font } = g;
    const badge = day.weekend ? pal.accent2 : pal.accent;
    const dim = day.entry.off;

    const wdBoxH = Math.max(Math.min(rh * 0.42, 66 * u * s), 30 * u);
    const dateSize = Math.max(Math.min(rh * 0.30, 54 * u * s), 22 * u);
    const gap = 5 * u;
    const top = cy - (wdBoxH + gap + dateSize) / 2;

    ctx.font = fontString(font, dateSize);
    const dateW = ctx.measureText(day.dateText).width;
    const wdSize = g.lang === 'en' ? wdBoxH * 0.46 : wdBoxH * 0.62;
    ctx.font = fontString(font, wdSize);
    const wdBoxW = style === 'text'
      ? ctx.measureText(day.wd).width
      : Math.max(wdBoxH, ctx.measureText(day.wd).width + 22 * u);

    const colW = Math.max(wdBoxW, dateW);
    const cx = leftX + colW / 2;
    const wdCy = top + wdBoxH / 2;

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 曜日
    if (style === 'circle') {
      ctx.fillStyle = dim ? rgba(badge, 0.45) : badge;
      if (wdBoxW <= wdBoxH + 1) { ctx.beginPath(); ctx.arc(cx, wdCy, wdBoxH / 2, 0, Math.PI * 2); ctx.fill(); }
      else { roundRect(ctx, cx - wdBoxW / 2, top, wdBoxW, wdBoxH, wdBoxH / 2); ctx.fill(); }
      ctx.fillStyle = onColor(badge);
    } else if (style === 'tag') {
      ctx.fillStyle = dim ? rgba(badge, 0.5) : badge;
      skewRect(ctx, cx - wdBoxW / 2, top, wdBoxW, wdBoxH, 7 * u);
      ctx.fill();
      ctx.fillStyle = onColor(badge);
    } else {
      ctx.fillStyle = dim ? rgba(badge, 0.6) : badge;
    }
    ctx.font = fontString(font, wdSize);
    ctx.fillText(day.wd, cx, wdCy + wdSize * 0.05);

    // 日付
    ctx.font = fontString(font, dateSize);
    ctx.fillStyle = dim ? pal.sub : pal.text;
    ctx.fillText(day.dateText, cx, top + wdBoxH + gap + dateSize / 2 + dateSize * 0.05);

    return leftX + colW;
  }

  // 時間＋内容（または「休み」「未定」）を右揃えで描く
  function drawTimeBlock(g, e, left, right, cy, rh, s) {
    const { ctx, u, pal, font, model } = g;
    const areaW = Math.max(40 * u, right - left);
    const x = right;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    if (e.off) {
      const size = fitSize(ctx, model.offLabel, areaW, 58 * u * s, 22 * u, font);
      ctx.fillStyle = pal.sub;
      ctx.fillText(model.offLabel, x, cy + size * 0.04);
      return;
    }
    const slots = activeSlots(e);
    if (slots.length === 0) {
      const size = 44 * u * s;
      ctx.font = fontString(font, size);
      ctx.fillStyle = pal.sub;
      ctx.fillText('未定', x, cy + size * 0.04);
      return;
    }

    if (slots.length === 1) {
      // 1枠：「内容（時間）」を1行で大きく
      const text = slotText(slots[0], model.koro);
      const size = fitSize(ctx, text, areaW, 66 * u * s, 24 * u, font);
      ctx.fillStyle = pal.text;
      ctx.fillText(ellipsize(ctx, text, areaW), x, cy + size * 0.04);
      return;
    }

    // 複数枠（朝配信・夜配信など）：1枠1行で「内容（時間）」を右揃えに
    const n = slots.length;
    const pad = 8 * u;
    const lineH = (rh - pad * 2) / n;
    const base = clamp(lineH * 0.66, 20 * u, 56 * u * s);
    slots.forEach((sl, i) => {
      const ly = cy - rh / 2 + pad + lineH * (i + 0.5);
      const text = slotText(sl, model.koro);
      const size = fitSize(ctx, text, areaW, base, 18 * u, font);
      ctx.fillStyle = pal.text;
      ctx.fillText(ellipsize(ctx, text, areaW), x, ly + size * 0.04);
    });
  }

  // 1枠分の表示文字列：「雑談 20:00頃～」。時間だけ／内容だけの場合はそのまま
  function slotText(sl, koro) {
    const time = timeLabel(sl, koro);
    const memo = (sl.memo || '').trim();
    if (memo && time) return `${memo} ${time}`;
    return memo || time;
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
    const geo = rowGeometry(g, headerBottom, footerTop, rowWeights(days), 18, 210);
    const s = geo.scale;
    days.forEach((day, i) => {
      const { y: ry, h: rh } = geo.rows[i];
      const rx = padX, rw = contentW;
      const e = day.entry;
      // カード
      ctx.save();
      ctx.shadowColor = g.dark ? 'rgba(0,0,0,0.45)' : rgba(pal.accent, 0.22);
      ctx.shadowBlur = 24 * u;
      ctx.shadowOffsetY = 8 * u;
      ctx.fillStyle = e.off ? rgba(pal.card, 0.55) : pal.card;
      roundRect(ctx, rx, ry, rw, rh, Math.min(40 * u, rh / 2));
      ctx.fill();
      ctx.restore();

      // 曜日（上）＋日付（下）
      const cy = ry + rh / 2;
      const labelRight = drawDayLabel(g, day, rx + 22 * u, cy, rh, s, 'circle');

      // 時間・内容
      drawTimeBlock(g, e, labelRight + 16 * u, rx + rw - 26 * u, cy, rh, s);
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
    const geo = rowGeometry(g, headerBottom, footerTop, rowWeights(days), 16, 200);
    const s = geo.scale;
    const skew = 22 * u;
    days.forEach((day, i) => {
      const { y: ry, h: rh } = geo.rows[i];
      const rx = padX, rw = contentW;
      const e = day.entry;
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

      // 曜日（上）＋日付（下）
      const cy = ry + rh / 2;
      const labelRight = drawDayLabel(g, day, rx + skew + 18 * u, cy, rh, s, 'tag');

      drawTimeBlock(g, e, labelRight + 16 * u, rx + rw - skew - 20 * u, cy, rh, s);
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
    const geo = rowGeometry(g, headerBottom, footerTop, rowWeights(days), 0, 210);
    const s = geo.scale;
    const line = rgba(pal.sub, 0.35);
    if (geo.rows.length) {
      ctx.fillStyle = line;
      ctx.fillRect(padX, geo.rows[0].y, contentW, 2 * u);
    }
    days.forEach((day, i) => {
      const { y: ry, h: rh } = geo.rows[i];
      const cy = ry + rh / 2;
      const e = day.entry;
      ctx.fillStyle = line;
      ctx.fillRect(padX, ry + rh - 2 * u, contentW, 2 * u);

      // 曜日（上）＋日付（下）
      const labelRight = drawDayLabel(g, day, padX + 2 * u, cy, rh, s, 'text');

      drawTimeBlock(g, e, labelRight + 16 * u, padX + contentW - 2 * u, cy, rh, s);
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
     model = { size:{w,h,story}, pal, font, layout, koro,
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
    const parts = [model.title, model.subtitle, model.note, model.offLabel, '未定頃', '0123456789:～〜/.()- …'];
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

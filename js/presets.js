/* ============================================================
   BUTAI LIVE Schedule - プリセット定義
   （書き出しサイズ / フォント / カラー / レイアウト / 曜日）
   ============================================================ */
(function (global) {
  'use strict';

  // ---- 書き出しサイズ -------------------------------------------------
  // TikTokストーリーズは 9:16・1080×1920px が推奨。
  // story:true のサイズではTikTokのUI重なり領域（セーフゾーン）を考慮して配置する。
  const SIZES = [
    { id: '1080x1920', w: 1080, h: 1920, label: '1080 × 1920（9:16）', note: 'TikTokストーリーズ推奨', story: true },
    { id: '1440x2560', w: 1440, h: 2560, label: '1440 × 2560（9:16）', note: '高解像度', story: true },
    { id: '720x1280',  w: 720,  h: 1280, label: '720 × 1280（9:16）',  note: '軽量', story: true },
    { id: '1080x1350', w: 1080, h: 1350, label: '1080 × 1350（4:5）', note: 'フィード投稿向け', story: false },
    { id: '1080x1080', w: 1080, h: 1080, label: '1080 × 1080（1:1）', note: '正方形', story: false },
  ];

  // TikTok UI が重なる目安（1080×1920 基準・px）
  //  上：ユーザー名・閉じるボタン等 150〜200px / 下：返信バー等 250〜300px / 右：アイコン列 120px
  const SAFE_ZONE = { top: 200, bottom: 300, right: 120 };

  // ---- フォント（Google Fonts / 日本語対応・太めのゴシック中心）-----------
  const FONT_GROUPS = [
    { id: 'round',  label: '丸くてかわいい' },
    { id: 'simple', label: 'シンプル' },
    { id: 'cool',   label: 'かっこいい' },
  ];

  const FONTS = [
    // 丸い・かわいい
    { id: 'mplus-rounded', family: 'M PLUS Rounded 1c', weight: 800, group: 'round',  label: 'M PLUS Rounded', desc: '王道の丸ゴシック・太字' },
    { id: 'zen-maru',      family: 'Zen Maru Gothic',   weight: 900, group: 'round',  label: 'Zen丸ゴシック',   desc: 'やわらかく読みやすい' },
    { id: 'mochiy-pop',    family: 'Mochiy Pop One',    weight: 400, group: 'round',  label: 'モッチーポップ',  desc: 'ぽってり太めのポップ体' },
    { id: 'kosugi-maru',   family: 'Kosugi Maru',       weight: 400, group: 'round',  label: '小杉丸ゴシック',  desc: '定番の丸ゴ' },
    { id: 'kiwi-maru',     family: 'Kiwi Maru',         weight: 500, group: 'round',  label: 'キウイ丸',        desc: 'レトロかわいい' },
    { id: 'tsukimi',       family: 'Tsukimi Rounded',   weight: 700, group: 'round',  label: 'つきみ丸',        desc: 'ふんわり丸め' },
    { id: 'potta',         family: 'Potta One',         weight: 400, group: 'round',  label: 'ポッタ',          desc: 'ぽってり手書き風' },
    { id: 'cherry-bomb',   family: 'Cherry Bomb One',   weight: 400, group: 'round',  label: 'チェリーボム',    desc: 'コミカルで元気' },
    { id: 'yusei-magic',   family: 'Yusei Magic',       weight: 400, group: 'round',  label: '油性マジック',    desc: 'マーカー手書き風' },
    // シンプル
    { id: 'noto-sans', family: 'Noto Sans JP',         weight: 900, group: 'simple', label: 'Noto Sans JP',   desc: '定番ゴシック・極太' },
    { id: 'mplus2',    family: 'M PLUS 2',             weight: 900, group: 'simple', label: 'M PLUS 2',       desc: 'モダンなゴシック' },
    { id: 'zen-kaku',  family: 'Zen Kaku Gothic New',  weight: 900, group: 'simple', label: 'Zen角ゴシック',  desc: 'すっきり洗練' },
    { id: 'biz-udp',   family: 'BIZ UDPGothic',        weight: 700, group: 'simple', label: 'BIZ UDPゴシック', desc: '視認性重視のUDフォント' },
    { id: 'murecho',   family: 'Murecho',              weight: 800, group: 'simple', label: 'Murecho',        desc: '端正でモダン' },
    // かっこいい
    { id: 'dela-gothic',       family: 'Dela Gothic One',     weight: 400, group: 'cool', label: 'デラゴシック',       desc: '超極太インパクト' },
    { id: 'rocknroll',         family: 'RocknRoll One',       weight: 400, group: 'cool', label: 'ロックンロール',     desc: 'ポップで力強い' },
    { id: 'shippori-antique',  family: 'Shippori Antique B1', weight: 400, group: 'cool', label: 'しっぽりアンチック', desc: 'マンガ風の太字' },
    { id: 'reggae',            family: 'Reggae One',          weight: 400, group: 'cool', label: 'レゲエ',             desc: '勢いのある太字' },
    { id: 'zen-old-mincho',    family: 'Zen Old Mincho',      weight: 900, group: 'cool', label: 'Zenオールド明朝',    desc: '上品でエレガント' },
  ];

  // ---- カラープリセット（かっこいい系 7色 / かわいい系 7色）-----------------
  // bg: 背景グラデーション2色 / card: カード / text: 文字 / sub: 補助文字
  // accent: メインアクセント（平日バッジ等） / accent2: サブアクセント（土日バッジ等）
  const COLOR_GROUPS = [
    { id: 'cool', label: 'かっこいい系' },
    { id: 'cute', label: 'かわいい系' },
  ];

  const COLORS = [
    // かっこいい系
    { id: 'tiktok-dark', group: 'cool', name: 'TikTok ブラック',     bg: ['#15151c', '#000000'], card: '#1d1d26', text: '#ffffff', sub: '#a9a9b6', accent: '#69c9d0', accent2: '#ee1d52' },
    { id: 'mono-black',  group: 'cool', name: 'モノクロ（黒）',      bg: ['#1c1c1c', '#050505'], card: '#262626', text: '#ffffff', sub: '#9c9c9c', accent: '#ffffff', accent2: '#c4c4c4' },
    { id: 'mono-white',  group: 'cool', name: 'モノクロ（白）',      bg: ['#ffffff', '#e9e9e9'], card: '#f5f5f5', text: '#111111', sub: '#666666', accent: '#111111', accent2: '#6f6f6f' },
    { id: 'navy-gold',   group: 'cool', name: 'ネイビー×ゴールド',  bg: ['#0e1d3d', '#050b1d'], card: '#142649', text: '#ffffff', sub: '#a8b3cf', accent: '#f2c14e', accent2: '#e08a3c' },
    { id: 'neon-purple', group: 'cool', name: 'ネオンパープル',      bg: ['#1c0b33', '#07030f'], card: '#251343', text: '#ffffff', sub: '#b9a7d6', accent: '#b46cff', accent2: '#ff4fd8' },
    { id: 'emerald',     group: 'cool', name: 'エメラルド',          bg: ['#072b22', '#02120e'], card: '#0d3c2f', text: '#ffffff', sub: '#9dc7b8', accent: '#2fe3a0', accent2: '#7ef0c8' },
    { id: 'crimson',     group: 'cool', name: 'クリムゾン',          bg: ['#2c0a11', '#0c0304'], card: '#3c111a', text: '#ffffff', sub: '#d0a2ab', accent: '#ff2e4d', accent2: '#ff8a5b' },
    // かわいい系
    { id: 'tiktok-pastel', group: 'cute', name: 'TikTok パステル', bg: ['#fff1f6', '#e4fbfc'], card: '#ffffff', text: '#2b2b33', sub: '#7a7a88', accent: '#ee1d52', accent2: '#69c9d0' },
    { id: 'sakura',        group: 'cute', name: 'さくら',           bg: ['#ffe9f0', '#ffd3e2'], card: '#ffffff', text: '#5a3745', sub: '#9b7480', accent: '#ff7fa9', accent2: '#ffb4c9' },
    { id: 'mint',          group: 'cute', name: 'ミントソーダ',     bg: ['#e6fbf4', '#d0f4e8'], card: '#ffffff', text: '#264d40', sub: '#6a9184', accent: '#3ecf9a', accent2: '#7fd8ff' },
    { id: 'lavender',      group: 'cute', name: 'ラベンダー',       bg: ['#f1e9ff', '#e2d4ff'], card: '#ffffff', text: '#3e2f5e', sub: '#7f6f9e', accent: '#a67cf2', accent2: '#f2a7d8' },
    { id: 'lemon',         group: 'cute', name: 'レモン',           bg: ['#fff9dc', '#ffefb3'], card: '#ffffff', text: '#55461c', sub: '#8f8050', accent: '#f6b21a', accent2: '#8fd14f' },
    { id: 'peach',         group: 'cute', name: 'ピーチ',           bg: ['#fff0e6', '#ffdac8'], card: '#ffffff', text: '#5c3a2b', sub: '#9a7a6b', accent: '#ff8c5a', accent2: '#ffc38b' },
    { id: 'sky',           group: 'cute', name: 'そらいろ',         bg: ['#e7f3ff', '#d0e6ff'], card: '#ffffff', text: '#2b3f5c', sub: '#6d82a0', accent: '#5aa9ff', accent2: '#ff9ecf' },
  ];

  // ---- レイアウト ------------------------------------------------------
  const LAYOUTS = [
    { id: 'cute',   label: 'かわいい',   emoji: '🎀', desc: '丸カード・パステル・ハート＆星' },
    { id: 'cool',   label: 'かっこいい', emoji: '⚡', desc: 'ダーク・斜めカード・ネオン' },
    { id: 'simple', label: 'シンプル',   emoji: '⬜', desc: '余白と罫線のミニマル' },
  ];

  // ---- 曜日 ------------------------------------------------------------
  const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'];
  const WEEKDAY_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

  // ---- 配信内容のプリセット（ドロップダウンの並び順）------------------------
  const MEMO_PRESETS = ['雑談', 'ゲーム', '作業', '歌枠', 'ASMR'];

  // Google Fonts の読み込みURL（全フォントを1リクエストで）
  function googleFontsUrl() {
    const fams = FONTS.map((f) => {
      const name = f.family.replace(/ /g, '+');
      return f.weight && f.weight !== 400 ? `family=${name}:wght@${f.weight}` : `family=${name}`;
    });
    return `https://fonts.googleapis.com/css2?${fams.join('&')}&display=swap`;
  }

  global.Presets = {
    SIZES, SAFE_ZONE, FONT_GROUPS, FONTS, COLOR_GROUPS, COLORS, LAYOUTS,
    WEEKDAY_JA, WEEKDAY_EN, MEMO_PRESETS, googleFontsUrl,
  };
})(window);

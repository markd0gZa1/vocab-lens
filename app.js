(function () {
  'use strict';

  // ---------------------------------------------------------------- 状态

  const BOOKS = [
    { code: 'zk', name: '中考', group: '中学' },
    { code: 'gk', name: '高考', group: '中学' },
    { code: 'cet4', name: '四级', group: '四六级' },
    { code: 'cet6', name: '六级', group: '四六级' },
    { code: 'ky', name: '考研', group: '考研' },
    { code: 'toefl', name: '托福', group: '出国' },
    { code: 'ielts', name: '雅思', group: '出国' },
    { code: 'gre', name: 'GRE', group: '出国' }
  ];

  function bookName(code) {
    if (code === 'all') return '全部词';
    const found = BOOKS.find(function (b) { return b.code === code; });
    return found ? found.name : code;
  }

  function savedWordbook() {
    try {
      return localStorage.getItem('vl.wordbook') || 'all';
    } catch (e) {
      return 'all';
    }
  }

  function savedTheme() {
    try {
      return localStorage.getItem('vl.theme') || 'auto';
    } catch (e) {
      return 'auto';
    }
  }

  function savedFlag(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : raw === '1';
    } catch (e) {
      return fallback;
    }
  }

  function savedRate() {
    try {
      const value = parseFloat(localStorage.getItem('vl.rate') || '');
      return value >= 0.6 && value <= 1.4 ? value : 0.92;
    } catch (e) {
      return 0.92;
    }
  }

  function savedLayout() {
    try {
      return localStorage.getItem('vl.layout') || 'list';
    } catch (e) {
      return 'list';
    }
  }

  const state = {
    tab: 'scan',
    words: [],
    paragraphs: [],
    photo: null,
    photoOpen: false,
    reading: { sentences: [], layout: [] },
    viewMode: 'words', // words | reading
    layout: savedLayout(), // list | grid
    showAll: false,
    showTrans: false,
    showGrammar: false,
    transZh: {},
    translating: false,
    transPending: {},
    busy: false,
    overlay: null, // { title, hint, progress }
    progress: 0,
    progressLabel: null,
    message: null,
    detail: null,
    grammar: null,
    historyDetail: null,
    dictReady: false,
    dictError: null,
    wordbook: savedWordbook(),
    theme: savedTheme(),
    speechRate: savedRate(),
    showPhoto: savedFlag('vl.showPhoto', true),
    aiEnabled: savedFlag('vl.ai', false),
    settingsOpen: false,
    aiTesting: null
  };

  // 调试/自检用，正式界面不依赖它
  window.__vl = state;
  window.__vlRender = render;

  const store = {
    starred: loadJSON('vl.starred', []),
    history: loadJSON('vl.history', [])
  };

  let ocrWorker = null;
  let itemSeq = 0;
  let lastAccent = 'US';
  let speakingWord = null;
  let speakingAccent = null;
  let speakingAll = false;
  let speakingSentence = null;

  // ---------------------------------------------------------------- 图标

  const S = 'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" fill="none"';

  const ICONS = {
    scan: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><path d="M8 12h8"/></svg>',
    book: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 19.2A2.8 2.8 0 0 1 6.8 16.4H20"/><path d="M6.8 2.2H20v19.6H6.8A2.8 2.8 0 0 1 4 19V5A2.8 2.8 0 0 1 6.8 2.2z"/></svg>',
    star: '<svg viewBox="0 0 24 24" ' + S + '><ellipse cx="6.6" cy="10.4" rx="2" ry="2.6"/><ellipse cx="11" cy="7.6" rx="2" ry="2.8"/><ellipse cx="15.8" cy="7.8" rx="2" ry="2.8"/><ellipse cx="19.6" cy="11" rx="1.9" ry="2.5"/><path d="M13 13.2c3 0 5.2 2 5.2 4.2 0 1.9-1.7 3-3.5 3-.9 0-1.4-.4-1.7-.4s-.8.4-1.7.4c-1.8 0-3.5-1.1-3.5-3 0-2.2 2.2-4.2 5.2-4.2z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor"><ellipse cx="6.6" cy="10.4" rx="2" ry="2.6"/><ellipse cx="11" cy="7.6" rx="2" ry="2.8"/><ellipse cx="15.8" cy="7.8" rx="2" ry="2.8"/><ellipse cx="19.6" cy="11" rx="1.9" ry="2.5"/><path d="M13 13.2c3 0 5.2 2 5.2 4.2 0 1.9-1.7 3-3.5 3-.9 0-1.4-.4-1.7-.4s-.8.4-1.7.4c-1.8 0-3.5-1.1-3.5-3 0-2.2 2.2-4.2 5.2-4.2z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.1 1.9"/></svg>',
    camera: '<svg viewBox="0 0 24 24" ' + S + '><path d="M3 8.6A2.6 2.6 0 0 1 5.6 6h1.5l1-1.6A1.5 1.5 0 0 1 9.4 3.6h5.2a1.5 1.5 0 0 1 1.3.8l1 1.6h1.5A2.6 2.6 0 0 1 21 8.6v8.8A2.6 2.6 0 0 1 18.4 20H5.6A2.6 2.6 0 0 1 3 17.4z"/><circle cx="12" cy="12.8" r="3.5"/></svg>',
    image: '<svg viewBox="0 0 24 24" ' + S + '><rect x="3" y="4.2" width="18" height="15.6" rx="2.6"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="m4 17 4.7-4.6a1.6 1.6 0 0 1 2.2 0L15 16.6"/><path d="m14 14 1.9-1.8a1.6 1.6 0 0 1 2.2 0L20.4 14"/></svg>',
    sun: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="4"/><path d="M12 2.6v2M12 19.4v2M2.6 12h2M19.4 12h2M5.4 5.4l1.4 1.4M17.2 17.2l1.4 1.4M18.6 5.4l-1.4 1.4M6.8 17.2l-1.4 1.4"/></svg>',
    moon: '<svg viewBox="0 0 24 24" ' + S + '><path d="M20.6 13.4A8.7 8.7 0 1 1 10.6 3.4a7 7 0 0 0 10 10z"/></svg>',
    info: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5.2"/><path d="M12 7.9h.01"/></svg>',
    gear: '<svg viewBox="0 0 24 24" ' + S + '><circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.2a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V20a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7.5 4.6v14.8L20 12z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 7h16M9.4 7V4.8h5.2V7M6.4 7l.9 12.2h9.4L17.6 7"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 9.4v5.2h3.2L12 18.4V5.6L7.2 9.4z"/><path d="M15.6 8.8a4.6 4.6 0 0 1 0 6.4"/></svg>',
    list: '<svg viewBox="0 0 24 24" ' + S + '><path d="M8.5 6h11M8.5 12h11M8.5 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>',
    grid: '<svg viewBox="0 0 24 24" ' + S + '><rect x="3.6" y="3.6" width="7" height="7" rx="1.6"/><rect x="13.4" y="3.6" width="7" height="7" rx="1.6"/><rect x="3.6" y="13.4" width="7" height="7" rx="1.6"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.6"/></svg>',
    translate: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 6h8M8 4v2c0 3.4-1.7 6.2-4.4 7.8M6.2 8.6c.9 2.4 2.8 4.2 5.2 5"/><path d="m12.4 20 3.6-9.4L19.6 20M13.8 16.8h4.6"/></svg>',
    grammar: '<svg viewBox="0 0 24 24" ' + S + '><path d="M4 6.5h7M4 11.5h10M4 16.5h5"/><path d="m15.4 14.4 1.9 1.9 3.5-3.9"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" ' + S + '><path d="m14.5 6.5-5.5 5.5 5.5 5.5"/></svg>'
  };


  // ---------------------------------------------------------------- 小猫

  /** 状态猫：idle 待机 / scan 识别中 / think 翻译中 / happy 完成 / sad 出错 */
  function catSvg(state, extraClass) {
    const eyes = {
      idle:
        '<circle cx="44" cy="58" r="4.6"/><circle cx="76" cy="58" r="4.6"/>' +
        '<circle cx="45.4" cy="56.4" r="1.5" fill="var(--cat-bg)"/>' +
        '<circle cx="77.4" cy="56.4" r="1.5" fill="var(--cat-bg)"/>',
      scan:
        '<ellipse cx="44" cy="58" rx="4.6" ry="5.4"/><ellipse cx="76" cy="58" rx="4.6" ry="5.4"/>' +
        '<circle cx="46" cy="56" r="1.5" fill="var(--cat-bg)"/>' +
        '<circle cx="78" cy="56" r="1.5" fill="var(--cat-bg)"/>',
      think:
        '<path d="M38 59 q6 -7 12 0" fill="none"/><path d="M70 59 q6 -7 12 0" fill="none"/>',
      happy:
        '<path d="M38 60 q6 -8 12 0" fill="none"/><path d="M70 60 q6 -8 12 0" fill="none"/>',
      sad:
        '<path d="M39 54 l10 10 M49 54 l-10 10" fill="none"/>' +
        '<path d="M71 54 l10 10 M81 54 l-10 10" fill="none"/>'
    };

    const mouth =
      state === 'happy'
        ? '<path d="M54 70 q6 7 12 0" fill="none"/>'
        : state === 'sad'
          ? '<path d="M55 74 q5 -5 10 0" fill="none"/>'
          : '<path d="M60 68 q-5 6 -9 1 M60 68 q5 6 9 1" fill="none"/>';

    const extras =
      state === 'scan'
        ? '<g class="cat-prop"><circle cx="88" cy="86" r="12"/><path d="M97 95 l9 9"/></g>'
        : state === 'think'
          ? '<g class="cat-prop cat-dots"><circle cx="44" cy="18" r="3.4"/><circle cx="56" cy="11" r="4.4"/><circle cx="70" cy="6" r="5.6"/></g>'
          : '';

    return (
      '<svg class="cat cat-' + state + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 120 120" fill="none" stroke="var(--cat-line)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">' +
        '<path class="cat-tail" d="M97 90 q25 10 24 -20" />' +
        '<path d="M24 48 L18 15 L50 30" fill="var(--cat-fill)"/>' +
        '<path d="M30 40 L27 25 L41 33" stroke-width="2.4" opacity="0.55"/>' +
        '<path d="M96 48 L102 15 L70 30" fill="var(--cat-fill)"/>' +
        '<path d="M90 40 L93 25 L79 33" stroke-width="2.4" opacity="0.55"/>' +
        '<path d="M14 54 C14 33 34 24 60 24 C86 24 106 33 106 54 C106 82 88 98 60 98 C32 98 14 82 14 54 Z" fill="var(--cat-fill)"/>' +
        '<g class="cat-eyes" stroke="var(--cat-line)" fill="var(--cat-line)" stroke-width="3.4">' + eyes[state] + '</g>' +
        '<path d="M56 66 L64 66 L60 71 Z" fill="var(--cat-line)" stroke="none"/>' +
        '<g>' + mouth + '</g>' +
        '<path d="M10 62 q-6 1 -8 3 M10 70 q-6 2 -8 5" stroke-width="2.4"/>' +
        '<path d="M110 62 q6 1 8 3 M110 70 q6 2 8 5" stroke-width="2.4"/>' +
        extras +
      '</svg>'
    );
  }

  // ---------------------------------------------------------------- 主题

  function resolvedTheme() {
    if (state.theme === 'dark') return 'dark';
    if (state.theme === 'light') return 'light';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#14161b' : '#f6f1e7');
  }

  function toggleTheme() {
    state.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('vl.theme', state.theme);
    } catch (e) { /* 存不下就算了 */ }
    applyTheme();
    render();
  }

  // ---------------------------------------------------------------- 工具

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      /* 存不下就算了 */
    }
  }

  function esc(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const today = new Date();
    const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((startOf(today) - startOf(d)) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  // ---------------------------------------------------------------- 发音

  function voiceFor(accent) {
    const lang = accent === 'UK' ? 'en-GB' : 'en-US';
    const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    return (
      voices.find((v) => v.lang === lang && v.localService) ||
      voices.find((v) => v.lang === lang) ||
      voices.find((v) => v.lang.indexOf('en') === 0) ||
      null
    );
  }

  function speak(word, accent) {
    if (!window.speechSynthesis) return;
    const chosen = accent || lastAccent;
    lastAccent = chosen;

    speechSynthesis.cancel();
    speakingAll = false;
    speakingSentence = null;

    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = chosen === 'UK' ? 'en-GB' : 'en-US';
    utterance.rate = 0.9;

    const voice = voiceFor(chosen);
    if (voice) utterance.voice = voice;

    speakingWord = word;
    speakingAccent = chosen;

    utterance.onend = () => {
      if (speakingWord === word) {
        speakingWord = null;
        speakingAccent = null;
        render();
      }
    };

    speechSynthesis.speak(utterance);
    render();
  }

  /** 念一段文本（句子 / 整段），rate 可调 */
  function speakText(text, accent, rate) {
    if (!window.speechSynthesis) return;
    const chosen = accent || lastAccent;
    lastAccent = chosen;

    speechSynthesis.cancel();
    speakingAll = false;
    speakingWord = null;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = chosen === 'UK' ? 'en-GB' : 'en-US';
    utterance.rate = rate || state.speechRate;

    const voice = voiceFor(chosen);
    if (voice) utterance.voice = voice;

    utterance.onend = () => {
      speakingSentence = null;
      render();
    };

    speechSynthesis.speak(utterance);
  }

  function speakAll(words) {
    if (!window.speechSynthesis || !words.length) return;
    if (speakingAll) {
      stopSpeaking();
      return;
    }

    speechSynthesis.cancel();
    speakingAll = true;
    speakingWord = null;
    speakingSentence = null;

    let index = 0;
    const next = () => {
      if (index >= words.length || !speakingAll) {
        speakingAll = false;
        render();
        return;
      }
      const accent = lastAccent;
      const utterance = new SpeechSynthesisUtterance(words[index++]);
      utterance.lang = accent === 'UK' ? 'en-GB' : 'en-US';
      utterance.rate = 0.9;
      const voice = voiceFor(accent);
      if (voice) utterance.voice = voice;
      utterance.onend = next;
      utterance.onerror = next;
      speechSynthesis.speak(utterance);
    };

    next();
    render();
  }

  /** 依次念整段的所有句子 */
  function speakArticle() {
    if (!window.speechSynthesis) return;
    if (speakingAll) {
      stopSpeaking();
      return;
    }

    const sentences = state.reading.sentences.map((s) => s.text);
    if (!sentences.length) return;

    speechSynthesis.cancel();
    speakingAll = true;
    speakingWord = null;

    let index = 0;
    const next = () => {
      if (index >= sentences.length || !speakingAll) {
        speakingAll = false;
        speakingSentence = null;
        render();
        return;
      }
      speakingSentence = index;
      const accent = lastAccent;
      const utterance = new SpeechSynthesisUtterance(sentences[index++]);
      utterance.lang = accent === 'UK' ? 'en-GB' : 'en-US';
      utterance.rate = state.speechRate;
      const voice = voiceFor(accent);
      if (voice) utterance.voice = voice;
      utterance.onend = next;
      utterance.onerror = next;
      speechSynthesis.speak(utterance);
      render();
      keepPlayingInView();
    };

    next();
  }

  /** 朗读时让正在念的那一句留在屏幕里 */
  function keepPlayingInView() {
    if (!speakingAll || speakingSentence == null) return;
    const el = document.querySelector('.sent.playing');
    if (el && el.scrollIntoView) {
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } catch (e) { /* 老浏览器不支持就算了 */ }
    }
  }

  function stopSpeaking() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    speakingAll = false;
    speakingWord = null;
    speakingAccent = null;
    speakingSentence = null;
    render();
  }

  // ---------------------------------------------------------------- 生词本 / 历史

  function isStarred(word) {
    return store.starred.some((item) => item.word.toLowerCase() === word.toLowerCase());
  }

  function toggleStar(word, entry) {
    const index = store.starred.findIndex((item) => item.word.toLowerCase() === word.toLowerCase());
    if (index >= 0) {
      store.starred.splice(index, 1);
    } else {
      store.starred.unshift({
        word: word,
        phonetic: entry ? entry.phonetic : null,
        meaning: entry ? entry.meaning : null,
        addedAt: Date.now()
      });
    }
    saveJSON('vl.starred', store.starred);
    render();
  }

  function starredGroups() {
    const buckets = new Map();
    for (const item of store.starred) {
      const d = new Date(item.addedAt);
      const key = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    return Array.from(buckets.entries()).sort((a, b) => b[0] - a[0]);
  }

  function addHistory(words, thumb) {
    if (!words.length) return;
    store.history.unshift({
      id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
      scannedAt: Date.now(),
      words: words,
      thumb: thumb || null
    });
    if (store.history.length > 50) store.history.length = 50;
    saveJSON('vl.history', store.history);
  }

  function usefulWords(entry) {
    const known = entry.words.filter((w) => Dictionary.contains(w));
    return known.length ? known : entry.words;
  }

  // ---------------------------------------------------------------- 识别参数

  const query = new URLSearchParams(location.search);
  const CFG = {
    engine: query.get('engine') || 'paddle',
    psm: query.get('psm') || '11',
    whitelist: query.get('wl') !== '0',
    binarize: query.get('bin') === '1',
    minConfidence: parseInt(query.get('conf') || '0', 10),
    maxSide: parseInt(query.get('side') || '2000', 10),
    minSide: parseInt(query.get('minside') || '1200', 10)
  };

  // ---------------------------------------------------------------- PP-OCRv4

  let paddleEngine = null;
  let assetsReady = false;

  const PADDLE_ASSETS = [
    'vendor/guten-ocr.js',
    'vendor/ort/ort-wasm-simd-threaded.wasm',
    'vendor/ort/ort-wasm-simd-threaded.mjs',
    'vendor/ocr/ch_PP-OCRv4_det_infer.onnx',
    'vendor/ocr/ch_PP-OCRv4_rec_infer.onnx',
    'vendor/ocr/ppocr_keys_v1.txt'
  ];

  async function prefetchAssets() {
    if (assetsReady) return;

    const sizes = await Promise.all(
      PADDLE_ASSETS.map(async function (url) {
        try {
          const response = await fetch(url, { method: 'HEAD' });
          return parseInt(response.headers.get('content-length') || '0', 10) || 0;
        } catch (e) {
          return 0;
        }
      })
    );

    const total = sizes.reduce(function (a, b) { return a + b; }, 0) || 1;
    let loaded = 0;

    for (let i = 0; i < PADDLE_ASSETS.length; i++) {
      const url = PADDLE_ASSETS[i];
      const response = await fetch(url);
      if (!response.ok) throw new Error('下载失败：' + url);

      if (!response.body || !response.body.getReader) {
        loaded += sizes[i];
        continue;
      }

      const reader = response.body.getReader();
      let fileBytes = 0;

      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;

        fileBytes += chunk.value.length;
        const progress = Math.min(0.92, 0.06 + ((loaded + fileBytes) / total) * 0.86);
        state.progress = progress;
        state.progressLabel =
          '正在下载识别引擎… ' +
          ((loaded + fileBytes) / 1048576).toFixed(1) +
          ' / ' +
          (total / 1048576).toFixed(0) +
          ' MB（只需下载一次）';
        renderProgress();
      }

      loaded += sizes[i] || fileBytes;
    }

    assetsReady = true;
    state.progressLabel = '正在准备识别…';
    renderProgress();
  }

  async function ensurePaddle() {
    if (paddleEngine) return paddleEngine;
    if (!window.GutenOcr) {
      await prefetchAssets();
      await import('./vendor/guten-ocr.js');
    }
    paddleEngine = await window.GutenOcr.create({
      models: {
        detectionPath: 'vendor/ocr/ch_PP-OCRv4_det_infer.onnx',
        recognitionPath: 'vendor/ocr/ch_PP-OCRv4_rec_infer.onnx',
        dictionaryPath: 'vendor/ocr/ppocr_keys_v1.txt'
      }
    });
    return paddleEngine;
  }

  /** 找页面中间的竖直空白缝；找不到返回 null */
  function findColumnGap(canvas) {
    const context = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const data = context.getImageData(0, 0, width, height).data;

    const ink = new Uint32Array(width);
    const step = Math.max(1, Math.floor(height / 600));
    let samples = 0;

    for (let y = 0; y < height; y += step) {
      samples++;
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const luminance =
          data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114;
        if (luminance < 110) ink[x]++;
      }
    }

    const limit = samples * 0.012;
    const from = Math.floor(width * 0.3);
    const to = Math.floor(width * 0.7);

    const windowWidth = Math.max(2, Math.round(width * 0.006));
    let totalInk = 0;
    for (let x = from; x < to; x++) totalInk += ink[x];
    const meanInk = totalInk / Math.max(1, to - from);

    const threshold = Math.max(limit, meanInk * 0.25);
    let runStart = -1;
    let widest = null;
    const runs = [];

    const closeRun = (end) => {
      if (runStart < 0) return;
      const runWidth = end - runStart;
      runs.push({ start: runStart, width: runWidth, center: runStart + runWidth / 2 });
      if (!widest || runWidth > widest.width) {
        widest = { start: runStart, width: runWidth, center: runStart + runWidth / 2 };
      }
      runStart = -1;
    };

    for (let x = from; x < to; x++) {
      if (ink[x] <= threshold) {
        if (runStart < 0) runStart = x;
      } else {
        closeRun(x);
      }
    }
    closeRun(to);

    let central = null;
    for (const run of runs) {
      // 真正的栏间距通常有好几毫米；太窄的多半是行尾参差造成的假缝
      if (run.width < width * 0.03) continue;
      const distance = Math.abs(run.center - width / 2);
      if (
        !central ||
        distance < central.distance - 0.5 ||
        (Math.abs(distance - central.distance) <= 0.5 && run.width > central.run.width)
      ) {
        central = { run: run, distance: distance };
      }
    }

    if (central) {
      window.__gapDebug = {
        mode: 'run',
        width: central.run.width,
        center: central.run.center,
        meanInk: meanInk,
        runs: runs.map((r) => [Math.round((r.center / width) * 100), r.width])
      };
      return Math.round(central.run.center);
    }

    let bestCenter = null;
    let bestSum = Infinity;

    for (let x = from; x < to; x++) {
      let sum = 0;
      for (let k = x - windowWidth; k <= x + windowWidth; k++) {
        if (k >= 0 && k < width) sum += ink[k];
      }
      if (sum < bestSum) {
        bestSum = sum;
        bestCenter = x;
      }
    }

    const ratio = meanInk > 0 ? bestSum / (meanInk * windowWidth * 2) : 1;
    window.__gapDebug = { mode: 'min', bestCenter: bestCenter, ratio: ratio, meanInk: meanInk };
    if (bestCenter !== null && ratio < 0.72) {
      return bestCenter;
    }
    return null;
  }

  function cropCanvas(canvas, left, right) {
    const out = document.createElement('canvas');
    out.width = Math.max(1, right - left);
    out.height = canvas.height;
    out.getContext('2d').drawImage(canvas, left, 0, out.width, canvas.height, 0, 0, out.width, canvas.height);
    return out;
  }

  async function recognizeWithPaddle(canvas) {
    const gap = findColumnGap(canvas);
    window.__debug = { gap: gap, width: canvas.width };

    if (gap && gap > canvas.width * 0.28 && gap < canvas.width * 0.78) {
      const leftCanvas = cropCanvas(canvas, 0, gap);
      const rightCanvas = cropCanvas(canvas, gap, canvas.width);

      const leftItems = await detectOn(leftCanvas, 0, canvas.width);
      const rightItems = await detectOn(rightCanvas, gap, canvas.width);
      window.__debug.left = leftItems.length;
      window.__debug.right = rightItems.length;

      if (
        leftItems.length >= 3 &&
        rightItems.length >= 3 &&
        isRealColumnSplit(leftItems, rightItems, gap / canvas.width)
      ) {
        return leftItems.concat(rightItems).map(function (item, index) {
          item.id = index;
          return item;
        });
      }
      window.__debug.fallback = true;
    }

    const items = await detectOn(canvas, 0, canvas.width);
    window.__debug.whole = items.length;
    return items;
  }

  /** 切完之后验一下：真的两栏，切口两边各有页边距，不会紧贴着文字 */
  function isRealColumnSplit(leftItems, rightItems, gapNorm) {
    const median = function (values) {
      const sorted = values.slice().sort(function (a, b) { return a - b; });
      return sorted[Math.floor(sorted.length / 2)];
    };

    const leftEdge = median(leftItems.map(function (i) { return i.right; }));
    const rightEdge = median(rightItems.map(function (i) { return i.left; }));

    // 切口紧贴着左边文字、或右边文字贴着切口起笔 → 说明是同一行被切开
    if (leftEdge > gapNorm - 0.012) return false;
    if (rightEdge < gapNorm + 0.012) return false;
    return true;
  }

  async function detectOn(sourceCanvas, offset, totalWidth) {
    const engine = await ensurePaddle();
    state.progress = 0.4;
    renderProgress();

    const context = sourceCanvas.getContext('2d');
    const imageData = context.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);

    const result = await engine.detect({
      data: imageData.data,
      width: sourceCanvas.width,
      height: sourceCanvas.height
    });

    const width = result.resizedImageWidth || sourceCanvas.width;
    const height = result.resizedImageHeight || sourceCanvas.height;
    const scale = sourceCanvas.width / width;

    const items = [];

    for (const line of result.texts || []) {
      const text = (line.text || '').trim();
      if (!text) continue;
      const box = line.box;
      if (!box || !box.length) continue;

      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const point of box) {
        left = Math.min(left, point[0]);
        top = Math.min(top, point[1]);
        right = Math.max(right, point[0]);
        bottom = Math.max(bottom, point[1]);
      }

      const item = {
        id: itemSeq++,
        text: text,
        left: (offset + left * scale) / totalWidth,
        right: (offset + right * scale) / totalWidth,
        top: top / height,
        bottom: bottom / height
      };
      item.midY = (item.top + item.bottom) / 2;
      item.height = item.bottom - item.top;
      items.push(item);
    }

    return items;
  }

  // 常见的两字母真词；除此之外的两字母碎片在切词时要罚分
  const SHORT_WORDS = [
    'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'if', 'in', 'is', 'it',
    'me', 'my', 'no', 'of', 'on', 'or', 'so', 'to', 'up', 'us', 'we', 'a', 'i'
  ];

  /** 把一个粘在一起的串按词典切回单词，比如 peoplewho → people who。
   *  同样是 0 代价的切法可能有好几种（scientist|shave 和 scientists|have 都成立），
   *  这里按「段数少 → 第一段长」来挑，实测更接近原文。 */
  function splitStuck(token) {
    const n = token.length;
    const best = new Array(n + 1).fill(null);
    best[0] = { cost: 0, count: 0, score: 0, parts: [] };

    const better = function (candidate, current) {
      if (!current) return true;
      if (candidate.cost !== current.cost) return candidate.cost < current.cost;
      if (candidate.count !== current.count) return candidate.count < current.count;
      // 段数一样时，碎片越长越像真词（books|in 优于 book|sin）
      return candidate.score > current.score;
    };

    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;

      for (let length = Math.min(20, n - i); length >= 1; length--) {
        const piece = token.substr(i, length);
        const known = length >= 2 && Dictionary.contains(piece);
        // 一两个字母的碎片（ad、sin、e）几乎总是切错了，除非是真·常用词；
        // 罚分要比「整词不认识」还重，宁可原样留着
        let cost = known ? 0 : 60 * length;
        if (length <= 2 && SHORT_WORDS.indexOf(piece.toLowerCase()) < 0) cost += 999;
        const total = best[i].cost + cost;

        const candidate = {
          cost: total,
          count: best[i].count + 1,
          score: best[i].score + length * length,
          parts: best[i].parts.concat([piece])
        };

        if (better(candidate, best[i + length])) best[i + length] = candidate;
      }
    }

    const parts = best[n] ? best[n].parts : [token];
    if (parts.length <= 1) return parts;

    // 只有每一段都是真词才认这个切法。像 enmissions 这种 OCR 错词，
    // 硬切会变成 enm|is|sions，还不如原样留着。
    const trustworthy = parts.every(function (piece) {
      return Dictionary.contains(piece) &&
        (piece.length >= 2 || SHORT_WORDS.indexOf(piece.toLowerCase()) >= 0);
    });

    return trustworthy ? parts : [token];
  }

  /** OCR 常把空格吃掉。只对 6 个字母以上的纯字母段做切分，标点原样保留。 */
  function respace(text) {
    return text
      .split(/\s+/)
      .map(function (token) {
        return token.replace(/[A-Za-z]{6,}/g, function (run) {
          if (Dictionary.contains(run)) return run;
          const parts = splitStuck(run);
          return parts.length > 1 ? parts.join(' ') : run;
        });
      })
      .join(' ');
  }

  /** OCR 常常把标点前后的空格吃掉（week,will），这里补回来，念起来才顺 */
  function tidyPunctuation(text) {
    return text
      .replace(/\s+([,.;:!?])/g, '$1')
      .replace(/([,;:!?])(?=[A-Za-z])/g, '$1 ')
      .replace(/\.(?=[A-Z][a-z])/g, '. ');
  }

  /** 把 OCR 的行按竖直间距重新拼成段落，连字符断词会接回去 */
  function buildParagraphs(items) {
    const lines = ReadingOrder.ordered(items)
      .map(function (item) {
        return {
          text: respace(item.text).trim(),
          top: item.top,
          bottom: item.bottom,
          height: item.height,
          left: item.left
        };
      })
      .filter(function (line) { return line.text; });

    // 段落的行距和正文行距差不了多少时，按「行高 × 1.25」判断会每行都断段。
    // 先量出整页的行距中位数，明显大于它才断段。
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      if (Math.abs((b.left || 0) - (a.left || 0)) > 0.15) continue;
      const gap = b.top - a.bottom;
      if (gap >= 0) gaps.push(gap);
    }
    gaps.sort(function (x, y) { return x - y; });
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

    const paragraphs = [];
    let current = [];
    let prev = null;

    const flush = function () {
      if (current.length) {
        paragraphs.push(tidyPunctuation(current.join(' ')));
        current = [];
      }
    };

    for (const line of lines) {
      if (prev) {
        const gap = line.top - prev.bottom;
        const height = Math.max(prev.height || 0.02, line.height || 0.02);
        const limit = Math.max(height * 0.6, medianGap * 1.9);
        // 换栏时 x 会突然跳一大截，这时候必须断段，不然左右两栏会连成一段
        const columnJump = Math.abs((line.left || 0) - (prev.left || 0)) > 0.15;
        if (gap > limit || gap < 0 || columnJump) flush();
      }

      if (current.length) {
        const tail = current[current.length - 1];
        if (/-$/.test(tail) && /^[a-z]/.test(line.text)) {
          // 行尾连字符：exam- + ple
          current[current.length - 1] = tail.slice(0, -1) + line.text;
        } else {
          const merged = mergeBrokenWord(tail, line.text);
          if (merged) {
            current[current.length - 1] = merged;
          } else {
            current.push(line.text);
          }
        }
      } else {
        current.push(line.text);
      }

      prev = line;
    }
    flush();

    return paragraphs;
  }

  /** 跨行被切断的词：conveni + ence → convenience。只有拼起来是词典里的真词才接。 */
  function mergeBrokenWord(tail, next) {
    if (/[.。!?！？,，;；:：]$/.test(tail)) return null;

    const last = tail.match(/([A-Za-z]+)$/);
    const first = next.match(/^([A-Za-z]+)/);
    if (!last || !first) return null;

    const left = last[1];
    const right = first[1];
    if (left !== left.toLowerCase() || right !== right.toLowerCase()) return null;
    if (Dictionary.contains(left)) return null;

    const joined = left + right;
    if (!Dictionary.contains(joined)) return null;

    return tail.slice(0, tail.length - left.length) + joined + next.slice(right.length);
  }

  /** 把段落切成句子，记录每段包含哪些句子 */
  function buildReading(paragraphs) {
    const sentences = [];
    const layout = [];

    paragraphs.forEach(function (para) {
      const parts = SentenceParse.splitSentences(para);
      const idxs = [];
      parts.forEach(function (text) {
        idxs.push(sentences.length);
        sentences.push({ text: text });
      });
      layout.push(idxs);
    });

    return { sentences: sentences, layout: layout };
  }

  async function handleFile(file) {
    if (!file) return;
    state.busy = true;
    state.overlay = { title: '正在识别', hint: '在本地处理，照片不会上传', progress: 0, cat: 'scan' };
    state.progress = 0;
    state.progressLabel = '正在识别…';
    state.message = null;
    render();

    try {
      const bitmap = await createImageBitmap(file);
      const longSide = Math.max(bitmap.width, bitmap.height);

      let ratio = 1;
      if (longSide > CFG.maxSide) ratio = CFG.maxSide / longSide;
      else if (longSide < CFG.minSide) ratio = Math.min(2, CFG.minSide / longSide);

      const width = Math.max(1, Math.round(bitmap.width * ratio));
      const height = Math.max(1, Math.round(bitmap.height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      if (bitmap.close) bitmap.close();

      if (CFG.binarize) binarize(canvas);

      let items;

      if (CFG.engine === 'paddle') {
        items = await recognizeWithPaddle(canvas);
      } else {
        const worker = await ensureWorker();
        const result = await worker.recognize(canvas, {}, { blocks: true, text: true });

        items = [];
        let id = 0;
        const blocks = result.data.blocks || [];
        for (const block of blocks) {
          for (const para of block.paragraphs || []) {
            for (const line of para.lines || []) {
              for (const word of line.words || []) {
                const text = (word.text || '').trim();
                if (!text) continue;
                if (CFG.minConfidence && (word.confidence || 0) < CFG.minConfidence) continue;
                const box = word.bbox;
                const item = {
                  id: id++,
                  text: text,
                  left: box.x0 / width,
                  top: box.y0 / height,
                  right: box.x1 / width,
                  bottom: box.y1 / height
                };
                item.midY = (item.top + item.bottom) / 2;
                item.height = item.bottom - item.top;
                items.push(item);
              }
            }
          }
        }
      }

      const candidates = ReadingOrder.words(items, function (w) {
        return Dictionary.isVocabWord(w);
      });
      window.__lastItems = items;

      let paragraphs = buildParagraphs(items);
      state.paragraphs = paragraphs;
      state.reading = buildReading(paragraphs);

      // AI 增强：把识别出来的文字交给 DeepSeek 校正（只发文字，不发照片）
      if (state.aiEnabled && AI.hasKey() && paragraphs.length) {
        state.overlay = { title: 'AI 校正中', hint: '把识别文字整理成正确的英文', progress: 0.9, cat: 'think' };
        render();
        try {
          const cleaned = await AI.cleanText(paragraphs.join('\n\n'));
          const parts = cleaned
            .split(/\n\s*\n/)
            .map(function (part) { return part.trim(); })
            .filter(Boolean);
          if (parts.length) {
            state.paragraphs = parts;
            state.reading = buildReading(parts);
          }
        } catch (error) {
          state.message = 'AI 校正失败，已用本地识别结果';
        }
      }

      state.viewMode = 'words';
      state.showTrans = false;
      state.showGrammar = false;
      state.transZh = {};
      state.transPending = {};

      const known = candidates.filter(function (w) {
        return Dictionary.isVocabWord(w);
      });
      const found = known.length ? known : candidates;

      state.words = found;
      state.showAll = false;
      try {
        // 只留识别到的文字范围，页面空白不要，对照起来更省地方
        state.photo = makePhoto(canvas, items);
      } catch (e) {
        state.photo = null;
      }

      if (!found.length) {
        state.message = '没找到英文单词。试试把书页拍正、拍满一点。';
      } else {
        addHistory(found, makeThumb(canvas));
      }
    } catch (error) {
      state.message = '识别出错了：' + (error && error.message ? error.message : error);
    } finally {
      state.busy = false;
      state.overlay = null;
      render();
    }
  }

  /** 把整张照片按文字范围裁一下，再转成 dataURL */
  function makePhoto(canvas, items) {
    if (items && items.length) {
      let left = 1, top = 1, right = 0, bottom = 0;
      for (const item of items) {
        left = Math.min(left, item.left);
        top = Math.min(top, item.top);
        right = Math.max(right, item.right);
        bottom = Math.max(bottom, item.bottom);
      }

      if (right > left && bottom > top) {
        const padX = Math.max(0.01, (right - left) * 0.03);
        const padY = Math.max(0.012, (bottom - top) * 0.06);

        const x0 = Math.max(0, Math.floor((left - padX) * canvas.width));
        const y0 = Math.max(0, Math.floor((top - padY) * canvas.height));
        const x1 = Math.min(canvas.width, Math.ceil((right + padX) * canvas.width));
        const y1 = Math.min(canvas.height, Math.ceil((bottom + padY) * canvas.height));

        if (x1 - x0 > 20 && y1 - y0 > 20) {
          const out = document.createElement('canvas');
          out.width = x1 - x0;
          out.height = y1 - y0;
          out.getContext('2d').drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
          return out.toDataURL('image/jpeg', 0.85);
        }
      }
    }

    return canvas.toDataURL('image/jpeg', 0.82);
  }

  function makeThumb(canvas) {
    try {
      const side = 96;
      const ratio = Math.min(1, side / Math.max(canvas.width, canvas.height));
      const thumb = document.createElement('canvas');
      thumb.width = Math.max(1, Math.round(canvas.width * ratio));
      thumb.height = Math.max(1, Math.round(canvas.height * ratio));
      thumb.getContext('2d').drawImage(canvas, 0, 0, thumb.width, thumb.height);
      return thumb.toDataURL('image/jpeg', 0.5);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- 翻译

  async function translateMissing() {
    if (state.translating) return;
    const sentences = state.reading.sentences;
    if (!sentences.length) return;

    const todo = sentences
      .map(function (s, i) { return { i: i, text: s.text }; })
      .filter(function (item) { return !state.transZh[item.i]; });

    if (!todo.length) return;

    state.translating = true;
    state.transPending = {};
    todo.forEach(function (item) { state.transPending[item.i] = true; });

    let useAI = state.aiEnabled && AI.hasKey();

    if (useAI) {
      state.overlay = {
        title: 'AI 翻译中',
        hint: '正在通过 DeepSeek 逐句翻译',
        progress: 0.6,
        cat: 'think'
      };
      render();

      try {
        const translated = await AI.translateSentences(todo.map(function (item) { return item.text; }));
        todo.forEach(function (item, index) {
          state.transZh[item.i] = translated[index] || '';
          delete state.transPending[item.i];
        });
      } catch (error) {
        state.message = 'AI 翻译失败，改用本地翻译';
        useAI = false;
      } finally {
        state.overlay = null;
      }
      render();
    }

    if (!useAI) {
      let first = true;
      state.overlay = {
        title: '正在准备翻译',
        hint: '翻译模型约 107 MB，只需下载一次，之后离线可用',
        progress: 0,
        cat: 'think'
      };
      render();

      try {
        for (const item of todo) {
          if (state.transZh[item.i]) {
            delete state.transPending[item.i];
            continue;
          }

          const zh = await Translator.translateOne(item.text, function (p) {
            if (first && state.overlay) {
              state.overlay.progress = p.ratio;
              state.overlay.hint =
                '正在下载翻译模型 ' +
                (p.loaded / 1048576).toFixed(0) +
                ' / ' +
                (p.total / 1048576).toFixed(0) +
                ' MB';
              renderProgress();
            }
          });

          if (first) {
            first = false;
            state.overlay = null;
            render();
          }

          state.transZh[item.i] = zh;
          delete state.transPending[item.i];
          render();
        }
      } catch (error) {
        state.showTrans = false;
        state.message = '翻译失败：' + (error && error.message ? error.message : error);
      }
    }

    state.translating = false;
    state.transPending = {};
    state.overlay = null;
    render();
  }

  // ---------------------------------------------------------------- 渲染

  const screen = document.getElementById('screen');
  const overlay = document.getElementById('overlay');

  function visibleWords() {
    if (state.showAll) return state.words;
    const filtered = state.words.filter((w) => Dictionary.isVocabWord(w));
    return filtered.length ? filtered : state.words;
  }

  function hiddenCount() {
    return state.words.filter((w) => !Dictionary.isVocabWord(w)).length;
  }

  function starIcon(on) {
    return on ? ICONS.starFill : ICONS.star;
  }

  function wordRowMarkup(word, index) {
    const entry = Dictionary.lookup(word);
    const starred = isStarred(word);

    const tag = entry.tag || '';
    const inBook = state.wordbook !== 'all' && tag.split(' ').indexOf(state.wordbook) >= 0;
    const badge = inBook ? ' <span class="badge">' + bookName(state.wordbook) + '</span>' : '';

    let subline = '<div class="sub empty">词典未收录</div>';
    if (!entry.empty) {
      const parts = [];
      if (entry.phonetic) parts.push('<span class="ipa">/' + esc(entry.phonetic) + '/</span>');
      if (entry.lemma) parts.push('<span class="lemma">' + esc(entry.lemma) + '</span>');
      if (entry.meaning) parts.push('<span class="meaning">' + esc(entry.meaning) + '</span>');
      subline = '<div class="sub">' + parts.join(' ') + '</div>';
    }

    const active = speakingWord === word;

    return (
      '<div class="row" data-word="' + esc(word) + '">' +
        (index == null ? '' : '<div class="index">' + (index + 1) + '</div>') +
        '<div class="text">' +
          '<div class="word">' + esc(word) + badge + '</div>' +
          subline +
        '</div>' +
        '<button class="star' + (starred ? ' on' : '') + '" data-star="' + esc(word) + '" aria-label="收藏">' + starIcon(starred) + '</button>' +
        '<div class="pill">' +
          '<button class="accent-btn' + (active && speakingAccent === 'UK' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="UK">英音</button>' +
          '<span class="divider"></span>' +
          '<button class="accent-btn' + (active && speakingAccent === 'US' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="US">美音</button>' +
        '</div>' +
      '</div>'
    );
  }

  function tileMarkup(word) {
    const entry = Dictionary.lookup(word);
    const meaning = entry.meaning ? entry.meaning.split(/[；;]/)[0] : '词典未收录';
    const active = speakingWord === word;

    return (
      '<button class="tile' + (active ? ' active' : '') + '" data-word="' + esc(word) + '">' +
        '<div class="tile-word">' + esc(word) + '</div>' +
        '<div class="tile-ipa">' + (entry.phonetic ? '/' + esc(entry.phonetic) + '/' : '') + '</div>' +
        '<div class="tile-meaning">' + esc(meaning) + '</div>' +
      '</button>'
    );
  }

  function listMarkup(words, withIndex) {
    const rows = words.map((w, i) => wordRowMarkup(w, withIndex ? i : null));
    return '<div class="card">' + rows.join('') + '</div>';
  }

  function gridMarkup(words) {
    return '<div class="grid">' + words.map(tileMarkup).join('') + '</div>';
  }

  /** 一句英文 → 可点的单词 span */
  function sentenceMarkup(text) {
    let html = '';
    const re = /([A-Za-z][A-Za-z'’\-]*)/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      html += esc(text.slice(last, m.index));
      html += '<span class="w" data-w="' + esc(m[0]) + '">' + esc(m[0]) + '</span>';
      last = m.index + m[0].length;
    }
    html += esc(text.slice(last));
    return html;
  }

  function sentenceSpan(index) {
    const sentence = state.reading.sentences[index];
    if (!sentence) return '';

    const playing = speakingAll && speakingSentence === index;

    return (
      '<span class="sent' + (playing ? ' playing' : '') + '" data-sent="' + index + '">' +
        sentenceMarkup(sentence.text) +
        '<button class="sent-play" data-play-sent="' + index + '" aria-label="朗读这句">' +
          (speakingSentence === index ? ICONS.stop : ICONS.play) +
        '</button>' +
      '</span>'
    );
  }

  function grammarChips(index) {
    const sentence = state.reading.sentences[index];
    if (!sentence) return '';
    const analysis = SentenceParse.analyze(sentence.text, Dictionary.lookup);
    if (!analysis.points.length) return '';

    return (
      '<div class="g-chips">' +
        analysis.points
          .map(function (point) {
            return (
              '<button class="g-chip" data-grammar="' + index + '">' + esc(point.name) + '</button>'
            );
          })
          .join('') +
      '</div>'
    );
  }

  function readingMarkup() {
    const reading = state.reading;
    if (!reading.sentences.length) {
      return (
        '<div class="empty-state">' +
          '<div class="icon">📖</div>' +
          '<div class="title">这一页没有切出完整的句子</div>' +
          '<div class="hint">可能是书页太糊，或者只拍到了单词表。换个角度再拍一张试试。</div>' +
        '</div>'
      );
    }

    const aligned = state.showTrans || state.showGrammar;
    let inner = '';

    reading.layout.forEach(function (idxs) {
      if (!idxs.length) return;

      if (!aligned) {
        inner +=
          '<div class="passage">' +
          idxs.map(sentenceSpan).join(' ') +
          '</div>';
        return;
      }

      inner += '<div class="passage">';
      idxs.forEach(function (i) {
        inner += '<div class="sent-block">' + sentenceSpan(i);

        if (state.showTrans) {
          const zh = state.transZh[i];
          if (zh) inner += '<div class="trans">' + esc(zh) + '</div>';
          else if (state.transPending[i]) inner += '<div class="trans pending">翻译中…</div>';
        }

        if (state.showGrammar) inner += grammarChips(i);
        inner += '</div>';
      });
      inner += '</div>';
    });

    return (
      '<div class="read-card">' + inner + '</div>' +
      '<div class="read-hint">点单词查词，点句子听整句，句末小三角单独朗读</div>'
    );
  }

  function rateLabel() {
    return state.speechRate <= 0.85 ? '慢速' : state.speechRate >= 1.05 ? '快速' : '常速';
  }

  function scanToolbar() {
    if (state.viewMode === 'reading') {
      return (
        '<div class="seg-row">' +
          '<div class="segmented">' +
            '<button class="seg" data-mode="words">单词</button>' +
            '<button class="seg on" data-mode="reading">段落</button>' +
          '</div>' +
          '<div class="spacer"></div>' +
          '<button class="mini-btn' + (state.showTrans ? ' on' : '') + '" data-translate>' +
            ICONS.translate + '<span>翻译</span>' +
          '</button>' +
          '<button class="mini-btn' + (state.showGrammar ? ' on' : '') + '" data-grammar-toggle>' +
            ICONS.grammar + '<span>语法</span>' +
          '</button>' +
        '</div>'
      );
    }

    return (
      '<div class="seg-row">' +
        '<div class="segmented">' +
          '<button class="seg on" data-mode="words">单词</button>' +
          '<button class="seg" data-mode="reading">段落</button>' +
        '</div>' +
        '<div class="spacer"></div>' +
        '<button class="mini-btn" data-layout>' +
          (state.layout === 'list' ? ICONS.grid : ICONS.list) +
          '<span>' + (state.layout === 'list' ? '横排' : '竖排') + '</span>' +
        '</button>' +
      '</div>'
    );
  }

  function scanScreen() {
    if (!Dictionary.isLoaded()) {
      if (state.dictError) {
        return (
          '<div class="empty-state">' +
            '<div class="icon">😵</div>' +
            '<div class="title">词典没加载成功</div>' +
            '<div class="hint">' + esc(state.dictError) + '</div>' +
            '<button class="wide" data-retry-dict style="max-width:220px">重试</button>' +
          '</div>'
        );
      }
      return (
        '<div class="empty-state">' +
          '<div class="spinner"></div>' +
          '<div class="title">正在加载词典…</div>' +
          '<div class="hint">首次大约 8 MB，加载完就存在手机里，以后不用再等</div>' +
        '</div>'
      );
    }

    const words = visibleWords();
    const hidden = hiddenCount();

    let notice = '';
    if (state.words.length && hidden > 0) {
      notice =
        '<button class="notice" data-toggle-all>' +
        (state.showAll
          ? '正在显示全部，含 ' + hidden + ' 个词典未收录的'
          : '已隐藏 ' + hidden + ' 个词典未收录的词') +
        '</button>';
    }

    let body = '';

    if (state.words.length || state.reading.sentences.length) {
      const wordCount = state.words.length;
      const paraCount = state.paragraphs.length;
      body +=
        '<div class="cat-status">' +
          catSvg('happy') +
          '<div class="cat-status-text"><b>' + wordCount + '</b> 个词 · <b>' + paraCount + '</b> 段' +
            '<span>点词查词，点句听音</span>' +
          '</div>' +
        '</div>';

      if (state.photo && state.showPhoto) {
        body +=
          '<button class="photo-card" data-photo aria-label="查看原图">' +
            '<img src="' + state.photo + '" alt="原图">' +
            '<span class="photo-caption">原图 · 点开看大图</span>' +
          '</button>';
      }
      body += scanToolbar();

      if (state.viewMode === 'reading') {
        body +=
          '<div class="list" style="padding:0">' + readingMarkup() + '</div>' +
          '<div class="footer">' +
            '<button class="wide" data-read-all>' +
              (speakingAll ? ICONS.stop + '停止' : ICONS.speaker + '朗读全文') +
            '</button>' +
            '<button class="speed-btn" data-rate aria-label="语速">' + rateLabel() + '</button>' +
            '<button class="square" data-clear aria-label="清空">' + ICONS.trash + '</button>' +
          '</div>';
      } else {
        body +=
          (state.layout === 'grid' ? gridMarkup(words) : '<div class="list">' + listMarkup(words, true) + '</div>') +
          '<div class="footer">' +
            '<button class="wide" data-speak-all>' +
              (speakingAll ? ICONS.stop + '停止' : ICONS.speaker + '全部朗读') +
            '</button>' +
            '<button class="square" data-clear aria-label="清空">' + ICONS.trash + '</button>' +
          '</div>';
      }
    } else {
      body =
        '<div class="empty-state cat-empty">' +
          catSvg('idle') +
          '<div class="title">拍下书页，我来帮你理</div>' +
          '<div class="hint">单词视图点一下就念；段落视图可以逐句听、整段听、离线翻译</div>' +
        '</div>';
    }

    return (
      '<header class="head">' +
        '<h1>单词视界</h1>' +
        '<p>拍一页，读懂一整页</p>' +
        '<div class="head-actions">' +
          '<button class="icon-btn" data-theme-toggle>' + (resolvedTheme() === 'dark' ? ICONS.sun : ICONS.moon) + '</button>' +
          '<button class="icon-btn" data-settings>' + ICONS.gear + '</button>' +
          '<button class="icon-btn" data-about>' + ICONS.info + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="actions">' +
        '<label class="big-btn primary">' + ICONS.camera + '拍照<input type="file" accept="image/*" capture="environment" data-input hidden></label>' +
        '<label class="big-btn">' + ICONS.image + '相册<input type="file" accept="image/*" data-input hidden></label>' +
      '</div>' +
      notice +
      (state.message ? '<div class="message">' + esc(state.message) + '</div>' : '') +
      body
    );
  }

  function starredScreen() {
    if (!store.starred.length) {
      return (
        '<header class="head"><h1>生词本</h1><p>不会的词点颗星，就存在这里</p></header>' +
        '<div class="empty-state"><div class="icon">⭐</div><div class="title">还没有星标单词</div>' +
        '<div class="hint">在扫描结果里点每行右边的那颗星，就会收进这里</div></div>'
      );
    }

    const groups = starredGroups();
    let html = '<header class="head"><h1>生词本</h1><p>共 ' + store.starred.length + ' 个词</p></header><div class="list">';

    for (const [day, items] of groups) {
      html += '<div class="group-title">' + dayLabel(day) + ' <span>' + items.length + '</span></div>';
      html += '<div class="card">';
      for (const item of items) {
        html += wordRowMarkup(item.word, null);
      }
      html += '</div>';
    }

    html += '</div>';
    html +=
      '<div class="footer">' +
        '<button class="wide" data-speak-all>' +
          (speakingAll ? ICONS.stop + '停止' : ICONS.speaker + '全部朗读') +
        '</button>' +
      '</div>';

    return html;
  }

  function historyScreen() {
    if (!store.history.length) {
      return (
        '<header class="head"><h1>历史</h1><p>识别过的每一次都留在这里</p></header>' +
        '<div class="empty-state"><div class="icon">🕘</div><div class="title">还没有查词记录</div>' +
        '<div class="hint">每次拍照或选图识别，都会自动存一条</div></div>'
      );
    }

    let html =
      '<header class="head"><h1>历史</h1>' +
      '<p>共 ' + store.history.length + ' 次识别 <button class="link" data-clear-history>清空</button></p></header>' +
      '<div class="list">';

    for (const entry of store.history) {
      const words = usefulWords(entry);
      const preview = words.slice(0, 4).join(' · ');
      html +=
        '<button class="history-row" data-history="' + entry.id + '">' +
          (entry.thumb ? '<img class="thumb" src="' + entry.thumb + '" alt="">' : '<div class="thumb placeholder">🖼</div>') +
          '<div class="history-info">' +
            '<div class="history-time">' + dayLabel(entry.scannedAt) + ' <span>' + timeLabel(entry.scannedAt) + '</span></div>' +
            '<div class="history-preview">' + words.length + ' 个词 · ' + esc(preview) + '</div>' +
          '</div>' +
        '</button>';
    }

    html += '</div>';
    return html;
  }

  function historyDetailScreen() {
    const entry = state.historyDetail;
    const words = usefulWords(entry);

    return (
      '<header class="head detail-head">' +
        '<button class="back" data-back aria-label="返回">' + ICONS.chevron + '</button>' +
        '<h1 class="small">' + dayLabel(entry.scannedAt) + ' ' + timeLabel(entry.scannedAt) + '</h1>' +
      '</header>' +
      '<div class="list">' + listMarkup(words, true) + '</div>' +
      '<div class="footer">' +
        '<button class="wide" data-speak-all>' +
          (speakingAll ? ICONS.stop + '停止' : ICONS.speaker + '全部朗读') +
        '</button>' +
      '</div>'
    );
  }

  function libraryScreen() {
    if (!Dictionary.isLoaded()) {
      return (
        '<div class="empty-state"><div class="spinner"></div>' +
        '<div class="title">正在加载词库…</div></div>'
      );
    }

    const counts = Dictionary.countByTag();

    function starredIn(code) {
      let n = 0;
      for (const item of store.starred) {
        const tag = Dictionary.lookup(item.word).tag || '';
        if (tag.split(' ').indexOf(code) >= 0) n++;
      }
      return n;
    }

    let html =
      '<header class="head"><h1>词库</h1><p>' +
      (state.wordbook === 'all'
        ? '当前全部词，扫描时不作标记'
        : '当前「' + bookName(state.wordbook) + '」，扫描时会标出属于它的词') +
      '</p></header><div class="list">';

    html +=
      '<div class="card">' +
        '<button class="book-row' + (state.wordbook === 'all' ? ' on' : '') + '" data-book="all">' +
          '<span class="book-name">全部词</span>' +
          '<span class="book-count">' + Dictionary.total() + ' 词</span>' +
        '</button>' +
      '</div>';

    ['中学', '四六级', '考研', '出国'].forEach(function (group) {
      html += '<div class="group-title">' + group + '</div><div class="card">';

      BOOKS.filter(function (b) { return b.group === group; }).forEach(function (book) {
        const count = counts[book.code] || 0;
        const starred = starredIn(book.code);
        html +=
          '<button class="book-row' + (state.wordbook === book.code ? ' on' : '') + '" data-book="' + book.code + '">' +
            '<span class="book-name">' + book.name + '</span>' +
            '<span class="book-count">' + count + ' 词' + (starred ? ' · 已收藏 ' + starred : '') + '</span>' +
          '</button>';
      });

      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function tabsMarkup() {
    const tabs = [
      ['scan', '扫描', ICONS.scan],
      ['library', '词库', ICONS.book],
      ['starred', '生词本', ICONS.star],
      ['history', '历史', ICONS.clock]
    ];
    return tabs
      .map(function (item) {
        const key = item[0];
        return (
          '<button class="tab' + (state.tab === key ? ' active' : '') + '" data-tab="' + key + '">' +
            item[2] + '<span>' + item[1] + '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function renderProgress() {
    const bar = document.querySelector('.progress-fill');
    if (bar) {
      const value = state.overlay && typeof state.overlay.progress === 'number'
        ? state.overlay.progress
        : state.progress;
      bar.style.width = Math.round(value * 100) + '%';
    }
    const label = document.querySelector('.progress-label');
    if (label) label.textContent = state.overlay ? state.overlay.hint : state.progressLabel || '正在识别…';
  }

  function render() {
    let html;
    if (state.historyDetail) html = historyDetailScreen();
    else if (state.tab === 'library') html = libraryScreen();
    else if (state.tab === 'starred') html = starredScreen();
    else if (state.tab === 'history') html = historyScreen();
    else html = scanScreen();

    screen.innerHTML = html;
    document.getElementById('tabs').innerHTML = tabsMarkup();

    renderOverlay();
  }

  function renderOverlay() {
    if (state.overlay) {
      overlay.hidden = false;
      const progress = typeof state.overlay.progress === 'number' ? state.overlay.progress : 0;
      overlay.innerHTML =
        '<div class="modal-backdrop"></div>' +
        '<div class="loading">' +
          catSvg(state.overlay.cat || 'scan', 'cat-loading') +
          '<div class="loading-title">' + esc(state.overlay.title || '处理中') + '</div>' +
          '<div class="progress-label">' + esc(state.overlay.hint || '') + '</div>' +
          '<div class="progress"><div class="progress-fill" style="width:' + Math.round(progress * 100) + '%"></div></div>' +
        '</div>';
      return;
    }

    if (state.settingsOpen) {
      overlay.hidden = false;
      overlay.innerHTML = settingsMarkup();
      return;
    }

    if (state.photoOpen && state.photo) {
      overlay.hidden = false;
      overlay.innerHTML =
        '<div class="photo-full" data-close-photo>' +
          '<img src="' + state.photo + '" alt="原图">' +
          '<div class="photo-close">点任意处关闭</div>' +
        '</div>';
      return;
    }

    if (state.detail) {
      overlay.hidden = false;
      overlay.innerHTML = detailMarkup(state.detail);
      return;
    }

    if (state.grammar != null) {
      overlay.hidden = false;
      overlay.innerHTML = grammarMarkup(state.grammar);
      return;
    }

    overlay.hidden = true;
    overlay.innerHTML = '';
  }

  function settingsMarkup() {
    const hasKey = AI.hasKey();

    const row = function (title, subtitle, on, attr) {
      return (
        '<div class="set-row">' +
          '<div class="set-text"><div class="set-title">' + title + '</div>' +
          (subtitle ? '<div class="set-sub">' + subtitle + '</div>' : '') +
          '</div>' +
          '<button class="switch' + (on ? ' on' : '') + '" data-' + attr + ' role="switch" aria-checked="' + on + '">' +
            '<span></span>' +
          '</button>' +
        '</div>'
      );
    };

    return (
      '<div class="modal-backdrop" data-close-detail></div>' +
      '<div class="sheet">' +
        '<div class="sheet-head"><div class="detail-word" style="font-size:24px">设置</div></div>' +

        '<div class="set-group">' +
          row('显示原图', '识别结果上方显示拍的那张照片', state.showPhoto, 'toggle-photo') +
        '</div>' +

        '<div class="set-group">' +
          row('AI 增强（DeepSeek）', '用你的 DeepSeek 账号校正识别文字、翻译整段',
              state.aiEnabled, 'toggle-ai') +
          '<div class="set-note">开启后只会把「识别出的文字」发到 DeepSeek，照片不会离开这台设备。' +
            '关掉就完全本地。</div>' +

          '<div class="set-key">' +
            '<input id="ai-key" class="key-input" type="password" autocomplete="off" ' +
              'placeholder="粘贴 DeepSeek API Key（sk-…）" value="' + esc(hasKey ? 'saved' : '') + '">' +
            '<button class="key-save" data-save-key>保存</button>' +
          '</div>' +
          '<div class="set-actions">' +
            '<button class="mini-btn" data-test-ai>测试连接</button>' +
            (state.aiTesting === 'ok' ? '<span class="set-status ok">连接正常</span>' : '') +
            (state.aiTesting === 'fail' ? '<span class="set-status fail">连接失败，检查 Key</span>' : '') +
          '</div>' +
        '</div>' +

        '<button class="close-detail" data-close-detail>关闭</button>' +
      '</div>'
    );
  }

  function detailMarkup(word) {
    const entry = Dictionary.lookup(word);
    const active = speakingWord === word;
    const starred = isStarred(word);

    let body = '';
    if (entry.empty) {
      body = '<div class="detail-section"><div class="detail-body">词典里没有收录这个词。</div></div>';
    } else {
      if (entry.meaning) body += section('中文释义', esc(entry.meaning));
      if (entry.definition) body += section('英文释义', esc(entry.definition));
      if (entry.examLabels.length)
        body +=
          '<div class="detail-section"><div class="detail-title">考试范围</div><div class="chips">' +
          entry.examLabels.map((l) => '<span class="chip">' + l + '</span>').join('') +
          '</div></div>';
      if (entry.inflectionText) body += section('词形变化', esc(entry.inflectionText));
      if (entry.collins > 0) {
        let stars = '';
        for (let i = 1; i <= 5; i++) stars += i <= entry.collins ? '★' : '☆';
        body += section('柯林斯词频', stars);
      }
    }

    return (
      '<div class="modal-backdrop" data-close-detail></div>' +
      '<div class="sheet">' +
        '<div class="sheet-head">' +
          '<div class="detail-word">' + esc(word) + '</div>' +
          (entry.phonetic ? '<div class="detail-ipa">/' + esc(entry.phonetic) + '/</div>' : '') +
          (entry.lemma ? '<div class="detail-lemma">是 ' + esc(entry.lemma) + ' 的变形，释义借用原形</div>' : '') +
          '<div class="detail-actions">' +
            '<button class="chip-btn' + (active && speakingAccent === 'UK' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="UK">' + ICONS.speaker + '英音</button>' +
            '<button class="chip-btn' + (active && speakingAccent === 'US' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="US">' + ICONS.speaker + '美音</button>' +
            '<button class="chip-btn' + (starred ? ' starred' : '') + '" data-star="' + esc(word) + '">' + starIcon(starred) + '</button>' +
          '</div>' +
        '</div>' +
        body +
        '<button class="close-detail" data-close-detail>关闭</button>' +
      '</div>'
    );
  }

  function grammarMarkup(index) {
    const sentence = state.reading.sentences[index];
    if (!sentence) return '';

    const analysis = SentenceParse.analyze(sentence.text, Dictionary.lookup);

    const structure = analysis.clauses
      .map(function (clause) {
        return (
          '<div class="clause">' +
            '<span class="clause-role">' + esc(clause.role || '主句') + '</span>' +
            '<span class="clause-text">' + esc(clause.text) + '</span>' +
          '</div>'
        );
      })
      .join('');

    const notes = analysis.points
      .map(function (point) {
        return '<div class="grammar-note"><b>' + esc(point.name) + '</b> · ' + esc(point.note) + '</div>';
      })
      .join('');

    return (
      '<div class="modal-backdrop" data-close-detail></div>' +
      '<div class="sheet">' +
        '<div class="sheet-head">' +
          '<div class="detail-word" style="font-size:19px;line-height:1.5">' +
            sentenceMarkup(sentence.text) +
          '</div>' +
        '</div>' +
        '<div class="detail-section"><div class="detail-title">结构</div>' + structure + '</div>' +
        (notes ? '<div class="detail-section"><div class="detail-title">语法点</div>' + notes + '</div>' : '') +
        '<button class="close-detail" data-close-detail>关闭</button>' +
      '</div>'
    );
  }

  function section(title, body) {
    return (
      '<div class="detail-section">' +
        '<div class="detail-title">' + title + '</div>' +
        '<div class="detail-body">' + body.replace(/\n/g, '<br>') + '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- 事件

  let longPressTimer = null;
  let longPressed = false;

  document.addEventListener('pointerdown', function (event) {
    const row = event.target.closest('.row, .tile');
    if (!row || event.target.closest('button')) return;
    longPressed = false;
    const word = row.dataset.word;
    longPressTimer = setTimeout(function () {
      longPressed = true;
      state.detail = word;
      render();
    }, 450);
  });

  ['pointerup', 'pointercancel', 'pointermove'].forEach(function (name) {
    document.addEventListener(name, function () {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
  });

  document.addEventListener('click', function (event) {
    const target = event.target;

    const speakBtn = target.closest('[data-speak]');
    if (speakBtn) {
      event.stopPropagation();
      speak(speakBtn.dataset.speak, speakBtn.dataset.accent);
      return;
    }

    const starBtn = target.closest('[data-star]');
    if (starBtn) {
      event.stopPropagation();
      toggleStar(starBtn.dataset.star, Dictionary.lookup(starBtn.dataset.star));
      return;
    }

    const playSent = target.closest('[data-play-sent]');
    if (playSent) {
      event.stopPropagation();
      const index = parseInt(playSent.dataset.playSent, 10);
      if (speakingSentence === index && window.speechSynthesis && speechSynthesis.speaking) {
        stopSpeaking();
      } else {
        speakingSentence = index;
        speakText(state.reading.sentences[index].text, null, 0.92);
      }
      render();
      return;
    }

    // 段落里的单词 → 查词
    const wordSpan = target.closest('.w');
    if (wordSpan) {
      event.stopPropagation();
      state.detail = wordSpan.dataset.w;
      render();
      return;
    }

    // 点句子其他位置 → 念这一句
    const sent = target.closest('[data-sent]');
    if (sent) {
      const index = parseInt(sent.dataset.sent, 10);
      speakingSentence = index;
      speakText(state.reading.sentences[index].text, null, 0.92);
      render();
      return;
    }

    const grammarChip = target.closest('[data-grammar]');
    if (grammarChip) {
      event.stopPropagation();
      state.grammar = parseInt(grammarChip.dataset.grammar, 10);
      render();
      return;
    }

    if (target.closest('[data-speak-all]')) {
      const words = state.historyDetail
        ? usefulWords(state.historyDetail)
        : state.tab === 'starred'
          ? store.starred.map((x) => x.word)
          : visibleWords();
      speakAll(words);
      return;
    }

    if (target.closest('[data-read-all]')) {
      speakArticle();
      return;
    }

    if (target.closest('[data-translate]')) {
      if (state.showTrans) {
        state.showTrans = false;
        render();
      } else {
        state.showTrans = true;
        render();
        translateMissing();
      }
      return;
    }

    if (target.closest('[data-rate]')) {
      const next = state.speechRate <= 0.85 ? 0.92 : state.speechRate < 1.05 ? 1.15 : 0.75;
      state.speechRate = next;
      try {
        localStorage.setItem('vl.rate', String(next));
      } catch (e) { /* 存不下就算了 */ }
      if (speakingAll) speakArticle();
      else render();
      return;
    }

    if (target.closest('[data-grammar-toggle]')) {
      state.showGrammar = !state.showGrammar;
      render();
      return;
    }

    if (target.closest('[data-layout]')) {
      state.layout = state.layout === 'list' ? 'grid' : 'list';
      try {
        localStorage.setItem('vl.layout', state.layout);
      } catch (e) { /* 存不下就算了 */ }
      render();
      return;
    }

    if (target.closest('[data-theme-toggle]')) {
      toggleTheme();
      return;
    }

    if (target.closest('[data-clear]')) {
      stopSpeaking();
      state.words = [];
      state.paragraphs = [];
      state.photo = null;
      state.photoOpen = false;
      state.reading = { sentences: [], layout: [] };
      state.transZh = {};
      state.message = null;
      render();
      return;
    }

    if (target.closest('[data-toggle-all]')) {
      state.showAll = !state.showAll;
      render();
      return;
    }

    const modeBtn = target.closest('[data-mode]');
    if (modeBtn) {
      state.viewMode = modeBtn.dataset.mode;
      render();
      return;
    }

    if (target.closest('[data-tab]')) {
      state.tab = target.closest('[data-tab]').dataset.tab;
      state.historyDetail = null;
      render();
      return;
    }

    const bookBtn = target.closest('[data-book]');
    if (bookBtn) {
      state.wordbook = bookBtn.dataset.book;
      try {
        localStorage.setItem('vl.wordbook', state.wordbook);
      } catch (e) { /* 存不下就算了 */ }
      render();
      return;
    }

    if (target.closest('[data-history]')) {
      const id = target.closest('[data-history]').dataset.history;
      state.historyDetail = store.history.find((x) => x.id === id) || null;
      render();
      return;
    }

    if (target.closest('[data-clear-history]')) {
      store.history = [];
      saveJSON('vl.history', store.history);
      render();
      return;
    }

    if (target.closest('[data-back]')) {
      state.historyDetail = null;
      render();
      return;
    }

    if (target.closest('[data-settings]')) {
      state.settingsOpen = true;
      state.aiTesting = null;
      render();
      return;
    }

    if (target.closest('[data-toggle-photo]')) {
      state.showPhoto = !state.showPhoto;
      try { localStorage.setItem('vl.showPhoto', state.showPhoto ? '1' : '0'); } catch (e) {}
      render();
      return;
    }

    if (target.closest('[data-toggle-ai]')) {
      state.aiEnabled = !state.aiEnabled;
      try { localStorage.setItem('vl.ai', state.aiEnabled ? '1' : '0'); } catch (e) {}
      render();
      return;
    }

    if (target.closest('[data-save-key]')) {
      const input = document.getElementById('ai-key');
      const value = input ? input.value.trim() : '';
      if (value && value !== 'saved') {
        try { localStorage.setItem('vl.aiKey', value); } catch (e) {}
      }
      state.aiTesting = null;
      render();
      return;
    }

    if (target.closest('[data-test-ai]')) {
      state.aiTesting = 'testing';
      render();
      AI.test()
        .then(function () {
          state.aiTesting = 'ok';
          render();
        })
        .catch(function () {
          state.aiTesting = 'fail';
          render();
        });
      return;
    }

    if (target.closest('[data-photo]')) {
      state.photoOpen = true;
      render();
      return;
    }

    if (target.closest('[data-close-photo]')) {
      state.photoOpen = false;
      render();
      return;
    }

    if (target.closest('[data-close-detail]')) {
      state.detail = null;
      state.grammar = null;
      render();
      return;
    }

    if (target.closest('[data-retry-dict]')) {
      loadDictionary();
      return;
    }

    if (target.closest('[data-about]')) {
      showAbout();
      return;
    }

    const row = target.closest('.row, .tile');
    if (row) {
      if (longPressed) {
        longPressed = false;
        return;
      }
      speak(row.dataset.word, null);
    }
  });

  document.addEventListener('change', function (event) {
    const input = event.target.closest('[data-input]');
    if (input && input.files && input.files[0]) {
      handleFile(input.files[0]);
      input.value = '';
    }
  });

  function showAbout() {
    state.detail = null;
    state.grammar = null;
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="modal-backdrop" data-close-detail></div>' +
      '<div class="sheet">' +
        '<div class="sheet-head"><div class="detail-word">关于</div>' +
        '<div class="detail-lemma">单词视界 · 网页版 1.1</div></div>' +
        section('隐私', '识别和翻译都在这台设备上完成，照片和文字都不上传。\n生词本和历史存在本机浏览器里。') +
        section('识别', '用 PaddleOCR PP-OCRv4 在浏览器里本地识别，首次需要下载约 39 MB 的模型。') +
        section('翻译', '离线 OPUS-MT 英译中模型，约 107 MB，第一次点「翻译」时才下载，之后不联网也能用。') +
        section('词典', '53513 词条，来自开源项目 ECDICT（MIT 许可证）。') +
        '<button class="close-detail" data-close-detail>关闭</button>' +
      '</div>';
  }

  // ---------------------------------------------------------------- 启动

  async function loadDictionary() {
    state.dictError = null;
    render();
    try {
      await Dictionary.load('dictionary.tsv');
    } catch (error) {
      state.dictError = (error && error.message) || String(error);
    }
    render();
  }

  window.addEventListener('load', async function () {
    applyTheme();
    render();
    await loadDictionary();

    // 词典好了就趁空闲把识别引擎先下下来；开了省流量就算了
    const connection = navigator.connection || {};
    const saveData = connection.saveData === true;
    if (!saveData && !assetsReady) {
      const start = function () {
        prefetchAssets().catch(function () {});
      };
      if (window.requestIdleCallback) window.requestIdleCallback(start, { timeout: 3000 });
      else setTimeout(start, 2000);
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  });

  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = function () {
      if (state.theme === 'auto') {
        applyTheme();
        render();
      }
    };
    if (media.addEventListener) media.addEventListener('change', onChange);
  }

  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = function () {};
  }

  // ---------------------------------------------------------------- 自检

  if (location.hash === '#selftest') {
    window.addEventListener('load', function () {
      setTimeout(runSelfTest, 600);
    });
  }

  async function runSelfTest() {
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 46px Helvetica';

    ['dash', 'race', 'marathon', 'walk', 'gymnastics', 'parallel'].forEach(function (w, i) {
      ctx.fillText(w, 80, 120 + i * 130);
    });
    ['throwing', 'discus', 'hammer', 'javelin', 'horizontal', 'weight'].forEach(function (w, i) {
      ctx.fillText(w, 780, 120 + i * 130);
    });

    const blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, 'image/png');
    });

    await handleFile(new File([blob], 'selftest.png', { type: 'image/png' }));

    const result = document.createElement('div');
    result.id = 'selftest-result';
    result.textContent = state.words.join(',');
    document.body.appendChild(result);
    document.title = 'SELFTEST_DONE';
  }
})();

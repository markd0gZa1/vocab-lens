(function () {
  'use strict';

  // ---------------------------------------------------------------- 状态

  const state = {
    tab: 'scan',
    words: [],
    showAll: false,
    busy: false,
    progress: 0,
    message: null,
    detail: null,
    historyDetail: null,
    dictReady: false
  };

  const store = {
    starred: loadJSON('vl.starred', []),
    history: loadJSON('vl.history', [])
  };

  let ocrWorker = null;
  let lastAccent = 'US';
  let speakingWord = null;
  let speakingAccent = null;
  let speakingAll = false;

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
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
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

  function speakAll(words) {
    if (!window.speechSynthesis || !words.length) return;
    if (speakingAll) {
      stopSpeaking();
      return;
    }

    speechSynthesis.cancel();
    speakingAll = true;
    speakingWord = null;

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

  function stopSpeaking() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    speakingAll = false;
    speakingWord = null;
    speakingAccent = null;
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

  // ---------------------------------------------------------------- 识别

  function ensureWorker() {
    if (ocrWorker) return Promise.resolve(ocrWorker);
    return Tesseract.createWorker('eng', 1, {
      workerPath: 'vendor/worker.min.js',
      langPath: 'vendor',
      corePath: 'vendor',
      logger: function (message) {
        if (message.status === 'recognizing text') {
          state.progress = message.progress || 0;
          renderProgress();
        }
      }
    }).then(function (worker) {
      ocrWorker = worker;
      return worker;
    });
  }

  async function handleFile(file) {
    if (!file) return;
    state.busy = true;
    state.progress = 0;
    state.message = null;
    render();

    try {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1600;
      const ratio = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * ratio));
      const height = Math.max(1, Math.round(bitmap.height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      if (bitmap.close) bitmap.close();

      const worker = await ensureWorker();
      const result = await worker.recognize(canvas, {}, { blocks: true, text: true });

      const items = [];
      let id = 0;
      const blocks = result.data.blocks || [];
      for (const block of blocks) {
        for (const para of block.paragraphs || []) {
          for (const line of para.lines || []) {
            for (const word of line.words || []) {
              const text = (word.text || '').trim();
              if (!text) continue;
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

      const candidates = ReadingOrder.words(items, function (w) {
        return Dictionary.contains(w);
      });
      const known = candidates.filter(function (w) {
        return Dictionary.contains(w);
      });
      const found = known.length ? known : candidates;

      state.words = found;
      state.showAll = false;

      if (!found.length) {
        state.message = '没找到英文单词。试试把书页拍正、拍满一点。';
      } else {
        addHistory(found, makeThumb(canvas));
      }
    } catch (error) {
      state.message = '识别出错了：' + (error && error.message ? error.message : error);
    } finally {
      state.busy = false;
      render();
    }
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

  // ---------------------------------------------------------------- 渲染

  const screen = document.getElementById('screen');
  const overlay = document.getElementById('overlay');

  function visibleWords() {
    if (state.showAll) return state.words;
    const filtered = state.words.filter((w) => !Dictionary.lookup(w).empty);
    return filtered.length ? filtered : state.words;
  }

  function hiddenCount() {
    return state.words.filter((w) => Dictionary.lookup(w).empty).length;
  }

  function wordRowMarkup(word, index) {
    const entry = Dictionary.lookup(word);
    const starred = isStarred(word);

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
          '<div class="word">' + esc(word) + '</div>' +
          subline +
        '</div>' +
        '<button class="star' + (starred ? ' on' : '') + '" data-star="' + esc(word) + '" aria-label="收藏">★</button>' +
        '<div class="pill">' +
          '<button class="accent-btn' + (active && speakingAccent === 'UK' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="UK">英音</button>' +
          '<span class="divider"></span>' +
          '<button class="accent-btn' + (active && speakingAccent === 'US' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="US">美音</button>' +
        '</div>' +
      '</div>'
    );
  }

  function listMarkup(words, withIndex) {
    const rows = words.map((w, i) => wordRowMarkup(w, withIndex ? i : null));
    return '<div class="card">' + rows.join('') + '</div>';
  }

  function scanScreen() {
    if (!Dictionary.isLoaded()) {
      return '<div class="empty-state"><div class="icon">📖</div><div>正在加载词典…</div></div>';
    }

    const words = visibleWords();
    const hidden = hiddenCount();

    let notice = '';
    if (state.words.length && hidden > 0) {
      notice =
        '<button class="notice" data-toggle-all>' +
        (state.showAll ? '正在显示全部，含 ' + hidden + ' 个词典未收录的'
                       : '已隐藏 ' + hidden + ' 个词典未收录的词') +
        '</button>';
    }

    let body;
    if (!words.length) {
      body =
        '<div class="empty-state">' +
          '<div class="icon">📄</div>' +
          '<div class="title">拍下书页，英文单词会按顺序列出</div>' +
          '<div class="hint">点单词听发音，点「英音/美音」选口音，长按看完整释义</div>' +
        '</div>';
    } else {
      body =
        '<div class="list">' + listMarkup(words, true) + '</div>' +
        '<div class="footer">' +
          '<button class="wide" data-speak-all>' + (speakingAll ? '■ 停止' : '▶ 全部朗读') + '</button>' +
          '<button class="square" data-clear>🗑</button>' +
        '</div>';
    }

    return (
      '<header class="head">' +
        '<h1>单词镜头</h1>' +
        '<p>拍一页，点一下就念给你听</p>' +
        '<button class="about-btn" data-about>ⓘ</button>' +
      '</header>' +
      '<div class="actions">' +
        '<label class="big-btn">拍照<input type="file" accept="image/*" capture="environment" data-input hidden></label>' +
        '<label class="big-btn">相册<input type="file" accept="image/*" data-input hidden></label>' +
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
        '<button class="wide" data-speak-all>' + (speakingAll ? '■ 停止' : '▶ 全部朗读') + '</button>' +
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
        '<button class="back" data-back>‹</button>' +
        '<h1 class="small">' + dayLabel(entry.scannedAt) + ' ' + timeLabel(entry.scannedAt) + '</h1>' +
      '</header>' +
      '<div class="list">' + listMarkup(words, true) + '</div>' +
      '<div class="footer">' +
        '<button class="wide" data-speak-all>' + (speakingAll ? '■ 停止' : '▶ 全部朗读') + '</button>' +
      '</div>'
    );
  }

  function tabsMarkup() {
    const tabs = [
      ['scan', '扫描'],
      ['starred', '生词本'],
      ['history', '历史']
    ];
    return tabs
      .map(
        ([key, label]) =>
          '<button class="tab' + (state.tab === key ? ' active' : '') + '" data-tab="' + key + '">' + label + '</button>'
      )
      .join('');
  }

  function renderProgress() {
    const bar = document.querySelector('.progress-fill');
    if (bar) bar.style.width = Math.round(state.progress * 100) + '%';
  }

  function render() {
    let html;
    if (state.historyDetail) html = historyDetailScreen();
    else if (state.tab === 'starred') html = starredScreen();
    else if (state.tab === 'history') html = historyScreen();
    else html = scanScreen();

    screen.innerHTML = html;
    document.getElementById('tabs').innerHTML = tabsMarkup();

    if (state.busy) {
      overlay.hidden = false;
      overlay.innerHTML =
        '<div class="modal-backdrop"></div>' +
        '<div class="loading">' +
          '<div class="spinner"></div>' +
          '<div>正在识别…</div>' +
          '<div class="progress"><div class="progress-fill" style="width:' + Math.round(state.progress * 100) + '%"></div></div>' +
        '</div>';
    } else if (state.detail) {
      overlay.hidden = false;
      overlay.innerHTML = detailMarkup(state.detail);
    } else {
      overlay.hidden = true;
      overlay.innerHTML = '';
    }
  }

  function detailMarkup(word) {
    const entry = Dictionary.lookup(word);
    const active = speakingWord === word;

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
          (entry.lemma ? '<div class="detail-lemma">是 ' + esc(entry.lemma) + ' 的变形，释义和音标借用原形</div>' : '') +
          '<div class="detail-actions">' +
            '<button class="chip-btn' + (active && speakingAccent === 'UK' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="UK">🔊 英音</button>' +
            '<button class="chip-btn' + (active && speakingAccent === 'US' ? ' active' : '') + '" data-speak="' + esc(word) + '" data-accent="US">🔊 美音</button>' +
            '<button class="chip-btn' + (isStarred(word) ? ' starred' : '') + '" data-star="' + esc(word) + '">★</button>' +
          '</div>' +
        '</div>' +
        body +
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
    const row = event.target.closest('.row');
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

    if (target.closest('[data-speak-all]')) {
      const words = state.historyDetail
        ? usefulWords(state.historyDetail)
        : state.tab === 'starred'
          ? store.starred.map((x) => x.word)
          : visibleWords();
      speakAll(words);
      return;
    }

    if (target.closest('[data-clear]')) {
      stopSpeaking();
      state.words = [];
      state.message = null;
      render();
      return;
    }

    if (target.closest('[data-toggle-all]')) {
      state.showAll = !state.showAll;
      render();
      return;
    }

    if (target.closest('[data-tab]')) {
      state.tab = target.closest('[data-tab]').dataset.tab;
      state.historyDetail = null;
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

    if (target.closest('[data-close-detail]')) {
      state.detail = null;
      render();
      return;
    }

    if (target.closest('[data-about]')) {
      state.detail = null;
      showAbout();
      return;
    }

    const row = target.closest('.row');
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
    overlay.hidden = false;
    overlay.innerHTML =
      '<div class="modal-backdrop" data-close-detail></div>' +
      '<div class="sheet">' +
        '<div class="sheet-head"><div class="detail-word">关于</div>' +
        '<div class="detail-lemma">单词镜头 · 网页版 1.0</div></div>' +
        section('隐私', '不联网做识别。照片只在这台设备的浏览器里处理，不上传。\n生词本和历史存在本机浏览器里。') +
        section('识别', '用 Tesseract.js 在浏览器里本地识别。比原生 App 慢，准确率也低一些，好处是不用安装、不用审核。') +
        section('词典', '53513 词条，来自开源项目 ECDICT（MIT 许可证）。') +
        '<button class="close-detail" data-close-detail>关闭</button>' +
      '</div>';
  }

  // ---------------------------------------------------------------- 启动

  window.addEventListener('load', async function () {
    render();

    try {
      await Dictionary.load('dictionary.tsv');
    } catch (error) {
      state.message = '词典加载失败：' + error.message;
    }
    render();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
  });

  if (window.speechSynthesis) {
    speechSynthesis.onvoiceschanged = function () {};
  }

  // ---------------------------------------------------------------- 自检（只在地址栏带 #selftest 时跑）

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

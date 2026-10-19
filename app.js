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

  const state = {
    tab: 'scan',
    words: [],
    article: '',
    viewMode: 'words',
    expandedSentence: null,
    showAll: false,
    busy: false,
    progress: 0,
    progressLabel: null,
    message: null,
    detail: null,
    historyDetail: null,
    dictReady: false,
    dictError: null,
    wordbook: savedWordbook()
  };

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

  // ---------------------------------------------------------------- 识别参数（可以用 ?psm=11&bin=0 之类临时覆盖，便于调试）

  const query = new URLSearchParams(location.search);
  const CFG = {
    // paddle = PP-OCRv4 视觉模型（准，体积大）；tesseract = 老方案（轻，效果差）
    engine: query.get('engine') || 'paddle',
    psm: query.get('psm') || '11',
    whitelist: query.get('wl') !== '0',
    // 实测：书页照片上二值化会把细笔画吃掉，反而更差
    binarize: query.get('bin') === '1',
    minConfidence: parseInt(query.get('conf') || '0', 10),
    maxSide: parseInt(query.get('side') || '2000', 10),
    minSide: parseInt(query.get('minside') || '1200', 10)
  };

  // ---------------------------------------------------------------- PP-OCRv4（视觉模型）

  let paddleEngine = null;
  let assetsReady = false;

  const PADDLE_ASSETS = [
    'vendor/guten-ocr.mjs',
    'vendor/ort/ort-wasm-simd-threaded.wasm',
    'vendor/ort/ort-wasm-simd-threaded.mjs',
    'vendor/ocr/ch_PP-OCRv4_det_infer.onnx',
    'vendor/ocr/ch_PP-OCRv4_rec_infer.onnx',
    'vendor/ocr/ppocr_keys_v1.txt'
  ];

  /** 把识别引擎的静态文件先下载下来，顺便报告真实进度（第一次大约 39 MB） */
  async function prefetchAssets() {
    if (assetsReady) return;

    // 先问一下每个文件多大
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

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = function () { reject(new Error('加载失败：' + src)); };
      document.head.appendChild(script);
    });
  }

  async function ensurePaddle() {
    if (paddleEngine) return paddleEngine;
    if (!window.GutenOcr) {
      await prefetchAssets();
      await import('./vendor/guten-ocr.mjs');
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

    // 一列里几乎没有墨迹 → 空白
    const limit = samples * 0.012;
    const from = Math.floor(width * 0.3);
    const to = Math.floor(width * 0.7);

    // 找「墨迹最少」的那条竖线（插图可能跨过中缝，所以用相对比较而不是绝对阈值）
    const windowWidth = Math.max(2, Math.round(width * 0.006));
    let totalInk = 0;
    for (let x = from; x < to; x++) totalInk += ink[x];
    const meanInk = totalInk / Math.max(1, to - from);

    // 先找一段连续的低墨迹区域（相对阈值，比绝对阈值稳）
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

    // 空白带有好几段时，取最靠近页面中线的那条（分栏缝通常在中线附近）
    let central = null;
    for (const run of runs) {
      if (run.width < width * 0.015) continue;
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

    // 退而求其次：找「最少墨迹」的那条竖线
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

    // 这条线明显比平均干净才算数
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

  /** 用视觉模型识别，返回「一行一行」的文本块 */
  async function recognizeWithPaddle(canvas) {
    const gap = findColumnGap(canvas);
    window.__debug = { gap: gap, width: canvas.width };

    if (gap && gap > canvas.width * 0.28 && gap < canvas.width * 0.78) {
      // 两栏：分别识别，左栏在前，右栏在后
      const leftCanvas = cropCanvas(canvas, 0, gap);
      const rightCanvas = cropCanvas(canvas, gap, canvas.width);

      const leftItems = await detectOn(leftCanvas, 0, canvas.width);
      const rightItems = await detectOn(rightCanvas, gap, canvas.width);
      window.__debug.left = leftItems.length;
      window.__debug.right = rightItems.length;

      // 保险：如果切完一侧几乎是空的，说明这不是两栏页，退回整图
      if (leftItems.length >= 3 && rightItems.length >= 3) {
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

  /** `offset` 是这块画布在整张图里的起始 x（像素） */
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
    }).then(async function (worker) {
      await worker.setParameters({
        tessedit_pageseg_mode: CFG.psm,
        tessedit_char_whitelist: CFG.whitelist
          ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'-"
          : '',
        preserve_interword_spaces: '1'
      });
      ocrWorker = worker;
      return worker;
    });
  }

  /** Otsu 自动阈值：先转灰度，再按直方图找最佳黑白分界 */
  function binarize(canvas) {
    const context = canvas.getContext('2d');
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = image.data;

    const histogram = new Uint32Array(256);
    for (let i = 0; i < data.length; i += 4) {
      const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      data[i] = data[i + 1] = data[i + 2] = gray;
      histogram[gray]++;
    }

    const total = canvas.width * canvas.height;
    let sum = 0;
    for (let t = 0; t < 256; t++) sum += t * histogram[t];

    let sumB = 0;
    let weightB = 0;
    let best = 0;
    let threshold = 128;

    for (let t = 0; t < 256; t++) {
      weightB += histogram[t];
      if (weightB === 0) continue;
      const weightF = total - weightB;
      if (weightF === 0) break;

      sumB += t * histogram[t];
      const meanB = sumB / weightB;
      const meanF = (sum - sumB) / weightF;
      const between = weightB * weightF * (meanB - meanF) * (meanB - meanF);

      if (between > best) {
        best = between;
        threshold = t;
      }
    }

    for (let i = 0; i < data.length; i += 4) {
      const value = data[i] > threshold ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = value;
      data[i + 3] = 255;
    }

    context.putImageData(image, 0, 0);
  }

  /** 把一个粘在一起的串按词典切回单词，比如 peoplewho → people who。
   *  用动态规划：认识的分段不扣分，不认识的分段重罚，这样整体最优。 */
  function splitStuck(token) {
    const n = token.length;
    const best = new Array(n + 1).fill(null);
    best[0] = { cost: 0, parts: [] };

    for (let i = 0; i < n; i++) {
      if (!best[i]) continue;

      for (let length = Math.min(20, n - i); length >= 1; length--) {
        const piece = token.substr(i, length);
        const known = length >= 2 && Dictionary.contains(piece);
        const cost = known ? 0 : 60 * length;
        const total = best[i].cost + cost;

        if (!best[i + length] || total < best[i + length].cost) {
          best[i + length] = { cost: total, parts: best[i].parts.concat([piece]) };
        }
      }
    }

    return best[n] ? best[n].parts : [token];
  }

  /** OCR 有时会把单词粘在一起，这里按词典补回空格 */
  function respace(text) {
    return text
      .split(/\s+/)
      .map(function (token) {
        const clean = token.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
        if (clean.length < 6) return token;
        if (Dictionary.contains(clean)) return token;

        const parts = splitStuck(clean);
        if (parts.length < 2) return token;

        const prefix = token.match(/^[^A-Za-z]*/)[0];
        const suffix = token.match(/[^A-Za-z]*$/)[0];
        return prefix + parts.join(' ') + suffix;
      })
      .join(' ');
  }

  async function handleFile(file) {
    if (!file) return;
    state.busy = true;
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

      // 按阅读顺序拼出全文，给长难句拆解用；顺手把粘在一起的单词补回空格
      const ordered = ReadingOrder.ordered(items);
      state.article = ordered.map(function (item) { return respace(item.text); }).join('\n');
      state.viewMode = 'words';
      state.expandedSentence = null;
      const known = candidates.filter(function (w) {
        return Dictionary.isVocabWord(w);
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
    const filtered = state.words.filter((w) => Dictionary.isVocabWord(w));
    return filtered.length ? filtered : state.words;
  }

  function hiddenCount() {
    return state.words.filter((w) => !Dictionary.isVocabWord(w)).length;
  }

  function wordRowMarkup(word, index) {
    const entry = Dictionary.lookup(word);
    const starred = isStarred(word);

    const tag = entry.tag || '';
    const inBook =
      state.wordbook !== 'all' && tag.split(' ').indexOf(state.wordbook) >= 0;
    const badge = inBook
      ? ' <span class="badge">' + bookName(state.wordbook) + '</span>'
      : '';

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

  /** 句子视图：逐句拆解 */
  function sentencesMarkup() {
    const sentences = SentenceParse.splitSentences(state.article);

    if (!sentences.length) {
      return '<div class="empty-state"><div class="title">这一页没有可切分的句子</div></div>';
    }

    return (
      '<div class="list">' +
      sentences
        .map(function (sentence, index) {
          const analysis = SentenceParse.analyze(sentence, Dictionary.lookup);
          const expanded = state.expandedSentence === index;

          const chips = analysis.points
            .map(function (point) {
              return '<span class="g-chip">' + esc(point.name) + '</span>';
            })
            .join('');

          let detail = '';
          if (expanded) {
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
                return '<div class="grammar-note">· ' + esc(point.note) + '</div>';
              })
              .join('');

            detail =
              '<div class="sentence-detail">' +
              '<div class="detail-title">结构</div>' +
              structure +
              (notes ? '<div class="detail-title">语法点</div>' + notes : '') +
              '<div class="web-note">网页版暂不支持翻译：浏览器不允许网页调用 http 接口</div>' +
              '</div>';
          }

          return (
            '<div class="sentence-card' + (expanded ? ' open' : '') + '" data-sentence="' + index + '">' +
            '<div class="sentence-text">' + esc(sentence) + '</div>' +
            (chips ? '<div class="g-chips">' + chips + '</div>' : '') +
            detail +
            '</div>'
          );
        })
        .join('') +
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
          '<div class="hint">首次大约 3.5 MB，加载完就存在手机里，以后不用再等</div>' +
        '</div>'
      );
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
      const chips =
        '<div class="mode-row">' +
          '<button class="mode-chip' + (state.viewMode === 'words' ? ' on' : '') + '" data-mode="words">单词</button>' +
          '<button class="mode-chip' + (state.viewMode === 'sentences' ? ' on' : '') + '" data-mode="sentences">句子</button>' +
        '</div>';

      if (state.viewMode === 'sentences') {
        body = chips + sentencesMarkup();
      } else {
        body =
          chips +
          '<div class="list">' + listMarkup(words, true) + '</div>' +
          '<div class="footer">' +
            '<button class="wide" data-speak-all>' + (speakingAll ? '■ 停止' : '▶ 全部朗读') + '</button>' +
            '<button class="square" data-clear>🗑</button>' +
          '</div>';
      }
    }

    return (
      '<header class="head">' +
        '<h1>单词视界</h1>' +
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
            '<span class="book-count">' + count + ' 词' +
              (starred ? ' · 已收藏 ' + starred : '') +
            '</span>' +
          '</button>';
      });

      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  function tabsMarkup() {
    const tabs = [
      ['scan', '扫描'],
      ['library', '词库'],
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
    const label = document.querySelector('.progress-label');
    if (label) label.textContent = state.progressLabel || '正在识别…';
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

    if (state.busy) {
      overlay.hidden = false;
      overlay.innerHTML =
        '<div class="modal-backdrop"></div>' +
        '<div class="loading">' +
          '<div class="spinner"></div>' +
          '<div class="progress-label">' + esc(state.progressLabel || '正在识别…') + '</div>' +
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

    const modeBtn = target.closest('[data-mode]');
    if (modeBtn) {
      state.viewMode = modeBtn.dataset.mode;
      state.expandedSentence = null;
      render();
      return;
    }

    const sentenceCard = target.closest('[data-sentence]');
    if (sentenceCard) {
      const index = parseInt(sentenceCard.dataset.sentence, 10);
      state.expandedSentence = state.expandedSentence === index ? null : index;
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

    if (target.closest('[data-close-detail]')) {
      state.detail = null;
      render();
      return;
    }

    if (target.closest('[data-retry-dict]')) {
      loadDictionary();
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
        '<div class="detail-lemma">单词视界 · 网页版 1.0</div></div>' +
        section('隐私', '不联网做识别。照片只在这台设备的浏览器里处理，不上传。\n生词本和历史存在本机浏览器里。') +
        section('识别', '用 Tesseract.js 在浏览器里本地识别。比原生 App 慢，准确率也低一些，好处是不用安装、不用审核。') +
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
    render();
    await loadDictionary();

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

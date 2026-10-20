// 离线英译中：OPUS-MT（约 107 MB）跑在浏览器里，第一次用时才下载。
// 不联网翻译，不经过服务器，照片和文本都不出去。
(function (global) {
  'use strict';

  let translatorPromise = null;
  let translating = false;

  const cache = new Map(); // 原文 → 译文

  // 模型分几个文件下载，这里把各自的进度加起来算一个总进度
  const files = new Map();
  let lastReport = 0;

  function resetProgress() {
    files.clear();
    lastReport = 0;
  }

  function reportProgress(onProgress) {
    if (!onProgress) return;

    let loaded = 0;
    let total = 0;
    files.forEach(function (item) {
      loaded += item.loaded || 0;
      total += item.total || 0;
    });

    if (!total) return;

    const now = Date.now();
    // 别把界面刷爆
    if (now - lastReport < 120 && loaded < total) return;
    lastReport = now;

    onProgress({
      loaded: loaded,
      total: total,
      ratio: Math.max(0, Math.min(1, loaded / total))
    });
  }

  function ensureEngine(onProgress) {
    if (translatorPromise) return translatorPromise;

    resetProgress();

    translatorPromise = (async function () {
      // 动态加载：不点翻译就不下载这 500 KB 的引擎
      const mod = await import('./vendor/transformers/tf.bundle.js');

      return mod.pipeline('translation', 'opus-mt-en-zh', {
        dtype: 'q8',
        progress_callback: function (p) {
          if (p.status === 'progress' && p.file) {
            files.set(p.file, { loaded: p.loaded || 0, total: p.total || 0 });
            reportProgress(onProgress);
          } else if (p.status === 'done' && p.file) {
            files.set(p.file, { loaded: p.total || 0, total: p.total || 0 });
            reportProgress(onProgress);
          }
        }
      });
    })();

    translatorPromise.catch(function () {
      // 失败别把坏掉的 promise 留在那儿，下次重试还有机会
      translatorPromise = null;
    });

    return translatorPromise;
  }

  /** 翻一句（带缓存）。 */
  async function translateOne(text, onProgress) {
    const key = String(text || '').trim();
    if (!key) return '';
    if (cache.has(key)) return cache.get(key);

    const translator = await ensureEngine(onProgress);
    const result = await translator(key, { max_new_tokens: 160 });
    const out = (result && result[0] && result[0].translation_text) || '';
    cache.set(key, out);
    return out;
  }

  /** 顺序翻一批句子；onSentence(index, 译文) 每翻完一句回调一次 */
  async function translateSentences(sentences, onSentence, onProgress) {
    translating = true;
    try {
      const out = [];
      for (let i = 0; i < sentences.length; i++) {
        const zh = await translateOne(sentences[i], onProgress);
        out.push(zh);
        if (onSentence) onSentence(i, zh);
      }
      return out;
    } finally {
      translating = false;
    }
  }

  global.Translator = {
    ensureEngine: ensureEngine,
    translateOne: translateOne,
    translateSentences: translateSentences,
    isReady: function () { return !!translatorPromise && !translating; },
    isTranslating: function () { return translating; }
  };
})(window);

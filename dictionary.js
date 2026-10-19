// 本地英汉词典。数据是 dictionary.tsv，浏览器里解析，不联网。
(function (global) {
  'use strict';

  const entries = new Map();
  const lemmas = new Map();
  let loaded = false;

  const EXAM = {
    zk: '中考',
    gk: '高考',
    cet4: '四级',
    cet6: '六级',
    ky: '考研',
    toefl: '托福',
    ielts: '雅思',
    gre: 'GRE'
  };

  const INFLECTION = {
    p: '过去式',
    d: '过去分词',
    i: '现在分词',
    '3': '第三人称单数',
    s: '复数',
    r: '比较级',
    t: '最高级'
  };

  async function load(url) {
    const target = url || 'dictionary.tsv';

    // 先看缓存（上次加载时存进去的），没有再走网络。
    // 词典文件大，交给 Cache API 存，不让 Service Worker 在请求链路上复制一遍
    let text = null;

    if ('caches' in window) {
      try {
        const hit = await caches.match(target);
        if (hit) text = await hit.text();
      } catch (e) {
        /* 读缓存失败就当没有 */
      }
    }

    if (text === null) {
      const response = await fetch(target);
      if (!response.ok) throw new Error('词典加载失败 ' + response.status);
      text = await response.text();

      if ('caches' in window) {
        caches
          .open('vocab-lens-dict')
          .then((cache) =>
            cache.put(
              target,
              new Response(text, {
                headers: { 'Content-Type': 'text/tab-separated-values' }
              })
            )
          )
          .catch(function () {});
      }
    }

    let section = '';
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line) continue;
      if (line.charCodeAt(0) === 35) {
        section = line.slice(1);
        continue;
      }
      const parts = line.split('\t');
      if (section === 'lemmas') {
        if (parts.length >= 2) lemmas.set(parts[0], parts[1]);
      } else if (section === 'entries' && parts.length >= 7) {
        entries.set(parts[0], parts.slice(1, 7));
      }
    }

    loaded = true;
  }

  function normalize(word) {
    return String(word).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  }

  function contains(word) {
    const key = normalize(word);
    return entries.has(key) || lemmas.has(key);
  }

  // 真正的单词，释义里会带词性标记：n. / vt. / a. / ad. …
  // 缩写（rd、wr、Eg、EE）没有，正好用来筛掉 OCR 碎片
  const POS_RE = /(^|[；;\s])(n\.|v\.|vt\.|vi\.|a\.|ad\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|int\.|aux\.)/;

  /** 这个词值不值得显示：词典里有、不是缩写、带词性 */
  function isVocabWord(word) {
    const entry = lookup(word);
    if (entry.empty) return false;
    return POS_RE.test(entry.meaning);
  }

  function lookup(word) {
    const key = normalize(word);

    const direct = entries.get(key);
    if (direct) {
      return build(direct, null);
    }

    // 变形词退回原形查释义，但音标不借——发音不一样
    const base = lemmas.get(key);
    if (base) {
      const raw = entries.get(base);
      if (raw && raw[1]) {
        const entry = build(raw, base);
        entry.phonetic = null;
        return entry;
      }
    }

    return {
      phonetic: null, meaning: null, definition: null, tag: null,
      exchange: null, collins: 0, lemma: null,
      empty: true, examLabels: [], inflectionText: null
    };
  }

  function build(raw, lemma) {
    const meaning = raw[1] || null;
    const tag = raw[3] || '';
    const exchange = raw[4] || '';

    const examLabels = tag
      .split(' ')
      .map((code) => EXAM[code])
      .filter(Boolean);

    const inflectionText = exchange
      ? exchange
          .split('/')
          .map((chunk) => {
            const pieces = chunk.split(':');
            if (pieces.length < 2) return null;
            const label = INFLECTION[pieces[0][0]];
            return label ? label + ' ' + pieces.slice(1).join(':') : null;
          })
          .filter(Boolean)
          .join(' · ')
      : null;

    return {
      phonetic: raw[0] || null,
      meaning: meaning,
      definition: raw[2] || null,
      tag: tag || null,
      exchange: exchange || null,
      collins: parseInt(raw[5], 10) || 0,
      lemma: lemma,
      empty: !meaning,
      examLabels: examLabels,
      inflectionText: inflectionText || null
    };
  }

  global.Dictionary = {
    load: load,
    lookup: lookup,
    contains: contains,
    isVocabWord: isVocabWord,
    isLoaded: function () { return loaded; }
  };
})(window);

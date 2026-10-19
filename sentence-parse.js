// 长难句拆解：切句 → 标词性 → 找从句 → 判断语法点。
// 全部基于规则 + 本地词典，不联网。
(function (global) {
  'use strict';

  // 引导从句的词，以及它们各自的角色
  const CLAUSE_WORDS = {
    that: '引导词',
    which: '关系代词',
    who: '关系代词',
    whom: '关系代词',
    whose: '关系代词',
    when: '关系副词',
    where: '关系副词',
    why: '关系副词',
    because: '原因状语从句',
    although: '让步状语从句',
    though: '让步状语从句',
    while: '时间/让步状语从句',
    if: '条件状语从句',
    unless: '条件状语从句',
    since: '时间/原因状语从句',
    before: '时间状语从句',
    after: '时间状语从句',
    until: '时间状语从句',
    whether: '宾语从句',
    as: '状语从句'
  };

  const AUX_BE = ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'];
  const AUX_HAVE = ['have', 'has', 'had'];
  const AUX_WILL = ['will', 'would', 'shall', 'should'];

  /** 按句号问号感叹号切句，句首字母大写才算，避免切断 Mr. 之类 */
  function splitSentences(text) {
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return [];

    const out = [];
    let start = 0;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;

      const rest = cleaned.slice(i + 1).trimStart();
      if (!rest) {
        out.push(cleaned.slice(start).trim());
        start = cleaned.length;
        break;
      }

      const next = rest[0];
      if (next === next.toUpperCase() && /[A-Za-z"'“‘]/.test(next)) {
        out.push(cleaned.slice(start, i + 1).trim());
        start = i + 1;
      }
    }

    if (start < cleaned.length) {
      const tail = cleaned.slice(start).trim();
      if (tail) out.push(tail);
    }

    return out.filter((s) => /[A-Za-z]/.test(s));
  }

  /** 从词典释义里取第一个词性标记，比如 "n." "vt." "a." */
  function posOf(word, lookup) {
    const entry = lookup(word);
    if (!entry || !entry.meaning) return null;
    const match = entry.meaning.match(/(^|[；;\s])(n\.|v\.|vt\.|vi\.|a\.|ad\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|int\.|aux\.)/);
    return match ? match[2] : null;
  }

  function isVerbLike(pos) {
    return pos === 'v.' || pos === 'vt.' || pos === 'vi.';
  }

  /** 拆一句：返回词、从句分段、语法点 */
  function analyze(sentence, lookup) {
    const rawWords = sentence.match(/[A-Za-z][A-Za-z'’\-]*/g) || [];
    const words = rawWords.map((text) => {
      const pos = posOf(text, lookup);
      return { text: text, lower: text.toLowerCase(), pos: pos };
    });

    // ---- 从句分段：先按逗号切，再看每段有没有引导词 ----
    const clauses = [];

    sentence.split(/,\s*/).forEach(function (segment) {
      const segWords = segment.match(/[A-Za-z][A-Za-z'’\-]*/g) || [];
      if (!segWords.length) return;

      const leading = CLAUSE_WORDS[segWords[0].toLowerCase()];
      if (leading) {
        clauses.push({ text: segWords.join(' '), role: leading });
        return;
      }

      // 段中间出现引导词 → 前面是主句，后面是从句
      let hit = -1;
      for (let i = 1; i < segWords.length; i++) {
        if (CLAUSE_WORDS[segWords[i].toLowerCase()]) {
          hit = i;
          break;
        }
      }

      if (hit > 0) {
        clauses.push({ text: segWords.slice(0, hit).join(' '), role: null });
        clauses.push({
          text: segWords.slice(hit).join(' '),
          role: CLAUSE_WORDS[segWords[hit].toLowerCase()]
        });
      } else {
        clauses.push({ text: segWords.join(' '), role: null });
      }
    });

    // ---- 语法点 ----
    const points = [];
    const add = (code, name, note) => {
      if (!points.some((p) => p.code === code)) points.push({ code, name, note });
    };

    const lower = words.map((w) => w.lower);

    // 从句
    const clauseHits = new Set();
    words.forEach(function (w) {
      if (CLAUSE_WORDS[w.lower]) clauseHits.add(CLAUSE_WORDS[w.lower]);
    });
    if (clauseHits.has('关系代词') || clauseHits.has('关系副词')) {
      add('relative', '定语从句', '关系词后面的部分修饰它前面的名词，中文习惯把修饰语放到名词前面。');
    }
    if (clauseHits.has('条件状语从句')) {
      add('condition', '条件状语从句', 'if 引导的条件句，主句常用「will / would + 动词」。');
    }
    if (clauseHits.has('让步状语从句')) {
      add('concession', '让步状语从句', 'although / though 引导，意思是「虽然……但是……」，中文不能再用「但是」。');
    }
    if (clauseHits.has('原因状语从句') || clauseHits.has('时间/原因状语从句')) {
      add('cause', '原因状语从句', 'because / since 引导，说明主句的原因。');
    }
    if (clauseHits.has('宾语从句')) {
      add('object', '宾语从句', 'that / whether 引导的从句整体充当动词的宾语。');
    }
    if (clauseHits.has('引导词')) {
      add('that', 'that 从句', 'that 在这里只起连接作用，不充当句子成分，翻译时通常省略。');
    }

    // 被动语态：be + 过去分词
    for (let i = 0; i < lower.length - 1; i++) {
      if (AUX_BE.indexOf(lower[i]) >= 0 && /(ed|en)$/.test(lower[i + 1])) {
        add('passive', '被动语态', 'be + 过去分词，主语是动作的承受者，中文常译成「被……」或省略主语。');
        break;
      }
    }

    // 完成时：have/has/had + 过去分词
    for (let i = 0; i < lower.length - 1; i++) {
      if (AUX_HAVE.indexOf(lower[i]) >= 0 && /(ed|en)$/.test(lower[i + 1])) {
        add('perfect', '完成时', 'have / has / had + 过去分词，表示动作已经完成或持续到现在。');
        break;
      }
    }

    // 进行时：be + doing
    for (let i = 0; i < lower.length - 1; i++) {
      if (AUX_BE.indexOf(lower[i]) >= 0 && /ing$/.test(lower[i + 1])) {
        add('progressive', '进行时', 'be + 现在分词，强调动作正在进行。');
        break;
      }
    }

    // 将来 / 虚拟
    if (lower.some((w) => AUX_WILL.indexOf(w) >= 0)) {
      const hasHad = lower.some((w) => w === 'had');
      const hasWould = lower.some((w) => w === 'would');
      if (hasHad && hasWould) {
        add('subjunctive', '虚拟语气', 'if + had done, would have done：表示与过去事实相反的假设。');
      } else {
        add('future', '将来时', 'will / would + 动词原形，表示将来或过去的将来。');
      }
    }

    // 非谓语：to + 动词；句首 -ing
    for (let i = 0; i < lower.length - 1; i++) {
      if (lower[i] === 'to' && isVerbLike(words[i + 1].pos)) {
        add('infinitive', '动词不定式', 'to + 动词原形，可以作主语、宾语、定语或目的状语。');
        break;
      }
    }
    if (lower.length && /ing$/.test(lower[0]) && lower.length > 2) {
      add('gerund', '现在分词作状语', '句首的 -ing 形式常作状语，说明主句动作的时间、原因或伴随状态。');
    }

    return {
      text: sentence,
      words: words,
      clauses: clauses.map(function (c) {
        return { text: c.text, role: c.role };
      }),
      points: points
    };
  }

  global.SentenceParse = {
    splitSentences: splitSentences,
    analyze: analyze,
    posOf: posOf
  };
})(window);

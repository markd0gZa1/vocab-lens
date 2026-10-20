// 长难句拆解：切句 → 认从句 → 判类型 → 标语法点。
// 纯规则 + 本地词典，不联网。给四六级 / 考研 / 托福这个档次的阅读用。
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- 词表

  // 引导词 → 默认角色
  const CLAUSE_WORDS = {
    that: '从句引导',
    which: '定语从句',
    who: '定语从句',
    whom: '定语从句',
    whose: '定语从句',
    when: '时间状语从句',
    where: '地点状语从句',
    why: '原因状语从句',
    because: '原因状语从句',
    although: '让步状语从句',
    though: '让步状语从句',
    while: '让步/时间状语从句',
    if: '条件状语从句',
    unless: '条件状语从句',
    once: '条件状语从句',
    since: '原因/时间状语从句',
    before: '时间状语从句',
    after: '时间状语从句',
    until: '时间状语从句',
    whether: '名词性从句',
    lest: '目的状语从句'
  };

  // 这些名词后面的 that 从句常是同位语从句
  const APPOSITIVE_HEADS = [
    'fact', 'news', 'idea', 'belief', 'possibility', 'evidence', 'hope',
    'doubt', 'fear', 'proof', 'conclusion', 'suggestion', 'assumption',
    'claim', 'notion', 'view', 'opinion', 'promise', 'message', 'report'
  ];

  // 这些名词后面的 when/where/why 是定语从句
  const TIME_HEADS = ['time', 'day', 'year', 'moment', 'period', 'age', 'point', 'occasion'];
  const PLACE_HEADS = ['place', 'city', 'country', 'area', 'room', 'house', 'school', 'site', 'point'];
  const REASON_HEADS = ['reason', 'cause', 'explanation'];

  const AUX_BE = ['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being'];
  const AUX_HAVE = ['have', 'has', 'had'];
  const AUX_MODAL = ['will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might', 'must'];
  const CONJUNCTS = ['and', 'but', 'or', 'yet', 'so', 'for', 'nor', 'then'];

  const INVERT_START = [
    'never', 'seldom', 'rarely', 'hardly', 'scarcely', 'little', 'nowhere',
    'no', 'not', 'only', 'notonly'
  ];

  // 这些词既是介词又是连词（before last week / before he left），
  // 只有当后面真的跟着「主语 + 谓语」时才当成从句引导词
  const TIME_WORDS = ['before', 'after', 'since', 'until', 'while', 'when', 'where', 'why', 'once'];

  const SUBJECT_STARTERS = [
    'i', 'you', 'he', 'she', 'it', 'we', 'they', 'who', 'which', 'that',
    'this', 'these', 'those', 'the', 'a', 'an', 'his', 'her', 'their',
    'our', 'my', 'your', 'its', 'there', 'everyone', 'everybody', 'someone',
    'nobody', 'people', 'one', 'all', 'both', 'each'
  ];

  const AUX_ALL = AUX_BE.concat(AUX_HAVE, AUX_MODAL, ['do', 'does', 'did']);

  const WORD_RE = /[A-Za-z][A-Za-z'’\-]*/g;

  /** 引导词后面像不像一个完整的从句：要有主语开头，而且五词之内有谓语 */
  function looksLikeClause(words, index) {
    const next = words[index + 1];
    if (!next) return false;

    const subjectStarter =
      SUBJECT_STARTERS.indexOf(next.lower) >= 0 || isNounLike(next.pos);
    if (!subjectStarter) return false;

    const limit = Math.min(words.length, index + 6);
    for (let k = index + 1; k < limit; k++) {
      if (isVerbLike(words[k].pos) || AUX_ALL.indexOf(words[k].lower) >= 0) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- 切句

  // 常见缩写，后面跟句点不算句尾
  const ABBR = ['mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'vs', 'etc', 'e.g', 'i.e', 'no', 'fig', 'inc', 'ltd'];

  /** 按句号问号感叹号切句；缩写、小数点不切 */
  function splitSentences(text) {
    const cleaned = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return [];

    const out = [];
    let start = 0;

    for (let i = 0; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;

      // "3.5" 这种小数
      if (ch === '.' && /\d/.test(cleaned[i - 1] || '') && /\d/.test(cleaned[i + 1] || '')) continue;

      // 缩写后面
      if (ch === '.') {
        const before = cleaned.slice(Math.max(0, i - 8), i).toLowerCase();
        const tail = before.split(/[^a-z.]/).pop() || '';
        if (ABBR.indexOf(tail.replace(/\./g, '')) >= 0) continue;
        if (before.length && /^\.?[a-z]$/.test(tail)) continue; // 单个字母缩写
      }

      const rest = cleaned.slice(i + 1).trimStart();
      if (!rest) {
        out.push(cleaned.slice(start).trim());
        start = cleaned.length;
        break;
      }

      const next = rest[0];
      // 句号/问号/叹号后面跟大写字母或引号才算断句
      if (!/[A-Za-z"'“‘]/.test(next)) continue;
      if (next !== next.toUpperCase() && ch === '.') continue;

      out.push(cleaned.slice(start, i + 1).trim());
      start = i + 1;
    }

    if (start < cleaned.length) {
      const tail = cleaned.slice(start).trim();
      if (tail) out.push(tail);
    }

    return out.filter((s) => /[A-Za-z]/.test(s));
  }

  // ---------------------------------------------------------------- 词性

  /** 从词典释义里取第一个词性标记，比如 "n." "vt." "a." */
  function posOf(word, lookup) {
    const entry = lookup(word);
    if (!entry || !entry.meaning) return null;
    const match = entry.meaning.match(
      /(^|[；;\s])(n\.|v\.|vt\.|vi\.|a\.|ad\.|adj\.|adv\.|prep\.|conj\.|pron\.|num\.|int\.|aux\.)/
    );
    return match ? match[2] : null;
  }

  function isVerbLike(pos) {
    return pos === 'v.' || pos === 'vt.' || pos === 'vi.';
  }

  function isNounLike(pos) {
    return pos === 'n.' || pos === 'pron.';
  }

  // ---------------------------------------------------------------- 从句切分

  /** 按逗号/分号/冒号把句子切成几段，保留每段原文 */
  function splitClauses(sentence) {
    const parts = [];
    let start = 0;
    let quote = 0;

    for (let i = 0; i < sentence.length; i++) {
      const ch = sentence[i];
      if (ch === '"' || ch === '“' || ch === '”') quote = quote ? 0 : 1;
      if (quote) continue;
      if (ch === ',' || ch === ';' || ch === ':') {
        const piece = sentence.slice(start, i).trim();
        if (piece) parts.push(piece);
        start = i + 1;
      }
    }

    const last = sentence.slice(start).trim();
    if (last) parts.push(last);
    return parts;
  }

  /** 找出这一段里的从句起点：返回 {index, word, compound} */
  function findConnector(words, from) {
    for (let i = from || 0; i < words.length; i++) {
      const lower = words[i].lower;

      // 两三个词组成的引导短语
      const next1 = words[i + 1] ? words[i + 1].lower : '';
      const next2 = words[i + 2] ? words[i + 2].lower : '';

      if (lower === 'even' && (next1 === 'though' || next1 === 'if')) {
        return { index: i, word: 'even ' + next1, compound: true, role: next1 === 'if' ? '条件状语从句' : '让步状语从句' };
      }
      if (lower === 'as' && next1 === 'long' && next2 === 'as') {
        return { index: i, word: 'as long as', compound: true, role: '条件状语从句' };
      }
      if (lower === 'so' && next1 === 'that') {
        return { index: i, word: 'so that', compound: true, role: '目的状语从句' };
      }
      if (lower === 'in' && next1 === 'order' && next2 === 'that') {
        return { index: i, word: 'in order that', compound: true, role: '目的状语从句' };
      }
      if (lower === 'such' && next1 === 'that') {
        return { index: i, word: 'such that', compound: true, role: '结果状语从句' };
      }
      if (lower === 'given' && next1 === 'that') {
        return { index: i, word: 'given that', compound: true, role: '条件状语从句' };
      }

      if (CLAUSE_WORDS[lower]) {
        if (TIME_WORDS.indexOf(lower) >= 0 && !looksLikeClause(words, i)) continue;
        return { index: i, word: lower, compound: false, role: CLAUSE_WORDS[lower] };
      }
    }
    return null;
  }

  /** 一段里可能套着好几个从句（that 里面又包一个 who），全部找出来 */
  function findAllConnectors(words, offset) {
    const found = [];
    let cursor = offset;

    while (cursor < words.length) {
      const connector = findConnector(words, cursor);
      if (!connector) break;

      connector.index += 0;
      found.push(connector);

      // 跳过引导短语本身，免得 "so that" 里的 that 又被找一遍
      const skip = connector.compound ? 2 : 1;
      cursor = connector.index + skip;

      if (found.length >= 4) break;
    }

    return found;
  }

  /** 看引导词前面的词，把「that 从句」之类细化成真正的类型 */
  function refineRole(connector, words, beforeText) {
    const role = connector.role;
    const word = connector.word;
    const prev = words[connector.index - 1];
    const prevLower = prev ? prev.lower : null;
    const prevPos = prev ? prev.pos : null;

    if (word === 'that') {
      // 句首的 that → 主语从句
      if (connector.index === 0 && !beforeText) {
        return { role: '主语从句', code: 'subject' };
      }
      // 前面是动词 → 宾语从句
      if (prevPos && isVerbLike(prevPos)) {
        return { role: '宾语从句', code: 'object' };
      }
      // 前面是 fact / news 这类抽象名词 → 同位语从句
      const prevBase = prevLow(prev);
      if (prevLower && APPOSITIVE_HEADS.indexOf(prevLower) >= 0) {
        return { role: '同位语从句', code: 'appositive' };
      }
      if (prevBase && APPOSITIVE_HEADS.indexOf(prevBase) >= 0) {
        return { role: '同位语从句', code: 'appositive' };
      }
      // 前面是名词 → 定语从句
      if (prevPos && isNounLike(prevPos)) {
        return { role: '定语从句', code: 'relative' };
      }
      return { role: '定语从句', code: 'relative' };
    }

    if (word === 'whether') {
      if (connector.index === 0 && !beforeText) return { role: '主语从句', code: 'subject' };
      if (prevPos && isVerbLike(prevPos)) return { role: '宾语从句', code: 'object' };
      return { role: '名词性从句', code: 'nominal' };
    }

    if (word === 'when' || word === 'where' || word === 'why') {
      const prevBase = prevLower ? prevLower : null;
      const heads = word === 'when' ? TIME_HEADS : word === 'where' ? PLACE_HEADS : REASON_HEADS;
      if (prevBase && heads.indexOf(prevBase) >= 0) {
        return { role: '定语从句', code: 'relative' };
      }
    }

    if (word === 'which' || word === 'who' || word === 'whom' || word === 'whose') {
      return { role: '定语从句', code: 'relative' };
    }

    const map = {
      '原因状语从句': 'cause',
      '让步状语从句': 'concession',
      '条件状语从句': 'condition',
      '时间状语从句': 'time',
      '地点状语从句': 'place',
      '目的状语从句': 'purpose',
      '结果状语从句': 'result',
      '原因/时间状语从句': 'cause',
      '让步/时间状语从句': 'concession',
      '状语从句': 'adverbial'
    };

    return { role: role, code: map[role] || 'adverbial' };
  }

  /** 变形词退回原形，用来核对 fact/ideas 这类复数 */
  function prevLow(word) {
    if (!word) return null;
    const t = word.lower;
    if (!t) return null;
    if (t.slice(-1) === 's') return t.slice(0, -1);
    return t;
  }

  // ---------------------------------------------------------------- 主函数

  /** 拆一句：返回词、从句分段、语法点 */
  function analyze(sentence, lookup) {
    const text = String(sentence || '').trim();
    const tokens = [];
    let match;
    WORD_RE.lastIndex = 0;
    while ((match = WORD_RE.exec(text))) {
      const word = match[0];
      tokens.push({
        text: word,
        lower: word.toLowerCase(),
        pos: posOf(word, lookup),
        start: match.index,
        end: match.index + word.length
      });
    }

    // ---- 从句分段
    const clauses = [];
    let beforeText = '';

    splitClauses(text).forEach(function (segment) {
      const segTokens = [];
      let m;
      WORD_RE.lastIndex = 0;
      while ((m = WORD_RE.exec(segment))) {
        segTokens.push({
          text: m[0],
          lower: m[0].toLowerCase(),
          pos: posOf(m[0], lookup)
        });
      }
      if (!segTokens.length) return;

      // 去掉段首的 and / but / so 这类连词再找引导词
      let offset = 0;
      while (offset < segTokens.length && CONJUNCTS.indexOf(segTokens[offset].lower) >= 0) offset++;

      const connectors = findAllConnectors(segTokens, offset);

      if (!connectors.length) {
        clauses.push({ text: segTokens.map((w) => w.text).join(' '), role: null, code: 'main' });
      } else {
        // 第一个引导词前面的部分算主句
        if (connectors[0].index > 0) {
          const head = segTokens.slice(0, connectors[0].index).map((w) => w.text).join(' ');
          if (head) clauses.push({ text: head, role: null, code: 'main' });
        }

        connectors.forEach(function (connector, k) {
          const end = k + 1 < connectors.length ? connectors[k + 1].index : segTokens.length;
          const refined = refineRole(connector, segTokens, beforeText);
          clauses.push({
            text: segTokens.slice(connector.index, end).map((w) => w.text).join(' '),
            role: refined.role,
            code: refined.code
          });
        });
      }

      beforeText += ' ' + segment;
    });

    // ---- 语法点
    const points = [];
    const add = function (code, name, note) {
      if (!points.some(function (p) { return p.code === code; })) {
        points.push({ code: code, name: name, note: note });
      }
    };

    const lowers = tokens.map(function (t) { return t.lower; });
    const clauseCodes = clauses.map(function (c) { return c.code; });

    if (clauseCodes.indexOf('relative') >= 0) {
      add('relative', '定语从句', '关系词（that / which / who…）把一整句挂到前面的名词上，中文习惯把这句翻译成「……的」放在名词前面。');
    }
    if (clauseCodes.indexOf('object') >= 0) {
      add('object', '宾语从句', 'that / whether 引导的整句充当动词的宾语，翻译时按英文语序直译即可，中文常省略 that。');
    }
    if (clauseCodes.indexOf('appositive') >= 0) {
      add('appositive', '同位语从句', 'that 后面的句子就是在解释前面那个抽象名词（fact / idea / news…）的具体内容，可以把 that 理解成冒号。');
    }
    if (clauseCodes.indexOf('subject') >= 0) {
      add('subject', '主语从句', '整个从句充当主语，谓语通常用单数；中文常译成「……这件事」。');
    }
    if (clauseCodes.indexOf('condition') >= 0) {
      add('condition', '条件状语从句', 'if / unless 引导条件，主句常用 will / would / can + 动词；「主将从现」：从句用一般现在时表将来。');
    }
    if (clauseCodes.indexOf('concession') >= 0) {
      add('concession', '让步状语从句', 'although / though / even though 表示「虽然」，中文不能再加「但是」；while 有时也表示「尽管」。');
    }
    if (clauseCodes.indexOf('cause') >= 0) {
      add('cause', '原因状语从句', 'because 语气最强，since / as 更书面、理由更弱；不能和 so 连用。');
    }
    if (clauseCodes.indexOf('time') >= 0 || clauseCodes.indexOf('place') >= 0) {
      add('adverbial', '状语从句', '从句交代主句发生的时间、地点、条件或原因，翻译时通常放在主句前面。');
    }
    if (clauseCodes.indexOf('purpose') >= 0 || clauseCodes.indexOf('result') >= 0) {
      add('purpose', '目的/结果从句', 'so that 后面跟 can / could 多表示目的；没有情态动词时多表示结果。');
    }

    // 被动：be + 过去分词
    for (let i = 0; i < lowers.length - 1; i++) {
      if (AUX_BE.indexOf(lowers[i]) >= 0 && /(ed|en)$/.test(lowers[i + 1]) && lowers[i + 1].length > 3) {
        add('passive', '被动语态', 'be + 过去分词，主语是动作的承受者；中文可以译成「被……」，也可以译成无主句更自然。');
        break;
      }
    }

    // 完成时
    for (let i = 0; i < lowers.length - 1; i++) {
      if (AUX_HAVE.indexOf(lowers[i]) >= 0 && /(ed|en)$/.test(lowers[i + 1]) && lowers[i + 1].length > 3) {
        add('perfect', '完成时', 'have / has / had + 过去分词，表示动作已完成或持续到现在；后面出现 since / for 时尤其常见。');
        break;
      }
    }

    // 进行时
    for (let i = 0; i < lowers.length - 1; i++) {
      if (AUX_BE.indexOf(lowers[i]) >= 0 && /ing$/.test(lowers[i + 1]) && lowers[i + 1].length > 4) {
        add('progressive', '进行时', 'be + 现在分词，强调动作正在进行或持续的状态。');
        break;
      }
    }

    // 强调句：It is/was ... that ...
    for (let i = 0; i < lowers.length - 3; i++) {
      if (
        lowers[i] === 'it' &&
        (lowers[i + 1] === 'is' || lowers[i + 1] === 'was') &&
        lowers.slice(i + 2).indexOf('that') > 0
      ) {
        add('cleft', '强调句', 'It is / was + 被强调部分 + that…；去掉 It is 和 that 句子依然完整，这就是它和定语从句的区别。');
        break;
      }
    }

    // 倒装：否定词放句首
    let inverted = false;
    for (let k = 0; k < Math.min(2, lowers.length - 1); k++) {
      const head = lowers[k];
      const isTrigger = INVERT_START.indexOf(head) >= 0 || (head === 'not' && lowers[k + 1] === 'only');
      if (!isTrigger) continue;
      // 允许否定词后隔一个副词：Never before have I…
      if (AUX_ALL.indexOf(lowers[k + 1]) >= 0 || AUX_ALL.indexOf(lowers[k + 2]) >= 0) inverted = true;
    }
    if (inverted) {
      add('inversion', '倒装句', '否定意义的词（never / hardly / not only…）放到句首时，助动词要提到主语前面。');
    }

    // 比较结构
    if (lowers.indexOf('than') >= 0 || (lowers.indexOf('as') >= 0 && lowers.indexOf('as', lowers.indexOf('as') + 1) >= 0)) {
      add('comparison', '比较结构', 'more / -er + than 或 as + 原级 + as；注意比较的两边要对等，别把「than 后面省略了什么」看丢。');
    }

    // 虚拟语气
    if (lowers.indexOf('would') >= 0 && lowers.indexOf('had') >= 0 && lowers.indexOf('have') > lowers.indexOf('would')) {
      add('subjunctive', '虚拟语气', 'if + had done, would have done：对过去的假设，表示与事实相反。');
    } else if (
      lowers.indexOf('if') >= 0 &&
      (lowers.indexOf('were') >= 0 || lowers.indexOf('would') >= 0 || lowers.indexOf('could') >= 0)
    ) {
      add('subjunctive', '虚拟语气', 'if 从句用 were / 过去式，主句用 would / could + 动词原形，表示与现在事实相反。');
    }

    // 不定式
    for (let i = 0; i < lowers.length - 1; i++) {
      if (lowers[i] === 'to' && isVerbLike(tokens[i + 1].pos)) {
        add('infinitive', '动词不定式', 'to + 动词原形，可以作主语、宾语、定语或目的状语；看到 to 先判断它后面是不是动词。');
        break;
      }
    }

    // 分词作状语
    if (lowers.length > 2 && /ing$/.test(lowers[0])) {
      add('gerund', '现在分词作状语', '句首的 -ing 形式常作状语，说明主句动作的时间、原因或伴随状态，逻辑主语就是主句主语。');
    } else if (lowers.length > 2 && /ed$/.test(lowers[0])) {
      add('participle', '过去分词作状语', '句首的 -ed 形式表示被动或完成，逻辑主语同样是主句主语。');
    }

    // 强调句里的 that 不是定语从句，别标错
    if (points.some((p) => p.code === 'cleft')) {
      clauses.forEach((clause) => {
        if (clause.role === '定语从句' && /^that\b/i.test(clause.text)) {
          clause.role = '强调句 that';
          clause.code = 'cleft';
        }
      });
      // 只剩强调句的 that 了，定语从句这个标签要撤掉
      if (!clauses.some((c) => c.code === 'relative')) {
        for (let i = points.length - 1; i >= 0; i--) {
          if (points[i].code === 'relative') points.splice(i, 1);
        }
      }
    }

    return {
      text: text,
      words: tokens,
      clauses: clauses,
      points: points
    };
  }

  global.SentenceParse = {
    splitSentences: splitSentences,
    analyze: analyze,
    posOf: posOf
  };
})(window);

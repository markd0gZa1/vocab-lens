// 把一堆带坐标的文本块还原成人读的顺序，再挑出英文单词。
// 这段是从 iOS/Android 两版逐行移植过来的，规则完全一致。
(function (global) {
  'use strict';

  // 两头的标点，去掉
  const TRIM_RE = /^[\s"'“”‘’()[\]{}<>|/\\—\-_*•·、。，：；,.!?;:]+|[\s"'“”‘’()[\]{}<>|/\\—\-_*•·、。，：；,.!?;:]+$/g;

  function splitColumns(items, depth) {
    depth = depth || 0;
    // 原来要求 10 块以上才尝试分栏，结果半页 9 行的两栏页永远切不开，
    // 左右两栏按行交错读。6 块（每栏各 3 行）就该试了。
    if (depth >= 2 || items.length < 6) return [items];

    // 横跨两栏的宽块（大标题、横幅）不参与分栏判断
    const narrow = items.filter((it) => it.right - it.left <= 0.45);

    let bestSplit = null;
    let bestBalance = 0;

    for (let step = 25; step <= 75; step++) {
      const x = step / 100;
      if (narrow.some((it) => it.left < x && it.right > x)) continue;
      const left = narrow.filter((it) => it.right <= x).length;
      const right = narrow.filter((it) => it.left >= x).length;
      if (left < 3 || right < 3) continue;
      const balance = Math.min(left, right);
      if (balance > bestBalance) {
        bestBalance = balance;
        bestSplit = x;
      }
    }

    if (bestSplit === null) return [items];

    const isWide = (it) => it.right - it.left > 0.45;
    const center = (it) => (it.left + it.right) / 2;

    const left = items.filter((it) => (isWide(it) ? center(it) <= bestSplit : it.right <= bestSplit));
    const right = items.filter((it) => (isWide(it) ? center(it) > bestSplit : it.left >= bestSplit));

    return [left].concat(splitColumns(right, depth + 1));
  }

  function orderRows(items) {
    const remaining = items.slice();
    const out = [];

    while (remaining.length) {
      let seed = remaining[0];
      for (const it of remaining) if (it.midY < seed.midY) seed = it;

      const tolerance = Math.max(seed.height, 0.008) * 0.65;
      const row = remaining
        .filter((it) => Math.abs(it.midY - seed.midY) <= tolerance)
        .sort((a, b) => a.left - b.left);

      out.push.apply(out, row);

      const taken = new Set(row.map((it) => it.id));
      for (let i = remaining.length - 1; i >= 0; i--) {
        if (taken.has(remaining[i].id)) remaining.splice(i, 1);
      }
    }

    return out;
  }

  function ordered(items) {
    return splitColumns(items).flatMap((col) => orderRows(col));
  }

  function isCandidate(token, isKnown) {
    // 教材单词基本都是 3 个字母以上；两个字母的多半是 OCR 碎片
    if (token.length < 3 || token.length > 25) return false;
    if (!/^[A-Za-z'’\-]+$/.test(token)) return false;

    const letters = (token.match(/[A-Za-z]/g) || []).length;
    if (letters < 2) return false;

    const shouty = token.length <= 3 && /^[A-Z]+$/.test(token);
    if (shouty && !isKnown(token)) return false;

    return true;
  }

  function words(items, isKnown, fixText) {
    const seen = new Set();
    const out = [];
    const fix = fixText || function (text) { return text; };

    for (const item of ordered(items)) {
      // 只按「不是字母」的字符切开：OCR 常把空格吃掉，
      // close,they / automatic.(2Automatic 这种粘在一起也要能拆开
      for (const raw of fix(item.text).split(/[^A-Za-z'’\-]+/)) {
        const token = raw.replace(TRIM_RE, '');
        if (!isCandidate(token, isKnown)) continue;
        const key = token.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(token);
      }
    }

    return out;
  }

  global.ReadingOrder = { ordered, splitColumns, orderRows, words, isCandidate };
})(window);

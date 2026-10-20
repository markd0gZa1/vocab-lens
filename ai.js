// DeepSeek 接口：OCR 文字校正 + 整段翻译。
// 只有「文字」会发出去，照片始终留在本机；开关关掉就完全不走网络。
(function (global) {
  'use strict';

  const ENDPOINT = 'https://api.deepseek.com/chat/completions';
  const MODEL = 'deepseek-chat';

  function key() {
    try {
      return localStorage.getItem('vl.aiKey') || '';
    } catch (e) {
      return '';
    }
  }

  function hasKey() {
    return key().length > 10;
  }

  async function chat(messages, options) {
    const settings = options || {};
    const secret = key();
    if (!secret) throw new Error('还没填 API Key');

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + secret
      },
      body: JSON.stringify({
        model: MODEL,
        messages: messages,
        temperature: settings.temperature == null ? 0.2 : settings.temperature,
        max_tokens: settings.maxTokens || 1200,
        stream: false
      })
    });

    if (!response.ok) {
      const detail = await response.text().catch(function () { return ''; });
      throw new Error('DeepSeek ' + response.status + ' ' + detail.slice(0, 120));
    }

    const data = await response.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
    return String(content || '').trim();
  }

  /** 把 OCR 出来的文字修成正确的英文：补空格、修断词、还原分段 */
  async function cleanText(text) {
    const input = String(text || '').slice(0, 6000);
    if (!input) return '';

    const out = await chat([
      {
        role: 'system',
        content:
          '你是 OCR 文本校对器。用户给你一段从书页上识别出来的英文，里面可能有：单词被拆开、' +
          '少了空格、标点错位、个别字母认错（比如 emissions 被认成 enmissions）。' +
          '请还原成正确的英文原文。要求：1) 只输出修正后的英文本身；2) 保留原有的段落结构，段落之间用空行；' +
          '3) 不要翻译、不要解释、不要加任何前后缀。'
      },
      { role: 'user', content: input }
    ], { maxTokens: 2000, temperature: 0 });

    return out;
  }

  /** 批量翻译：一次请求翻完，保证上下文连贯 */
  async function translateSentences(sentences) {
    const list = (sentences || []).slice(0, 60);
    if (!list.length) return [];

    const payload = JSON.stringify(list);
    const out = await chat([
      {
        role: 'system',
        content:
          '你是英语教辅译者。把用户给的 JSON 数组里的英文逐句翻译成自然、准确的中文，' +
          '面向四六级 / 考研学生。要求：1) 严格返回同样长度的 JSON 字符串数组；' +
          '2) 不要合并或拆分句子；3) 不要输出任何解释或代码块标记。'
      },
      { role: 'user', content: payload }
    ], { maxTokens: 3000, temperature: 0.2 });

    const text = out.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // 模型偶尔会多写一句话，兜底按行切
      parsed = text.split('\n').map(function (line) {
        return line.replace(/^\s*\d+[.)、]\s*/, '').replace(/^["“]|["”,]?$/g, '').trim();
      });
    }

    if (!Array.isArray(parsed)) throw new Error('翻译结果格式不对');
    return parsed.map(function (item) { return String(item || '').trim(); });
  }

  async function test() {
    const out = await chat([
      { role: 'system', content: '只回复两个字：可用' },
      { role: 'user', content: 'ping' }
    ], { maxTokens: 16, temperature: 0 });
    return out;
  }

  global.AI = {
    hasKey: hasKey,
    cleanText: cleanText,
    translateSentences: translateSentences,
    test: test
  };
})(window);

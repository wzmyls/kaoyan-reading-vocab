/* ===========================================================
   srs.js —— 纯逻辑层（不依赖 DOM，可直接用 node 测试）
   调度算法：Anki 简化版（学习阶梯 + 易度因子 + 间隔抖动）
   =========================================================== */
(function (root) {
  'use strict';

  var MIN = 60000;
  var DAY = 86400000;

  var LADDER = [1, 10];    // 学习阶段间隔（分钟）
  var MAX_IVL = 365;       // 最长间隔（天）
  var MASTER_IVL = 21;     // 间隔达到 21 天视为「已掌握」

  var DEFAULT_SETTINGS = {
    newPerDay: 12,          // 每天新词上限
    mode: 'en2cn',          // en2cn 英→中 | cn2en 中→英 | spell 拼写
    showPhonetic: true,
    showExample: true,
    blankOnFront: true,     // 正面例句挖空
    shuffleNew: false
  };

  var GRADE_LABEL = ['忘记', '模糊', '认识', '太简单'];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function todayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function newCard(ts) {
    return {
      state: 'new',        // new | learning | review
      step: 0,
      ease: 2.5,
      ivl: 0,              // 当前间隔（天）
      due: ts == null ? Date.now() : ts,
      reps: 0,
      lapses: 0,
      last: 0,
      suspended: false
    };
  }

  function isMastered(c) { return c.state === 'review' && c.ivl >= MASTER_IVL; }

  /* 间隔抖动：避免同一天录入的词永远同一天到期 */
  function fuzz(ivl) {
    if (ivl < 3) return ivl;
    var f = 0.95 + Math.random() * 0.1;
    return Math.max(2, Math.round(ivl * f));
  }

  /* 核心调度：返回推进后的卡片副本
     grade 0=忘记 1=模糊 2=认识 3=太简单 */
  function schedule(card, grade, now) {
    now = now == null ? Date.now() : now;
    var c = {};
    for (var k in card) if (Object.prototype.hasOwnProperty.call(card, k)) c[k] = card[k];

    c.reps = (c.reps || 0) + 1;
    c.last = now;

    /* ---- 新卡首次作答 ---- */
    if (c.state === 'new') {
      if (grade <= 0) {                       // 完全不会 -> 进入学习阶梯
        c.state = 'learning'; c.step = 0; c.due = now + 1 * MIN;
      } else if (grade === 1) {
        c.state = 'learning'; c.step = 0; c.due = now + 5 * MIN;
      } else if (grade === 2) {               // 认识 -> 直接毕业，1 天后再见
        c.state = 'review'; c.ivl = 1; c.due = now + fuzz(1) * DAY;
      } else {                                // 太简单 -> 4 天后
        c.state = 'review'; c.ease = 2.5; c.ivl = 4; c.due = now + fuzz(4) * DAY;
      }
      return c;
    }

    /* ---- 学习阶段 ---- */
    if (c.state === 'learning') {
      if (grade <= 0) {
        c.step = 0; c.due = now + 1 * MIN;
      } else if (grade === 1) {
        c.due = now + (LADDER[c.step] || 5) * MIN;
      } else if (grade === 2) {
        c.step = (c.step || 0) + 1;
        if (c.step >= LADDER.length) { c.state = 'review'; c.ivl = 1; c.due = now + fuzz(1) * DAY; }
        else { c.due = now + LADDER[c.step] * MIN; }
      } else {
        c.state = 'review'; c.ivl = 4; c.due = now + fuzz(4) * DAY;
      }
      return c;
    }

    /* ---- 复习阶段 ---- */
    if (grade <= 0) {                          // 忘记：重罚，回到学习阶梯
      c.lapses = (c.lapses || 0) + 1;
      c.ease = clamp(+(c.ease - 0.2).toFixed(3), 1.3, 2.8);
      c.ivl = Math.max(1, Math.round(c.ivl * 0.2));
      c.state = 'learning'; c.step = 0; c.due = now + 1 * MIN;
    } else if (grade === 1) {                  // 模糊：小幅延长
      c.ease = clamp(+(c.ease - 0.15).toFixed(3), 1.3, 2.8);
      c.ivl = clamp(Math.max(1, Math.round(c.ivl * 1.2)), 1, MAX_IVL);
      c.due = now + fuzz(c.ivl) * DAY;
    } else if (grade === 2) {                  // 认识
      c.ivl = clamp(Math.max(1, Math.round(c.ivl * c.ease)), 1, MAX_IVL);
      c.due = now + fuzz(c.ivl) * DAY;
    } else {                                   // 太简单
      c.ease = clamp(+(c.ease + 0.15).toFixed(3), 1.3, 2.8);
      c.ivl = clamp(Math.max(1, Math.round(c.ivl * c.ease * 1.3)), 1, MAX_IVL);
      c.due = now + fuzz(c.ivl) * DAY;
    }
    return c;
  }

  /* 按钮上显示的「选了会怎样」提示 */
  function humanizeDelta(ms) {
    var m = ms / MIN;
    if (m < 1) return '<1 分钟';
    if (m < 60) return Math.round(m) + ' 分钟';
    var h = m / 60;
    if (h < 24) return Math.round(h) + ' 小时';
    var d = h / 24;
    if (d < 30) return Math.round(d) + ' 天';
    if (d < 365) return (d / 30).toFixed(1).replace('.0', '') + ' 个月';
    return (d / 365).toFixed(1) + ' 年';
  }

  function previewIntervals(card, now) {
    now = now == null ? Date.now() : now;
    var out = [];
    for (var g = 0; g <= 3; g++) {
      var c = schedule(card, g, now);
      out.push(humanizeDelta(c.due - now));
    }
    return out;
  }

  /* 组卷：到期复习卡 + 今日剩余额度内的新卡 */
  function buildQueue(words, store, now) {
    now = now == null ? Date.now() : now;
    var settings = store.settings || DEFAULT_SETTINGS;
    var cards = store.cards || {};
    var due = [], fresh = [];

    for (var i = 0; i < words.length; i++) {
      var id = words[i].w;
      var c = cards[id] || newCard(now);
      if (c.suspended) continue;
      if (c.state === 'new') fresh.push({ id: id, idx: i });
      else if (c.due <= now) due.push({ id: id, due: c.due });
    }
    due.sort(function (a, b) { return a.due - b.due; });

    var todayLog = (store.log || {})[todayKey(now)] || {};
    var allow = Math.max(0, (settings.newPerDay || 0) - (todayLog.new || 0));
    var picked = fresh.slice(0, allow).map(function (x) { return x.id; });
    if (settings.shuffleNew) {
      for (var j = picked.length - 1; j > 0; j--) {
        var k = Math.floor(Math.random() * (j + 1));
        var t = picked[j]; picked[j] = picked[k]; picked[k] = t;
      }
    }

    return {
      ids: due.map(function (x) { return x.id; }).concat(picked),
      dueCount: due.length,
      newCount: picked.length,
      newLeftToday: allow,
      untouched: fresh.length
    };
  }

  /* 统计汇总 */
  function summarize(words, store, now) {
    now = now == null ? Date.now() : now;
    var cards = store.cards || {};
    var s = { total: words.length, fresh: 0, learning: 0, review: 0, mastered: 0, suspended: 0, due: 0, byYear: {} };
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var c = cards[w.w] || newCard(now);
      if (c.suspended) s.suspended++;
      else if (c.state === 'new') s.fresh++;
      else if (c.state === 'learning') s.learning++;
      else s.review++;
      if (!c.suspended && c.state !== 'new' && c.due <= now) s.due++;
      if (c.state === 'review' && c.ivl >= MASTER_IVL && !c.suspended) s.mastered++;

      var y = w.y ? String(w.y) : '未标注';
      if (!s.byYear[y]) s.byYear[y] = { total: 0, seen: 0, mastered: 0 };
      s.byYear[y].total++;
      if (c.state !== 'new') s.byYear[y].seen++;
      if (c.ivl >= MASTER_IVL && c.state === 'review' && !c.suspended) s.byYear[y].mastered++;
    }
    return s;
  }

  /* 连续打卡天数（从今天往前数） */
  function streak(store, now) {
    now = now == null ? Date.now() : now;
    var log = store.log || {};
    var n = 0, t = now;
    for (var i = 0; i < 3650; i++) {
      var k = todayKey(t);
      var d = log[k];
      var hit = d && ((d.new || 0) + (d.rev || 0)) > 0;
      if (hit) n++;
      else if (i > 0) break;      // 今天还没学不算断签
      else if (i === 0) { /* 今天没学，继续往昨天看 */ }
      t -= DAY;
    }
    return n;
  }

  /* 未来 14 天的复习量预测（不含新词） */
  function forecast(words, store, days, now) {
    now = now == null ? Date.now() : now;
    var cards = store.cards || {};
    var buckets = [];
    for (var d = 0; d < days; d++) buckets.push(0);
    for (var i = 0; i < words.length; i++) {
      var c = cards[words[i].w];
      if (!c || c.state === 'new' || c.suspended) continue;
      var delta = Math.floor((c.due - now) / DAY);
      if (delta < 0) delta = 0;
      if (delta < days) buckets[delta]++;
    }
    return buckets;
  }

  root.SRS = {
    MIN: MIN, DAY: DAY, LADDER: LADDER, MAX_IVL: MAX_IVL, MASTER_IVL: MASTER_IVL,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    GRADE_LABEL: GRADE_LABEL,
    clamp: clamp, todayKey: todayKey, newCard: newCard, isMastered: isMastered,
    schedule: schedule, previewIntervals: previewIntervals, humanizeDelta: humanizeDelta,
    buildQueue: buildQueue, summarize: summarize, streak: streak, forecast: forecast
  };
})(typeof window !== 'undefined' ? window : globalThis);

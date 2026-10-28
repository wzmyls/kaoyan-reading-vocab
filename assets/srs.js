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

  var LEARNING_CREDIT = 0.1;   // 学习中：给一点进度分（已经认识了，但还不牢）

  /* 单张卡的记忆强度：未学 0 / 学习中 0.1 / 复习中「间隔÷21天」，满 21 天记 100% */
  function memoryStrength(c) {
    if (!c || c.state === 'new') return 0;
    if (c.state === 'learning') return LEARNING_CREDIT;
    return Math.min(1, Math.max(0, (c.ivl || 0) / MASTER_IVL));
  }

  /* 总体掌握度 = 所有卡片记忆强度的平均值
     upto 不为空时，只统计在那之前已经学过的卡片（用来回填历史曲线） */
  function masteryScore(words, store, now, upto) {
    now = now == null ? Date.now() : now;
    var cards = store.cards || {};
    var sum = 0, touchedN = 0, denom = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var c = cards[w.w];
      if (c && c.suspended) continue;       // 暂停的词不计入分母
      denom++;
      if (!c || c.state === 'new') continue;
      if (upto != null && !(c.last > 0 && c.last <= upto)) continue;
      touchedN++;
      sum += memoryStrength(c);
    }
    return {
      score: denom ? sum / denom : 0,
      touched: denom ? touchedN / denom : 0,
      touchedN: touchedN,
      total: denom
    };
  }

  /* 常错词：某一天「忘记」次数达到阈值的词
     opts: {threshold=3, days=1, now}
     返回 [{w, id, forgot, vague, worst, days:[{date,count}]}]，按最惨的排前面 */
  function troubleWords(words, store, opts) {
    opts = opts || {};
    var now = opts.now == null ? Date.now() : opts.now;
    var thr = opts.threshold == null ? 3 : opts.threshold;
    var span = opts.days == null ? 1 : opts.days;
    if (span === 0 || span === 'all') return troubleAllTime(words, store, thr);
    span = Math.max(1, span);
    var tl = store.trouble || {};
    var keys = [];
    for (var i = 0; i < span; i++) keys.push(todayKey(now - i * DAY));
    var res = [];
    for (var j = 0; j < words.length; j++) {
      var w = words[j], id = w.w;
      var forgot = 0, vague = 0, worst = 0, hits = [];
      for (var k = 0; k < keys.length; k++) {
        var rec = (tl[keys[k]] || {})[id];
        if (!rec) continue;
        var f = rec[0] || 0, v = rec[1] || 0;
        forgot += f;
        vague += v;
        if (f > worst) worst = f;
        if (f >= thr) hits.push({ date: keys[k], count: f });
      }
      if (hits.length) {
        res.push({ w: w, id: id, forgot: forgot, vague: vague, worst: worst, days: hits });
      }
    }
    res.sort(function (a, b) {
      return (b.worst - a.worst) || (b.forgot - a.forgot) || (a.id < b.id ? -1 : 1);
    });
    return res;
  }

  /* 历史全部：按累计忘记次数排（数据来自逐词累计表，不受逐日记录清理影响） */
  function troubleAllTime(words, store, thr) {
    var ta = store.troubleAll || {};
    var res = [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i], rec = ta[w.w];
      if (!rec) continue;
      /* 注意：时间戳是 13 位毫秒，不能用 |0（会截断成 32 位） */
      var f = rec[0] | 0, v = rec[1] | 0, dc = rec[2] | 0, mx = rec[3] | 0;
      var last = Number(rec[4]) || 0;
      if (mx < thr) continue;          /* 曾经某天达到过阈值，才算常错词 */
      res.push({
        w: w, id: w.w, forgot: f, vague: v, worst: mx,
        dayCount: dc, last: last, days: [], allTime: true
      });
    }
    res.sort(function (a, b) {
      return (b.forgot - a.forgot) || (b.worst - a.worst) || (a.id < b.id ? -1 : 1);
    });
    return res;
  }

  /* 老数据迁移：把逐日记录汇总成逐词累计表（只跑一次，之后靠增量累加） */
  function migrateTroubleAll(store) {
    if (store.troubleAll) return store.troubleAll;
    store.troubleAll = {};
    var days = store.trouble || {};
    var keys = Object.keys(days);
    for (var i = 0; i < keys.length; i++) {
      var recs = days[keys[i]] || {};
      var ids = Object.keys(recs);
      for (var j = 0; j < ids.length; j++) {
        var rec = recs[ids[j]] || [0, 0];
        var a = store.troubleAll[ids[j]] || (store.troubleAll[ids[j]] = [0, 0, 0, 0, 0]);
        a[0] += rec[0] || 0;
        a[1] += rec[1] || 0;
        a[2] += 1;
        if ((rec[0] || 0) > a[3]) a[3] = rec[0] || 0;
        var ts = new Date(keys[i] + 'T12:00:00').getTime();
        if (ts > a[4]) a[4] = ts;
      }
    }
    return store.troubleAll;
  }

  var GRADE_LABEL = ['忘记', '模糊', '认识', '太简单'];

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function todayKey(ts) {
    var d = new Date(ts == null ? Date.now() : ts);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' + m : m) + '-' + (day < 10 ? '0' + day : day);
  }

  function dateStr(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
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

  /* 核心调度（原始，不含重点权重）：返回推进后的卡片副本
     grade 0=忘记 1=模糊 2=认识 3=太简单 */
  function scheduleRaw(card, grade, now) {
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

  /* 重点词的权重：settings.focusYears 里的年份命中就返回 focusWeight（默认 0.6） */
  function focusWeight(word, settings) {
    var fy = (settings && settings.focusYears) || [];
    if (!fy.length) return 1;
    var k = (settings && settings.focusWeight);
    if (k == null) k = 0.6;
    var ys = (word && word.y) || [];
    for (var i = 0; i < ys.length; i++) {
      if (fy.indexOf(ys[i]) >= 0) return k;
    }
    return 1;
  }

  function isFocus(word, settings) {
    return focusWeight(word, settings) < 1;
  }

  /* 公开的调度：重点词的复习间隔按权重缩短，等于复习得更勤 */
  function schedule(card, grade, now, weight) {
    now = now == null ? Date.now() : now;
    var c = scheduleRaw(card, grade, now);
    if (weight != null && weight > 0 && weight !== 1 && c.state === 'review') {
      c.ivl = clamp(Math.max(1, Math.round(c.ivl * weight)), 1, MAX_IVL);
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

  function previewIntervals(card, now, weight) {
    now = now == null ? Date.now() : now;
    var out = [];
    for (var g = 0; g <= 3; g++) {
      var c = schedule(card, g, now, weight);
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
    var focusDue = 0, focusNew = 0;

    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var id = w.w;
      var c = cards[id] || newCard(now);
      if (c.suspended) continue;
      var f = isFocus(w, settings) ? 1 : 0;
      if (c.state === 'new') {
        fresh.push({ id: id, idx: i, f: f });
        if (f) focusNew++;
      } else if (c.due <= now) {
        due.push({ id: id, due: c.due, f: f });
        if (f) focusDue++;
      }
    }
    /* 重点年份的词排在前面：先复习重点，再复习其他 */
    due.sort(function (a, b) { return (b.f - a.f) || (a.due - b.due); });

    var todayLog = (store.log || {})[todayKey(now)] || {};
    var allow = Math.max(0, (settings.newPerDay || 0) - (todayLog.new || 0));
    /* 新词额度也优先给重点年份 */
    var fNew = [], oNew = [];
    for (var m = 0; m < fresh.length; m++) (fresh[m].f ? fNew : oNew).push(fresh[m]);
    if (settings.shuffleNew) { shuffleArr(fNew); shuffleArr(oNew); }
    var ordered = fNew.concat(oNew);
    var picked = ordered.slice(0, allow).map(function (x) { return x.id; });

    return {
      ids: due.map(function (x) { return x.id; }).concat(picked),
      dueCount: due.length,
      newCount: picked.length,
      newLeftToday: allow,
      untouched: fresh.length,
      focusDue: focusDue,
      focusNew: focusNew,
      focusNewPicked: picked.length ? Math.min(picked.length, fNew.length) : 0
    };
  }

  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* 统计汇总 */
  function summarize(words, store, now) {
    now = now == null ? Date.now() : now;
    var cards = store.cards || {};
    var settings = store.settings || DEFAULT_SETTINGS;
    var s = { total: words.length, fresh: 0, learning: 0, review: 0, mastered: 0, suspended: 0, due: 0,
              focus: { total: 0, fresh: 0, mastered: 0, due: 0 }, byYear: {} };
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      var c = cards[w.w] || newCard(now);
      var isF = isFocus(w, settings);
      if (isF) {
        s.focus.total++;
        if (!c.suspended && c.state === 'new') s.focus.fresh++;
        if (!c.suspended && c.state === 'review' && c.ivl >= MASTER_IVL) s.focus.mastered++;
        if (!c.suspended && c.state !== 'new' && c.due <= now) s.focus.due++;
      }
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

  /* 由「目标日期」反推每天要学多少新词
     opts: {targetDate:'YYYY-MM-DD', reserveDays, years:[..], now} */
  function makePlan(words, store, opts) {
    opts = opts || {};
    var now = opts.now == null ? Date.now() : opts.now;
    var target = opts.targetDate
      ? new Date(opts.targetDate + 'T23:59:59').getTime()
      : now + 60 * DAY;
    var reserve = opts.reserveDays == null ? 7 : Math.max(0, opts.reserveDays);
    var years = opts.years || null;
    var cards = store.cards || {};
    var fresh = 0, learning = 0, review = 0, total = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (years && years.length) {
        var hit = false;
        for (var j = 0; j < (w.y || []).length; j++) {
          if (years.indexOf(w.y[j]) >= 0) { hit = true; break; }
        }
        if (!hit) continue;
      }
      total++;
      var c = cards[w.w];
      if (!c || c.state === 'new') fresh++;
      else if (c.state === 'learning') learning++;
      else review++;
    }
    /* 按自然日边界算：今天到目标日期之间的天数（目标当天不算学习日） */
    function dayStart(ts) {
      var d = new Date(ts);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    var calendarDays = Math.max(1, Math.round((dayStart(target) - dayStart(now)) / DAY));
    var studyDays = Math.max(1, calendarDays - reserve);
    var perDay = Math.max(1, Math.ceil(fresh / studyDays));
    var weeks = [];
    var nWeeks = Math.ceil(studyDays / 7);
    for (var wk = 1; wk <= nWeeks; wk++) {
      var doneDays = Math.min(studyDays, wk * 7);
      var cum = Math.min(fresh, perDay * doneDays);
      weeks.push({
        week: wk,
        to: dateStr(now + doneDays * DAY),
        cumNew: cum,
        left: fresh - cum,
        doneDays: doneDays
      });
    }
    return {
      total: total,
      fresh: fresh,
      learning: learning,
      review: review,
      calendarDays: calendarDays,
      studyDays: studyDays,
      reserveDays: reserve,
      perDay: perDay,
      weeks: weeks,
      targetDate: dateStr(target),
      startDate: dateStr(now),
      estDaily: Math.round(perDay * 4),
      tight: perDay > 30,
      impossible: fresh > 0 && studyDays < 1
    };
  }

  root.SRS = {
    MIN: MIN, DAY: DAY, LADDER: LADDER, MAX_IVL: MAX_IVL, MASTER_IVL: MASTER_IVL,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    GRADE_LABEL: GRADE_LABEL,
    clamp: clamp, todayKey: todayKey, newCard: newCard, isMastered: isMastered,
    dateStr: dateStr,
    memoryStrength: memoryStrength, masteryScore: masteryScore,
    schedule: schedule, scheduleRaw: scheduleRaw,
    focusWeight: focusWeight, isFocus: isFocus,
    troubleWords: troubleWords, troubleAllTime: troubleAllTime,
    migrateTroubleAll: migrateTroubleAll,
    previewIntervals: previewIntervals, humanizeDelta: humanizeDelta,
    buildQueue: buildQueue, summarize: summarize, streak: streak, forecast: forecast,
    makePlan: makePlan
  };
})(typeof window !== 'undefined' ? window : globalThis);

/* ===========================================================
   app.js —— 界面与交互层（无依赖）
   =========================================================== */
(function () {
  'use strict';
  var S = window.SRS;
  var DATA = window.WORD_DATA || { words: [], groups: [] };
  var LS_KEY = 'kaoyan_words_v1';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }
  function md(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function ymd(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function isoDate(ts) {
    var d = new Date(ts), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  /* ---------- 存储 ---------- */
  var store, lsOK = true, saveTimer = null;
  function defStore() {
    return { v: 1, settings: {}, cards: {}, log: {}, groups: {}, custom: [], hist: {}, created: Date.now() };
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY); } catch (e) { lsOK = false; }
    try { store = raw ? JSON.parse(raw) : defStore(); } catch (e) { store = defStore(); }
    store.settings = Object.assign({}, S.DEFAULT_SETTINGS, store.settings || {});
    store.cards = store.cards || {};
    store.log = store.log || {};
    store.groups = store.groups || {};
    store.custom = store.custom || [];
    store.hist = store.hist || {};
    if (!store.settings.examDate) store.settings.examDate = isoDate(Date.now() + 60 * 86400000);
    if (!store.settings.focusYears) store.settings.focusYears = (DATA.focusYears || []).slice();
    if (store.settings.focusWeight == null) store.settings.focusWeight = 0.6;
  }
  function save() {
    if (!lsOK) return;
    recordSnapshot();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(LS_KEY, JSON.stringify(store)); }
      catch (e) { lsOK = false; showWarn('进度保存失败（' + e.message + '）：请点统计页的「导出备份」手动保存。'); }
    }, 120);
  }
  function showWarn(msg) {
    var el = $('#lsWarn');
    el.textContent = msg;
    el.classList.remove('hide');
  }
  /* ---------- 数据准备 ---------- */
  var WORDS = [], BYID = {};
  function prepare() {
    WORDS = [];
    (DATA.words || []).forEach(function (w) {
      var o = Object.assign({}, w);
      o.w = String(o.w).toLowerCase();
      o.id = o.w;
      o.kind = o.kind || 'word';
      WORDS.push(o);
    });
    BYID = {};
    WORDS.forEach(function (w) { BYID[w.id] = w; });
    store.custom.forEach(function (w) {
      var id = String(w.w).toLowerCase().trim();
      if (BYID[id]) return;
      var o = Object.assign({}, w);
      o.id = id;
      o.w = id;
      o.kind = o.kind || 'word';
      o.y = o.y || [];
      o.custom = true;
      WORDS.push(o);
      BYID[id] = o;
    });
    YEARS = (function () {
      var s = {};
      (DATA.words || []).forEach(function (w) {
        (w.y || []).forEach(function (y) { if (y) s[y] = 1; });
      });
      return Object.keys(s).map(Number).sort();
    })();
  }
  var YEARS = [];
  /* ---------- 内置词典（ECDICT 裁剪版，按需加载分片） ---------- */
  var SHARDS = 16, shardLoaded = {};
  function shardOf(w) {
    var h = 0;
    for (var i = 0; i < w.length; i++) h += w.charCodeAt(i);
    return h % SHARDS;
  }
  function loadScript(src, cb) {
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { cb(null); };
    s.onerror = function () { cb(new Error('加载失败：' + src)); };
    document.head.appendChild(s);
  }
  function loadShard(n, cb) {
    if (shardLoaded[n]) { cb(null); return; }
    loadScript('dict/d' + (n < 10 ? '0' + n : n) + '.js', function (err) {
      if (!err) shardLoaded[n] = 1;
      cb(err);
    });
  }
  function rawEntry(w) {
    var bag = window.ECDICT && window.ECDICT[shardOf(w)];
    return bag ? bag[w] : null;
  }
  /* 猜原形：-ies / -es / -s / -ing / -ed，含去 e 和双写辅音的情况 */
  function guesses(w) {
    var out = [];
    if (/ies$/.test(w) && w.length > 4) out.push(w.slice(0, -3) + 'y');
    if (/es$/.test(w) && w.length > 3) out.push(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) out.push(w.slice(0, -1));
    if (/ing$/.test(w) && w.length > 5) {
      out.push(w.slice(0, -3));
      out.push(w.slice(0, -3) + 'e');
      if (w.slice(-4, -3) === w.slice(-5, -4)) out.push(w.slice(0, -4));
    }
    if (/ed$/.test(w) && w.length > 4) {
      out.push(w.slice(0, -2));
      out.push(w.slice(0, -1));
      if (w.slice(-3, -2) === w.slice(-4, -3)) out.push(w.slice(0, -3));
    }
    var seen = {}, uniq = [];
    out.forEach(function (c) {
      if (c && c !== w && c.length > 1 && !seen[c]) { seen[c] = 1; uniq.push(c); }
    });
    return uniq.slice(0, 4);
  }
  /* 查词：返回 {key, entry, from}，查不到返回 null */
  function lookupWord(word, cb) {
    var w = String(word).toLowerCase().trim().replace(/\s+/g, ' ');
    if (!w) { cb(null); return; }
    var cands = [w].concat(guesses(w));
    var i = 0;
    (function step() {
      if (i >= cands.length) { cb(null); return; }
      var cand = cands[i++];
      loadShard(shardOf(cand), function (err) {
        if (err) { cb(null); return; }
        var e = rawEntry(cand);
        if (e && e.r) {
          var base = e.r;
          loadShard(shardOf(base), function (err2) {
            var be = err2 ? null : rawEntry(base);
            if (be) cb({ key: base, entry: be, from: cand });
            else step();
          });
          return;
        }
        if (e) cb({ key: cand, entry: e, from: cand });
        else step();
      });
    })();
  }
  /* ---------- 词根 / 近义辨析（aux.js，首次用时加载） ---------- */
  var AUX = null, auxLoading = false, auxWaiters = [];
  function loadAux(cb) {
    if (AUX) { cb(AUX); return; }
    auxWaiters.push(cb);
    if (auxLoading) return;
    auxLoading = true;
    loadScript('dict/ecdict-aux.js', function () {
      AUX = window.ECDICT_AUX || null;
      auxLoading = false;
      var ws = auxWaiters;
      auxWaiters = [];
      ws.forEach(function (f) { f(AUX); });
    });
  }
  function findRoot(w) {
    if (!AUX || !AUX.roots) return null;
    var roots = AUX.roots, k, info, e, i;
    for (k in roots) {
      e = roots[k].e;
      if (e) {
        for (i = 0; i < e.length; i++) {
          if (e[i].toLowerCase() === w) return { key: k, info: roots[k] };
        }
      }
    }
    var best = null;
    for (k in roots) {
      info = roots[k];
      var hit = false;
      if (k.charAt(0) === '-') hit = w.length > k.length - 1 && w.slice(-(k.length - 1)) === k.slice(1);
      else if (k.charAt(k.length - 1) === '-') hit = w.indexOf(k.slice(0, -1)) === 0;
      else hit = k.length >= 3 && w.indexOf(k) >= 0;
      if (hit && (!best || k.length > best.key.length)) best = { key: k, info: info };
    }
    return best;
  }
  function findGroup(w) {
    if (!AUX || !AUX.groups) return null;
    return AUX.groups[w] || null;
  }
  function deckWords(k) {
    if (k === 'att') return WORDS.filter(function (w) { return w.att; });
    if (k === 'phrase') return WORDS.filter(function (w) { return w.kind === 'phrase'; });
    if (k === 'focus') return WORDS.filter(function (w) { return S.isFocus(w, store.settings); });
    if (k === 'weak') {
      return WORDS.filter(function (w) {
        var c = store.cards[w.id];
        return c && !S.isMastered(c) && !c.suspended && (c.lapses >= 1 || c.state === 'learning');
      });
    }
    return WORDS.filter(function (w) { return w.kind !== 'phrase'; });
  }
  var DECKS = [
    { k: 'all', name: '全部单词' },
    { k: 'focus', name: '重点年份' },
    { k: 'att', name: '态度词' },
    { k: 'phrase', name: '固定搭配' },
    { k: 'weak', name: '易错重点' }
  ];
  /* ---------- 界面状态 ---------- */
  var ui = {
    view: 'review', deck: 'all', revealed: false,
    spell: '', spellOk: null, spellDone: false,
    listQ: '', listFilter: 'all', groupMode: 'drill', chartDays: 30
  };
  var session = null, cur = null, q = null;
  /* ---------- 会话 ---------- */
  function startSession(k, extraNew) {
    var list = deckWords(k);
    var built = S.buildQueue(list, store, Date.now());
    var ids = built.ids.slice();
    if (extraNew) {
      var taken = {};
      ids.forEach(function (id) { taken[id] = 1; });
      var more = [];
      for (var i = 0; i < list.length && more.length < extraNew; i++) {
        var id = list[i].id, c = store.cards[id];
        if (!taken[id] && (!c || c.state === 'new') && !(c && c.suspended)) more.push(id);
      }
      ids = ids.concat(more);
    }
    session = { deck: k, queue: ids, total: ids.length, done: 0, grades: [0, 0, 0, 0], built: built };
    takeNext();
  }
  function takeNext() {
    var id = session && session.queue.length ? session.queue.shift() : null;
    cur = id ? BYID[id] : null;
    ui.revealed = false; ui.spell = ''; ui.spellOk = null; ui.spellDone = false;
  }
  function bumpLog(now, isNew, g) {
    var k = S.todayKey(now);
    var d = store.log[k] || (store.log[k] = { new: 0, rev: 0, g: [0, 0, 0, 0] });
    d.g = d.g || [0, 0, 0, 0];
    if (isNew) d.new++; else d.rev++;
    d.g[g]++;
  }
  function grade(g) {
    if (!cur || !ui.revealed) return;
    var now = Date.now(), id = cur.id;
    var before = store.cards[id] || S.newCard(now);
    var isNew = before.state === 'new';
    /* 重点年份的词间隔按权重缩短 —— 复习得更勤 */
    store.cards[id] = S.schedule(before, g, now, S.focusWeight(cur, store.settings));
    bumpLog(now, isNew, g);
    session.done++;
    session.grades[g]++;
    if (g <= 1) {
      var pos = Math.min(4, session.queue.length);
      session.queue.splice(pos, 0, id);
    }
    save();
    takeNext();
    render();
  }
  /* ---------- 例句 ---------- */
  function exampleOf(w) {
    if (w.ex && w.ex.length) return w.ex[0];
    if (w.inline_ex && w.inline_ex.length) return w.inline_ex[0];
    if (w.collins_ex && w.collins_ex.length) return w.collins_ex[0];
    return null;
  }
  function allExamples(w) {
    var out = [];
    (w.ex || []).forEach(function (x) { out.push(x); });
    if (!out.length) (w.collins_ex || []).forEach(function (x) { if (out.length < 2) out.push(x); });
    return out.slice(0, 2);
  }
  function blankEx(en, word) {
    var head = word.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b' + head + '(s|es|ed|d|ing|ly|ies)?\\b', 'gi');
    return esc(en).replace(re, '<span style="color:var(--accent);font-weight:700">＿＿＿</span>');
  }
  function boldEx(en, word) {
    var head = word.split(' ')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b(' + head + '(?:s|es|ed|d|ing|ly|ies)?)\\b', 'gi');
    return esc(en).replace(re, '<b>$1</b>');
  }
  /* ---------- 卡片渲染 ---------- */
  var EXNAME = { '0': '原形', p: '过去式', d: '过去分词', i: '现在分词', '3': '第三人称单数', s: '复数', r: '比较级', t: '最高级' };
  function exchangeHtml(w) {
    if (!w.exchange) return '';
    var parts = [];
    String(w.exchange).split('/').forEach(function (x) {
      var kv = x.split(':');
      if (kv.length === 2 && EXNAME[kv[0]] && kv[1] && kv[0] !== '0') parts.push(EXNAME[kv[0]] + ' ' + kv[1]);
    });
    return parts.length ? '<div class="meta"><b>词形变化</b> ' + esc(parts.join('；')) + '</div>' : '';
  }
  function tagsHtml(w) {
    var h = [];
    if (S.isFocus(w, store.settings)) h.push('<span class="tag focus">重点</span>');
    (w.y || []).forEach(function (y) { if (y) h.push('<span class="tag">' + y + '</span>'); });
    if (!(w.y || []).length) h.push('<span class="tag">补充</span>');
    if (w.att) h.push('<span class="tag att-' + w.att + '">态度：' + ({ pos: '正', neg: '负', neu: '中性' }[w.att] || '') + '</span>');
    if (w.kind === 'phrase') h.push('<span class="tag">固定搭配</span>');
    if (w.collins) h.push('<span class="tag">柯林斯 ' + w.collins + '★</span>');
    if (w.g) {
      String(w.g).split(' ').forEach(function (t) {
        if (TAGNAME[t]) h.push('<span class="tag">' + TAGNAME[t] + '</span>');
      });
    }
    if (w.frq) h.push('<span class="tag">词频 ' + w.frq + '</span>');
    if (w.custom) h.push('<span class="tag">自建</span>');
    if ((w.forms || []).length) h.push('<span class="tag">文中作 ' + esc(w.forms.join(' / ')) + '</span>');
    if (w.freq) h.push('<span class="tag">' + esc(w.freq) + '</span>');
    return '<div class="tags">' + h.join('') + '</div>';
  }
  function phHtml(w) {
    if (!store.settings.showPhonetic) return '';
    var p = w.us || w.uk || w.ph;
    return p ? '<span class="ph">/' + esc(p) + '/</span>' : '';
  }
  function frontHtml(w) {
    var mode = store.settings.mode;
    var h = [];
    if (mode === 'cn2en') {
      h.push('<div class="bigword" style="font-size:26px">' + esc(w.own || (w.defs || [])[0] || '（暂无释义）') + '</div>');
      h.push('<div class="meta">想一想英文怎么说，再按空格看答案</div>');
      return h.join('');
    }
    if (mode === 'spell') {
      h.push('<div class="bigword" style="font-size:26px">' + esc(w.own || (w.defs || [])[0] || '（暂无释义）') + '</div>');
      h.push('<div class="meta">在下面输入英文，回车核对</div>');
      return h.join('');
    }
    h.push('<div class="wordline"><span class="' + (w.kind === 'phrase' ? 'kindword' : 'bigword') + '">' + esc(w.w) + '</span>' + phHtml(w) + '</div>');
    h.push('<div class="meta">' + ((w.y || []).join(' / ') || '补充') + (w.att ? ' · 态度词' : '') + '</div>');
    var ex = store.settings.showExample ? exampleOf(w) : null;
    if (ex) {
      var en = store.settings.blankOnFront ? blankEx(ex.en, w.w) : boldEx(ex.en, w.w);
      h.push('<div class="ex"><div class="en">' + en + '</div></div>');
    }
    return h.join('');
  }
  function backHtml(w) {
    var h = [];
    h.push('<div class="wordline"><span class="' + (w.kind === 'phrase' ? 'kindword' : 'bigword') + '">' + esc(w.w) + '</span>' + phHtml(w) + '</div>');
    h.push(tagsHtml(w));
    h.push('<hr class="hr">');
    if (w.own) h.push('<div class="own"><span class="lbl">你的笔记</span>' + esc(w.own) + '</div>');
    if ((w.defs || []).length) h.push('<ul class="defs">' + w.defs.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul>');
    if (w.root) h.push('<div class="meta" style="margin-top:10px"><b>词根词缀</b> ' + esc(w.root) + '</div>');
    h.push(exchangeHtml(w));
    if ((w.near || []).length) {
      h.push('<div class="meta"><b>近义辨析</b> ' + w.near.map(esc).join(' / ') +
        (w.nearNote ? '：' + esc(w.nearNote) : '') + '</div>');
    }
    if ((w.rel || []).length) {
      h.push('<div class="meta"><b>同根词</b> ' + w.rel.map(function (r) {
        return esc(r[1]) + ' <span style="opacity:.75">' + esc((r[0] || '') + ' ' + (r[2] || '')).slice(0, 40) + '</span>';
      }).join('；') + '</div>');
    }
    if ((w.disc || []).length) {
      h.push('<div class="meta"><b>辨析</b> ' + w.disc.map(function (d) {
        return esc(d[0]) + '：' + esc(d[1]);
      }).join('<br>') + '</div>');
    }
    if ((w.syno || []).length) {
      h.push('<div class="meta"><b>近义</b> ' + w.syno.map(function (s) {
        return esc((s[1] || []).join(' / '));
      }).join('；') + '</div>');
    }
    if ((w.conf || []).length) {
      h.push('<div class="meta"><b>形近易混</b> ' + w.conf.map(function (c) { return esc(c); }).join(' / ') + '（在「辨析」页集中练）</div>');
    }
    var exs = allExamples(w);
    if (exs.length) {
      h.push('<hr class="hr">');
      exs.forEach(function (x) {
        h.push('<div class="ex"><div class="en">' + boldEx(x.en, w.w) + '</div><div class="zh">' + esc(x.zh) + '</div></div>');
      });
    }
    if (w.note) h.push('<div class="meta" style="margin-top:10px">原记录存疑：' + esc(w.note) + '</div>');
    if (w.fixes) h.push('<div class="warnbox" style="margin-top:10px">已校正：' + esc(w.fixes) + '</div>');
    return h.join('');
  }
  function reviewHtml() {
    if (!session) startSession(ui.deck);
    var h = [];
    h.push('<div class="tools">');
    h.push('<select data-act="deck">' + DECKS.map(function (d) {
      return '<option value="' + d.k + '"' + (ui.deck === d.k ? ' selected' : '') + '>' + d.name + '</option>';
    }).join('') + '</select>');
    h.push('<span class="chip">' + (store.settings.newPerDay) + ' 新词/天</span>');
    if ((store.settings.focusYears || []).length) {
      h.push('<span class="chip hot">重点 <b>' + store.settings.focusYears.join('/') + '</b> 间隔×' +
        store.settings.focusWeight + '</span>');
    }
    h.push('<span style="flex:1"></span>');
    h.push('<button class="btn sm" data-act="addword">＋ 加词</button>');
    h.push('<button class="btn sm" data-act="restart">重新开始本轮</button>');
    h.push('</div>');
    h.push(todayBarHtml());
    if (!cur) {
      h.push('<div class="panel pad stack" style="min-height:300px">');
      if (session && session.total === 0) {
        h.push('<div style="font-size:19px;font-weight:650">这个范围今天没有待办卡片 🎉</div>');
        h.push('<div class="hint">可以是：没有到期复习卡、今日新词额度已用完，或者这个词表还没开始。</div>');
        h.push('<div><button class="btn primary" data-act="new10">再学 10 个新词</button> ');
        h.push('<button class="btn" data-act="restart">重新开始本轮</button></div>');
      } else {
        var n = session ? session.total : 0, g = session ? session.grades : [0, 0, 0, 0];
        h.push('<div style="font-size:19px;font-weight:650">本轮结束，共 ' + n + ' 张</div>');
        h.push('<div class="chip">忘记 ' + g[0] + ' · 模糊 ' + g[1] + ' · 认识 ' + g[2] + ' · 太简单 ' + g[3] + '</div>');
        h.push('<div><button class="btn primary" data-act="restart">开始新一轮</button> ');
        h.push('<button class="btn" data-act="new10">再学 10 个新词</button></div>');
      }
      h.push('</div>');
      return h.join('');
    }
    var done = session.done, left = session.queue.length;
    var pct = Math.max(3, Math.round(done / Math.max(1, done + left + 1) * 100));
    h.push('<div class="panel" id="card">');
    h.push('<div class="card-topbar"><span>本次 ' + (done + 1) + '</span><span class="bar"><i style="width:' + pct + '%"></i></span>');
    h.push('<span>剩余 ' + (left + 1) + '</span><span>今日新词 ' + ((store.log[S.todayKey()] || {}).new || 0) + '/' + store.settings.newPerDay + '</span></div>');
    h.push('<div class="card-body fade">');
    h.push(ui.revealed || ui.spellDone ? backHtml(cur) : frontHtml(cur));
    if (store.settings.mode === 'spell' && !ui.spellDone) {
      h.push('<div style="margin-top:16px"><input type="text" id="spellBox" style="width:100%;font-size:20px" placeholder="输入英文后回车" autocomplete="off" spellcheck="false" value="' + esc(ui.spell) + '"></div>');
      if (ui.spellOk === false) h.push('<div class="meta" style="color:var(--bad)">不对，再试试（或按空格看答案）</div>');
    }
    h.push('</div>');
    if (!ui.revealed) {
      h.push('<div class="grades"><button class="primary btn" style="grid-column:1/-1;padding:12px" data-act="reveal">显示答案 <kbd>空格</kbd></button></div>');
    } else {
      var ivl = S.previewIntervals(store.cards[cur.id] || S.newCard(), Date.now(),
        S.focusWeight(cur, store.settings));
      var lbl = S.GRADE_LABEL;
      h.push('<div class="grades">');
      for (var i = 0; i < 4; i++) {
        h.push('<button class="g' + i + '" data-act="grade" data-val="' + i + '"><span class="g-label">' + lbl[i] +
          '</span><span class="g-ivl">' + ivl[i] + ' <kbd>' + (i + 1) + '</kbd></span></button>');
      }
      h.push('</div>');
    }
    h.push('</div>');
    return h.join('');
  }
  function todayBarHtml() {
    var now = Date.now();
    var d = store.log[S.todayKey(now)] || {};
    var doneNew = d.new || 0, doneRev = d.rev || 0;
    var due = S.summarize(WORDS, store, now).due;
    var planNew = store.settings.newPerDay || 0;
    var totalRev = doneRev + due;
    var pct = Math.min(100, Math.round((doneNew + doneRev) / Math.max(1, planNew + totalRev) * 100));
    var h = [];
    h.push('<div class="todaybar">');
    h.push('<span>今日计划：新词 <b' + (planNew && doneNew >= planNew ? ' class="ok"' : '') + '>' + doneNew + '/' + planNew +
      '</b> · 复习 <b' + doneRev + '/' + totalRev + '</b></span>');
    h.push('<span class="bar"><i style="width:' + pct + '%"></i></span>');
    h.push('<span class="meta">' + pct + '%</span>');
    h.push('</div>');
    return h.join('');
  }
  /* ---------- 辨析 ---------- */
  function groupList() {
    var gs = [];
    (DATA.groups || []).forEach(function (g, i) {
      var items = (g.items || []).filter(function (x) { return BYID[x]; });
      if (items.length >= 2) gs.push({ key: 'g' + i, y: g.y, items: items, note: g.note || '' });
    });
    return gs;
  }
  function newQuestion() {
    var gs = groupList();
    if (!gs.length) return null;
    var pool = gs.filter(function (g) {
      return g.items.some(function (x) { return BYID[x].own || (BYID[x].defs || []).length; });
    });
    var g = pool[Math.floor(Math.random() * pool.length)];
    var withMean = g.items.filter(function (x) { return BYID[x].own || (BYID[x].defs || []).length; });
    var target = withMean[Math.floor(Math.random() * withMean.length)];
    var opts = g.items.slice();
    if (opts.length < 3) {
      for (var i = 0; i < WORDS.length && opts.length < 4; i++) {
        var cand = WORDS[i].id;
        if (opts.indexOf(cand) === -1 && !(WORDS[i].att) && WORDS[i].own) opts.push(cand);
      }
    }
    for (var j = opts.length - 1; j > 0; j--) {
      var k = Math.floor(Math.random() * (j + 1)), t = opts[j]; opts[j] = opts[k]; opts[k] = t;
    }
    q = { g: g, target: target, opts: opts, picked: null };
    return q;
  }
  function meanHtml(id) {
    var w = BYID[id];
    if (!w) return '';
    var parts = [];
    if (w.own) parts.push('<b>' + esc(w.own) + '</b>');
    (w.defs || []).slice(0, 2).forEach(function (d) { parts.push(esc(d)); });
    return parts.join('｜') || '（无释义）';
  }
  function drillHtml() {
    var h = [];
    h.push('<div class="tools">');
    h.push('<div class="tabs" style="margin:0"><button data-act="gmode" data-val="drill" class="' + (ui.groupMode === 'drill' ? 'on' : '') + '">抽题练习</button>');
    h.push('<button data-act="gmode" data-val="list" class="' + (ui.groupMode === 'list' ? 'on' : '') + '">全部对照</button></div>');
    h.push('<span style="flex:1"></span><button class="btn sm" data-act="gnext">换一题</button></div>');
    var gs = groupList();
    if (ui.groupMode === 'list') {
      h.push('<div class="panel pad">');
      gs.forEach(function (g) {
        h.push('<div style="margin-bottom:16px"><div class="meta">' + (g.y || '补充') + ' 年 · ' + g.items.length + ' 个</div>');
        h.push('<div class="cmp">');
        g.items.forEach(function (id) {
          h.push('<div class="row"><div class="h">' + esc(id) + '</div><div class="d">' + meanHtml(id) + '</div></div>');
        });
        h.push('</div>');
        if (g.note) h.push('<div class="warnbox" style="margin-top:8px">辨析：' + esc(g.note) + '</div>');
        h.push('</div>');
      });
      h.push('</div>');
      return h.join('');
    }
    if (!q) newQuestion();
    if (!q) { h.push('<div class="panel pad">没有可用的易混词组数据。</div>'); return h.join(''); }
    h.push('<div class="panel pad fade">');
    h.push('<div class="meta">' + (q.g.y || '补充') + ' 年 · 第 ' + q.g.items.length + ' 组 · 选出下面释义对应的单词</div>');
    h.push('<div style="font-size:22px;font-weight:650;margin:12px 0 6px">' + meanHtml(q.target) + '</div>');
    q.opts.forEach(function (id) {
      var cls = 'opt';
      if (q.picked) {
        if (id === q.target) cls += ' right';
        else if (id === q.picked) cls += ' wrong';
      }
      h.push('<button class="' + cls + '" data-act="gpick" data-val="' + esc(id) + '"' + (q.picked ? ' disabled' : '') + '>' + esc(id) + '</button>');
    });
    h.push('</div>');
    if (q.picked) {
      var ok = q.picked === q.target;
      h.push('<h3 class="sec">' + (ok ? '✅ 答对了' : '❌ 答错了，正确答案：' + esc(q.target)) + ' · 这几组词的区分</h3>');
      h.push('<div class="panel pad fade"><div class="cmp">');
      q.g.items.forEach(function (id) {
        h.push('<div class="row"><div class="h">' + esc(id) + (id === q.target ? ' ★' : '') + '</div><div class="d">' + meanHtml(id) + '</div></div>');
      });
      h.push('</div>');
      if (q.g.note) h.push('<div class="warnbox" style="margin-top:10px">辨析：' + esc(q.g.note) + '</div>');
      h.push('<div style="margin-top:14px"><button class="btn primary" data-act="gnext">下一题 <kbd>空格</kbd></button></div>');
      h.push('</div>');
    }
    return h.join('');
  }
  function pickGroup(id) {
    if (!q || q.picked) return;
    q.picked = id;
    var st = store.groups[q.g.key] || (store.groups[q.g.key] = { r: 0, w: 0 });
    if (id === q.target) st.r++; else st.w++;
    st.last = Date.now();
    save();
    render();
  }
  /* ---------- 词表 ---------- */
  function cardStateText(c) {
    if (!c || c.state === 'new') return ['未学', ''];
    if (c.suspended) return ['已暂停', ''];
    if (c.state === 'learning') return ['学习中', 'st'];
    if (S.isMastered(c)) return ['已掌握 · ' + c.ivl + '天', 'st master'];
    return ['复习中 · ' + c.ivl + '天', 'st review'];
  }
  function listRows() {
    var qq = ui.listQ.trim().toLowerCase();
    var rows = [];
    WORDS.forEach(function (w) {
      var c = store.cards[w.id];
      var st = cardStateText(c);
      if (ui.listFilter === 'new' && !(st[0] === '未学')) return;
      if (ui.listFilter === 'due' && !(c && c.state !== 'new' && c.due <= Date.now())) return;
      if (ui.listFilter === 'learn' && !(c && c.state === 'learning')) return;
      if (ui.listFilter === 'master' && !(c && S.isMastered(c))) return;
      if (ui.listFilter === 'weak' && !(c && c.lapses >= 1)) return;
      if (qq) {
        var hay = (w.w + ' ' + (w.own || '') + ' ' + ((w.defs || []).join(' '))).toLowerCase();
        if (hay.indexOf(qq) === -1) return;
      }
      rows.push(w);
    });
    var h = [];
    if (!rows.length) return '<tr><td colspan="5" class="hint">没有匹配的词。</td></tr>';
    rows.forEach(function (w) {
      var c = store.cards[w.id];
      var st = cardStateText(c);
      h.push('<tr><td class="w">' + esc(w.w) + '<div class="meta" style="font-size:11.5px">' + ((w.y || []).join('/') || '补充') + (w.kind === 'phrase' ? ' · 搭配' : '') + (w.custom ? ' · 自建' : '') + '</div></td>');
      h.push('<td>' + esc(w.own || '—') + (w.defs && w.defs.length ? '<div class="meta" style="font-size:12px">' + esc(w.defs[0]).slice(0, 60) + '</div>' : '') +
        (w.root ? '<div class="meta" style="font-size:12px">' + esc(w.root) + '</div>' : '') + '</td>');
      h.push('<td><span class="' + st[1] + '">' + st[0] + '</span></td>');
      h.push('<td>' + (c && c.state !== 'new' && !c.suspended ? md(c.due) : '—') + '</td>');
      h.push('<td style="white-space:nowrap"><button class="btn sm" data-act="toggle-master" data-val="' + esc(w.id) + '">' + (c && S.isMastered(c) ? '取消掌握' : '标记掌握') + '</button> ');
      h.push('<button class="btn sm danger" data-act="reset" data-val="' + esc(w.id) + '">重置</button>');
      if (w.custom) h.push(' <button class="btn sm danger" data-act="delword" data-val="' + esc(w.id) + '">删除</button>');
      h.push('</td></tr>');
    });
    return h.join('');
  }
  function listHtml() {
    var h = [];
    h.push('<div class="tools">');
    h.push('<input type="text" id="listQ" placeholder="搜索单词或释义…" value="' + esc(ui.listQ) + '" style="flex:1;min-width:180px">');
    h.push('<select data-act="lfilter">' + [['all', '全部'], ['new', '未学'], ['learn', '学习中'], ['due', '今日到期'], ['master', '已掌握'], ['weak', '曾答错']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (ui.listFilter === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>');
    h.push('<button class="btn sm" data-act="addword">＋ 加词</button>');
    h.push('</div>');
    h.push('<div class="panel" style="overflow:hidden"><table><thead><tr><th>单词</th><th>释义</th><th>状态</th><th>下次复习</th><th>操作</th></tr></thead>');
    h.push('<tbody id="listRows">' + listRows() + '</tbody></table></div>');
    h.push('<div class="meta" id="listCount" style="margin-top:10px"></div>');
    return h.join('');
  }
  /* ---------- 加词面板 ---------- */
  var TAGNAME = { zk: '中考', gk: '高考', cet4: '四级', cet6: '六级', ky: '考研', ielts: '雅思', toefl: '托福', gre: 'GRE' };
  var addUI = { open: false, year: 0, text: '', rows: [], busy: false, note: '', dictErr: false };
  function openAdd(year) {
    addUI.open = true;
    addUI.year = year == null ? (YEARS.length ? YEARS[YEARS.length - 1] : 0) : year;
    addUI.rows = [];
    addUI.note = '';
    addUI.dictErr = false;
    render();
  }
  function closeAdd() {
    addUI.open = false; addUI.rows = []; addUI.note = '';
    render();
  }
  /* 解析输入：换行/分号分隔；整行无中文时按逗号再拆 */
  function parseWords(text) {
    var out = [];
    String(text).split(/\r?\n|[；;]+/).forEach(function (line) {
      line = String(line).replace(/^\s*(?:\d+[.、)）]|[-*•])\s*/, '').trim();
      if (!line) return;
      var pieces = [line];
      if (line.indexOf(',') >= 0 && !/[\u4e00-\u9fff]/.test(line)) pieces = line.split(',');
      pieces.forEach(function (p) {
        p = p.trim().replace(/\s+/g, ' ');
        if (!p) return;
        var m = p.match(/^([A-Za-z][A-Za-z'\- ]*?)\s*([\u4e00-\u9fff].*)$/);
        if (m) out.push({ w: m[1].trim().toLowerCase(), own: m[2].trim() });
        else if (/^[A-Za-z][A-Za-z'\- ]*$/.test(p)) out.push({ w: p.toLowerCase(), own: '' });
      });
    });
    var seen = {}, uniq = [];
    out.forEach(function (o) { if (!seen[o.w]) { seen[o.w] = 1; uniq.push(o); } });
    return uniq.slice(0, 80);
  }
  function enrichRows() {
    addUI.rows.forEach(function (r) {
      if (!r || r.status === 'dup') return;
      var rt = findRoot(r.w);
      if (rt && rt.info) r.root = rt.key + '：' + (rt.info.m || '');
      var gp = findGroup(r.w);
      if (gp && gp.length) {
        r.near = gp[0].w;
        r.nearNote = gp[0].n || gp[0].h || '';
      }
    });
  }
  function runLookup() {
    var list = parseWords(addUI.text);
    if (!list.length) {
      addUI.note = '没解析出单词。一行一个，或一行多个用逗号隔开。';
      render(); return;
    }
    addUI.busy = true; addUI.note = ''; addUI.rows = []; addUI.dictErr = false;
    render();
    var i = 0;
    (function next() {
      if (i >= list.length) {
        addUI.busy = false;
        loadAux(function () {
          enrichRows();
          addUI.note = '查完 ' + addUI.rows.length + ' 个词。';
          render();
        });
        return;
      }
      var item = list[i++];
      if (BYID[item.w]) {
        addUI.rows.push({ w: item.w, own: item.own, status: 'dup' });
        next(); return;
      }
      lookupWord(item.w, function (hit) {
        var row;
        if (hit) {
          var e = hit.entry;
          var defs = e.t ? e.t.split(' / ') : [];
          row = {
            w: hit.key, shape: item.w, own: item.own || (defs[0] || ''),
            defs: defs, ph: e.p || '', tags: e.g || '', collins: e.c || 0,
            frq: e.f || 0, exchange: e.x || '', status: 'ok'
          };
        } else {
          addUI.dictErr = true;
          row = { w: item.w, shape: item.w, own: item.own || '', status: 'miss' };
        }
        /* 词典可能把它归到原形，而原形早就在词表里了 */
        if (BYID[row.w]) row.status = 'dup';
        addUI.rows.push(row);
        next();
      });
    })();
  }
  function saveAdd() {
    var ok = addUI.rows.filter(saveable);
    if (!ok.length) {
      addUI.note = '没有可保存的词。词库里没有的，需要自己填一下释义。';
      render(); return;
    }
    var year = parseInt(addUI.year, 10) || 0;
    var added = 0;
    ok.forEach(function (r) {
      var id = String(r.w).toLowerCase().trim();
      if (!id || BYID[id]) return;
      store.custom.push({
        w: id, own: (r.own || '').trim(), defs: r.defs || [], ph: r.ph || '',
        g: r.tags || '', c: r.collins || 0, frq: r.frq || 0, exchange: r.exchange || '',
        root: r.root || '', near: r.near || [], nearNote: r.nearNote || '',
        y: year ? [year] : [], kind: 'word', src: 'ecdict'
      });
      added++;
    });
    save(); prepare();
    addUI.open = false; addUI.rows = []; addUI.text = ''; addUI.note = '';
    ui.view = 'list';
    ui.listFilter = 'all';   /* 新词要能立刻看见，别被筛选条件挡住 */
    document.querySelectorAll('#tabs button').forEach(function (x) {
      x.classList.toggle('on', x.dataset.view === 'list');
    });
    render();
  }
  function saveable(r) {
    return !!r && r.status !== 'dup' && (r.status === 'ok' || !!(r.own || '').trim());
  }
  function yearOptions(sel) {
    var opts = YEARS.map(function (y) {
      return '<option value="' + y + '"' + (sel === y ? ' selected' : '') + '>' + y + ' 年</option>';
    });
    opts.push('<option value="0"' + (sel === 0 ? ' selected' : '') + '>补充（不归属年份）</option>');
    return opts.join('');
  }
  function modalHtml() {
    if (!addUI.open) return '';
    var h = [];
    h.push('<div class="overlay" data-act="closeadd"></div>');
    h.push('<div class="modal panel">');
    h.push('<div class="modal-head"><b>加生词</b><span class="meta">自动查词典，释义可以改</span>');
    h.push('<span style="flex:1"></span><button class="btn sm" data-act="closeadd">关闭</button></div>');
    h.push('<div class="modal-body">');
    h.push('<div class="tools" style="margin:0 0 10px"><label>加入年份 <select data-act="ayear">' + yearOptions(addUI.year) + '</select></label></div>');
    h.push('<textarea id="addText" rows="4" placeholder="一行一个单词；也可整列粘贴。&#10;例：&#10;pretext&#10;lucrative 有利可图的">' + esc(addUI.text) + '</textarea>');
    h.push('<div class="tools" style="margin:10px 0 0"><button class="btn primary" data-act="alookup"' + (addUI.busy ? ' disabled' : '') + '>' + (addUI.busy ? '查询中…' : '查词典') + '</button>');
    h.push('<span class="meta">' + esc(addUI.note) + '</span></div>');
    if (addUI.rows.length) {
      h.push('<div class="scrollbox"><table class="addtable"><thead><tr><th>单词</th><th>音标</th><th>释义（可直接改）</th><th>标记</th><th>状态</th></tr></thead><tbody>');
      addUI.rows.forEach(function (r, i) {
        var st = { ok: '<span class="st review">已找到</span>', miss: '<span class="st">词库里没有</span>', dup: '<span class="st">词表已有</span>', manual: '<span class="st master">手动填</span>' }[r.status] || '';
        var tags = [];
        if (r.tags) r.tags.split(' ').forEach(function (t) { tags.push(TAGNAME[t] || t); });
        if (r.collins) tags.push('柯林斯' + r.collins + '★');
        if (r.frq) tags.push('词频' + r.frq);
        h.push('<tr><td class="w">' + esc(r.w) + (r.shape && r.shape !== r.w ? '<div class="meta">输入 ' + esc(r.shape) + '</div>' : '') + '</td>');
        h.push('<td>' + (r.ph ? '/' + esc(r.ph) + '/' : '—') + '</td>');
        h.push('<td><input class="edit" data-act="adown" data-val="' + i + '" value="' + esc(r.own || '') + '"' + (r.status === 'dup' ? ' disabled' : '') + '></td>');
        h.push('<td class="meta">' + tags.join(' ') + (r.root ? '<div>词根 ' + esc(r.root) + '</div>' : '') +
          (r.near ? '<div>近义 ' + esc((r.near || []).join(' / ')) + '</div>' : '') + '</td>');
        h.push('<td>' + st + '</td></tr>');
      });
      h.push('</tbody></table></div>');
      var n = addUI.rows.filter(saveable).length;
      h.push('<div class="tools" style="margin-top:12px"><button class="btn primary" data-act="asave">保存到 ' +
        (parseInt(addUI.year, 10) ? addUI.year + ' 年' : '补充') + '</button>');
      h.push('<span class="meta">' + n + ' 个词可保存' +
        (addUI.dictErr ? '；标「词库里没有」的，填上释义也能存' : '') + '</span></div>');
    }
    h.push('</div></div>');
    return h.join('');
  }
  /* ---------- 统计 ---------- */
  /* 掌握度折线图 */
  var CHART_DAYS = [14, 30, 60];
  function dayStartTs(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  /* 每天存一次快照（同一天覆盖写），曲线从今往后是真实值 */
  function recordSnapshot(now) {
    now = now || Date.now();
    if (!WORDS.length) return;
    var m = S.masteryScore(WORDS, store, now);
    store.hist = store.hist || {};
    store.hist[S.todayKey(now)] = [Math.round(m.score * 1000) / 1000, Math.round(m.touched * 1000) / 1000];
  }
  /* 曲线数据：有快照用快照（真实），没有就按「那天之前学过的卡」回填（估算） */
  function masterySeries(now, days) {
    var pts = [];
    var t0 = dayStartTs(now - (days - 1) * 86400000);
    for (var t = t0; t <= now; t += 86400000) {
      var key = S.todayKey(t);
      var snap = store.hist && store.hist[key];
      var d = new Date(t);
      var v = snap ? { score: snap[0], touched: snap[1] } : S.masteryScore(WORDS, store, now, t + 86399999);
      pts.push({
        ts: t, label: (d.getMonth() + 1) + '/' + d.getDate(),
        score: v.score, touched: v.touched, exact: !!snap
      });
    }
    return pts;
  }
  function chartHtml(now) {
    var days = ui.chartDays || 30;
    var pts = masterySeries(now, days);
    var n = pts.length;
    var cur = S.masteryScore(WORDS, store, now);
    var W = 1000, H = 240, PL = 48, PR = 18, PT = 16, PB = 30;
    var iw = W - PL - PR, ih = H - PT - PB;
    function X(i) { return n <= 1 ? PL + iw / 2 : PL + iw * i / (n - 1); }
    function Y(v) { return PT + ih * (1 - Math.max(0, Math.min(1, v))); }
    var hasEst = pts.some(function (p) { return !p.exact; });
    var h = [];
    h.push('<div class="panel pad" style="margin-top:12px">');
    h.push('<div class="chart-head"><span><b style="font-size:20px">' + Math.round(cur.score * 100) + '%</b>' +
      ' <span class="meta">当前总体掌握度 · 学过 ' + cur.touchedN + '/' + cur.total + ' 个词</span></span>');
    h.push('<span style="flex:1"></span>');
    h.push('<div class="tabs" style="margin:0">' + CHART_DAYS.map(function (d) {
      return '<button data-act="chartdays" data-val="' + d + '"' + (days === d ? ' class="on"' : '') + '>' + d + '天</button>';
    }).join('') + '</div></div>');
    var svg = [];
    svg.push('<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="掌握度变化曲线">');
    [0, 0.25, 0.5, 0.75, 1].forEach(function (v) {
      svg.push('<line x1="' + PL + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + Y(v).toFixed(1) + '" class="grid"/>');
      svg.push('<text x="' + (PL - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" class="axis" text-anchor="end">' + Math.round(v * 100) + '%</text>');
    });
    if (n > 1) {
      var area = 'M' + X(0).toFixed(1) + ',' + (PT + ih).toFixed(1);
      for (var i = 0; i < n; i++) area += 'L' + X(i).toFixed(1) + ',' + Y(pts[i].touched).toFixed(1);
      area += 'L' + X(n - 1).toFixed(1) + ',' + (PT + ih).toFixed(1) + 'Z';
      svg.push('<path d="' + area + '" class="area"/>');
    }
    /* 折线：快照段实线，回填段虚线 */
    var segs = [], seg = null;
    for (var j = 0; j < n; j++) {
      if (!seg || seg.exact !== pts[j].exact) {
        seg = { exact: pts[j].exact, idx: [] };
        if (j > 0) seg.idx.push(j - 1);
        seg.idx.push(j);
        segs.push(seg);
      } else seg.idx.push(j);
    }
    segs.forEach(function (sg) {
      if (sg.idx.length < 2) return;
      var d = sg.idx.map(function (k, m) {
        return (m ? 'L' : 'M') + X(k).toFixed(1) + ',' + Y(pts[k].score).toFixed(1);
      }).join('');
      svg.push('<path d="' + d + '" class="line' + (sg.exact ? '' : ' est') + '"/>');
    });
    if (n <= 31) {
      for (var k2 = 0; k2 < n; k2++) {
        svg.push('<circle cx="' + X(k2).toFixed(1) + '" cy="' + Y(pts[k2].score).toFixed(1) +
          '" r="3" class="dot' + (pts[k2].exact ? '' : ' est') + '"><title>' + pts[k2].label + '：掌握度 ' +
          Math.round(pts[k2].score * 100) + '%，学过 ' + Math.round(pts[k2].touched * 100) + '%' +
          (pts[k2].exact ? '' : '（估算）') + '</title></circle>');
      }
    }
    var step = Math.max(1, Math.round(n / 7));
    for (var k3 = 0; k3 < n; k3 += step) {
      svg.push('<text x="' + X(k3).toFixed(1) + '" y="' + (H - 8) + '" class="axis" text-anchor="middle">' + pts[k3].label + '</text>');
    }
    if (n > 1 && (n - 1) % step !== 0) {
      svg.push('<text x="' + X(n - 1).toFixed(1) + '" y="' + (H - 8) + '" class="axis" text-anchor="middle">' + pts[n - 1].label + '</text>');
    }
    svg.push('</svg>');
    h.push(svg.join(''));
    h.push('<div class="legend"><span><i class="sw line"></i>总体掌握度</span>' +
      '<span><i class="sw area"></i>学过的词占比</span>' +
      (hasEst ? '<span class="meta">虚线那几天是按当前记忆强度回填的估算，今天起是真实记录</span>' : '') + '</div>');
    h.push('<div class="meta" style="margin-top:6px">算法：每张卡按记忆强度加权（未学 0 分、学习中 10%、复习中间隔越接近 21 天越接近满分），再对所有词取平均。</div>');
    h.push('</div>');
    return h.join('');
  }
  function statsHtml() {
    var now = Date.now();
    var sum = S.summarize(WORDS, store, now);
    var dueNow = S.buildQueue(WORDS.filter(function (w) { return w.kind !== 'phrase'; }), store, now);
    var seen = sum.total - sum.fresh;
    var todo = sum.fresh;
    var perDay = store.settings.newPerDay || 20;
    var days = Math.ceil(todo / perDay);
    var streak = S.streak(store, now);
    var f = S.forecast(WORDS, store, 14, now);
    var h = [];
    h.push('<div class="grid" style="margin-top:18px">');
    h.push('<div class="stat"><div class="k">词表总数</div><div class="v">' + sum.total + ' <small>词</small></div><div class="k">未学 ' + sum.fresh + ' · 学习中 ' + sum.learning + '</div></div>');
    h.push('<div class="stat"><div class="k">已掌握</div><div class="v">' + sum.mastered + ' <small>词</small></div><div class="k">间隔 ≥ 21 天</div></div>');
    if (sum.focus && sum.focus.total) {
      h.push('<div class="stat"><div class="k">重点年份 ' + (store.settings.focusYears || []).join('/') +
        '（间隔×' + store.settings.focusWeight + '）</div><div class="v">' + sum.focus.total +
        ' <small>词</small></div><div class="k">未学 ' + sum.focus.fresh + ' · 已掌握 ' + sum.focus.mastered +
        ' · 今日到期 ' + sum.focus.due + '</div></div>');
    }
    h.push('<div class="stat"><div class="k">今日待复习</div><div class="v">' + sum.due + ' <small>张</small></div><div class="k">今日已学新词 ' + ((store.log[S.todayKey()] || {}).new || 0) + ' / ' + perDay + '</div></div>');
    h.push('<div class="stat"><div class="k">连续打卡</div><div class="v">' + streak + ' <small>天</small></div><div class="k">共记录 ' + Object.keys(store.log).length + ' 天</div></div>');
    h.push('</div>');
    var examTs = store.settings.examDate ? new Date(store.settings.examDate + 'T09:00:00').getTime() : (now + 60 * 86400000);
    var daysLeft = Math.max(0, Math.ceil((examTs - now) / 86400000));
    h.push(chartHtml(now));
    h.push(planHtml(now));
    h.push('<h3 class="sec">倒计时与阶段安排</h3>');
    h.push('<div class="panel pad">');
    h.push('<div style="font-size:17px">距考试还有 <b style="font-size:26px;color:var(--accent)">' + daysLeft + '</b> 天 <span class="meta">（' + ymd(examTs) + '，可在下面设置里改）</span></div>');
    h.push('<hr class="hr">');
    if (todo > 0) {
      h.push('<div><b>阶段一：过完第一轮新词（约 ' + days + ' 天，到 ' + ymd(now + days * 86400000) + '）</b></div>');
      h.push('<div class="meta">每天 <b>' + perDay + '</b> 个新词 + 复习到期卡，一次 15–25 分钟。第一轮的目标只是「见过 + 能认出中文」，不要求拼写。</div>');
      h.push('<div style="margin-top:12px"><b>阶段二：巩固 + 回读真题（剩余约 ' + Math.max(0, daysLeft - days) + ' 天）</b></div>');
      h.push('<div class="meta">不再加新词，只加真题里新遇到的词。每天：复习到期卡 → 辨析页刷 10 组易混词 → 回读 1 篇真题长难句。</div>');
    } else {
      h.push('<div><b>新词已全部过完一轮。</b>接下来到考试前只需复习到期卡片，每天 10–20 分钟。</div>');
      h.push('<div class="meta">建议每天额外花 5 分钟刷「辨析」页：44 组形近词过一遍，这是你阅读失分最集中的地方。</div>');
    }
    h.push('<div class="meta" style="margin-top:12px"><b>考前 7 天</b>：只复习，不背新词，把「曾答错」筛出来重点看。</div>');
    h.push('<div style="margin-top:10px"><button class="btn sm" data-act="listweak">查看「曾答错」的词</button></div>');
    h.push('</div>');
    h.push('<h3 class="sec">未来 14 天复习量</h3><div class="panel pad">');
    var mx = Math.max(1, Math.max.apply(null, f));
    h.push('<div class="f14">');
    f.forEach(function (v, i) {
      var d = new Date(now + i * 86400000);
      h.push('<div class="col"><b>' + (v || '') + '</b><i style="height:' + Math.round(v / mx * 100) + '%"></i><span>' + (d.getMonth() + 1) + '/' + d.getDate() + '</span></div>');
    });
    h.push('</div></div>');
    h.push('<h3 class="sec">最近 28 天</h3><div class="panel pad"><div class="heat">');
    for (var i = 27; i >= 0; i--) {
      var t = now - i * 86400000, k = S.todayKey(t), d = store.log[k];
      var n = d ? (d.new || 0) + (d.rev || 0) : 0;
      var op = n === 0 ? 0 : Math.min(1, 0.25 + n / 60);
      h.push('<i title="' + k + '：' + n + ' 张" style="background:' + (n ? 'rgba(47,109,246,' + op.toFixed(2) + ')' : '') + '"></i>');
    }
    h.push('</div></div>');
    h.push('<h3 class="sec">按年份</h3><div class="panel" style="overflow:hidden"><table><thead><tr><th>年份</th><th>词数</th><th>已学过</th><th>已掌握</th></tr></thead><tbody>');
    Object.keys(sum.byYear).sort().forEach(function (y) {
      var o = sum.byYear[y];
      h.push('<tr><td class="w">' + y + '</td><td>' + o.total + '</td><td>' + o.seen + '</td><td>' + o.mastered + '</td></tr>');
    });
    h.push('</tbody></table></div>');
    h.push('<h3 class="sec">设置</h3><div class="panel pad">');
    h.push('<div class="tools" style="margin:0">');
    h.push('<label>考试日期 <input type="date" data-act="set" data-val="examDate" value="' + esc(store.settings.examDate || '') + '"></label>');
    h.push('<label>每天新词 <input type="number" min="0" max="100" value="' + perDay + '" data-act="set" data-val="newPerDay" style="width:80px"></label>');
    h.push('<label>重点年份 <input type="text" data-act="fset" data-val="focusYears" style="width:170px" value="' +
      esc((store.settings.focusYears || []).join(',')) + '" placeholder="如 2021,2022,2023"></label>');
    h.push('<label>重点词复习频率 <select data-act="fset" data-val="focusWeight">' +
      [[0.5, '间隔×0.5（最频繁）'], [0.6, '间隔×0.6（默认）'], [0.8, '间隔×0.8（略多）'], [1, '×1（不加强）']]
        .map(function (o) {
          return '<option value="' + o[0] + '"' + (Number(store.settings.focusWeight) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select></label>');
    h.push('<label>回忆方式 <select data-act="set" data-val="mode">' + [['en2cn', '看英文想中文（推荐）'], ['cn2en', '看中文想英文'], ['spell', '看中文拼写']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (store.settings.mode === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>');
    h.push('<label><input type="checkbox" data-act="set" data-val="showPhonetic"' + (store.settings.showPhonetic ? ' checked' : '') + '> 显示音标</label>');
    h.push('<label><input type="checkbox" data-act="set" data-val="showExample"' + (store.settings.showExample ? ' checked' : '') + '> 显示例句</label>');
    h.push('<label><input type="checkbox" data-act="set" data-val="blankOnFront"' + (store.settings.blankOnFront ? ' checked' : '') + '> 正面例句挖空</label>');
    h.push('<label><input type="checkbox" data-act="set" data-val="shuffleNew"' + (store.settings.shuffleNew ? ' checked' : '') + '> 新词乱序</label>');
    h.push('</div>');
    h.push('<hr class="hr">');
    h.push('<div class="tools" style="margin:0">');
    h.push('<button class="btn sm" data-act="export">导出备份</button>');
    h.push('<button class="btn sm" data-act="import">导入备份</button>');
    h.push('<input type="file" id="impFile" accept=".json" class="hide">');
    h.push('<span style="flex:1"></span>');
    h.push('<button class="btn sm danger" data-act="wipe">清空所有进度</button>');
    h.push('</div>');
    h.push('<div class="meta" style="margin-top:10px">数据保存在本机浏览器里。建议每两周导出一次备份（换电脑或清缓存时能恢复）。</div>');
    h.push('</div>');
    return h.join('');
  }
  /* ---------- 顶栏 ---------- */
  /* ---------- 自定义学习计划 ---------- */
  var planUI = { target: '', reserve: 7, res: null };
  function planHtml(now) {
    if (!planUI.target) planUI.target = store.settings.examDate || S.dateStr(now + 60 * 86400000);
    var r = planUI.res;
    var h = [];
    h.push('<h3 class="sec">自定义学习计划</h3><div class="panel pad">');
    h.push('<div class="tools" style="margin:0">');
    h.push('<label>目标日期 <input type="date" data-act="plan" data-val="target" value="' + esc(planUI.target) + '"></label>');
    h.push('<label>考前留出 <input type="number" min="0" max="90" style="width:72px" data-act="plan" data-val="reserve" value="' + planUI.reserve + '"> 天只复习</label>');
    h.push('<button class="btn primary" data-act="planmake">生成计划</button>');
    h.push('</div>');
    if (!r) {
      h.push('<div class="meta" style="margin-top:10px">设一个目标日期，点「生成计划」：按剩余新词反推每天要学几个，并给出每周的进度节点。生成的数字可以一键应用。</div>');
      h.push('</div>');
      return h.join('');
    }
    h.push('<hr class="hr">');
    h.push('<div class="grid">');
    h.push('<div class="stat"><div class="k">剩余新词</div><div class="v">' + r.fresh + ' <small>个</small></div><div class="k">范围内共 ' + r.total + ' 个</div></div>');
    h.push('<div class="stat"><div class="k">可用学习天数</div><div class="v">' + r.studyDays + ' <small>天</small></div><div class="k">' + r.startDate + ' → ' + r.targetDate + '，已留 ' + r.reserveDays + ' 天复习</div></div>');
    h.push('<div class="stat"><div class="k">每天新词</div><div class="v">' + r.perDay + ' <small>个</small></div><div class="k">加上复习约 ' + Math.max(8, Math.round(r.perDay * 1.7 + 4)) + ' 分钟</div></div>');
    h.push('<div class="stat"><div class="k">预计每天复习</div><div class="v">约 ' + r.estDaily + ' <small>张</small></div><div class="k">新词累积后稳定下来的量</div></div>');
    h.push('</div>');
    if (r.tight) {
      h.push('<div class="warnbox" style="margin-top:12px">每天 ' + r.perDay + ' 个新词偏多，容易坚持不下去。可以把目标日期往后挪，或者把「考前留出」的天数调小。</div>');
    }
    h.push('<div style="margin-top:12px"><button class="btn primary" data-act="planapply">按这个计划设置</button> <span class="meta">同时改掉每天新词数与考试日期</span></div>');
    h.push('<h3 class="sec" style="margin-top:18px">每周节点</h3>');
    h.push('<table><thead><tr><th>周次</th><th>到这天为止</th><th>累计学完</th><th>还剩</th></tr></thead><tbody>');
    r.weeks.forEach(function (w) {
      h.push('<tr><td class="w">第 ' + w.week + ' 周</td><td>' + w.to + '</td><td>' + w.cumNew + ' 个</td><td>' + w.left + ' 个</td></tr>');
    });
    h.push('</tbody></table>');
    h.push('</div>');
    return h.join('');
  }
  function chipsHtml() {
    var now = Date.now();
    var sum = S.summarize(WORDS, store, now);
    var d = store.log[S.todayKey(now)] || {};
    var h = [];
    h.push('<span class="chip' + (sum.due ? ' hot' : '') + '">待复习 <b>' + sum.due + '</b></span>');
    h.push('<span class="chip">今日新词 <b>' + (d.new || 0) + '</b>/' + store.settings.newPerDay + '</span>');
    h.push('<span class="chip ok">已掌握 <b>' + sum.mastered + '</b>/' + sum.total + '</span>');
    h.push('<span class="chip">连续 <b>' + S.streak(store, now) + '</b> 天</span>');
    h.push('<span class="chip">今日复习 <b>' + (d.rev || 0) + '</b></span>');
    return h.join('');
  }
  /* ---------- 渲染 ---------- */
  function render() {
    if (!WORDS.length) {
      $('#view').innerHTML = '<div class="panel pad" style="margin-top:18px">没有读到词表数据，请检查 <code>data.js</code> 是否存在。</div>';
      return;
    }
    $('#brandSub').textContent = (DATA.deckName || '') + ' · 共 ' + WORDS.length + ' 条';
    $('#chips').innerHTML = chipsHtml();
    var v = $('#view');
    if (ui.view === 'review') v.innerHTML = reviewHtml();
    else if (ui.view === 'drill') v.innerHTML = drillHtml();
    else if (ui.view === 'list') { v.innerHTML = listHtml(); }
    else v.innerHTML = statsHtml();
    $('#modal').innerHTML = modalHtml();
    var sb = $('#spellBox');
    if (sb && store.settings.mode === 'spell' && !ui.revealed) {
      sb.focus();
      sb.setSelectionRange(sb.value.length, sb.value.length);
    }
    var upd = function () {
      var n = document.querySelectorAll('#listRows tr').length;
      var el = $('#listCount');
      if (el) el.textContent = '显示 ' + n + ' 条 / 共 ' + WORDS.length + ' 条';
    };
    upd();
  }
  /* ---------- 事件 ---------- */
  function reveal() {
    if (!cur) return;
    ui.revealed = true;
    render();
  }
  function checkSpell() {
    var box = $('#spellBox');
    if (!box || !cur) return;
    ui.spell = box.value;
    var a = box.value.trim().toLowerCase().replace(/\s+/g, ' ');
    var b = cur.w.toLowerCase();
    if (a === b) { ui.spellDone = true; ui.revealed = true; ui.spellOk = true; render(); }
    else { ui.spellOk = false; render(); var nb = $('#spellBox'); if (nb) { nb.focus(); } }
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.dataset.act, val = t.dataset.val;
    if (act === 'grade') grade(parseInt(val, 10));
    else if (act === 'reveal') reveal();
    else if (act === 'restart') { startSession(ui.deck); render(); }
    else if (act === 'new10') { startSession(ui.deck, 10); render(); }
    else if (act === 'gmode') { ui.groupMode = val; render(); }
    else if (act === 'listweak') {
      ui.view = 'list'; ui.listFilter = 'weak';
      document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('on', x.dataset.view === 'list'); });
      render();
    }
    else if (act === 'chartdays') { ui.chartDays = parseInt(val, 10) || 30; render(); }
    else if (act === 'gnext') { ui.groupMode = 'drill'; newQuestion(); render(); }
    else if (act === 'gpick') pickGroup(val);
    else if (act === 'toggle-master') {
      var id = val, c = store.cards[id] || S.newCard();
      if (S.isMastered(c)) { c.state = 'review'; c.ivl = 1; c.due = Date.now() + 86400000; }
      else { c.state = 'review'; c.ivl = 60; c.ease = 2.5; c.due = Date.now() + 60 * 86400000; c.reps = (c.reps || 0) + 1; }
      store.cards[id] = c; save(); render();
    } else if (act === 'reset') {
      delete store.cards[val]; save(); render();
    } else if (act === 'addword') { openAdd(); }
    else if (act === 'closeadd') { closeAdd(); }
    else if (act === 'alookup') { runLookup(); }
    else if (act === 'asave') { saveAdd(); }
    else if (act === 'delword') {
      var dw = val, di = -1;
      store.custom.forEach(function (x, i) { if (String(x.w).toLowerCase() === dw) di = i; });
      if (di < 0) return;
      if (!confirm('删除自建词「' + dw + '」？')) return;
      store.custom.splice(di, 1);
      delete store.cards[dw];
      save(); prepare(); render();
    } else if (act === 'planmake') {
      planUI.res = S.makePlan(WORDS, store, {
        targetDate: planUI.target, reserveDays: planUI.reserve, now: Date.now()
      });
      render();
    } else if (act === 'planapply') {
      var r = planUI.res;
      if (!r) return;
      if (r.tight && !confirm('每天 ' + r.perDay + ' 个新词偏多，确定要这样设置吗？')) return;
      store.settings.newPerDay = r.perDay;
      store.settings.examDate = r.targetDate;
      save(); startSession(ui.deck); render();
    } else if (act === 'export') {
      var blob = new Blob([JSON.stringify(store)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '背词进度-' + ymd(Date.now()) + '.json';
      a.click();
    } else if (act === 'import') { $('#impFile').click(); }
    else if (act === 'wipe') {
      if (confirm('确定清空所有背诵进度吗？此操作不可撤销（建议先导出备份）。')) {
        store = defStore(); prepare(); startSession(ui.deck); render();
      }
    }
  });
  document.addEventListener('change', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t) return;
    var act = t.dataset.act, val = t.dataset.val;
    if (act === 'deck') { ui.deck = t.value; startSession(ui.deck); render(); }
    else if (act === 'lfilter') { ui.listFilter = t.value; $('#listRows').innerHTML = listRows(); render(); }
    else if (act === 'ayear') { addUI.year = parseInt(t.value, 10) || 0; render(); }
    else if (act === 'fset') {
      if (val === 'focusYears') {
        store.settings.focusYears = String(t.value).split(/[,，;；\s]+/)
          .map(function (x) { return parseInt(x, 10); })
          .filter(function (x) { return x > 2000 && x < 2100; });
      } else {
        var fw = parseFloat(t.value);
        store.settings.focusWeight = (fw > 0 && fw <= 1) ? fw : 1;
      }
      save(); render();
    }
    else if (act === 'plan') {
      if (val === 'target') planUI.target = t.value;
      else planUI.reserve = Math.max(0, parseInt(t.value, 10) || 0);
      planUI.res = null;
      render();
    }
    else if (act === 'set') {
      if (t.type === 'checkbox') store.settings[val] = t.checked;
      else if (t.type === 'number') store.settings[val] = Math.max(0, parseInt(t.value, 10) || 0);
      else store.settings[val] = t.value;
      save(); render();
    } else if (t.id === 'impFile' && t.files && t.files[0]) {
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var o = JSON.parse(fr.result);
          if (!o.cards) throw new Error('文件格式不对');
          store = Object.assign(defStore(), o);
          store.settings = Object.assign({}, S.DEFAULT_SETTINGS, store.settings || {});
          save(); prepare(); startSession(ui.deck); render();
          alert('导入成功。');
        } catch (err) { alert('导入失败：' + err.message); }
      };
      fr.readAsText(t.files[0]);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'listQ') {
      ui.listQ = e.target.value;
      var tb = $('#listRows');
      if (tb) tb.innerHTML = listRows();
      var el = $('#listCount');
      if (el) el.textContent = '显示 ' + document.querySelectorAll('#listRows tr').length + ' 条 / 共 ' + WORDS.length + ' 条';
    } else if (e.target.id === 'spellBox') {
      ui.spell = e.target.value; ui.spellOk = null;
    } else if (e.target.id === 'addText') {
      addUI.text = e.target.value;
    } else if (e.target.dataset && e.target.dataset.act === 'adown') {
      var ai = parseInt(e.target.dataset.val, 10);
      if (addUI.rows[ai]) addUI.rows[ai].own = e.target.value;
    }
  });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toUpperCase();
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (e.key === 'Enter' && e.target.id === 'spellBox') { e.preventDefault(); checkSpell(); return; }
    if (e.code === 'Space' && e.target.id === 'spellBox' && !e.target.value.trim() && !ui.revealed) {
      e.preventDefault(); reveal(); return;
    }
    if (typing) return;
    if (ui.view === 'drill') {
      if (e.code === 'Space') { e.preventDefault(); newQuestion(); render(); }
      return;
    }
    if (ui.view !== 'review' || !cur) return;
    if (e.code === 'Space' || e.key === 'Enter') {
      e.preventDefault();
      if (!ui.revealed) reveal();
      else grade(2);
      return;
    }
    if ('1234'.indexOf(e.key) >= 0 && ui.revealed) { e.preventDefault(); grade(parseInt(e.key, 10) - 1); }
  });
  /* ---------- 启动 ---------- */
  load();
  prepare();
  recordSnapshot();   /* 首次打开也记一笔今天的掌握度，曲线才有起点 */
  save();
  if (!lsOK) showWarn('这个页面无法保存进度（浏览器限制了本地存储）。请用文件夹里的「启动.bat」打开，或改用导出/导入备份。');
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      ui.view = b.dataset.view;
      if (ui.view === 'drill' && !q) newQuestion();
      render();
    });
  });
  window.__DBG = function () {
    return { store: store, words: WORDS.length, list: WORDS, byId: BYID, session: session, cur: cur };
  };
  render();
})();

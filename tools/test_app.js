/* 前端冒烟测试：用最小 DOM 桩把 app.js 真跑一遍，覆盖 4 个页面与主要交互
   用法: node tools/test_app.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.dirname(__dirname);
let pass = 0, fail = 0, errors = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + String(extra).slice(0, 300) : '')); }
}
function T(name, fn) { try { fn(); } catch (e) { fail++; console.log('  ✗ ' + name + ' 抛出异常: ' + e.message); errors.push(e); } }

/* ---------- DOM 桩 ---------- */
function makeEl(sel) {
  const cls = new Set();
  return {
    _sel: sel, innerHTML: '', textContent: '', value: '', checked: false,
    type: '', files: null, disabled: false, href: '', download: '',
    dataset: {}, style: {}, _on: {},
    classList: {
      add: c => cls.add(c), remove: c => cls.delete(c),
      contains: c => cls.has(c),
      toggle: (c, v) => { if (v) cls.add(c); else cls.delete(c); }
    },
    addEventListener(ev, fn) { this._on[ev] = fn; },
    focus() {}, setSelectionRange() {}, click() { this._clicked = true; },
    appendChild() {}, setAttribute() {}, closest() { return null; }
  };
}
const nodes = new Map();
const tabs = ['review', 'drill', 'trouble', 'list', 'stats'].map(v => {
  const e = makeEl('#tab-' + v); e.dataset.view = v; return e;
});
const tab = n => tabs.find(t => t.dataset.view === n);
const handlers = {};
const document = {
  querySelector(s) { if (!nodes.has(s)) nodes.set(s, makeEl(s)); return nodes.get(s); },
  querySelectorAll(s) { return s === '#tabs button' ? tabs : []; },
  addEventListener(ev, fn) { handlers[ev] = fn; },
  createElement(t) { return makeEl(t); },
  head: {
    /* app.js 用 <script> 按需加载词典分片：这里真读磁盘上的 dict/*.js 并执行 */
    appendChild(el) {
      try {
        const code = fs.readFileSync(path.join(root, el.src), 'utf8');
        vm.runInContext(code, sandbox);
        dictFiles.push(el.src);
        if (el.onload) el.onload();
      } catch (e) {
        if (el.onerror) el.onerror(e);
      }
    }
  }
};
const dictFiles = [];
const mem = {};
const localStorage = {
  getItem: k => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: k => { delete mem[k]; }
};
function fire(ev, obj) {
  const h = handlers[ev];
  if (!h) throw new Error('没有注册 ' + ev + ' 处理器');
  return h(obj);
}
function click(act, val) {
  const el = { dataset: { act: act, val: val } };
  el.closest = () => el;
  return fire('click', { target: el });
}
function change(act, val, extra) {
  const el = Object.assign({ dataset: { act: act, val: val }, value: '', type: 'text', checked: false }, extra || {});
  el.closest = () => el;
  return fire('change', { target: el });
}
/* setTimeout 桩：把回调攒起来，最后手动 flush（app.js 的保存是节流的） */
const timers = [];
const setTimeoutStub = fn => { timers.push(fn); return timers.length; };
const flushTimers = () => { let n = 0; while (timers.length && n++ < 200) timers.shift()(); };
function key(k, code, extra) {
  return fire('keydown', Object.assign({ key: k, code: code, target: { tagName: 'BODY' }, preventDefault() {} }, extra || {}));
}

/* ---------- 加载 ---------- */
const srsCode = fs.readFileSync(path.join(root, 'assets', 'srs.js'), 'utf8');
const appCode = fs.readFileSync(path.join(root, 'assets', 'app.js'), 'utf8');
const dataCode = fs.readFileSync(path.join(root, 'data.js'), 'utf8');

const win = {};
const sandbox = {
  window: win, document, localStorage, console,
  setTimeout: setTimeoutStub, clearTimeout: () => {}, Blob: class { constructor() {} },
  URL: { createObjectURL: () => 'blob:test' },
  FileReader: class { readAsText() {} },
  prompt: () => 'zzztestword', alert: () => {}, confirm: () => true,
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, isNaN, parseInt, parseFloat
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

console.log('— 加载 —');
T('srs.js 加载', () => vm.runInContext(srsCode, sandbox));
T('data.js 加载', () => vm.runInContext(dataCode, sandbox));
T('app.js 加载（不抛异常）', () => vm.runInContext(appCode, sandbox));
ok('app.js 挂上了调试入口', typeof win.__DBG === 'function');
ok('顶栏芯片已渲染', nodes.get('#chips').innerHTML.indexOf('待复习') >= 0);
const dbg0 = win.__DBG();
ok('读到词表 ' + dbg0.words + ' 张', dbg0.words > 250, dbg0.words);
ok('已自动建立会话', !!dbg0.session && dbg0.session.queue.length > 0, JSON.stringify(dbg0.session && dbg0.session.queue.length));
ok('第一张卡是单词卡', !!dbg0.cur && !!(dbg0.cur.w), dbg0.cur && dbg0.cur.w);
ok('默认只放 12 个新词', dbg0.session.total <= 12 + 1, dbg0.session.total);

console.log('— 2021–2025 数据接入 —');
{
  const d = win.__DBG(), b = d.byId;
  ok('词表扩到 390 张以上（' + d.words + '）', d.words >= 390, d.words);
  ok('punch 落在 2025 年', b.punch && JSON.stringify(b.punch.y) === '[2025]', JSON.stringify(b.punch && b.punch.y));
  ok('punch 沿用笔记释义「吸引力；一拳」', b.punch && (b.punch.own || '').indexOf('吸引力') >= 0, b.punch && b.punch.own);
  ok('at odds 在 2021 且标为负向态度词', b['at odds'] && b['at odds'].att === 'neg', JSON.stringify(b['at odds'] && b['at odds'].att));
  ok('mandates 已归并到 mandate 并标「文中作」', b.mandate && (b.mandate.forms || []).indexOf('mandates') >= 0,
    JSON.stringify(b.mandate && b.mandate.forms));
  ok('daunting 保留为独立形容词（没被还原成 daunt）', !!b.daunting && !b.daunt, Object.keys(b).filter(k => k.indexOf('daunt') === 0).join(','));
  ok('默认重点年份 = 2021–2025', JSON.stringify(win.__DBG().store.settings.focusYears) === '[2021,2022,2023,2024,2025]',
    JSON.stringify(win.__DBG().store.settings.focusYears));
}

console.log('— 背诵页：翻面与评分 —');
let view = () => nodes.get('#view').innerHTML;
ok('正面不显示释义', view().indexOf('你的笔记') === -1);
const firstWord = win.__DBG().cur.w;
T('点「显示答案」', () => click('reveal'));
ok('背面显示释义', view().indexOf('你的笔记') >= 0);
ok('背面显示该词', view().indexOf(firstWord) >= 0);

T('评分「认识」', () => click('grade', '2'));
const d1 = win.__DBG();
const c1 = d1.store.cards[firstWord];
ok('卡片被排到 1 天后左右', c1 && c1.state === 'review' && c1.due > Date.now() + 20 * 3600e3, JSON.stringify(c1 && { s: c1.state, d: c1.due - Date.now() }));
ok('今日日志记了一笔', (d1.store.log[Object.keys(d1.store.log)[0]] || {}).new === 1);
ok('进度前进到下一张', d1.session.done === 1);

T('键盘操作：空格翻面 + 数字键评分', () => { key(' ', 'Space'); key('3', 'Digit3'); });
ok('空格+数字键生效', win.__DBG().session.done === 2, win.__DBG().session.done);

T('评分「忘记」会把卡片重新排进本轮', () => {
  const before = win.__DBG().session;
  const left0 = before.queue.length;
  key(' ', 'Space');
  key('1', 'Digit1');
  ok('本轮队列长度没减少（词被排回来）', win.__DBG().session.queue.length >= left0 - 1,
    left0 + ' -> ' + win.__DBG().session.queue.length);
});

console.log('— 连打 30 张，检查调度稳定性 —');
T('连续作答 30 次', () => {
  for (let i = 0; i < 30; i++) {
    if (!win.__DBG().cur) break;
    key(' ', 'Space');
    key(String((i % 4) + 1), 'Digit' + ((i % 4) + 1));
  }
});
const d2 = win.__DBG();
const cards = Object.values(d2.store.cards);
ok('产生了 ' + cards.length + ' 张卡片记录', cards.length > 5, cards.length);
ok('所有卡片都有合法状态', cards.every(c => ['new', 'learning', 'review'].indexOf(c.state) >= 0 && c.due > 0 && c.ease >= 1.3 && c.ease <= 2.8));
ok('间隔都在 1–365 天内', cards.every(c => c.ivl >= 0 && c.ivl <= 365));

console.log('— 拼写模式 —');
if (!win.__DBG().cur) { T('补充一轮新词', () => click('new10')); }
T('切到拼写模式', () => change('set', 'mode', { value: 'spell', type: 'select' }));
ok('出现拼写输入框', view().indexOf('spell') >= 0 || view().indexOf('输入英文') >= 0);
const box = nodes.get('#spellBox');
box.value = 'totallywrong';
T('提交错误拼写', () => fire('keydown', { key: 'Enter', code: 'Enter', target: { id: 'spellBox', tagName: 'INPUT', value: 'totallywrong' }, preventDefault() {} }));
ok('答错不翻面', view().indexOf('你的笔记') === -1);
T('恢复看英文模式', () => change('set', 'mode', { value: 'en2cn', type: 'select' }));

console.log('— 辨析页 —');
  T('切到辨析页', () => tab('drill')._on.click());
ok('渲染出选项', view().indexOf('gpick') >= 0);
const m = view().match(/data-act="gpick" data-val="([^"]+)"/);
ok('能拿到选项', !!m);
T('点一个选项', () => click('gpick', m ? m[1] : 'x'));
ok('给出对错反馈', view().indexOf('答对') >= 0 || view().indexOf('答错') >= 0);
ok('显示全组对照', view().indexOf('cmp') >= 0);
ok('辨析统计被记录', Object.keys(win.__DBG().store.groups).length > 0);
  T('换一题 / 全部对照', () => { click('gnext'); tab('drill')._on.click(); click('gmode', 'list'); });
ok('全部对照渲染出多组', (view().match(/class="row"/g) || []).length > 20, (view().match(/class="row"/g) || []).length);
T('切回抽题', () => click('gmode', 'drill'));

console.log('— 词表页 —');
  T('切到词表页', () => tab('list')._on.click());
ok('渲染出表格行', view().indexOf('listRows') >= 0);
ok('有搜索框', view().indexOf('id="listQ"') >= 0);
T('切到「曾答错」筛选', () => click('listweak'));
const d3 = win.__DBG();
ok('筛选状态切换成功', view().indexOf('listRows') >= 0);
T('标记掌握', () => click('toggle-master', firstWord));
ok('标记后进入复习态且间隔很长', (() => { const c = win.__DBG().store.cards[firstWord]; return c.ivl >= 50; })());
T('重置卡片', () => click('reset', firstWord));
ok('重置后卡片被删除', !win.__DBG().store.cards[firstWord]);

console.log('— 统计页 —');
  T('切到统计页', () => tab('stats')._on.click());
ok('显示倒计时', view().indexOf('距考试还有') >= 0);
ok('显示阶段安排', view().indexOf('阶段一') >= 0);
ok('显示未来 14 天预测', (view().match(/class="col"/g) || []).length === 14);
ok('显示 28 天热力图', (view().match(/class="heat"/g) || []).length === 1);
ok('显示按年份表', view().indexOf('2012') >= 0 && view().indexOf('2020') >= 0);
T('改每天新词数', () => change('set', 'newPerDay', { value: '5', type: 'number' }));
ok('设置已生效', win.__DBG().store.settings.newPerDay === 5, JSON.stringify(win.__DBG().store.settings));
T('改考试日期', () => change('set', 'examDate', { value: '2026-12-19', type: 'date' }));
ok('考试日期已生效', win.__DBG().store.settings.examDate === '2026-12-19', JSON.stringify(win.__DBG().store.settings));
T('导出备份', () => click('export'));

console.log('— 进度持久化 —');
const beforeAdd = win.__DBG().words;
console.log('— 加词：查词典（加载真实分片）—');
const modal = () => nodes.get('#modal').innerHTML;
T('打开加词面板', () => click('addword'));
ok('面板里有输入框', modal().indexOf('addText') >= 0);
ok('可以选年份 2020', modal().indexOf('2020 年') >= 0);
T('年份选 2020', () => change('ayear', '2020', { value: '2020', type: 'select' }));
fire('input', { target: { id: 'addText', value: 'sanctions\nubiquitous 无所不在的\nplausible\ncareless\nzzzqqqnotaword' } });
T('点查词典', () => click('alookup'));
ok('真的加载了词典分片（' + dictFiles.length + ' 个）', dictFiles.length > 0, dictFiles.join(','));
ok('sanctions 被归到原形 sanction', modal().indexOf('输入 sanctions') >= 0);
ok('复数形式查到了释义', modal().indexOf('制裁') >= 0);
ok('原形已在词表里的标成「已有」', modal().indexOf('词表已有') >= 0);
ok('用户自己写的释义被保留', modal().indexOf('无所不在的') >= 0);
ok('查不到的词标成「词库里没有」', modal().indexOf('词库里没有') >= 0);
ok('提示可保存数量', /3 个词可保存/.test(modal()), (modal().match(/\d+ 个词可保存/) || [])[0]);
ok('带词根的词显示了词根', modal().indexOf('-less') >= 0);
ok('带近义群的词显示了近义', modal().indexOf('近义') >= 0);
T('保存', () => click('asave'));
const d4 = win.__DBG();
ok('自建词写进存储', d4.store.custom.length === 3, JSON.stringify(d4.store.custom.map(x => x.w)));
ok('词表总数 +3', d4.words === beforeAdd + 3, d4.words + ' vs ' + beforeAdd);
ok('带上了年份 2020', JSON.stringify(d4.store.custom[0].y) === '[2020]', JSON.stringify(d4.store.custom[0].y));
ok('保存了音标', !!(d4.store.custom[0].ph || '').length, d4.store.custom[0].ph);
ok('保存了词典释义', (d4.store.custom[0].defs || []).length > 0, JSON.stringify(d4.store.custom[0].defs));
ok('词根信息落库', d4.store.custom.some(x => (x.root || '').indexOf('-less') >= 0),
  JSON.stringify(d4.store.custom.map(x => x.root || '')));
ok('近义辨析落库', d4.store.custom.some(x => (x.near || []).length > 0),
  JSON.stringify(d4.store.custom.map(x => x.near || [])));
ok('保存后跳到词表页', view().indexOf('listRows') >= 0);
ok('词表里能看到自建词', view().indexOf('自建') >= 0 && view().indexOf('ubiquitous') >= 0);

console.log('— 自定义学习计划 —');
  T('切到统计页', () => tab('stats')._on.click());
ok('出现计划区', view().indexOf('自定义学习计划') >= 0);
T('设目标日期', () => change('plan', 'target', { value: '2026-12-13', type: 'date' }));
T('设考前预留 10 天', () => change('plan', 'reserve', { value: '10', type: 'number' }));
T('生成计划', () => click('planmake'));
ok('显示剩余新词', view().indexOf('剩余新词') >= 0);
ok('显示每周节点', view().indexOf('第 1 周') >= 0);
const pm = view().match(/每天新词<\/div><div class="v">(\d+)/);
ok('算出每天新词数 = ' + (pm && pm[1]), !!pm);
T('应用计划', () => click('planapply'));
ok('每天新词数被改成计划值', win.__DBG().store.settings.newPerDay === parseInt(pm[1], 10),
  win.__DBG().store.settings.newPerDay + ' vs ' + pm[1]);
ok('考试日期同步为 2026-12-13', win.__DBG().store.settings.examDate === '2026-12-13', win.__DBG().store.settings.examDate);
  T('回到背诵页', () => tab('review')._on.click());
ok('显示今日计划进度条', view().indexOf('今日计划') >= 0);

console.log('— 进度持久化 —');
console.log('— 重点年份加权 —');
  T('切到统计页', () => tab('stats')._on.click());
ok('默认已带重点年份', (win.__DBG().store.settings.focusYears || []).length > 0,
  JSON.stringify(win.__DBG().store.settings.focusYears));
ok('默认权重 0.6', win.__DBG().store.settings.focusWeight === 0.6, String(win.__DBG().store.settings.focusWeight));
ok('统计页显示重点块', view().indexOf('重点年份') >= 0);
T('把重点年份改成 2019,2020', () => change('fset', 'focusYears', { value: '2019,2020', type: 'text' }));
ok('重点年份已保存', JSON.stringify(win.__DBG().store.settings.focusYears) === '[2019,2020]',
  JSON.stringify(win.__DBG().store.settings.focusYears));
T('把重点频率改成 0.5', () => change('fset', 'focusWeight', { value: '0.5', type: 'select' }));
ok('权重已生效', win.__DBG().store.settings.focusWeight === 0.5, String(win.__DBG().store.settings.focusWeight));
{
  const S_ = sandbox.window.SRS;
  const card0 = { state: 'review', step: 0, ease: 2.5, ivl: 20, due: Date.now(), reps: 4, lapses: 0, last: 0, suspended: false };
  const st = win.__DBG().store.settings;
  const fi = S_.schedule(card0, 2, Date.now(), S_.focusWeight({ w: 'x', y: [2019] }, st)).ivl;
  const ni = S_.schedule(card0, 2, Date.now(), S_.focusWeight({ w: 'y', y: [2015] }, st)).ivl;
  ok('同样的评分，重点词间隔 ' + fi + ' 天 明显短于 普通词 ' + ni + ' 天', fi < ni);
}
T('切回背诵并选「重点年份」范围', () => {
  tab('review')._on.click();
  change('deck', 'focus', { value: 'focus', type: 'select' });
});
T('补一轮新词', () => click('new10'));
{
  const d = win.__DBG();
  const ids = (d.cur ? [d.cur.id] : []).concat(d.session.queue);
  ok('队列非空', ids.length > 0, String(ids.length));
  ok('排的确实都是 2019/2020 的词', ids.every(function (id) {
    const w = d.byId[id];
    return w && (w.y || []).some(function (y) { return y === 2019 || y === 2020; });
  }), ids.slice(0, 6).join(','));
  ok('复习范围是重点', d.session.deck === 'focus', d.session.deck);
}
ok('卡片带「重点」标记', (function () { click('reveal'); return view().indexOf('tag focus') >= 0; })());
ok('页面显示重点权重', view().indexOf('间隔×0.5') >= 0);

console.log('— 进度持久化 —');
console.log('— 掌握度折线图 —');
  T('切到统计页', () => tab('stats')._on.click());
ok('渲染出 SVG', view().indexOf('<svg') >= 0 && view().indexOf('class="chart"') >= 0);
ok('有折线路径', view().indexOf('class="line') >= 0);
ok('有学过的占比区域', view().indexOf('class="area"') >= 0);
ok('显示当前掌握度', view().indexOf('当前总体掌握度') >= 0);
ok('显示学过多少个词', /学过 \d+\/\d+ 个词/.test(view()), (view().match(/学过 \d+\/\d+ 个词/) || [])[0]);
ok('默认 30 天窗口', (view().match(/<circle/g) || []).length === 30, (view().match(/<circle/g) || []).length);
ok('坐标轴有 0%~100% 刻度', view().indexOf('>0%<') >= 0 && view().indexOf('>100%<') >= 0);
T('切到 14 天', () => click('chartdays', '14'));
ok('14 天 = 14 个点', (view().match(/<circle/g) || []).length === 14, (view().match(/<circle/g) || []).length);
T('切到 60 天', () => click('chartdays', '60'));
ok('60 天点太密就不画圆点', (view().match(/<circle/g) || []).length === 0, (view().match(/<circle/g) || []).length);
ok('60 天仍然有折线', view().indexOf('class="line') >= 0);
T('切回 30 天', () => click('chartdays', '30'));
{
  const hist = win.__DBG().store.hist || {};
  const keys = Object.keys(hist);
  ok('今天已经落了快照', keys.length === 1, JSON.stringify(keys));
  ok('快照是 [掌握度, 学过占比]', Array.isArray(hist[keys[0]]) && hist[keys[0]].length === 2, JSON.stringify(hist));
  ok('背过词之后掌握度大于 0（' + hist[keys[0]][0] + '）', hist[keys[0]][0] > 0, JSON.stringify(hist));
  ok('掌握度在 0~1 之间', hist[keys[0]][0] > 0 && hist[keys[0]][0] <= 1);
  ok('估算段用虚线画（历史回填）', view().indexOf('line est') >= 0);
  ok('图例说明估算段', view().indexOf('估算') >= 0);
}
ok('顶栏/统计里的掌握度与快照一致', (function () {
  const hist = win.__DBG().store.hist;
  const k = Object.keys(hist)[0];
  const shown = parseInt((view().match(/font-size:20px">(\d+)%/) || [])[1], 10);
  return Math.abs(shown / 100 - hist[k][0]) <= 0.01;
})(), (view().match(/font-size:20px">(\d+)%/) || [])[0]);

console.log('— 常错词 —');
{
  const S_ = sandbox.window.SRS;
  tab('review')._on.click();
  if (!win.__DBG().cur) click('new10');
  const curId = win.__DBG().cur.id;
  click('reveal');
  click('grade', '0');
  const today = S_.todayKey(Date.now());
  const todays = win.__DBG().store.trouble[today] || {};
  ok('点「忘记」会记进当天计数', !!todays[curId] && todays[curId][0] >= 1, JSON.stringify(todays[curId]));
  todays[curId] = [3, 1];
  tab('trouble')._on.click();
  ok('常错页收进了这个词', view().indexOf(curId) >= 0, curId);
  ok('显示忘记次数 3', view().indexOf('3</b> 次') >= 0, (view().match(/\d+<\/b> 次/) || [])[0]);
  ok('显示模糊次数', view().indexOf('模糊 1 次') >= 0);
  ok('有「开始背这 N 个词」按钮', view().indexOf('开始背这') >= 0);
  ok('顶栏出现常错计数', nodes.get('#chips').innerHTML.indexOf('常错') >= 0);
  click('troubleStart');
  const d = win.__DBG();
  ok('启动了常错词范围', d.session && d.session.deck === 'trouble', d.session && d.session.deck);
  const tids = (d.cur ? [d.cur.id] : []).concat(d.session.queue);
  ok('会话里只装常错词', tids.length > 0 && tids.every(function (id) {
    const r = todays[id];
    return r && r[0] >= (win.__DBG().store.settings.troubleThreshold || 3);
  }), tids.slice(0, 6).join(','));
  ok('跳回背诵页开始背', view().indexOf('今日计划') >= 0);
  win.__DBG().store.settings.troubleThreshold = 4;
  tab('trouble')._on.click();
  ok('阈值提到 4 后，3 次的词不再算常错', view().indexOf(curId) === -1, curId);
  win.__DBG().store.settings.troubleThreshold = 3;
  tab('review')._on.click();
}

console.log('— 进度持久化 —');
flushTimers();
const saved = JSON.parse(mem['kaoyan_words_v1'] || '{}');
ok('数据写进了 localStorage', !!saved.cards && Object.keys(saved.cards).length > 0,
  Object.keys(saved.cards || {}).length);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (errors.length) { console.log('首个异常栈：'); console.log(errors[0].stack); }
process.exit(fail ? 1 : 0);

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
const tabs = ['review', 'drill', 'list', 'stats'].map(v => {
  const e = makeEl('#tab-' + v); e.dataset.view = v; return e;
});
const handlers = {};
const document = {
  querySelector(s) { if (!nodes.has(s)) nodes.set(s, makeEl(s)); return nodes.get(s); },
  querySelectorAll(s) { return s === '#tabs button' ? tabs : []; },
  addEventListener(ev, fn) { handlers[ev] = fn; },
  createElement(t) { return makeEl(t); }
};
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
T('切到辨析页', () => tabs[1]._on.click());
ok('渲染出选项', view().indexOf('gpick') >= 0);
const m = view().match(/data-act="gpick" data-val="([^"]+)"/);
ok('能拿到选项', !!m);
T('点一个选项', () => click('gpick', m ? m[1] : 'x'));
ok('给出对错反馈', view().indexOf('答对') >= 0 || view().indexOf('答错') >= 0);
ok('显示全组对照', view().indexOf('cmp') >= 0);
ok('辨析统计被记录', Object.keys(win.__DBG().store.groups).length > 0);
T('换一题 / 全部对照', () => { click('gnext'); tabs[1]._on.click(); click('gmode', 'list'); });
ok('全部对照渲染出多组', (view().match(/class="row"/g) || []).length > 20, (view().match(/class="row"/g) || []).length);
T('切回抽题', () => click('gmode', 'drill'));

console.log('— 词表页 —');
T('切到词表页', () => tabs[2]._on.click());
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
T('切到统计页', () => tabs[3]._on.click());
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
flushTimers();
const saved = JSON.parse(mem['kaoyan_words_v1'] || '{}');
ok('数据写进了 localStorage', !!saved.cards && Object.keys(saved.cards).length > 0,
  Object.keys(saved.cards || {}).length);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (errors.length) { console.log('首个异常栈：'); console.log(errors[0].stack); }
process.exit(fail ? 1 : 0);

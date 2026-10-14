/* 内核测试：node tools/test_srs.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.dirname(__dirname);
const code = fs.readFileSync(path.join(root, 'assets', 'srs.js'), 'utf8');
const sandbox = { window: {}, Math, Date, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox.window.SRS;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
const DAY = 86400000, MIN = 60000;
const T0 = new Date('2026-10-14T09:00:00+08:00').getTime();
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.12 * b : tol);

console.log('— 新卡调度 —');
let c = S.newCard(T0);
let g = S.schedule(c, 0, T0);
ok('新卡「忘记」→ 学习态，1 分钟后到期', g.state === 'learning' && near(g.due - T0, MIN, 500), g.state + ' ' + (g.due - T0));
g = S.schedule(c, 1, T0);
ok('新卡「模糊」→ 学习态，5 分钟后到期', g.state === 'learning' && near(g.due - T0, 5 * MIN, 500));
g = S.schedule(c, 2, T0);
ok('新卡「认识」→ 复习态，1 天后到期', g.state === 'review' && g.ivl === 1 && near(g.due - T0, DAY, 2000));
g = S.schedule(c, 3, T0);
ok('新卡「太简单」→ 复习态，4 天后到期', g.state === 'review' && g.ivl === 4 && near(g.due - T0, 4 * DAY, 4000));
ok('原卡片未被修改（纯函数）', c.state === 'new' && c.reps === 0);

console.log('— 复习卡间隔增长 —');
let r = { state: 'review', step: 0, ease: 2.5, ivl: 1, due: T0, reps: 3, lapses: 0, last: 0, suspended: false };
const seq = [];
for (let i = 0; i < 6; i++) {
  r = S.schedule(r, 2, T0 + i * DAY);
  seq.push(r.ivl);
}
ok('连续「认识」间隔递增: ' + seq.join('→'), seq.every((v, i) => i === 0 || v > seq[i - 1]), seq.join(','));
ok('间隔上限 365 天', r.ivl <= 365, String(r.ivl));
ok('易度因子在 [1.3, 2.8]', r.ease >= 1.3 && r.ease <= 2.8, String(r.ease));

const lapsed = S.schedule({ state: 'review', step: 0, ease: 2.5, ivl: 30, due: T0, reps: 5, lapses: 0, last: 0, suspended: false }, 0, T0);
ok('复习卡「忘记」→ 回到学习态并计一次遗忘', lapsed.state === 'learning' && lapsed.lapses === 1, lapsed.state);
ok('复习卡「忘记」→ 间隔大幅缩短', lapsed.ivl < 30, String(lapsed.ivl));
ok('复习卡「忘记」→ 易度下降', lapsed.ease < 2.5, String(lapsed.ease));

const easy = S.schedule({ state: 'review', step: 0, ease: 2.5, ivl: 10, due: T0, reps: 5, lapses: 0, last: 0, suspended: false }, 3, T0);
ok('「太简单」比「认识」排得更远', easy.ivl > Math.round(10 * 2.5), easy.ivl + ' vs ' + Math.round(10 * 2.5));

console.log('— 组卷与额度 —');
const words = [];
for (let i = 0; i < 50; i++) words.push({ w: 'w' + i, kind: 'word' });
const store = { settings: Object.assign({}, S.DEFAULT_SETTINGS, { newPerDay: 10 }), cards: {}, log: {} };
let q = S.buildQueue(words, store, T0);
ok('首次组卷只放 10 个新词', q.ids.length === 10 && q.newCount === 10, q.ids.length + '');
ok('剩余未学正确', q.untouched === 50, String(q.untouched));
store.log[S.todayKey(T0)] = { new: 10, rev: 0, g: [0, 0, 0, 0] };
q = S.buildQueue(words, store, T0);
ok('今日额度用完后不再放新词', q.ids.length === 0, q.ids.length + '');
store.cards.w0 = { state: 'review', step: 0, ease: 2.5, ivl: 1, due: T0 - DAY, reps: 1, lapses: 0, last: 0, suspended: false };
store.cards.w1 = { state: 'review', step: 0, ease: 2.5, ivl: 1, due: T0 + DAY, reps: 1, lapses: 0, last: 0, suspended: false };
store.cards.w2 = { state: 'review', step: 0, ease: 2.5, ivl: 1, due: T0 - DAY, reps: 1, lapses: 0, last: 0, suspended: false };
q = S.buildQueue(words, store, T0);
ok('只放已到期的复习卡', q.dueCount === 2, String(q.dueCount));
store.cards.w0.suspended = true;
ok('暂停的卡片被跳过', S.buildQueue(words, store, T0).dueCount === 1);

console.log('— 统计 —');
const sum = S.summarize(words, store, T0);
ok('总数正确', sum.total === 50, String(sum.total));
ok('已暂停单列', sum.suspended === 1, String(sum.suspended));
ok('到期数正确（w2+w3，w0暂停）', sum.due === 1, String(sum.due));
const st = S.streak({ log: { [S.todayKey(T0)]: { new: 5, rev: 5 }, [S.todayKey(T0 - DAY)]: { new: 5, rev: 0 }, [S.todayKey(T0 - 2 * DAY)]: { new: 5, rev: 0 } } }, T0);
ok('连续打卡 3 天', st === 3, String(st));
const st2 = S.streak({ log: { [S.todayKey(T0 - DAY)]: { new: 5, rev: 0 } } }, T0);
ok('今天还没学不算断签', st2 === 1, String(st2));

console.log('— 时间显示 —');
ok('1 分钟', /分钟/.test(S.previewIntervals(S.newCard(T0), T0)[0]));
ok('1 天', /天/.test(S.previewIntervals(S.newCard(T0), T0)[2]));

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

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

console.log('— 学习计划反推 —');
const planWords = [];
for (let i = 0; i < 50; i++) planWords.push({ w: 'p' + i, y: [2012] });
const empty = { settings: {}, cards: {}, log: {} };
let pr = S.makePlan(planWords, empty, { targetDate: '2026-11-13', reserveDays: 7, now: T0 });
ok('日历天数 30 天', pr.calendarDays === 30, pr.calendarDays);
ok('扣掉考前 7 天后可学 23 天', pr.studyDays === 23, pr.studyDays);
ok('每天 3 个新词（50/23 向上取整）', pr.perDay === 3, pr.perDay);
ok('周节点 4 个', pr.weeks.length === 4, pr.weeks.length);
ok('第一周累计 21 个', pr.weeks[0].cumNew === 21, pr.weeks[0].cumNew);
ok('末周收敛到全部 50 个', pr.weeks[pr.weeks.length - 1].cumNew === 50, pr.weeks[pr.weeks.length - 1].cumNew);
ok('末周剩余 0', pr.weeks[pr.weeks.length - 1].left === 0);
ok('起止日期正确', pr.startDate === '2026-10-14' && pr.targetDate === '2026-11-13', pr.startDate + '~' + pr.targetDate);

const half = { settings: {}, cards: {}, log: {} };
for (let i = 0; i < 20; i++) half.cards['p' + i] = { state: 'review', step: 0, ease: 2.5, ivl: 5, due: T0 + DAY, reps: 2, lapses: 0, last: 0, suspended: false };
let r2 = S.makePlan(planWords, half, { targetDate: '2026-11-13', reserveDays: 7, now: T0 });
ok('已学过的词不计入新词', r2.fresh === 30, r2.fresh);
ok('新词少了，每天也变少', r2.perDay === 2, r2.perDay);

const many = [];
for (let i = 0; i < 400; i++) many.push({ w: 'q' + i, y: [2013] });
const r3 = S.makePlan(many, empty, { targetDate: '2026-10-24', reserveDays: 0, now: T0 });
ok('时间紧时每天新词数很大', r3.perDay === 40, r3.perDay);
ok('过紧时给出警告标记', r3.tight === true);

let r4 = S.makePlan(planWords, empty, { targetDate: '2026-10-15', reserveDays: 7, now: T0 });
ok('预留天数超过总天数时至少留 1 天', r4.studyDays === 1, r4.studyDays);
ok('这种情况下每天要学完所有新词', r4.perDay === 50, r4.perDay);

let r5 = S.makePlan(many, empty, { targetDate: '2026-11-13', reserveDays: 0, years: [2013], now: T0 });
ok('可以按年份限定范围', r5.total === 400, r5.total);
let r6 = S.makePlan(planWords.concat(many), empty, { targetDate: '2026-11-13', reserveDays: 0, years: [2012], now: T0 });
ok('限定 2012 年时不含 2013 的词', r6.total === 50, r6.total);
ok('默认目标日期为 60 天后', S.makePlan(planWords, empty, { now: T0 }).calendarDays === 60);

console.log('— 重点年份加权 —');
const fset = { focused: 1, focusYears: [2023], focusWeight: 0.6 };
ok('命中重点年份返回权重', S.focusWeight({ w: 'a', y: [2023] }, fset) === 0.6);
ok('非重点年份权重为 1', S.focusWeight({ w: 'b', y: [2015] }, fset) === 1);
ok('多个年份命中其一即算重点', S.isFocus({ w: 'c', y: [2015, 2023] }, fset) === true);
ok('非重点词 isFocus 为 false', S.isFocus({ w: 'd', y: [2015] }, fset) === false);
ok('没设重点年份时一律不加权', S.focusWeight({ w: 'e', y: [2023] }, {}) === 1);
ok('自己加的词（无年份）不加权', S.focusWeight({ w: 'f', y: [] }, fset) === 1);

const rc = { state: 'review', step: 0, ease: 2.5, ivl: 30, due: T0, reps: 5, lapses: 0, last: 0, suspended: false };
const norm = S.scheduleRaw(rc, 2, T0);
const wtd = S.schedule(rc, 2, T0, 0.6);
ok('重点词间隔被缩短（' + norm.ivl + ' → ' + wtd.ivl + ' 天）', wtd.ivl < norm.ivl && wtd.ivl >= 1);
ok('重点词到期时间跟着变早', Math.abs((wtd.due - T0) - wtd.ivl * DAY) <= 0.12 * wtd.ivl * DAY + 1);
ok('权重为 1 时与原调度完全一致', S.schedule(rc, 2, T0, 1).ivl === norm.ivl);
ok('权重不会把间隔压到 0 以下', S.schedule(rc, 2, T0, 0.3).ivl >= 1, String(S.schedule(rc, 2, T0, 0.3).ivl));
ok('学习态不受权重影响', S.schedule(S.newCard(T0), 0, T0, 0.6).state === 'learning');
ok('按钮提示也会反映加权的间隔', /\d/.test(S.previewIntervals(rc, T0, 0.6)[2]));

const fw = [];
for (let i = 0; i < 6; i++) fw.push({ w: 'n' + i, y: [2023] });
for (let i = 0; i < 6; i++) fw.push({ w: 'o' + i, y: [2015] });
const fstore = { settings: { newPerDay: 4, focusYears: [2023], focusWeight: 0.6, shuffleNew: false }, cards: {}, log: {} };
const fq = S.buildQueue(fw, fstore, T0);
ok('新词额度优先给重点年份', fq.ids.length === 4 && fq.ids.every(id => id[0] === 'n'), fq.ids.join(','));
ok('报告重点新词数量', fq.focusNew === 6 && fq.focusNewPicked === 4, fq.focusNew + ' / ' + fq.focusNewPicked);

fstore.cards.n1 = { state: 'review', step: 0, ease: 2.5, ivl: 5, due: T0 - 2 * DAY, reps: 3, lapses: 0, last: 0, suspended: false };
fstore.cards.o1 = { state: 'review', step: 0, ease: 2.5, ivl: 5, due: T0 - 5 * DAY, reps: 3, lapses: 0, last: 0, suspended: false };
fstore.log[S.todayKey(T0)] = { new: 4, rev: 0, g: [0, 0, 0, 0] };
const fq2 = S.buildQueue(fw, fstore, T0);
ok('到期卡片里重点词排最前（哪怕到期更晚）', fq2.ids[0] === 'n1', fq2.ids.join(','));
ok('报告重点到期数', fq2.focusDue === 1, String(fq2.focusDue));
const fsum = S.summarize(fw, fstore, T0);
ok('统计里单列出重点块', fsum.focus.total === 6 && fsum.focus.due === 1, JSON.stringify(fsum.focus));

console.log('— 总体掌握度 —');
const mw = [];
for (let i = 0; i < 10; i++) mw.push({ w: 'm' + i, y: [2015] });
const ms = { settings: {}, cards: {}, log: {} };
let msco = S.masteryScore(mw, ms, T0);
ok('一张都没学 → 掌握度 0', msco.score === 0, msco.score);
ok('学过占比也是 0', msco.touched === 0);

for (let i = 0; i < 5; i++) {
  ms.cards['m' + i] = { state: 'review', step: 0, ease: 2.5, ivl: 21, due: T0 + DAY, reps: 5, lapses: 0, last: T0 - 30 * DAY, suspended: false };
}
msco = S.masteryScore(mw, ms, T0);
ok('一半已掌握 → 掌握度 50%', Math.abs(msco.score - 0.5) < 1e-9, msco.score);
ok('学过占比 50%', Math.abs(msco.touched - 0.5) < 1e-9, msco.touched);

ms.cards.m9 = { state: 'learning', step: 0, ease: 2.5, ivl: 0, due: T0, reps: 1, lapses: 0, last: T0, suspended: false };
msco = S.masteryScore(mw, ms, T0);
ok('学习中的卡算 10%（0.5 + 0.1/10 = 0.51）', Math.abs(msco.score - 0.51) < 1e-9, msco.score);

const w1 = [{ w: 'x', y: [] }];
const mk = ivl => ({ settings: {}, log: {}, cards: { x: { state: 'review', step: 0, ease: 2.5, ivl: ivl, due: T0, reps: 2, lapses: 0, last: T0 - 5 * DAY, suspended: false } } });
ok('间隔 10 天 → 10/21', Math.abs(S.masteryScore(w1, mk(10), T0).score - 10 / 21) < 1e-9, S.masteryScore(w1, mk(10), T0).score);
ok('间隔超过 21 天不溢出，封顶 100%', S.memoryStrength({ state: 'review', ivl: 365 }) === 1);
ok('回填：那天还没学过的卡不计入', S.masteryScore(w1, mk(10), T0, T0 - 10 * DAY).score === 0);
ok('回填：学到之后就算上', Math.abs(S.masteryScore(w1, mk(10), T0, T0).score - 10 / 21) < 1e-9);
const s3 = { settings: {}, log: {}, cards: { x: { state: 'review', step: 0, ease: 2.5, ivl: 21, due: T0, reps: 5, lapses: 0, last: T0 - DAY, suspended: true } } };
ok('暂停的词不计入分母', S.masteryScore([{ w: 'x', y: [] }, { w: 'y', y: [] }], s3, T0).total === 1);

console.log('— 常错词 —');
const tw = [{ w: 'a', y: [2023] }, { w: 'b', y: [2023] }, { w: 'c', y: [2023] }];
const ts = { settings: {}, cards: {}, log: {}, trouble: {} };
const tk0 = S.todayKey(T0), tk1 = S.todayKey(T0 - DAY);
ts.trouble[tk0] = { a: [3, 0], b: [2, 4], c: [0, 5] };
let tl = S.troubleWords(tw, ts, { threshold: 3, days: 1, now: T0 });
ok('只有点满 3 次「忘记」的词进常错', tl.length === 1 && tl[0].id === 'a', JSON.stringify(tl.map(x => x.id)));
ok('模糊次数单独统计（不算进阈值）', tl[0].vague === 0 && tl[0].forgot === 3, JSON.stringify(tl[0]));
ok('2 次忘记不进常错', !tl.find(x => x.id === 'b'));

ts.trouble[tk0].b = [3, 1];
tl = S.troubleWords(tw, ts, { threshold: 3, days: 1, now: T0 });
ok('多个词都收进来', tl.length === 2, JSON.stringify(tl.map(x => x.id)));
ok('每个词的模糊次数也带出来', tl.find(x => x.id === 'b').vague === 1, JSON.stringify(tl.map(x => [x.id, x.vague])));

ts.trouble[tk1] = { c: [4, 0] };
ok('「今天」窗口不含昨天', S.troubleWords(tw, ts, { threshold: 3, days: 1, now: T0 }).length === 2);
tl = S.troubleWords(tw, ts, { threshold: 3, days: 7, now: T0 });
ok('「近 7 天」窗口包含昨天', tl.length === 3, JSON.stringify(tl.map(x => x.id)));
ok('按单日最多次数排序（4 次排第一）', tl[0].id === 'c', JSON.stringify(tl.map(x => [x.id, x.worst])));
ok('阈值调到 4 只剩 c', S.troubleWords(tw, ts, { threshold: 4, days: 7, now: T0 }).length === 1);
ok('阈值调到 2 三个都算', S.troubleWords(tw, ts, { threshold: 2, days: 7, now: T0 }).length === 3);
ok('没有记录的词不会进来', S.troubleWords([{ w: 'z', y: [] }], ts, { threshold: 3, days: 7, now: T0 }).length === 0);

console.log('— 常错词：历史全部 —');
const ts2 = { settings: {}, cards: {}, log: {}, trouble: {}, troubleAll: {} };
ts2.troubleAll.a = [9, 2, 4, 4, T0 - DAY];        // 累计忘 9 次，跨 4 天，单日最多 4
ts2.troubleAll.b = [3, 0, 1, 3, T0 - 5 * DAY];    // 3 次，集中在一天
ts2.troubleAll.c = [8, 0, 5, 2, T0 - 9 * DAY];    // 累计 8 次，但单日最多只有 2 → 不达标
let ta = S.troubleWords(tw, ts2, { threshold: 3, days: 0, now: T0 });
ok('历史全部只收「曾经某天达标」的词：' + ta.map(x => x.id).join(','), ta.length === 2 && ta[0].id === 'a' && ta[1].id === 'b',
  JSON.stringify(ta.map(x => x.id)));
ok('累计忘记次数带出来了（9 / 3）', ta[0].forgot === 9 && ta[1].forgot === 3, JSON.stringify(ta.map(x => x.forgot)));
ok('按累计忘记次数排序，9 次的排第一', ta[0].id === 'a');
ok('出现天数与单日最多都带出来', ta[0].dayCount === 4 && ta[0].worst === 4, JSON.stringify([ta[0].dayCount, ta[0].worst]));
ok('最近一次时间带出来', ta[0].last === T0 - DAY, String(ta[0].last));
ok('累计 8 次但单日没达标的 c 不收', !ta.find(x => x.id === 'c'));
ok('阈值调到 4 只剩 a', S.troubleWords(tw, ts2, { threshold: 4, days: 0, now: T0 }).length === 1);
ok('「全部」不受逐日记录影响（trouble 为空也能算）', Object.keys(ts2.trouble).length === 0 && ta.length === 2);
ok('days:7 仍走逐日逻辑（trouble 为空 → 0）', S.troubleWords(tw, ts2, { threshold: 3, days: 7, now: T0 }).length === 0);
ok('没有历史记录的词不进来', S.troubleWords([{ w: 'z', y: [] }], ts2, { threshold: 3, days: 0, now: T0 }).length === 0);

console.log('— 常错词：老数据迁移 —');
const oldStore = {
  trouble: {
    '2026-10-22': { x: [3, 1], y: [1, 0] },
    '2026-10-23': { x: [4, 0] }
  }
};
S.migrateTroubleAll(oldStore);
ok('迁移后生成累计表', !!oldStore.troubleAll && Object.keys(oldStore.troubleAll).length === 2);
ok('x：累计忘记 7、模糊 1、出现 2 天、单日最多 4',
  JSON.stringify(oldStore.troubleAll.x.slice(0, 4)) === '[7,1,2,4]', JSON.stringify(oldStore.troubleAll.x));
ok('y：累计忘记 1、出现 1 天', oldStore.troubleAll.y[0] === 1 && oldStore.troubleAll.y[2] === 1);
ok('最近一次取较晚的日期（10-23）', new Date(oldStore.troubleAll.x[4]).getDate() === 23,
  String(oldStore.troubleAll.x[4]));
ok('已有累计表时不会重复累加', (function () {
  S.migrateTroubleAll(oldStore);
  return oldStore.troubleAll.x[0] === 7;
})(), JSON.stringify(oldStore.troubleAll.x));

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);

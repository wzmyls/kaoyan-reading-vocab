# -*- coding: utf-8 -*-
"""词表解析/合并的回归测试：node 那两套是前端，这套管数据管线。
用法: python tools/test_parse.py
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PASS = FAIL = 0

def ok(name, cond, extra=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print('  OK  ' + name)
    else:
        FAIL += 1
        print('  ✗   ' + name + ('  -> ' + str(extra) if extra else ''))

def run(files, out):
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'parse_list.py')] + files + ['--out', out],
                       capture_output=True, text=True, encoding='utf-8', errors='ignore')
    if r.returncode != 0:
        raise SystemExit('解析失败:\n' + (r.stderr or '') + (r.stdout or ''))
    with open(out, encoding='utf-8') as f:
        return json.load(f)

def main():
    tmp = tempfile.mkdtemp(prefix='vocabtest_')
    old = os.path.join(ROOT, 'raw', '原始词表.txt')

    s21 = os.path.join(tmp, '2021.txt')
    with open(s21, 'w', encoding='utf-8') as f:
        f.write("""2021 年

1. 普通单词

单词你记录的中文含义

tactic策略
pretext借口
virtue美德

2. 词组

the likes of像……这样的人

3. 态度词

单词中文含义

dismissive轻蔑的

4. 易混词组

{pretext, context}
""")

    s22 = os.path.join(tmp, '2022.txt')
    with open(s22, 'w', encoding='utf-8') as f:
        f.write("""2022年

conspicuous显眼的
impose强加
""")

    print('— 单文件解析 —')
    a = run([s21], os.path.join(tmp, 'a.json'))
    ok('识别出 2021 年的 4 条（含态度词）', len(a['words']) == 4, len(a['words']))
    ok('年份标成 2021', sorted({y for w in a['words'] for y in w['y']}) == [2021],
       sorted({y for w in a['words'] for y in w['y']}))
    ok('词组被单独归类', len(a['phrases']) == 1 and a['phrases'][0]['w'] == 'the likes of',
       json.dumps(a['phrases'], ensure_ascii=False))
    ok('态度词被标记', len([w for w in a['words'] if w['att']]) == 1)
    ok('易混组解析出来了', len(a['groups']) == 1 and a['groups'][0]['items'] == ['pretext', 'context'],
       json.dumps(a['groups'], ensure_ascii=False))

    print('— 不写「1. 普通单词」小节也能解析（纯列表）—')
    b = run([s22], os.path.join(tmp, 'b.json'))
    ok('纯列表文件也能读懂', len(b['words']) == 2, json.dumps([w['w'] for w in b['words']], ensure_ascii=False))
    ok('年份 2022 正确', sorted({y for w in b['words'] for y in w['y']}) == [2022])

    print('— 多文件合并 —')
    c = run([old, s21, s22], os.path.join(tmp, 'c.json'))
    ys = sorted({y for w in c['words'] for y in w['y'] if y})
    ok('年份覆盖 2012–2022', ys[0] == 2012 and ys[-1] == 2022, ys)
    ok('原词表一条都没丢（仍是 276 条）', len([w for w in c['words'] if max(w['y'] or [0]) <= 2020]) == 276,
       len([w for w in c['words'] if max(w['y'] or [0]) <= 2020]))
    w21 = sorted(w['w'] for w in c['words'] if 2021 in w['y'])
    w22 = sorted(w['w'] for w in c['words'] if 2022 in w['y'])
    ok('2021 年的词：' + ','.join(w21), w21 == ['dismissive', 'pretext', 'tactic', 'virtue'], w21)
    ok('2022 年的词：' + ','.join(w22), w22 == ['conspicuous', 'impose'], w22)
    ok('合并后词组总数 = 原有 + 新增', len(c['phrases']) == 20, len(c['phrases']))
    ok('易混组也跟着合并', len(c['groups']) == 38, len(c['groups']))

    print('— 合并后生成 data.js（含重点年份自动切换）—')
    din = os.path.join(tmp, 'data.js')
    r = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'build_deck.py'),
                        '--list', os.path.join(tmp, 'c.json'),
                        '--cache', os.path.join(ROOT, 'raw', 'dict_cache.json'),
                        '--out', din],
                       capture_output=True, text=True, encoding='utf-8', errors='ignore')
    ok('build_deck 跑通', r.returncode == 0, (r.stderr or '')[-300:])
    deck = json.loads(open(din, encoding='utf-8').read().split('=', 1)[1].rstrip(';\n'))
    all_y = sorted({y for w in deck['words'] for y in (w.get('y') or []) if y})
    ok('卡片年份已到 2022', all_y[-1] == 2022, all_y)
    ok('重点年份自动切成最近的真题年份', deck['focusYears'] == [2021, 2022],
       json.dumps(deck['focusYears']))
    fw = sorted(w['w'] for w in deck['words'] if set(w.get('y') or []) & set(deck['focusYears']))
    # 6 个单词 + 1 个词组（the likes of，词组同样带年份、同样加权）
    ok('重点词就是 2021/2022 这几个：' + ','.join(fw), len(fw) == 7, len(fw))

    print('— 年份行不会误吃正文 —')
    sys.path.insert(0, os.path.join(ROOT, 'tools'))
    import parse_list as PL
    ok('「一、2012 年」识别为年份', PL.year_header('一、2012 年') == 2012)
    ok('「2021年」识别为年份', PL.year_header('2021年') == 2021)
    ok('「2021」单独一行识别为年份', PL.year_header('2021') == 2021)
    ok('「2012ought to应该」不当成年份行', PL.year_header('2012ought to应该') is None)
    ok('年份开头的小标签仍算年份行', PL.year_header('2021 年真题') == 2021)
    ok('长句子不当年份行', PL.year_header('2020 年阅读真题里的长难句分析请结合上下文理解') is None)

    print('\n通过 %d 项，失败 %d 项' % (PASS, FAIL))
    return 1 if FAIL else 0

if __name__ == '__main__':
    sys.exit(main())

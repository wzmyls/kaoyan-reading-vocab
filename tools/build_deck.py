# -*- coding: utf-8 -*-
"""合并 词表 + 词典缓存 + 人工校正层 -> data.js
用法: python tools/build_deck.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_FORMS = ("withdraw", "sell", "care", "plead", "feat", "irritate", "benefit",
              "executive", "incentive", "sanction", "impose", "unfold", "condemn")

def load(name):
    p = name if os.path.isabs(name) else os.path.join(ROOT, name)
    with open(p, encoding='utf-8') as f:
        return json.load(f)

def merge_own(a, b):
    parts = []
    for s in (a or '').split('；') + (b or '').split('；'):
        s = s.strip()
        if s and s not in parts:
            parts.append(s)
    return '；'.join(parts)

def lev(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]

NOISE = ('<古>', '<史>', '<俚>', '<方>', '<废>', '<诗>', '<谑>')

def tidy_defs(defs, n=3):
    """去掉古义/冷僻义等噪音，最多保留 n 条"""
    out = []
    for d in defs:
        parts = [p for p in d.split('；') if not any(k in p for k in NOISE)]
        s = '；'.join(p for p in parts if p.strip()).strip()
        if s:
            out.append(s)
    return out[:n]

def tidy_syno(syno, nw=4):
    out = []
    for s in syno[:1]:
        out.append([s[0], (s[1] or [])[:nw], s[2]])
    return out

def main():
    args = sys.argv[1:]
    def opt(name, default):
        return args[args.index(name) + 1] if name in args else default
    lst = load(opt('--list', 'raw/词表.json'))
    cache = load(opt('--cache', 'raw/dict_cache.json'))
    man = load(opt('--manual', 'tools/manual.json'))
    out_path = opt('--out', os.path.join(ROOT, 'data.js'))
    fixes, attmap = man.get('fixes', {}), man.get('att', {})
    gnotes = man.get('groups', {})

    entries = []
    for item in lst['words']:
        e = dict(item); e['kind'] = 'word'
        entries.append(e)
    for item in lst['phrases']:
        e = dict(item); e['kind'] = 'phrase'
        entries.append(e)
    for item in man.get('extra_words', []):
        entries.append({'w': item['w'], 'own': item.get('own', ''), 'note': '',
                        'y': [], 'att': bool(item.get('att')), 'kind': 'word', 'extra': True})

    # ---- 合并到规范词形 ----
    merged, order, lemma_map, forms = {}, [], {}, {}
    for e in entries:
        key = e['w'].lower()
        entry_cache = cache.get(key) or {}
        canon = key
        if e['kind'] == 'word' and not e.get('extra'):
            proto = (entry_cache.get('lemma') or '').strip().lower()
            if proto and proto != key and ' ' not in proto and proto in BASE_FORMS:
                canon = proto
                lemma_map[key] = proto
        e['canon'] = canon
        forms.setdefault(canon, [])
        if e['w'].lower() != canon and e['w'] not in forms[canon]:
            forms[canon].append(e['w'])
        if canon not in merged:
            merged[canon] = {'canon': canon, 'own': '', 'note': '', 'y': [], 'att': False, 'kind': e['kind']}
            order.append(canon)
        m = merged[canon]
        m['own'] = merge_own(m['own'], e['own'])
        if e.get('note') and e['note'] not in m['note']:
            m['note'] = merge_own(m['note'], e['note']) if m['note'] else e['note']
        for y in e['y']:
            if y not in m['y']:
                m['y'].append(y)
        if e.get('att'):
            m['att'] = True
        if e.get('extra'):
            m['extra'] = True
        if e['kind'] == 'phrase':
            m['kind'] = 'phrase'

    # ---- 组装卡片 ----
    words = []
    for canon in order:
        m = merged[canon]
        d = cache.get(canon) or {}
        if not d.get('defs'):
            for f in forms.get(canon, []):
                cand = cache.get(f.lower()) or {}
                if cand.get('defs'):
                    d = cand
                    break
        w = {
            'w': canon,
            'kind': m['kind'],
            'y': sorted(m['y']),
            'own': m['own'],
            'defs': tidy_defs(d.get('defs') or []),
            'ph': d.get('us') or '',
            'uk': d.get('uk') or '',
            'ex': (d.get('ex') or [])[:2],
            'root': d.get('root') or '',
            'rel': (d.get('rel') or [])[:4],
            'disc': (d.get('disc') or [])[:3],
            'syno': tidy_syno(d.get('syno') or []),
            'collins': d.get('collins') or 0
        }
        if m['kind'] == 'phrase':
            w['ex'] = ((d.get('ex') or []) + (d.get('collins_ex') or []))[:2]
            if not w['ex'] and d.get('inline_ex'):
                w['ex'] = d['inline_ex'][:2]
        if forms.get(canon):
            w['forms'] = forms[canon]
        if m['att']:
            w['att'] = attmap.get(canon, 'neu')
        if canon in fixes:
            w['fixes'] = fixes[canon]
        if m.get('note'):
            w['note'] = m['note']
        if m.get('extra'):
            w['extra'] = True
        words.append(w)

    byid = {}
    for w in words:
        byid[w['w']] = w

    # ---- 易混组 ----
    groups = []
    for g in lst['groups']:
        items = [x for x in g['items'] if x in byid]
        groups.append({'y': g.get('y'), 'items': items, 'key': ','.join(g['items'])})
    for g in man.get('extra_groups', []):
        items = [x for x in g['items'] if x in byid]
        if len(items) >= 2:
            groups.append({'y': g.get('y'), 'items': items, 'key': ','.join(g['items'])})
    for g in groups:
        g['note'] = gnotes.get(g['key'], g.get('note', ''))

    conf = {}
    for g in groups:
        for a in g['items']:
            for b in g['items']:
                if a != b:
                    conf.setdefault(a, [])
                    if b not in conf[a]:
                        conf[a].append(b)
    # 自动形近词兜底（编辑距离 <= 2 且首字母相同）
    ids = [w['w'] for w in words if w['kind'] == 'word' and ' ' not in w['w']]
    auto = {}
    for i, a in enumerate(ids):
        if len(a) < 5:
            continue
        for b in ids[i + 1:]:
            if len(b) < 5 or a[0] != b[0]:
                continue
            if abs(len(a) - len(b)) > 2:
                continue
            if lev(a, b) <= 2 and not a.startswith(b) and not b.startswith(a):
                auto.setdefault(a, []).append(b)
                auto.setdefault(b, []).append(a)
    for a, bs in auto.items():
        for b in bs[:2]:
            conf.setdefault(a, [])
            if b not in conf[a] and len(conf[a]) < 5:
                conf[a].append(b)
                byid[a]['auto_conf'] = True
    for a, bs in conf.items():
        if a in byid and bs:
            byid[a]['conf'] = bs[:5]

    # 重点年份：优先取最近几年的真题（离考试越近，参考价值越大）
    all_years = sorted({y for w in words for y in (w.get('y') or []) if y})
    FOCUS_DEFAULT = [2021, 2022, 2023, 2024, 2025]
    focus_years = [y for y in FOCUS_DEFAULT if y in all_years]
    if not focus_years:
        focus_years = all_years[-2:] if len(all_years) >= 2 else list(all_years)
    years_txt = '%d–%d' % (all_years[0], all_years[-1]) if all_years else ''
    deck = {
        'deckName': '考研英语一 阅读生词 · ' + years_txt,
        'builtAt': '2026-10-14',
        'focusYears': focus_years,
        'words': words,
        'groups': groups
    }
    out = 'window.WORD_DATA = ' + json.dumps(deck, ensure_ascii=False, separators=(',', ':')) + ';\n'
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(out)

    # ---- 报告 ----
    nw = len([w for w in words if w['kind'] == 'word'])
    np_ = len([w for w in words if w['kind'] == 'phrase'])
    na = len([w for w in words if w.get('att')])
    print('生成 data.js：单词 %d + 词组 %d = %d 张卡；易混组 %d；态度词 %d' % (nw, np_, len(words), len(groups), na))
    print('年份范围: %s  重点年份: %s（%d 张卡）' % (
        years_txt, ','.join(str(y) for y in focus_years),
        len([w for w in words if set(w.get('y') or []) & set(focus_years)])))
    print('体积: %.0f KB' % (len(out.encode('utf-8')) / 1024.0))
    nod = [w['w'] for w in words if not w['defs']]
    nex = [w['w'] for w in words if not w['ex']]
    nph = [w['w'] for w in words if not w['ph']]
    print('无词典释义: %d %s' % (len(nod), ' / '.join(nod[:25])))
    print('无例句: %d %s' % (len(nex), ' / '.join(nex[:25])))
    print('无音标: %d' % len(nph))
    print('--- 词形归并（原文形式 -> 卡片词形）---')
    print('  ' + '  '.join('%s->%s' % (k, v) for k, v in sorted(lemma_map.items())))
    print('--- 自动补充的形近词（前 20 组）---')
    shown = 0
    for a in sorted(auto):
        if byid.get(a, {}).get('auto_conf') and shown < 20:
            print('  %s ≈ %s' % (a, ' / '.join(auto[a][:3])))
            shown += 1

if __name__ == '__main__':
    main()

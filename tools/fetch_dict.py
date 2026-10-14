# -*- coding: utf-8 -*-
"""批量抓取词典数据（音标/释义/词根/同根词/辨析/双语例句），带缓存与多线程。
用法: python tools/fetch_dict.py [--force] [--workers 6]
输出: raw/dict_cache.json
"""
import json, os, re, sys, time, threading, traceback
import urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, 'raw', 'dict_cache.json')
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")

def fetch(q):
    url = "https://dict.youdao.com/jsonapi?q=" + urllib.parse.quote(q)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://dict.youdao.com/"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode('utf-8', 'ignore'))

def get(j, *keys):
    """安全取值：取每个 key 之前先把 list 拆成第一个元素"""
    cur = j
    for k in keys:
        while isinstance(cur, list):
            if not cur:
                return None
            cur = cur[0]
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur

def aslist(x):
    if x is None or x == '' or x == {}:
        return []
    return x if isinstance(x, list) else [x]

def clean_html(s):
    if not s:
        return ''
    s = re.sub(r'<[^>]+>', '', str(s))
    s = (s.replace('&quot;', '"').replace('&amp;', '&')
          .replace('&lt;', '<').replace('&gt;', '>').replace('&#39;', "'"))
    return re.sub(r'\s+', ' ', s).strip()

def pick_examples(j, word, n=2):
    pairs = []
    for key in ('blng_sents_part', 'auth_sents_part'):
        for s in aslist(get(j, key, 'sentence-pair')):
            if not isinstance(s, dict):
                continue
            en = clean_html(s.get('sentence') or s.get('sentence-eng') or '')
            zh = clean_html(s.get('sentence-translation') or '')
            if en and zh and en != zh:
                pairs.append((en, zh))
    for w0 in aslist(get(j, 'ec', 'word')):
        if not isinstance(w0, dict):
            continue
        for tr in aslist(w0.get('trs')):
            for l in aslist(get(tr, 'tr', 'l', 'i')):
                if isinstance(l, dict):
                    for s in aslist(l.get('sentence')):
                        en, zh = clean_html(s.get('en')), clean_html(s.get('zh'))
                        if en and zh:
                            pairs.append((en, zh))
    head = word.lower().split()[0]
    seen, scored = set(), []
    for en, zh in pairs:
        if en in seen:
            continue
        seen.add(en)
        L = len(en)
        if L < 25 or L > 170 or head not in en.lower():
            continue
        score = -abs(L - 80)
        if 40 <= L <= 120:
            score += 25
        scored.append((score, en, zh))
    scored.sort(key=lambda x: -x[0])
    return [{'en': e, 'zh': z} for _, e, z in scored[:n]]

def extract(j, word):
    out = {'q': word}
    ews = aslist(get(j, 'ec', 'word'))
    if ews and isinstance(ews[0], dict):
        w0 = ews[0]
        out['us'] = w0.get('usphone') or ''
        out['uk'] = w0.get('ukphone') or ''
        out['lemma'] = str(w0.get('prototype') or '').strip().lower()
        defs, inl = [], []
        for tr in aslist(w0.get('trs')):
            for l in aslist(get(tr, 'tr', 'l', 'i')):
                if isinstance(l, str) and l.strip():
                    defs.append(l.strip())
                elif isinstance(l, dict):
                    for s in aslist(l.get('sentence')):
                        en, zh = clean_html(s.get('en')), clean_html(s.get('zh'))
                        if en and zh:
                            inl.append({'en': en, 'zh': zh})
        out['defs'] = defs
        wfs = []
        for x in aslist(w0.get('wfs')):
            wf = x.get('wf') if isinstance(x, dict) else None
            if isinstance(wf, dict) and wf.get('name') and wf.get('value'):
                wfs.append([wf['name'], wf['value']])
        out['wfs'] = wfs
        if inl:
            out['inline_ex'] = inl
    for c0 in aslist(get(j, 'collins', 'collins_entries'))[:1]:
        if not isinstance(c0, dict):
            continue
        star = c0.get('star')
        if star:
            try:
                out['collins'] = int(str(star).strip())
            except Exception:
                pass
        for ent in aslist(get(c0, 'entries', 'entry')):
            for te in aslist(get(ent, 'tran_entry')):
                for s in aslist(get(te, 'exam_sents', 'sent')):
                    en, zh = clean_html(s.get('eng_sent')), clean_html(s.get('chn_sent'))
                    if en and zh:
                        out.setdefault('collins_ex', []).append({'en': en, 'zh': zh})
    for e0 in aslist(get(j, 'etym', 'etyms', 'zh'))[:1]:
        if isinstance(e0, dict) and e0.get('value'):
            out['root'] = clean_html(e0.get('value'))
            out['root_desc'] = clean_html(e0.get('desc') or '')
    rel = []
    for r in aslist(get(j, 'rel_word', 'rels')):
        pos = get(r, 'rel', 'pos') or ''
        for wd in aslist(get(r, 'rel', 'words'))[:3]:
            if isinstance(wd, dict) and wd.get('word'):
                rel.append([str(pos), wd['word'], clean_html(wd.get('tran') or '')])
    out['rel'] = rel[:6]
    stem = get(j, 'rel_word', 'stem')
    if stem:
        out['stem'] = str(stem).lower()
    us = []
    for d0 in aslist(get(j, 'discriminate', 'data')):
        for u in aslist(get(d0, 'usages')):
            if isinstance(u, dict) and u.get('headword') and u.get('usage'):
                us.append([u['headword'], clean_html(u['usage'])])
    out['disc'] = us[:6]
    syn = []
    for s0 in aslist(get(j, 'syno', 'synos'))[:2]:
        d0 = get(s0, 'syno')
        if not isinstance(d0, dict):
            continue
        ws = [x.get('w') for x in aslist(d0.get('ws')) if isinstance(x, dict) and x.get('w')]
        if ws:
            syn.append([str(d0.get('pos') or ''), ws[:6], clean_html(d0.get('tran') or '')])
    out['syno'] = syn
    out['ex'] = pick_examples(j, word, 2)
    return out

def targets_of():
    with open(os.path.join(ROOT, 'raw', '词表.json'), encoding='utf-8') as f:
        data = json.load(f)
    out, seen = [], set()
    for w in data['words']:
        k = w['w'].lower()
        if k not in seen:
            seen.add(k); out.append(w['w'])
    for p in data['phrases']:
        k = p['w'].lower()
        if k not in seen:
            seen.add(k); out.append(p['w'])
    mpath = os.path.join(ROOT, 'tools', 'manual.json')
    if os.path.exists(mpath):
        with open(mpath, encoding='utf-8') as f:
            man = json.load(f)
        for it in man.get('extra_words', []):
            k = it['w'].lower()
            if k not in seen:
                seen.add(k); out.append(it['w'])
    return out

def main():
    force = '--force' in sys.argv
    workers = 6
    if '--workers' in sys.argv:
        workers = int(sys.argv[sys.argv.index('--workers') + 1])
    targets = targets_of()
    print('待抓取: %d 条' % len(targets))
    cache = {}
    if os.path.exists(CACHE) and not force:
        with open(CACHE, encoding='utf-8') as f:
            cache = json.load(f)
    if force:
        cache = {}
    # 失败过的条目要重试
    todo = [t for t in targets
            if t.lower() not in cache or (cache[t.lower()] or {}).get('error')]
    usable = len([t for t in targets if (cache.get(t.lower()) or {}).get('defs')])
    print('缓存可用: %d  本次需抓: %d  线程: %d' % (usable, len(todo), workers))
    if not todo:
        print('全部已缓存，无需抓取。')
        return
    lock = threading.Lock()
    state = {'done': 0, 'ok': 0, 'fail': 0, 'tb': 0}

    def work(t):
        err = None
        for attempt in range(3):
            try:
                return t, extract(fetch(t), t), None
            except Exception as e:
                err = e
                if attempt < 2:
                    time.sleep(0.7 * (attempt + 1))
        return t, {'q': t, 'error': '%s: %s' % (type(err).__name__, err)}, err

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for t, res, err in ex.map(work, todo):
            with lock:
                cache[t.lower()] = res
                state['done'] += 1
                if err is None:
                    state['ok'] += 1
                else:
                    state['fail'] += 1
                    if state['tb'] < 2:
                        state['tb'] += 1
                        print('  ! %s 出错：%s' % (t, err))
                        if state['tb'] == 1:
                            traceback.print_exception(type(err), err, err.__traceback__)
                if state['done'] % 25 == 0 or state['done'] == len(todo):
                    with open(CACHE, 'w', encoding='utf-8') as f:
                        json.dump(cache, f, ensure_ascii=False)
                    print('  进度 %d/%d  成功 %d 失败 %d' % (state['done'], len(todo), state['ok'], state['fail']), flush=True)
    with open(CACHE, 'w', encoding='utf-8') as f:
        json.dump(cache, f, ensure_ascii=False)
    bad = [t for t in targets if (cache.get(t.lower()) or {}).get('error')]
    miss = [t for t in targets if not (cache.get(t.lower()) or {}).get('defs')]
    print('完成。缓存条目 %d；出错 %d；无释义 %d' % (len(cache), len(bad), len(miss)))
    if bad:
        print('  出错: ' + ' / '.join(bad[:20]))
    if miss:
        print('  无释义: ' + ' / '.join(miss[:40]))

if __name__ == '__main__':
    main()

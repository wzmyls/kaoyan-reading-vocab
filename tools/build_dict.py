# -*- coding: utf-8 -*-
"""把 ECDICT 裁剪成浏览器内置词典（分片 JS），供「加词」时离线查询。

用法:
  python tools/build_dict.py --src <ECDICT 解压目录> [--sample]
  python tools/build_dict.py --src "C:/Users/xx/AppData/Local/Temp/ecdict_src/ECDICT-master"

输出:
  dict/d00.js ... dict/d15.js   词典分片（按词哈希分片，按需加载）
  dict/ecdict-aux.js            不规则词形表 + 词根表 + 近义辨析表

注意: 辅助文件名必须避开 aux.js —— AUX 是 Windows 保留设备名，
      叫 aux.js 的文件在 Win32 路径解析里会被当成设备，git clone/checkout 直接失败。
"""
import csv, json, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'dict')
SHARDS = 16

EXAM_TAGS = {'zk', 'gk', 'cet4', 'cet6', 'ky', 'ielts', 'toefl', 'gre'}
WORD_RE = re.compile(r"^[a-z][a-z'\-]{1,21}$")

def shard_of(word):
    h = sum(ord(c) for c in word)
    return h % SHARDS

DOMAIN_TAGS = ('医', '化', '机', '计', '经', '网络', '法', '电', '建', '植', '生化',
               '药', '农', '生物', '数', '物', '力', '天', '海', '军', '商', '纺')

def fix_phonetic(s):
    """ECDICT 音标混用旧式记法：Cyrillic ә、ASCII 重音符号、: 表长音，统一成 IPA"""
    if not s:
        return ''
    s = str(s).strip().strip('/')
    for a, b in (('\u04d9', 'ə'), ('\u0454', 'ɛ'), ("'", 'ˈ'), ('"', 'ˈ'), ('.', 'ˌ'), (':', 'ː')):
        s = s.replace(a, b)
    return re.sub(r'\s+', '', s)

def clean_translation(s, maxseg=4, maxlen=150):
    """去掉领域标签、还原换行，最多保留 maxseg 段"""
    if not s:
        return ''
    s = str(s).replace('\\n', ' ||| ').replace('\r', ' ').replace('\n', ' ||| ')
    s = re.sub(r'\[(?:%s)\]' % '|'.join(DOMAIN_TAGS), ' ', s)
    segs = []
    for part in s.split('|||'):
        part = re.sub(r'\s+', ' ', part).strip(' /,;，；、')
        part = re.sub(r'^[/,;，；、\s]+', '', part)
        if part:
            segs.append(part)
    out, used = [], 0
    for x in segs[:maxseg]:
        if used + len(x) > maxlen:
            break
        out.append(x)
        used += len(x)
    return ' / '.join(out)[:maxlen]

def as_int(v):
    try:
        return int(str(v).strip() or 0)
    except Exception:
        return 0

def want(row):
    """是否收录：考试大纲词汇 / 柯林斯 / 牛津核心 / 词频靠前"""
    w = (row.get('word') or '').strip().lower()
    if not WORD_RE.match(w):
        return False
    if not clean_translation(row.get('translation')):
        return False
    tags = set((row.get('tag') or '').split())
    if tags & EXAM_TAGS:
        return True
    if as_int(row.get('collins')) >= 1 or as_int(row.get('oxford')) == 1:
        return True
    frq, bnc = as_int(row.get('frq')), as_int(row.get('bnc'))
    return (0 < frq <= 25000) or (0 < bnc <= 25000)

def entry_of(row):
    e = {
        'p': fix_phonetic(row.get('phonetic')),
        't': clean_translation(row.get('translation')),
        'o': (row.get('pos') or '').strip(),
        'c': as_int(row.get('collins')),
        'y': as_int(row.get('oxford')),
        'g': ' '.join(sorted(set((row.get('tag') or '').split()) & EXAM_TAGS)),
        'x': (row.get('exchange') or '').strip()[:80],
        'f': as_int(row.get('frq')),
    }
    return {k: v for k, v in e.items() if v not in ('', 0)}

def build_roots(src):
    """wordroot.txt 是 JSON：{词根: {meaning, class, origin, example:[词...]}}"""
    p = os.path.join(src, 'wordroot.txt')
    out = {}
    if not os.path.exists(p):
        return out
    with open(p, encoding='utf-8', errors='ignore') as f:
        try:
            data = json.load(f)
        except Exception:
            return {}
    if not isinstance(data, dict):
        return {}
    for k, v in data.items():
        if not isinstance(v, dict):
            continue
        e = {}
        if v.get('meaning'):
            e['m'] = str(v['meaning']).strip()[:160]
        if v.get('class'):
            e['c'] = str(v['class']).strip()[:40]
        if v.get('origin'):
            e['o'] = str(v['origin']).strip()[:30]
        ex = [w for w in (v.get('example') or []) if isinstance(w, str) and len(w) <= 18]
        if ex:
            e['e'] = ex[:24]
        if e:
            out[str(k).strip()] = e
    return out

def build_groups(src, max_per_word=2, note_len=120):
    """resemble.txt：'% 词1, 词2' 开头，下面 '这组词都…' + '- 词: 区别'"""
    p = os.path.join(src, 'resemble.txt')
    if not os.path.exists(p):
        return {}
    groups, cur = [], None
    with open(p, encoding='utf-8', errors='ignore') as f:
        for ln in f:
            s = ln.rstrip('\n').strip()
            if not s:
                continue
            if s.startswith('%'):
                words = [w.strip().lower() for w in re.split(r'[,，、]', s[1:]) if w.strip()]
                cur = {'words': words, 'head': '', 'notes': {}}
                groups.append(cur)
                continue
            if cur is None:
                continue
            m = re.match(r"^-\s*([A-Za-z][A-Za-z'\-]*)\s*[:：]\s*(.+)$", s)
            if m:
                cur['notes'].setdefault(m.group(1).lower(), m.group(2).strip())
                continue
            if not cur['head'] and not s.startswith('-'):
                cur['head'] = s
    idx = {}
    for g in groups:
        if len(g['words']) < 2:
            continue
        for w in g['words']:
            lst = idx.setdefault(w, [])
            if len(lst) < max_per_word:
                note = g['notes'].get(w, '')[:note_len]
                item = {'w': g['words'][:6]}
                if note:
                    item['n'] = note
                elif g['head']:
                    item['h'] = g['head'][:note_len]
                lst.append(item)
    return idx

def sample(src):
    path = os.path.join(src, 'ecdict.csv')
    with open(path, encoding='utf-8-sig', newline='') as f:
        r = csv.DictReader(f)
        for i, row in enumerate(r):
            if i % 90000 == 0:
                print('  [%d] %s' % (i, json.dumps({k: (v or '')[:60] for k, v in row.items()}, ensure_ascii=False)))
            if i > 400000:
                break
    for name in ('wordroot.txt', 'resemble.txt'):
        p = os.path.join(src, name)
        print('--- %s ---' % name)
        if name.endswith('.txt') and name.startswith('wordroot'):
            with open(p, encoding='utf-8', errors='ignore') as f:
                try:
                    data = json.load(f)
                except Exception as e:
                    print('  JSON 解析失败: %s' % e)
                    f.seek(0)
                    print('  ' + f.readline()[:200])
                    continue
            print('  顶层类型: %s，条目数: %d' % (type(data).__name__, len(data)))
            for i, (k, v) in enumerate(data.items()):
                if i >= 3:
                    break
                print('  %r -> %s' % (k, json.dumps(v, ensure_ascii=False)[:200]))
        else:
            with open(p, encoding='utf-8', errors='ignore') as f:
                lines = [l.rstrip('\n') for l in f]
            print('  总行数: %d' % len(lines))
            marks = [i for i, l in enumerate(lines) if l.startswith('%')]
            print('  词群数(=%% 开头行数): %d' % len(marks))
            if marks:
                a = marks[0]
                print('  第一个词群（片段）:')
                for l in lines[a:a + 9]:
                    print('    ' + l[:150])

def main():
    args = sys.argv[1:]
    src = None
    if '--src' in args:
        src = args[args.index('--src') + 1]
    if not src:
        print('需要 --src <ECDICT 目录>')
        return 1
    if '--sample' in args:
        sample(src)
        return 0
    csv_path = os.path.join(src, 'ecdict.csv')
    print('读取 ' + csv_path)
    os.makedirs(OUT, exist_ok=True)

    shards = collections.defaultdict(dict)
    aliases = {}          # 不规则词形 -> 原形
    total = kept = 0
    multi = {}
    with open(csv_path, encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            total += 1
            if not want(row):
                continue
            w = row['word'].strip().lower()
            if w in shards[shard_of(w)] and len(w) > len(row.get('word', '')):
                continue
            shards[shard_of(w)][w] = entry_of(row)
            kept += 1
            ex = (row.get('exchange') or '')
            if ex:
                for part in ex.split('/'):
                    if ':' not in part:
                        continue
                    kind, val = part.split(':', 1)
                    val = val.strip().lower()
                    if not val or val == w or not WORD_RE.match(val):
                        continue
                    base = w
                    if kind == '0':
                        base = val
                        continue
                    multi.setdefault(val, base)
    # 只保留「原形之外还需要提示」的：
    # 简单加 s/es/ed/ing/d 就能猜到的形式不收录（前端用规则处理）
    def predictable(form, base):
        if form == base + 's' or form == base + 'es' or form == base + 'd' or form == base + 'ed' or form == base + 'ing':
            return True
        if base.endswith('e') and form == base[:-1] + 'ing':
            return True
        if base.endswith('y') and form == base[:-1] + 'ies':
            return True
        if len(base) > 2 and base[-1] not in 'aeiou' and form == base + base[-1] + 'ing':
            return True
        if len(base) > 2 and base[-1] not in 'aeiou' and form == base + base[-1] + 'ed':
            return True
        return False
    for form, base in multi.items():
        if form in shards[shard_of(form)]:
            continue
        if predictable(form, base):
            continue
        aliases[form] = base

    # 别名也要能被查到，放进对应分片（只存指针，省体积）
    for form, base in aliases.items():
        shards[shard_of(form)][form] = {'r': base}

    files = []
    for i in range(SHARDS):
        d = shards[i]
        body = 'window.ECDICT=window.ECDICT||{};window.ECDICT[' + str(i) + ']=' + \
               json.dumps(d, ensure_ascii=False, separators=(',', ':')) + ';\n'
        p = os.path.join(OUT, 'd%02d.js' % i)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(body)
        files.append((i, len(d), len(body.encode('utf-8'))))

    roots = build_roots(src)
    groups = build_groups(src)
    aux = {'roots': roots, 'groups': groups}
    ap = os.path.join(OUT, 'ecdict-aux.js')
    with open(ap, 'w', encoding='utf-8') as f:
        f.write('window.ECDICT_AUX=' + json.dumps(aux, ensure_ascii=False, separators=(',', ':')) + ';\n')

    print('原始条目 %d，收录 %d，别名 %d' % (total, kept, len(aliases)))
    total_kb = sum(x[2] for x in files) / 1024.0
    print('分片共 %.1f MB，最大分片 %.0f KB' % (total_kb / 1024, max(x[2] for x in files) / 1024.0))
    print('  ' + '  '.join('d%02d:%d条/%.0fKB' % (i, n, kb / 1024.0) for i, n, kb in files))
    print('aux.js: %.0f KB（词根 %d 条，近义辨析词 %d 条）' % (
        os.path.getsize(ap) / 1024.0, len(roots), len(groups)))
    return 0

if __name__ == '__main__':
    sys.exit(main())

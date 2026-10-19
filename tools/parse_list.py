# -*- coding: utf-8 -*-
"""把 docx 抽出的纯文本解析成结构化词表 -> raw/词表.json
结构: {"words":[{w,own,note,y:[..],att:bool,kind}], "phrases":[...], "groups":[{y,items}]}
"""
import json, re, sys, os, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

YEAR_HEAD = re.compile(r'^(?:[一二三四五六七八九十]+[、.．]\s*)?(20\d{2})\s*年?(.*)$')
SEC_NUM = re.compile(r'^\d{1,2}[.．、]\s*(.+?)\s*$')
GROUP_RE = re.compile(r'^\{\s*(.+?)\s*\}\s*$')
NOTE_MARKERS = ('原笔记', '原记录', '待核对', '待确认', '不确定', '原笔迹', '原字迹', '字迹',
                '划改', '需要结合', '已更正', '之前误识别', '暂保留', '疑似', '或相应语境')
SKIP_WORDS = ('汇总', '核对', '统计', '说明', '附录', '重复词')

def is_skip_header(line):
    """整节跳过的汇总章节，如『十一、所有词组汇总』『六、重复词核对』"""
    s = line.strip()
    if not re.match(r'^[一二三四五六七八九十]+[、.．]', s):
        return False
    return any(w in s for w in SKIP_WORDS)

def section_bucket(line):
    """小节标题 -> 归类：『1. 原始词条』『2. 大括号中的易混词组』『2. 词组单独保留』"""
    m = SEC_NUM.match(line.strip())
    if not m:
        return None
    t = m.group(1)
    if len(t) > 24 or re.search(r'[A-Za-z]', t):
        return None
    if '易混' in t:
        return '易混词组'
    if '态度' in t:
        return '态度词'
    if '词组' in t or '搭配' in t or '短语' in t:
        return '词组'
    if '词条' in t or '单词' in t or '词汇' in t:
        return '普通单词'
    return None

def norm_en(s):
    return re.sub(r'\s+', ' ', s.strip()).replace('\u2019', "'")

def year_header(line):
    """识别「一、2012 年」「2021年」「2021」这类年份分节行（避免误吃正文）"""
    s = line.strip()
    m = YEAR_HEAD.match(s)
    if not m:
        return None
    rest = m.group(2).strip(' \t：:、.．-—')
    if re.search(r'[A-Za-z]', rest) or len(rest) > 12:
        return None
    return int(m.group(1))

def split_note(cn):
    """把括号里的『存疑备注』从释义中摘出来"""
    notes = []
    def take(inner):
        if any(k in inner for k in NOTE_MARKERS):
            notes.append(inner)
            return ''
        return None
    def repl_fw(m):
        r = take(m.group(1))
        return r if r is not None else m.group(0)
    def repl_hw(m):
        r = take(m.group(1))
        return r if r is not None else m.group(0)
    out = re.sub(r'（([^（）]*)）', repl_fw, cn)
    out = re.sub(r'\(([^()]*)\)', repl_hw, out)
    out = re.sub(r'[；;，,\s]+$', '', out).strip()
    return out, '；'.join(notes)

def split_entry(line):
    """把『单词中文释义』切成 (英文, 中文)"""
    s = line.strip()
    # 表格行：「序号<TAB>英文<TAB>释义」或「英文<2+空格>释义」
    if '\t' in s or re.search(r'[^\s] {2,}[^\s]', s):
        cells = [c.strip() for c in re.split(r'\t+| {2,}', s) if c.strip()]
        en = cn = None
        for c in cells:
            if en is None:
                if re.search(r'[A-Za-z]', c) and not re.search(r'[\u4e00-\u9fff]', c):
                    en = c
                continue
            if re.search(r'[\u4e00-\u9fff]', c):
                cn = c
                break
        if en and cn:
            return norm_en(en), cn
    m = re.match(r'^([^\u4e00-\u9fff]*?)([\u4e00-\u9fff].*)$', s)
    if not m:
        return None
    en = m.group(1).strip()
    cn = m.group(2).strip()
    if not re.search(r'[A-Za-z]', en):
        return None
    en = norm_en(en)
    return en, cn

def parse_args(argv):
    files, out = [], os.path.join(ROOT, 'raw', '词表.json')
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--out' and i + 1 < len(argv):
            i += 1
            out = argv[i]
        elif not a.startswith('-'):
            files.append(a)
        i += 1
    if not files:
        files = [os.path.join(ROOT, 'raw', '原始词表.txt')]
    return files, out

def main():
    files, out_path = parse_args(sys.argv[1:])
    words, phrases, groups = [], [], []
    total_lines = 0
    # 逐文件解析：每个文件都是独立的一份词表，
    # 年份分节和「汇总章节」的跳过标记必须在文件边界重置，
    # 否则前一份文件末尾的汇总章节会把它之后的文件全部吃掉。
    for path in files:
        with open(path, encoding='utf-8') as f:
            lines = [l.strip() for l in f]
        total_lines += len(lines)
        year, bucket, skip = None, '普通单词', False
        for ln in lines:
            if not ln:
                continue
            if is_skip_header(ln):
                skip = True
                continue
            y = year_header(ln)
            if y:
                year, bucket, skip = y, '普通单词', False
                continue
            if skip:
                continue
            b = section_bucket(ln)
            if b:
                bucket = b
                continue
            if '你特别指出遗漏' in ln:
                year, bucket = None, '遗漏补充'
                continue
            if bucket in ('普通单词', '态度词', '遗漏补充'):
                got = split_entry(ln)
                if not got:
                    continue
                en, cn = got
                cn, note = split_note(cn)
                words.append({'w': en, 'own': cn, 'note': note,
                              'y': [year] if year else [], 'att': bucket == '态度词'})
            elif bucket == '词组':
                got = split_entry(ln)
                if got:
                    en, cn = got
                    cn, note = split_note(cn)
                    phrases.append({'w': en, 'own': cn, 'note': note,
                                    'y': [year] if year else []})
                    continue
                # 词组单独成行（没写释义）：若前面已作为词条收过，改归到词组
                name = norm_en(ln)
                if re.match(r"^[A-Za-z][A-Za-z'\- ]*$", name):
                    for w in words:
                        if w['w'].lower() == name.lower() and (not year or year in w['y']):
                            w['phrase'] = True
                            break
            elif bucket == '易混词组':
                g = GROUP_RE.match(ln)
                if g:
                    items = [x.strip().lower() for x in re.split(r'[,，]', g.group(1)) if x.strip()]
                    groups.append({'y': year, 'items': items})
    print('读入 %d 个文件，共 %d 行' % (len(files), total_lines))

    out = {'words': words, 'phrases': phrases, 'groups': groups}
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print('输出: ' + out_path)

    # ---- 摘要 ----
    uniq = {}
    for w in words:
        uniq.setdefault(w['w'].lower(), set()).update(w['y'])
    print('普通/态度词条目: %d  去重后: %d' % (len(words), len(uniq)))
    print('词组: %d  易混组: %d' % (len(phrases), len(groups)))
    print('态度词条目: %d' % len([w for w in words if w['att']]))
    print('--- 有存疑备注的条目 ---')
    for w in words + phrases:
        if w['note']:
            print('  %-18s %s' % (w['w'], w['note'][:70]))
    print('--- 重复出现的词 ---')
    for k, ys in sorted(uniq.items()):
        cnt = len([w for w in words if w['w'].lower() == k])
        if cnt > 1:
            print('  %-18s x%d  年份%s' % (k, cnt, sorted(ys)))

if __name__ == '__main__':
    main()

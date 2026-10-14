# -*- coding: utf-8 -*-
"""把 docx 抽出的纯文本解析成结构化词表 -> raw/词表.json
结构: {"words":[{w,own,note,y:[..],att:bool,kind}], "phrases":[...], "groups":[{y,items}]}
"""
import json, re, sys, os, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

YEAR_HEAD = re.compile(r'^(?:[一二三四五六七八九十]+[、.．]\s*)?(20\d{2})\s*年?(.*)$')
SEC_RE = re.compile(r'^([1-4])\.\s*(普通单词|词组|态度词|易混词组)\s*$')
SKIP_RE = re.compile(r'^十[一二三四五六七八九]、')
GROUP_RE = re.compile(r'^\{\s*(.+?)\s*\}\s*$')
NOTE_MARKERS = ('原笔记', '原记录', '待核对', '不确定', '原笔迹', '需要结合', '已更正',
                '之前误识别', '暂保留', '疑似', '或相应语境')

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
    m = re.match(r'^([^\u4e00-\u9fff]*?)([\u4e00-\u9fff].*)$', line)
    if not m:
        return None
    en = m.group(1).strip()
    cn = m.group(2).strip()
    if not re.search(r'[A-Za-z]', en):
        return None
    en = re.sub(r'\s+', ' ', en).replace('\u2019', "'")
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
            if SKIP_RE.match(ln):
                skip = True
            if skip:
                continue
            y = year_header(ln)
            if y:
                year, bucket = y, '普通单词'
                continue
            m = SEC_RE.match(ln)
            if m:
                bucket = m.group(2)
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
                if not got:
                    continue
                en, cn = got
                cn, note = split_note(cn)
                phrases.append({'w': en, 'own': cn, 'note': note,
                                'y': [year] if year else []})
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

# -*- coding: utf-8 -*-
"""把 docx 抽出的纯文本解析成结构化词表 -> raw/词表.json
结构: {"words":[{w,own,note,y:[..],att:bool,kind}], "phrases":[...], "groups":[{y,items}]}
"""
import json, re, sys, os, io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

YEAR_RE = re.compile(r'^[一二三四五六七八九十]+、\s*(\d{4})\s*年')
SEC_RE = re.compile(r'^([1-4])\.\s*(普通单词|词组|态度词|易混词组)\s*$')
SKIP_RE = re.compile(r'^十[一二三四五六七八九]、')
GROUP_RE = re.compile(r'^\{\s*(.+?)\s*\}\s*$')
NOTE_MARKERS = ('原笔记', '原记录', '待核对', '不确定', '原笔迹', '需要结合', '已更正',
                '之前误识别', '暂保留', '疑似', '或相应语境')

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

def main():
    src = os.path.join(ROOT, 'raw', '原始词表.txt')
    with open(src, encoding='utf-8') as f:
        lines = [l.strip() for l in f]

    words, phrases, groups = [], [], []
    year, bucket, skip = None, None, False

    for ln in lines:
        if not ln:
            continue
        if SKIP_RE.match(ln):
            skip = True
        if skip:
            continue
        m = YEAR_RE.match(ln)
        if m:
            year, bucket = int(m.group(1)), None
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

    out = {'words': words, 'phrases': phrases, 'groups': groups}
    dst = os.path.join(ROOT, 'raw', '词表.json')
    with open(dst, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)

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

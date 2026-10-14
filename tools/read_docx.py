# -*- coding: utf-8 -*-
"""从 .docx 中抽取纯文本（仅用标准库，不需要 python-docx）。
用法: python tools/read_docx.py <输入.docx> <输出.txt>
"""
import sys, zipfile, re, html

def docx_text(path):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        xml = z.read('word/document.xml').decode('utf-8', 'ignore')
    # 段落切分：把 </w:p> 当换行；表格单元格 </w:tc> 当制表符
    xml = re.sub(r'</w:tc>', '\t', xml)
    xml = re.sub(r'<w:br[^>]*/>', '\n', xml)
    xml = re.sub(r'<w:tab[^>]*/>', '\t', xml)
    paras = re.split(r'</w:p>', xml)
    out = []
    for p in paras:
        texts = re.findall(r'<w:t[^>]*>(.*?)</w:t>', p, re.S)
        line = ''.join(texts)
        line = html.unescape(line)
        line = line.replace('\u00a0', ' ').rstrip('\t')
        out.append(line)
    return out

def main():
    src, dst = sys.argv[1], sys.argv[2]
    paras = docx_text(src)
    lines = [p.strip() for p in paras]
    # 去掉连续空行
    cleaned = []
    prev_blank = False
    for ln in lines:
        if ln == '':
            if prev_blank:
                continue
            prev_blank = True
        else:
            prev_blank = False
        cleaned.append(ln)
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('\n'.join(cleaned))
    nonblank = [c for c in cleaned if c]
    print('总段落: %d  非空行: %d  总字符: %d' % (len(cleaned), len(nonblank), sum(len(c) for c in cleaned)))
    print('--- 前 60 行 ---')
    for ln in nonblank[:60]:
        print(ln)

if __name__ == '__main__':
    main()

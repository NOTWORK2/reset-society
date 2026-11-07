"""Stamp every local CSS/JS link in the pages with a new ?v= version.

GitHub Pages lets browsers cache CSS/JS for 10 minutes. Without a new version
number, a visitor can get a new page with old styles/scripts right after an
update. Run this before each commit:  python tools/bump-version.py
"""
import re, time, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
version = time.strftime("%Y%m%d%H%M")
pattern = re.compile(r'((?:href|src)="(?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?"')
for page in ["index.html", "book.html", "admin.html"]:
    p = root / page
    text = p.read_text(encoding="utf-8")
    new, n = pattern.subn(lambda m: f'{m.group(1)}?v={version}"', text)
    p.write_text(new, encoding="utf-8")
    print(f"{page}: {n} links -> v={version}")

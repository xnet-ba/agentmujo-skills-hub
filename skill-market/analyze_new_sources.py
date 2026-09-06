# -*- coding: utf-8 -*-
import os, re, json

MARKET_JS = r"C:\Users\Admin\Documents\Dashboard\skill-market\skills-data\meta.js"
BASE = r"C:\Users\Admin\AppData\Local\Temp\opencode\skill-sources"

FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n(?:---|\.\.\.)", re.DOTALL)
KVP_RE = re.compile(r"^(\w[\w-]*):\s*(.*)$")

def parse_skill_md(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception:
        return (None, None)
    m = FRONTMATTER_RE.match(content)
    if not m:
        return (None, None)
    fm = m.group(1)
    fields = {}
    for line in fm.splitlines():
        km = KVP_RE.match(line.strip())
        if km:
            fields[km.group(1).lower()] = km.group(2).strip()
    name = fields.get("name")
    desc = fields.get("description")
    if not name or not desc:
        return (None, None)
    name = name.strip('"').strip("'").strip()
    return (name, desc)

def load_market_names():
    with open(MARKET_JS, "r", encoding="utf-8") as f:
        s = f.read()
    body = s.split("= ", 1)[1].rstrip().rstrip(";").strip()
    data = json.loads(body)
    names = set()
    for item in data:
        n = item.get("name")
        if n:
            names.add(n.strip('"').strip("'").strip())
    return names

REPOS = [
    ("nexu-io/open-design", "nexu-io-open-design", None),
    ("nexu-io/motion-anything", "nexu-io-motion-anything", None),
    ("nexu-io/html-anything", "nexu-io-html-anything", None),
    ("mvanhorn/printing-press-library", "mvanhorn-printing-press-library", None),
    ("openai/plugins", "openai-plugins", None),
    ("nvidia/skills", "nvidia-skills", None),
    ("thedaviddias/Front-End-Checklist", "thedaviddias-front-end-checklist", None),
    ("thedaviddias/ux-patterns-for-developers", "thedaviddias-ux-patterns", None),
    ("diegosouzapw/awesome-omni-skill", "diegosouzapw-awesome-omni-skill", None),
    ("ruvnet/ruflo", "ruvnet-ruflo", None),
]

def main():
    market = load_market_names()
    print("Market existing skill names: %d" % len(market))
    print("=" * 72)
    print("%-40s%6s%6s%10s%8s" % ("repo", "all", "good", "inMarket", "netNew"))
    print("-" * 72)
    all_netnew = set()
    for label, sub, include in REPOS:
        root = os.path.join(BASE, sub)
        paths = [os.path.join(r, f) for r, _, fs in os.walk(root) for f in fs if f.lower() == "skill.md"]
        total = len(paths)
        good_names = {}
        for p in paths:
            n, d = parse_skill_md(p)
            if n:
                good_names.setdefault(n.lower(), n)
        good_set = set(good_names.values())
        good = len(good_set)
        in_market = len(good_set & market)
        netnew = set(g for g in good_set if g not in market)
        all_netnew |= netnew
        print("%-40s%6d%6d%10d%8d" % (label, total, good, in_market, len(netnew)))
    print("-" * 72)
    print("Total unique net-new across all repos: %d" % len(all_netnew))

if __name__ == "__main__":
    main()


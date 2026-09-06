import os, json, re
from collections import Counter

SRC_ROOT = r"C:\Users\Admin\AppData\Local\Temp\opencode\skill-sources"
OUT_DIR = r"C:\Users\Admin\Documents\Dashboard\skill-market"

# ---------------- category rules (mirror of JS) ----------------
CAT_ORDER = ["webapp-frontend","backend-api","data-ai-ml","code-quality","git-workflow",
             "testing","security","debugging","agent-orchestration","devops-infra",
             "automation-tools","content-docs"]
CAT_LABEL = {
  "webapp-frontend":"Web & frontend","backend-api":"Backend & API","data-ai-ml":"Data, AI & ML",
  "code-quality":"Code quality","git-workflow":"Git & workflow","testing":"Testing",
  "security":"Security","debugging":"Debugging","agent-orchestration":"Agents & orchestration",
  "devops-infra":"DevOps & infra","automation-tools":"Automation & tools","content-docs":"Content & docs"
}
CAT_RULES = {
  "webapp-frontend": [r"frontend|ui-|design|tailwind|react|vue|svelte|next|html|css|ux|shadcn|daisyui|webapp|landing|slides|banner|brand|animation|three"],
  "backend-api": [r"backend|api|graphql|fastapi|flask|django|node|express|grpc|rest|openapi|server|microservice|lambda|function"],
  "data-ai-ml": [r"data|ml\b|machine.learning|ai\b|llm|prompt|embedding|rag\b|vector|pandas|sql\b|database|numpy|model|tensor"],
  "code-quality": [r"code.review|refactor|lint|clean.code|quality|simplif|coverage|static|verification|audit"],
  "git-workflow": [r"git\b|github|gitlab|pull.request|commit|branch|merge|release|changelog|versioning|workflow"],
  "testing": [r"test|e2e|playwright|cypress|jest|vitest|pytest|tdd|selenium|bdd|cucumber"],
  "security": [r"security|secur|auth|encrypt|vulnerab|pentest|hardening|threat|compliance|jwt|oauth|saml|gdpr"],
  "debugging": [r"debug|troubleshoot|error|trace|diagnos|fix|incident|log|monitor|observab"],
  "agent-orchestration": [r"agent|orchestrat|workflow|delegate|multi.agent|autonomous|skill|subagent|context|memory"],
  "devops-infra": [r"devops|docker|kubernetes|k8s|terraform|cloud|aws|azure|gcp|ci.?cd|deploy|infrastructure|infra"],
  "automation-tools": [r"automation|integration|sync|mcp|n8n|zapier|scripting|cli\b|tool"],
  "content-docs": [r"doc|writing|content|readme|markdown|blog|docs|article|copywriting|translat"],
}
def categorize(name, desc):
    hay = (name + " " + desc).lower()
    for c in CAT_ORDER:
        for r in CAT_RULES[c]:
            if re.search(r, hay):
                return c
    return "automation-tools"

# ---------------- source definitions (priority ascending) ----------------
def walk_skill_dirs(base):
    base = os.path.abspath(base)
    for dirpath, dirs, files in os.walk(base):
        if '__pycache__' in dirpath: continue
        if 'SKILL.md' in files:
            rel = os.path.relpath(dirpath, base).replace(os.sep, '/')
            folder = os.path.basename(dirpath)
            yield (rel, folder, dirpath)

# ---------------- source definitions (priority ascending) ----------------
sources = []
def add_source(key, base, prio, only=None, exclude=None):
    entries = list(walk_skill_dirs(base))
    sources.append({'key': key, 'prio': prio, 'entries': entries,
                    'only': only, 'exclude': exclude})

S = SRC_ROOT
# local installed skills (highest priority)
add_source('local', r"C:\Users\Admin\Documents\Dashboard\.opencode\skills", 0)
# anthropic official top-level skills
add_source('anthropic', os.path.join(S, "anthropics-skills", "skills"), 1)
# addyosmani engineering pack
add_source('addyosmani', os.path.join(S, "addy-agent-skills", "skills"), 2)
# microsoft curated top-level (.github/skills) + plugins' skills (skip SDK plugin trees/manifests)
add_source('microsoft', os.path.join(S, "microsoft-skills", ".github", "skills"), 3)
add_source('microsoft-plugins', os.path.join(S, "microsoft-skills", ".github", "plugins"), 3,
           only=lambda rel, folder: '/skills/' in rel)
# composio — full repo incl. composio-skills automation connectors; only skip system/demo dirs
add_source('composio', os.path.join(S, "composio"), 3,
           only=lambda rel, folder: not any(p in rel for p in
              ['scripts','examples','reference','theme','fonts','.github']))
# alireza breadth — monorepo with domain directories; skip system/plugin dirs and .gemini symlink stubs
ALIREZA_SKIP_DIRS = ['.claude','.claude-plugin','.codex','.codex-plugin','.gemini','.github',
                     '.hermes','.vibe','commands','docs','scripts','assets','templates',
                     'custom-gpt','markdown-html','c-level-agents','agents']
add_source('alireza', os.path.join(S, "alireza"), 3,
           only=lambda rel, folder: not any(rel.startswith(d+'/') or rel==d
              for d in ALIREZA_SKIP_DIRS))
# sickn33 mega-repo: drop duplicate families
def _sick_drop(rel):
    n = rel.lower()
    drops = ['azure-','threejs-','n8n-','markstream-','makepad-','odoo-','fal-',
             'hig-','robius-','monte-carlo-','neon-','crossframe-','cc-skill-',
             'seo-','fp-','microsoft-','entra-','api-','aws-','expo-','hugging-',
             'apify-','vercel-','shopify-','stripe-','telegram-','whatsapp-','slack-',
             'wordpress-','monte-','leiloeiro-','wiki-','google-','conductor-','brooks-',
             'logic-','codebase-','marketing-','startup-','youtube-','linkedin-',
             'instagram-','twitter-','reddit-','notion-','salesforce-','snowflake-']
    if any(n.startswith(p) for p in drops): return True
    if any(p in n for p in ['-analyzer','psychologist','-automation','malware','exploit',
                            '-pentest','privilege-escalation','sql-injection']): return True
    return False
add_source('sickn33', os.path.join(S, "sickn33-awesome"), 4, exclude=_sick_drop)

# ---- skillsmp-discovered NEW sources (real SKILL.md content) ----
add_source('superpowers', os.path.join(S, "obra-superpowers", "skills"), 3)
add_source('vercel-labs', os.path.join(S, "vercel-labs-agent-skills", "skills"), 3)
add_source('deer-flow', os.path.join(S, "bytedance-deer-flow", "skills", "public"), 3)
add_source('awesome-copilot', os.path.join(S, "github-awesome-copilot"), 3,
           only=lambda rel, folder: not any(p in rel for p in
              ['scripts','docs/','node_modules']))
add_source('github-migrations', os.path.join(S, "github-actions-migrations"), 3)
add_source('mattpocock', os.path.join(S, "mattpocock-skills"), 3)
add_source('browser-use', os.path.join(S, "browser-use-browser-use"), 3,
           only=lambda rel, folder: not any(p in rel for p in ['docs','tests','.github']))

# ---- skillsmp-discovered large creators (real SKILL.md content) ----
OMNI = os.path.join(S, "diegosouzapw-awesome-omni-skill", "skills")
def _omni_drop(rel):
    n = rel.lower()
    if any(x in n for x in ['-dump-','malware','exploit','-pentest','sql-injection',
                            'ransomware','reverse-shell','-c2-','phishing-kit','payload']):
        return True
    return False
add_source('omni', OMNI, 3, exclude=_omni_drop)

add_source('openai-plugins', os.path.join(S, "openai-plugins", "plugins"), 3)
add_source('mvanhorn', os.path.join(S, "mvanhorn-printing-press-library"), 3,
           only=lambda rel, folder: not any(p in rel for p in ['docs','npm','tools','receipts','.github','.printing']))
add_source('front-end-checklist', os.path.join(S, "thedaviddias-front-end-checklist", "skills"), 3)
add_source('nvidia', os.path.join(S, "nvidia-skills", "skills"), 3)
add_source('open-design', os.path.join(S, "nexu-io-open-design"), 3,
           only=lambda rel, folder: rel.startswith('skills/') or rel.startswith('plugins/') or rel.startswith('design-templates/'))
add_source('ruflo', os.path.join(S, "ruvnet-ruflo"), 3,
           only=lambda rel, folder: rel.startswith('.agents/') or rel.startswith('.claude/')
              or rel.startswith('plugins/') or rel.startswith('v3/'))
add_source('motion-anything', os.path.join(S, "nexu-io-motion-anything", "recipes"), 3)
add_source('ux-patterns', os.path.join(S, "thedaviddias-ux-patterns", "skills"), 3)
add_source('html-anything', os.path.join(S, "nexu-io-html-anything", "next", "src", "lib", "templates", "skills"), 3)

# ---------------- parse + collect ----------------
def parse(content):
    fm, body = {}, content
    m = re.match(r'^---\s*\n(.*?)\n(?:---|\.\.\.)\s*\n?\n?(.*)$', content, re.S)
    if m:
        raw, body = m.group(1), m.group(2).strip()
        for line in raw.splitlines():
            lm = re.match(r'^(\w[\w-]*):\s*(.*)$', line)
            if lm:
                fm[lm.group(1)] = lm.group(2).strip().strip('"')
    return fm, body

collected = {}
def add_skill(name, folder, content, source, prio):
    fm, body = parse(content)
    nm = fm.get('name') or name
    desc = fm.get('description','')
    if not nm or not desc:
        return
    key = nm
    cur = collected.get(key)
    if cur and cur['prio'] < prio:
        return
    if cur and cur['prio'] == prio and len(cur['body']) >= len(body):
        return
    cat = categorize(nm, desc)
    collected[key] = {
        'name': nm, 'folder': folder, 'description': desc,
        'license': fm.get('license','MIT'), 'frontmatter': fm, 'body': body,
        'source': source, 'prio': prio, 'cat': cat,
    }

SOURCE_LABEL = {'local':'Installed','anthropic':'Anthropic Official','addyosmani':'addyosmani',
                'microsoft':'Microsoft','microsoft-plugins':'Microsoft','composio':'Composio',
                'alireza':'Community','sickn33':'Community','superpowers':'Superpowers (obra)',
                'vercel-labs':'Vercel Labs','deer-flow':'ByteDance DeerFlow',
                'awesome-copilot':'GitHub',
                'github-migrations':'GitHub','mattpocock':'Matt Pocock','browser-use':'Browser Use',
                'omni':'Awesome Omni Skill','openai-plugins':'OpenAI','mvanhorn':'Printing Press',
                'front-end-checklist':'TheDavidDias','nvidia':'NVIDIA','open-design':'Nexu.io',
                'ruflo':'RuvNet','motion-anything':'Nexu.io','ux-patterns':'TheDavidDias',
                'html-anything':'Nexu.io'}

for src in sources:
    for rel, folder, absd in src['entries']:
        if src.get('only') and not src['only'](rel, folder): continue
        if src.get('exclude') and src['exclude'](rel): continue
        md = os.path.join(absd, 'SKILL.md')
        with open(md, encoding='utf-8', errors='replace') as f:
            add_skill(folder, folder, f.read(), src['key'], src['prio'])

# cap sickn33 contribution to keep focus (post-dedup it's a big portion)
by_src = Counter(s['source'] for s in collected.values())
print("TOTAL after dedup:", len(collected))
print("By source:", dict(by_src))

# ----------------- output -----------------
os.makedirs(os.path.join(OUT_DIR, "skills-data"), exist_ok=True)
# meta (no bodies)
meta = [{'name':s['name'],'folder':s['folder'],'desc':s['description'],'license':s['license'],
         'source':s['source'],'srcLabel':SOURCE_LABEL[s['source']],'cat':s['cat']} for s in collected.values()]
meta.sort(key=lambda s: (s['name']))
with open(os.path.join(OUT_DIR, "skills-data", "meta.js"), "w", encoding="utf-8") as f:
    f.write("window.SKILLS_META = ")
    f.write(json.dumps(meta, ensure_ascii=False))
    f.write(";\n")

# parts by cat (bodies)
parts = {}
for s in collected.values():
    parts.setdefault(s['cat'], []).append({'name':s['name'],'folder':s['folder'],
        'frontmatter':s['frontmatter'],'body':s['body']})
for cat, items in parts.items():
    with open(os.path.join(OUT_DIR, "skills-data", "part-"+cat+".js"), "w", encoding="utf-8") as f:
        f.write("window.SKILLS_PART = window.SKILLS_PART || {};\n")
        f.write("window.SKILLS_PART['"+cat+"'] = ")
        f.write(json.dumps(items, ensure_ascii=False))
        f.write(";\n")

meta_size = os.path.getsize(os.path.join(OUT_DIR,"skills-data","meta.js"))
print("TOTAL skills:", len(collected))
print("meta.js:", round(meta_size/1024,1), "KB")
print("parts by cat:", {k:len(v) for k,v in parts.items()})

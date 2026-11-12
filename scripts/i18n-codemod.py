#!/usr/bin/env python3
"""
One-shot codemod: migrate inline `language === "zh" ? A : B` ternaries into lib/i18n.ts.

  - "静态" : "Static"            -> t("ns.key")
  - `动态 ${x}` : `Dyn ${x}`      -> t("ns.key", { x })   (template literals -> {{x}} placeholders)
  - item.name : item.nameEn      -> l(item.name, item.nameEn)   (data pairs stay in data)

Keys are namespaced by screen; pairs used in >= 2 files are promoted to `common.*`.
Existing translations with an identical (zh, en) pair are reused instead of duplicated.
Class-name toggles such as `language === "en" ? "bg-primary" : ...` are intentionally left alone.

Usage: python3 scripts/i18n-codemod.py [--dry-run]
"""
from __future__ import annotations

import glob
import hashlib
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRY = "--dry-run" in sys.argv

STR = r'"(?:[^"\\]|\\.)*"'
TPL = r'`(?:[^`\\]|\\.)*`'
IDENT = r'[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\[\]]*\])*'
BRANCH = rf'(?:{STR}|{TPL}|{IDENT})'
TERNARY = re.compile(rf'language\s*===\s*"zh"\s*\?\s*({BRANCH})\s*:\s*({BRANCH})', re.S)
TPL_EXPR = re.compile(r'\$\{([^}]*)\}')


def ns_for(path: str) -> str:
    rel = os.path.relpath(path, ROOT).replace("\\", "/")
    base = os.path.splitext(os.path.basename(rel))[0]
    if rel == "app/index.tsx":
        return "splash"
    if rel == "app/(tabs)/index.tsx":
        return "home"
    if rel == "app/(tabs)/_layout.tsx":
        return "tabs"
    if base == "[id]":
        base = rel.split("/")[-2]
    base = base.replace("-ui", "")
    parts = re.split(r"[-_]", base)
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def slug_for(en: str, zh: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", en)
    if not words:
        words = re.findall(r"[A-Za-z0-9]+", zh)
    if not words:
        return "text" + hashlib.md5((zh + "|" + en).encode()).hexdigest()[:6]
    words = words[:4]
    s = words[0].lower() + "".join(w.capitalize() for w in words[1:])
    if s[0].isdigit():
        s = "n" + s
    return s


def unquote(lit: str) -> str:
    body = lit[1:-1]
    return body.replace('\\"', '"').replace("\\`", "`").replace("\\\\", "\\")


def to_single_quoted(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n") + "'"


def param_name(expr: str, used: set[str]) -> str:
    expr = expr.strip()
    m = re.findall(r"[A-Za-z_$][\w$]*", expr)
    name = m[-1] if m else "value"
    if name in ("length", "size", "count") and len(m) >= 2:
        name = m[-2] + name.capitalize()
    base, i = name, 2
    while name in used:
        name = f"{base}{i}"
        i += 1
    used.add(name)
    return name


def templ_to_i18n(zh_t: str, en_t: str):
    """Return (zh_value, en_value, params_src) or None if the two templates differ in expressions."""
    zh_exprs = [e.strip() for e in TPL_EXPR.findall(zh_t)]
    en_exprs = [e.strip() for e in TPL_EXPR.findall(en_t)]
    if sorted(zh_exprs) != sorted(en_exprs):
        return None
    used: set[str] = set()
    names: dict[str, str] = {}
    for e in zh_exprs:
        if e not in names:
            names[e] = param_name(e, used)

    def sub(t: str) -> str:
        return TPL_EXPR.sub(lambda m: "{{" + names[m.group(1).strip()] + "}}", t)

    zh_v, en_v = sub(unquote(zh_t)), sub(unquote(en_t))
    params = ", ".join(f"{n}: {e}" if n != e else n for e, n in names.items())
    return zh_v, en_v, params


# ---------------------------------------------------------------- load existing translations
i18n_path = os.path.join(ROOT, "lib/i18n.ts")
i18n_src = open(i18n_path, encoding="utf-8").read()
KEY_LINE = re.compile(r"^\s*(?:'([^']+)'|([A-Za-z_]\w*)):\s*'((?:[^'\\]|\\.)*)',\s*$", re.M)


def parse_block(block: str) -> dict[str, str]:
    out = {}
    for m in KEY_LINE.finditer(block):
        out[m.group(1) or m.group(2)] = m.group(3).replace("\\'", "'")
    return out


zh_start = i18n_src.index("  zh: {")
en_start = i18n_src.index("  en: {")
end_obj = i18n_src.rindex("\n};")
existing_zh = parse_block(i18n_src[zh_start:en_start])
existing_en = parse_block(i18n_src[en_start:end_obj])
existing_pairs = {(existing_zh[k], existing_en.get(k, "")): k for k in existing_zh}

# ---------------------------------------------------------------- pass 1: collect
files = sorted(glob.glob(os.path.join(ROOT, "app/**/*.tsx"), recursive=True) + glob.glob(os.path.join(ROOT, "components/**/*.tsx"), recursive=True))
pair_files: dict[tuple[str, str], set[str]] = defaultdict(set)
pair_first_ns: dict[tuple[str, str], str] = {}

for f in files:
    src = open(f, encoding="utf-8").read()
    for m in TERNARY.finditer(src):
        a, b = m.group(1), m.group(2)
        if a.startswith('"') and b.startswith('"'):
            pair = (unquote(a), unquote(b))
        elif a.startswith("`") and b.startswith("`"):
            conv = templ_to_i18n(a, b)
            if not conv:
                continue
            pair = (conv[0], conv[1])
        else:
            continue
        pair_files[pair].add(f)
        pair_first_ns.setdefault(pair, ns_for(f))

# assign keys
pair_key: dict[tuple[str, str], str] = {}
taken: set[str] = set(existing_zh)
for pair, fs in pair_files.items():
    if pair in existing_pairs:
        pair_key[pair] = existing_pairs[pair]
        continue
    ns = "common" if len(fs) >= 2 else pair_first_ns[pair]
    key = f"{ns}.{slug_for(pair[1], pair[0])}"
    base, i = key, 2
    while key in taken:
        key = f"{base}{i}"
        i += 1
    taken.add(key)
    pair_key[pair] = key

# ---------------------------------------------------------------- pass 2: rewrite files
DESTRUCT = re.compile(r"const\s*\{([^}]*)\}\s*=\s*useLanguage\(\);")
report = {"t": 0, "tParams": 0, "l": 0, "skipped": []}


def rewrite(src: str, path: str) -> str:
    def repl(m: re.Match) -> str:
        a, b = m.group(1), m.group(2)
        if a.startswith('"') and b.startswith('"'):
            report["t"] += 1
            return f't("{pair_key[(unquote(a), unquote(b))]}")'
        if a.startswith("`") and b.startswith("`"):
            conv = templ_to_i18n(a, b)
            if conv:
                report["tParams"] += 1
                key = pair_key[(conv[0], conv[1])]
                return f't("{key}", {{ {conv[2]} }})' if conv[2] else f't("{key}")'
            report["skipped"].append((path, m.group(0)[:80]))
            return m.group(0)
        if re.fullmatch(IDENT, a) and re.fullmatch(IDENT, b):
            report["l"] += 1
            return f"l({a}, {b})"
        report["skipped"].append((path, m.group(0)[:80]))
        return m.group(0)

    out = TERNARY.sub(repl, src)

    # fix up useLanguage destructurings per component scope
    spans = [(m.start(), m.end(), m) for m in DESTRUCT.finditer(out)]
    if not spans:
        return out
    pieces, last = [], 0
    for i, (s, e, m) in enumerate(spans):
        scope_end = spans[i + 1][0] if i + 1 < len(spans) else len(out)
        scope = out[e:scope_end]
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        uses_t = re.search(r"\bt\(", scope) is not None
        uses_l = re.search(r"\bl\(", scope) is not None
        uses_lang = re.search(r"\blanguage\b", scope) is not None
        if uses_t and "t" not in names:
            names.insert(0, "t")
        if uses_l and "l" not in names:
            names.append("l")
        if not uses_lang and "language" in names:
            names.remove("language")
        if not uses_t and "t" in names and not re.search(r"\bt\b", scope):
            names.remove("t")
        new_line = f"const {{ {', '.join(names)} }} = useLanguage();" if names else "useLanguage();"
        pieces.append(out[last:s])
        pieces.append(new_line)
        last = e
    pieces.append(out[last:])
    return "".join(pieces)


changed = 0
for f in files:
    src = open(f, encoding="utf-8").read()
    if 'language === "zh"' not in src:
        continue
    new = rewrite(src, f)
    if new != src:
        changed += 1
        if not DRY:
            open(f, "w", encoding="utf-8").write(new)

# ---------------------------------------------------------------- pass 3: append translations
new_pairs = [(p, k) for p, k in pair_key.items() if k not in existing_zh]
new_pairs.sort(key=lambda x: x[1])
if new_pairs and not DRY:
    zh_lines = ["", "    // --- Migrated from inline ternaries (P2 i18n codemod) ---"]
    en_lines = ["", "    // --- Migrated from inline ternaries (P2 i18n codemod) ---"]
    cur_ns = None
    for (zh, en), key in new_pairs:
        ns = key.split(".")[0]
        if ns != cur_ns:
            zh_lines.append(f"    // {ns}")
            en_lines.append(f"    // {ns}")
            cur_ns = ns
        zh_lines.append(f"    '{key}': {to_single_quoted(zh)},")
        en_lines.append(f"    '{key}': {to_single_quoted(en)},")
    zh_block, en_block = "\n".join(zh_lines), "\n".join(en_lines)
    # insert before "  },\n  en: {" and before final "  },\n};"
    marker_en = "\n  },\n  en: {"
    idx = i18n_src.index(marker_en)
    i18n_src = i18n_src[:idx] + "\n" + zh_block + i18n_src[idx:]
    idx2 = i18n_src.rindex("\n  },\n};")
    i18n_src = i18n_src[:idx2] + "\n" + en_block + i18n_src[idx2:]
    open(i18n_path, "w", encoding="utf-8").write(i18n_src)

print(f"files changed: {changed}")
print(f"t(): {report['t']}  t(params): {report['tParams']}  l(): {report['l']}  new keys: {len(new_pairs)}  reused existing: {sum(1 for k in pair_key.values() if k in existing_zh)}")
if report["skipped"]:
    print("SKIPPED (manual):")
    for p, snippet in report["skipped"]:
        print("  ", os.path.relpath(p, ROOT), "::", snippet)

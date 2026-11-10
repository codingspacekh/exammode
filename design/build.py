#!/usr/bin/env python3
"""Build the static UI prototype screens for ExamMode.

Reads  design/src/*.html  (templates)  and writes  design/screens/*.html  — the same
conventions as the gradebook's, OneEditor's and MicroLab's prototypes.

Template tags:
  {{include:name}}                    -> contents of src/partials/name.html
  {{i:name}} / {{i:name:extra-class}} -> inline SVG icon
  <!--@NAME: value--> ... {{NAME}}    -> per-page variable (unset = empty)
  {{NAME|default}}                    -> per-page variable with a default

Run:  python3 design/build.py
"""
import pathlib
import re
import shutil

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
OUT = ROOT / "screens"

FILLED = {"play", "dot", "stopfill"}
ICONS = {
    "lock": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    "unlock": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    "clock": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    "upload": '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    "download": '<path d="M12 4v12M7 11l5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "checkc": '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16.5 9.5"/>',
    "x": '<path d="M6 6l12 12M18 6L6 18"/>',
    "xc": '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
    "warn": '<path d="M12 3.5L2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
    "info": '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.01"/>',
    "wifi": '<path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19" r=".8"/>',
    "wifioff": '<path d="M3 3l18 18M8.5 16a5 5 0 0 1 7 0M5.5 12.5a9.5 9.5 0 0 1 4-2.2M2.5 9a14 14 0 0 1 5-3M13.5 6.1A14 14 0 0 1 21.5 9M16 10.8a9.5 9.5 0 0 1 2.5 1.7"/><circle cx="12" cy="19" r=".8"/>',
    "monitor": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    "file": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    "folder": '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    "doc": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5"/>',
    "sheet": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.5h16M4 15h16M10 4v16"/>',
    "slides": '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v3M8 20h8M8 8.5h8M8 12h5"/>',
    "code": '<path d="M8.5 7L3.5 12l5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
    "globe": '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3z"/>',
    "questions": '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5v.5M12 16.5v.01"/>',
    "user": '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    "users": '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
    "play": '<path d="M7 4.5v15l12.5-7.5z"/>',
    "stopfill": '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    "more": '<circle cx="5.5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="18.5" cy="12" r="1.3"/>',
    "door": '<path d="M14 4H6v16h8M10 12h10M17 9l3 3-3 3"/>',
    "shield": '<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-4.5"/>',
    "search": '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
    "plus": '<path d="M12 5v14M5 12h14"/>',
    "minus": '<path d="M5 12h14"/>',
    "refresh": '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    "back": '<path d="M15 5l-7 7 7 7"/>',
    "fwd": '<path d="M9 5l7 7-7 7"/>',
    "down": '<path d="M6 9l6 6 6-6"/>',
    "eye": '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    "pc": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 20h10"/>',
    "calc": '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8.5 12v.01M12 12v.01M15.5 12v.01M8.5 16v.01M12 16v.01M15.5 16v.01"/>',
    "dot": '<circle cx="12" cy="12" r="5"/>',
    "timer": '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 1.5M9.5 2.5h5"/>',
    "list": '<path d="M9 6h11M9 12h11M9 18h11M4.5 6v.01M4.5 12v.01M4.5 18v.01"/>',
    "grid": '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    "edit": '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    "trash": '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    "copy": '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    "app": '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 9h16"/>',
    "keyboard": '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9"/>',
    "clipboard": '<rect x="6" y="4.5" width="12" height="16" rx="2"/><path d="M9 4.5V3h6v1.5"/>',
    "remote": '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M9 10h6M13 8l2 2-2 2"/>',
    "bell": '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
    "flag": '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    "settings": '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
    "hourglass": '<path d="M7 3h10M7 21h10M8 3c0 4 8 5 8 9s-8 5-8 9M16 3c0 4-8 5-8 9s8 5 8 9"/>',
    "arrowr": '<path d="M5 12h14M13 6l6 6-6 6"/>',
    "send": '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    "csv": '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 12.5h7M8.5 16h7M12 12.5V19"/>',
}


def icon(name, extra=""):
    body = ICONS[name]
    cls = "ico" + (" fill" if name in FILLED else "") + (f" {extra}" if extra else "")
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{body}</svg>'


VAR_DEF = re.compile(r"<!--@([A-Z0-9_]+):\s?(.*?)-->\n?", re.S)
INCLUDE = re.compile(r"\{\{include:([a-z0-9-]+)\}\}")
ICON = re.compile(r"\{\{i:([a-z0-9]+)(?::([a-z0-9 -]+))?\}\}")
VAR_USE = re.compile(r"\{\{([A-Z0-9_]+)(?:\|([^}]*))?\}\}")


def expand(text, variables, depth=0):
    if depth > 8:
        raise RuntimeError("includes nested too deeply")
    text = INCLUDE.sub(lambda m: (SRC / "partials" / f"{m[1]}.html").read_text(), text)
    text = VAR_USE.sub(lambda m: variables.get(m[1], m[2] or ""), text)
    if INCLUDE.search(text) or VAR_USE.search(text):
        return expand(text, variables, depth + 1)
    return text


def build_page(path):
    raw = path.read_text()
    variables = {m[1]: m[2].strip() for m in VAR_DEF.finditer(raw)}
    text = VAR_DEF.sub("", raw)
    text = expand(text, variables)
    text = ICON.sub(lambda m: icon(m[1], m[2] or ""), text)
    left = re.findall(r"\{\{[^}]*\}\}", text)
    if left:
        raise RuntimeError(f"{path.name}: unknown tags {left[:3]}")
    return text


def main():
    OUT.mkdir(exist_ok=True)
    for old in OUT.glob("*.html"):
        old.unlink()
    pages = sorted(SRC.glob("*.html"))
    for page in pages:
        (OUT / page.name).write_text(build_page(page))
    for asset in ("styles.css",):
        shutil.copy(SRC / asset, OUT / asset)
    print(f"built {len(pages)} screens into {OUT.relative_to(ROOT.parent)}")


if __name__ == "__main__":
    main()

"""Fail when the docs describe something the product no longer has.

The corpus does not rot by going out of date. It rots by staying confidently
specific about a thing that changed underneath it, which reads as authoritative
and is worse than saying nothing.

The 2026-08 audit found four of these live on the published site:

  * "Two kinds of toolset" -- there were three
  * the Studio described as three columns with a right activity panel -- the
    revamp replaced that with one rail in two modes and a bottom dock
  * "Graph Designer" -- rebuilt and renamed to the Graph Builder
  * `provider` documented as `"internal"` or `"mcp"` -- python was missing

Each was found by a human reading a page and noticing. This test is that
reading, automated: it does not check whether a page is *old*, it checks
whether a page still uses vocabulary the product has retired.

Adding an entry costs one line and is the cheapest moment to do it -- right
when you rename the thing.
"""

from __future__ import annotations

import re
from pathlib import Path

DOCS = Path(__file__).resolve().parents[1] / "docs_source"

# phrase -> why it is retired / what to say instead.
#
# Keep these narrow. A pattern that also matches legitimate prose will be
# suppressed by whoever hits it, and a suppressed check is worse than none.
RETIRED: dict[str, str] = {
    r"\bGraph Designer\b":
        "renamed to the Graph Builder when the builder was rebuilt",
    r"[Tt]wo kinds of toolset":
        "there are three: internal, mcp, and python",
    r"primer/user_docs/":
        "docs moved to docs_source/ in the primerhq.github.io repo",
    r'`"internal"` or `"mcp"`':
        'the provider enum also has "python"',
    r"right activity panel":
        "the studioV2 shell has no right rail; activity lives in the dock",
    r"\bAdd node\b|\bAdd edge\b":
        "the builder adds steps by purpose, and connects with Connect steps",
}

# Pages that are allowed to mention retired vocabulary, because describing the
# change IS their job.
EXEMPT = {
    "_meta/authoring-guide.md",
    "_meta/page-template.md",
}


def _pages() -> list[Path]:
    return sorted(
        p for p in DOCS.rglob("*.md")
        if str(p.relative_to(DOCS)) not in EXEMPT
    )


def test_no_page_uses_retired_vocabulary() -> None:
    hits: list[str] = []
    for page in _pages():
        text = page.read_text(encoding="utf-8")
        rel = page.relative_to(DOCS)
        for pattern, why in RETIRED.items():
            for m in re.finditer(pattern, text):
                line = text[: m.start()].count("\n") + 1
                hits.append(f"{rel}:{line}: {m.group(0)!r} -- {why}")
    assert not hits, (
        "docs still use vocabulary the product has retired:\n  "
        + "\n  ".join(hits)
    )


def test_the_guard_actually_matches_something() -> None:
    """A guard whose patterns match nothing is decoration.

    Checks each pattern against text that SHOULD trip it, so a typo in a
    regex fails here rather than silently passing forever.
    """
    samples = {
        r"\bGraph Designer\b": "open the Graph Designer to edit",
        r"[Tt]wo kinds of toolset": "There are two kinds of toolset.",
        r"primer/user_docs/": "docs live under primer/user_docs/x.md",
        r'`"internal"` or `"mcp"`': 'provider is `"internal"` or `"mcp"`',
        r"right activity panel": "the right activity panel streams events",
        r"\bAdd node\b|\bAdd edge\b": "click Add node in the toolbar",
    }
    assert set(samples) == set(RETIRED), (
        "every RETIRED pattern needs a sample proving it matches"
    )
    for pattern, sample in samples.items():
        assert re.search(pattern, sample), f"pattern never matches: {pattern}"

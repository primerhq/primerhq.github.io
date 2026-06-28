import json
from pathlib import Path

from build_site import build_site


def test_writes_search_index(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)

    index_path = out / "docs" / "search-index.json"
    assert index_path.exists()

    data = json.loads(index_path.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert data, "search index should not be empty"

    # One entry per published doc. Exclude the site root and the /docs/
    # redirect index.html (neither is a published doc).
    docs_dir = out / "docs"
    page_count = sum(
        1 for p in out.rglob("index.html")
        if p.parent != out and p.parent != docs_dir
    )
    assert len(data) == page_count

    # No _meta urls leak in.
    assert all(not e["url"].startswith("/docs/_meta/") for e in data)

    for entry in data:
        assert isinstance(entry["title"], str) and entry["title"]
        assert isinstance(entry["section"], str) and entry["section"]
        assert isinstance(entry["url"], str) and entry["url"].startswith("/")
        assert isinstance(entry["headings"], list)
        assert isinstance(entry["excerpt"], str)

    by_url = {e["url"]: e for e in data}
    llm = by_url.get("/docs/features/llm-providers/")
    assert llm is not None, "LLM Providers page should be indexed"
    assert llm["title"] == "LLM Providers"
    assert llm["section"] == "features"
    assert llm["headings"], "LLM Providers should expose its headings"
    assert llm["excerpt"], "LLM Providers should expose an excerpt"
    # The excerpt is plain text, not HTML.
    assert "<" not in llm["excerpt"]

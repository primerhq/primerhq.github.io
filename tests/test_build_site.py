import shutil
from pathlib import Path

import pytest

from build_site import DocsLintError, build_site


def test_builds_a_page_per_doc(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    page = out / "docs" / "getting-started" / "introduction" / "index.html"
    assert page.exists()
    home = page.read_text()
    assert "Features" in home and "LLM Providers" in home
    # Pages live under /docs/, so the base href and assets are rooted there.
    assert '<base href="/docs/"' in home
    assert (out / "docs" / "assets" / "docs.css").exists()
    # GitHub link points at the real repo, not the placeholder.
    assert "https://github.com/primerhq/primer" in home


def test_excludes_internal_meta_authoring_docs(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    # _meta is writer guidance, not public docs: no pages built for it.
    assert not (out / "docs" / "_meta").exists()
    assert not (out / "_meta").exists()


def test_emits_404_and_sitemap(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)

    notfound = out / "404.html"
    sitemap = out / "sitemap.xml"
    assert notfound.exists()
    assert sitemap.exists()

    # The 404 uses the page shell (sidebar nav present) and is a real page.
    nf_html = notfound.read_text()
    assert "Page not found" in nf_html
    assert "nav-link" in nf_html

    # The sitemap lists the homepage plus every published page url under /docs/.
    sm_xml = sitemap.read_text()
    assert "<urlset" in sm_xml
    assert "<loc>/</loc>" in sm_xml
    assert "<loc>/docs/getting-started/introduction/</loc>" in sm_xml


def test_build_fails_on_broken_corpus(tmp_path):
    # Copy the real corpus, then inject a dangling ref: the lint gate must
    # turn that into a build failure before any page is rendered.
    src = tmp_path / "user_docs"
    shutil.copytree(Path("docs_source"), src)
    intro = src / "getting-started" / "introduction.md"
    intro.write_text(
        intro.read_text()
        + "\n\n```ref:getting-started/does-not-exist\nDangling.\n```\n",
        encoding="utf-8",
    )

    with pytest.raises(DocsLintError):
        build_site(src, tmp_path / "dist")


def test_docs_root_redirects_to_home(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    docs_index = out / "docs" / "index.html"
    assert docs_index.exists()
    # The bare /docs/ root redirects to the docs home page.
    assert "/docs/getting-started/introduction/" in docs_index.read_text()


def test_root_is_left_for_homepage(tmp_path):
    out = tmp_path / "dist"
    build_site(Path("docs_source"), out)
    # The build no longer writes a root index.html; the homepage owns "/".
    assert not (out / "index.html").exists()

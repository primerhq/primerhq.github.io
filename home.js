/* =========================================================================
   Primer — homepage interactions (home.js)
   Pure vanilla, progressive enhancement. Everything here is non-essential:
   the page reads and lays out correctly with this file absent.
   ========================================================================= */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Signal JS is active (CSS gates its hidden/reveal states behind .js so the
  // page reads fully with JS off). Track IO health: in some embedded iframes
  // IntersectionObserver reports everything as non-intersecting, which would
  // otherwise leave reveal content stuck at opacity:0.
  document.documentElement.classList.add("js");
  var ioHealthy = false;
  function markIoHealthy() { ioHealthy = true; }

  /* ------------------------------------------------------------------ *
   *  Copy buttons
   * ------------------------------------------------------------------ */
  function commandText(id) {
    var pre = document.getElementById(id);
    if (!pre) return "";
    // Strip the leading "$ " prompt and any non-command output lines.
    var lines = pre.innerText.split("\n");
    var out = [];
    lines.forEach(function (raw) {
      var line = raw.replace(/\u00a0/g, " ").trimEnd();
      if (!line) return;
      if (/^\s*→/.test(line) || /console live at/.test(line)) return; // output line
      out.push(line.replace(/^\s*\$\s?/, ""));
    });
    return out.join("\n");
  }

  document.querySelectorAll(".copy-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = commandText(btn.getAttribute("data-copy-target"));
      var done = function () {
        var label = btn.querySelector(".copy-txt");
        var prev = label ? label.textContent : "";
        btn.classList.add("is-copied");
        if (label) label.textContent = "Copied";
        setTimeout(function () {
          btn.classList.remove("is-copied");
          if (label) label.textContent = prev || "Copy";
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else { fallback(); }
      function fallback() {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", "");
        ta.style.position = "absolute"; ta.style.left = "-9999px";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); done(); } catch (e) {}
        document.body.removeChild(ta);
      }
    });
  });

  /* ------------------------------------------------------------------ *
   *  Sticky topbar background on scroll
   * ------------------------------------------------------------------ */
  var topbar = document.getElementById("topbar");
  function onScroll() {
    if (!topbar) return;
    topbar.classList.toggle("is-stuck", window.scrollY > 8);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ------------------------------------------------------------------ *
   *  Scroll-in reveals + one-shot triggers (heat, terminal)
   * ------------------------------------------------------------------ */
  if ("IntersectionObserver" in window) {
    var revealEls = [].slice.call(document.querySelectorAll(".reveal, #heat, .terminal"));
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        markIoHealthy();
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.15 });
    revealEls.forEach(function (el) { io.observe(el); });
    // Failsafe: if IO never reported an intersection (broken in this context),
    // reveal everything so no content is lost.
    setTimeout(function () {
      if (ioHealthy) return;
      revealEls.forEach(function (el) { el.classList.add("is-in"); });
    }, 1000);
  } else {
    document.querySelectorAll(".reveal, #heat, .terminal").forEach(function (el) {
      el.classList.add("is-in");
    });
  }

  /* Measure accuracy-chart line lengths so stroke-dashoffset draws cleanly */
  ["line-primer", "line-naive"].forEach(function (id) {
    var p = document.getElementById(id);
    if (p && p.getTotalLength) {
      var len = Math.ceil(p.getTotalLength());
      p.style.setProperty("--len", len);
    }
  });

  /* ------------------------------------------------------------------ *
   *  Showcase tabs (Batteries included)
   * ------------------------------------------------------------------ */
  var FEATURES = {
    studio:      { t: "Studio",      d: "A real operator console — not just logs. Launch, watch, and debug every run: a live graph canvas, the full session transcript, and a streaming event rail, all in one view.", l: "/docs/features/observability/" },
    agents:      { t: "Agents",      d: "Configure each agent with its own model, tools, and a deliberately small context. Swap the model behind a chat without touching the loop.", l: "/docs/features/agents/" },
    graphs:      { t: "Graphs",      d: "Compose directed cyclic graphs in a visual canvas: a producer drafts, a judge critiques, and work loops until it passes.", l: "/docs/graphs/overview/" },
    collections: { t: "Collections", d: "Mount a whole knowledge collection into an agent's workspace as a live, editable directory — the agent reads and writes the files directly, then a 3-way diff syncs edits back upstream with Apply to collection.", l: "/docs/embedding/collections-and-documents/" },
    triggers:    { t: "Triggers",    d: "Give a loop a heartbeat: fire on a cron schedule, a delay, or an inbound webhook. No always-on babysitting required.", l: "/docs/features/triggers/" },
    harnesses:   { t: "Harnesses",   d: "Package a whole agent setup into an exportable, git-backed bundle — Helm for agents. Version it, share it, redeploy it.", l: "/docs/features/harnesses/" },
    mcp:         { t: "MCP server",  d: "Expose Primer's tools over MCP and consume external MCP servers — interoperable with the wider agent ecosystem.", l: "/docs/features/mcp-server/" }
  };
  /* Drop-in for real screenshots: home/<key>-dark.png if present, else CSS mock */
  var SHOT_IMG = {
    studio: "home/studio-console-dark.png",
    agents: "home/agents-page-dark.png",
    graphs: "home/graph-canvas-dark.png",
    collections: "home/internal-collections-enable-dark.png", // TODO: replace with a real collection-mount screenshot (enable-only shot, not the mount/diff flow)
    // channels: dropped from the showcase — no populated capture exists in
    // _embeds (only empty-state shots). See home/README.md to restore it.
    triggers: "home/trigger-create-dark.png",
    harnesses: "home/harness-dark.png",
    mcp: "home/mcp-exposure-dark.png"
  };

  var tabs = document.querySelectorAll(".tab");
  var scTitle = document.getElementById("sc-title");
  var scDesc = document.getElementById("sc-desc");
  var scLink = document.getElementById("sc-link");
  var shot = document.getElementById("shot");

  function mockFor(key) {
    // Lightweight CSS-rendered console stand-in keyed by feature.
    var accent = "var(--accent)";
    var rows = "";
    for (var i = 0; i < 4; i++) {
      rows += '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)">' +
        '<span style="width:18px;height:18px;border-radius:5px;background:var(--accent-dim);border:1px solid oklch(0.82 0.17 145/0.3)"></span>' +
        '<span style="height:7px;border-radius:4px;background:var(--bg-2);flex:' + (3 + (i % 3)) + '"></span>' +
        '<span style="height:7px;width:34px;border-radius:4px;background:' + (i === 0 ? accent : "var(--bg-2)") + ';opacity:' + (i === 0 ? 1 : .5) + '"></span>' +
        '</div>';
    }
    var graphMock =
      '<svg viewBox="0 0 320 200" style="width:100%;height:100%;display:block">' +
      '<line x1="70" y1="60" x2="160" y2="60" stroke="var(--border)" stroke-width="2"/>' +
      '<line x1="160" y1="60" x2="160" y2="140" stroke="var(--border)" stroke-width="2"/>' +
      '<line x1="160" y1="140" x2="250" y2="140" stroke="var(--accent)" stroke-width="2"/>' +
      '<rect x="28" y="44" width="84" height="32" rx="7" fill="var(--bg-1)" stroke="var(--border)"/>' +
      '<rect x="118" y="44" width="84" height="32" rx="7" fill="var(--bg-1)" stroke="var(--accent)"/>' +
      '<rect x="118" y="124" width="84" height="32" rx="7" fill="var(--bg-1)" stroke="var(--border)"/>' +
      '<rect x="236" y="124" width="60" height="32" rx="7" fill="oklch(0.82 0.17 145/0.12)" stroke="var(--accent)"/>' +
      '<circle cx="160" cy="100" r="3.5" fill="var(--amber)"/>' +
      '</svg>';

    var inner = (key === "graphs")
      ? '<div style="padding:14px;height:100%">' + graphMock + '</div>'
      : '<div style="height:100%;display:flex;flex-direction:column">' +
          '<div style="display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--bg-1)">' +
            '<span style="width:9px;height:9px;border-radius:50%;background:var(--accent)"></span>' +
            '<span style="font-family:var(--mono);font-size:11px;color:var(--text-3)">' + FEATURES[key].t.toLowerCase() + '</span>' +
          '</div>' + rows +
        '</div>';

    return '<div style="height:100%;background:var(--bg);">' + inner + '</div>';
  }

  function preload(src, ok, fail) {
    var img = new Image();
    img.onload = function () { ok(src); };
    img.onerror = fail;
    img.src = src;
  }

  function selectTab(key) {
    var f = FEATURES[key];
    if (!f) return;
    if (scTitle) scTitle.textContent = f.t;
    if (scDesc) scDesc.textContent = f.d;
    if (scLink) scLink.setAttribute("href", f.l);
    if (shot) {
      // Try the real screenshot first; fall back to the CSS mock.
      var src = SHOT_IMG[key];
      shot.innerHTML = mockFor(key);
      if (src) {
        preload(src, function (s) {
          shot.innerHTML = '<img src="' + s + '" alt="Primer console — ' + f.t + '" loading="lazy" />';
        }, function () { /* keep mock */ });
      }
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("is-active"); t.setAttribute("aria-selected", "false"); });
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
      selectTab(tab.getAttribute("data-tab"));
    });
  });
  if (tabs.length) selectTab("studio");

  /* ------------------------------------------------------------------ *
   *  Animated traveling dot along the loop diagrams
   * ------------------------------------------------------------------ */
  function LoopAnimator(svg, opts) {
    if (!svg) return null;
    var ns = "http://www.w3.org/2000/svg";
    var edges = {};
    svg.querySelectorAll("path.edge").forEach(function (p) { edges[p.id] = p; });
    var nodes = {};
    svg.querySelectorAll(".node").forEach(function (n) { nodes[n.getAttribute("data-node")] = n; });

    var dot = document.createElementNS(ns, "circle");
    dot.setAttribute("r", opts.r || 5.5);
    dot.setAttribute("class", "travel-dot");
    dot.style.opacity = "0";
    svg.appendChild(dot);

    var running = false, stopped = false, raf = 0;

    function setDotColor(c) { dot.setAttribute("fill", c); dot.style.color = c; }
    function pulse(name, color) {
      var n = nodes[name];
      if (!n) return;
      n.style.setProperty("--node-c", color || "var(--accent)");
      n.classList.add("is-active");
      setTimeout(function () { n.classList.remove("is-active"); }, opts.pulse || 520);
    }
    function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

    function travel(edgeId, color, dur, reverse) {
      return new Promise(function (resolve) {
        var path = edges[edgeId];
        if (!path) { resolve(); return; }
        var len = path.getTotalLength();
        setDotColor(color);
        dot.style.opacity = "1";
        var start = null;
        function frame(ts) {
          if (stopped) { resolve(); return; }
          if (start === null) start = ts;
          var t = Math.min((ts - start) / dur, 1);
          var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // easeInOut
          var at = reverse ? (1 - e) * len : e * len;
          var pt = path.getPointAtLength(at);
          dot.setAttribute("cx", pt.x);
          dot.setAttribute("cy", pt.y);
          if (t < 1) { raf = requestAnimationFrame(frame); }
          else { resolve(); }
        }
        raf = requestAnimationFrame(frame);
      });
    }

    var GREEN = "oklch(0.82 0.17 145)", AMBER = "oklch(0.82 0.16 75)",
        VIOLET = "oklch(0.72 0.16 290)", DIM = "oklch(0.72 0.005 250)";

    async function cycleFull(outcome) {
      // Trigger → Producer → Judge → outcome
      pulse("trigger", GREEN); await sleep(opts.pulse * 0.7);
      await travel("e-trig-prod", GREEN, opts.seg); pulse("producer", GREEN); await sleep(opts.pause);
      await travel("e-produce", DIM, opts.seg); pulse("judge", GREEN); await sleep(opts.pause);
      if (stopped) return;

      if (outcome === "retry") {
        await travel("e-retry", AMBER, opts.seg); pulse("producer", AMBER); await sleep(opts.pause);
        await travel("e-produce", DIM, opts.seg); pulse("judge", GREEN); await sleep(opts.pause);
        await travel("e-pass", GREEN, opts.seg); pulse("deliver", GREEN);
      } else if (outcome === "escalate") {
        await travel("e-escalate", VIOLET, opts.seg); pulse("human", VIOLET); await sleep(opts.pause * 1.3);
        await travel("e-escalate", VIOLET, opts.seg, true); pulse("judge", GREEN); await sleep(opts.pause);
        await travel("e-pass", GREEN, opts.seg); pulse("deliver", GREEN);
      } else {
        await travel("e-pass", GREEN, opts.seg); pulse("deliver", GREEN);
      }
      await sleep(opts.pulse);
    }

    async function cycleHero() {
      pulse("trigger", GREEN); await sleep(opts.pulse * 0.7);
      await travel("h-trig", GREEN, opts.seg); pulse("producer", GREEN); await sleep(opts.pause);
      await travel("h-produce", DIM, opts.seg); pulse("judge", GREEN); await sleep(opts.pause);
      await travel("h-retry", AMBER, opts.seg, false); pulse("producer", AMBER); await sleep(opts.pause);
      await travel("h-produce", DIM, opts.seg); pulse("judge", GREEN); await sleep(opts.pause);
      await travel("h-pass", GREEN, opts.seg); pulse("deliver", GREEN);
      await sleep(opts.pulse);
    }

    var outcomes = ["pass", "retry", "escalate"], idx = 0;
    async function run() {
      if (running) return;
      running = true; stopped = false;
      while (!stopped) {
        if (opts.hero) { await cycleHero(); }
        else { await cycleFull(outcomes[idx % outcomes.length]); idx++; }
        dot.style.opacity = "0";
        await sleep(opts.gap);
      }
      running = false;
    }
    function stop() { stopped = true; cancelAnimationFrame(raf); dot.style.opacity = "0"; }

    return { run: run, stop: stop };
  }

  if (!reduceMotion && "IntersectionObserver" in window) {
    var heroSvg = document.querySelector("#hero-loop svg");
    var dcgSvg = document.querySelector("#dcg-stage svg");

    var heroAnim = heroSvg ? LoopAnimator(heroSvg, { hero: true, seg: 520, pause: 360, pulse: 480, gap: 700, r: 5 }) : null;
    var dcgAnim = dcgSvg ? LoopAnimator(dcgSvg, { seg: 560, pause: 420, pulse: 520, gap: 900, r: 6 }) : null;

    function watch(el, anim) {
      if (!el || !anim) return;
      var started = false;
      var ob = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { markIoHealthy(); started = true; anim.run(); }
          else if (started) { anim.stop(); }
        });
      }, { threshold: 0.25 });
      ob.observe(el);
      // Failsafe: if IO is unhealthy, start anyway so the diagram still animates.
      setTimeout(function () { if (!ioHealthy && !started) { started = true; anim.run(); } }, 1300);
    }
    watch(document.getElementById("hero-loop"), heroAnim);
    watch(document.getElementById("dcg-stage"), dcgAnim);
  }
})();

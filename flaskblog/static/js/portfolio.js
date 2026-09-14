/* ==========================================================================
   portfolio.js — Dual-Mode Portfolio behaviour
   TECHNICAL side: a full-screen terminal. Commands run in a persistent
   session history, then the matching section is displayed.
   CREATIVE side: a tactile scrolling page with a carved nav.
   Zero dependencies. Reduced-motion aware.
   ========================================================================== */
(function () {
  "use strict";

  var MODE_KEY = "portfolio-mode";
  var root = document.getElementById("dm-root");
  if (!root) return; // Not the portfolio page (blog/admin) — do nothing.

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------------
     Tiny helpers
  ------------------------------------------------------------------ */
  function $(selector, scope) { return (scope || document).querySelector(selector); }
  function $all(selector, scope) { return Array.prototype.slice.call((scope || document).querySelectorAll(selector)); }
  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  /* ------------------------------------------------------------------
     1. Mode controller — the medallion flips the whole site
  ------------------------------------------------------------------ */
  var currentMode = "technical";
  var booted = false;

  function readStoredMode() {
    try {
      var stored = localStorage.getItem(MODE_KEY);
      return stored === "creative" ? "creative" : "technical";
    } catch (err) {
      return "technical";
    }
  }

  function storeMode(mode) {
    try { localStorage.setItem(MODE_KEY, mode); } catch (err) { /* private mode */ }
  }

  /* Tailwind's !bg-white on <body> can only be beaten by an inline !important */
  function paintBody(mode) {
    var color = mode === "creative" ? "#ece4d4" : "#0d0d0d";
    try {
      document.body.style.setProperty("background-color", color, "important");
    } catch (err) { /* older browser — dm-root still paints the viewport */ }
  }

  function staggerReveals(scope) {
    var items = $all(".dm-reveal", scope);
    items.forEach(function (item, index) {
      item.style.setProperty("--dm-delay", Math.min(index * 60, 600) + "ms");
      item.classList.remove("is-in");
    });
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        items.forEach(function (item) { item.classList.add("is-in"); });
      });
    });
  }

  function forceIn(scope) {
    $all(".dm-reveal", scope).forEach(function (el) { el.classList.add("is-in"); });
  }

  function applyMode(mode, options) {
    var animate = !(options && options.instant) && !reducedMotion;
    currentMode = mode;
    root.classList.toggle("mode-technical", mode === "technical");
    root.classList.toggle("mode-creative", mode === "creative");
    paintBody(mode);
    storeMode(mode);

    var medallion = $("#dm-medallion");
    if (medallion) {
      medallion.setAttribute("aria-pressed", String(mode === "creative"));
      medallion.title = mode === "technical" ? "flip to the creative side ❋" : "flip to the technical side ±";
    }

    var technical = $("#mode-technical");
    var creative = $("#mode-creative");
    if (!technical || !creative) return;

    if (mode === "technical") {
      creative.hidden = true;
      technical.hidden = false;
      if (!booted) {
        booted = true;
        bootSequence();
      } else if (animate) {
        staggerReveals(activeViewEl() || technical);
      } else {
        forceIn(activeViewEl() || technical);
      }
    } else {
      technical.hidden = true;
      creative.hidden = false;
      if (animate) staggerReveals(creative);
      else forceIn(creative);
      observeNotepads(); // poems type themselves out when they enter view
    }
  }

  function setMode(mode) {
    if (mode === currentMode) return;
    applyMode(mode);
  }

  function initMedallion() {
    var medallion = $("#dm-medallion");
    if (!medallion) return;
    medallion.addEventListener("click", function () {
      setMode(currentMode === "technical" ? "creative" : "technical");
    });
  }

  /* ------------------------------------------------------------------
     2. Terminal engine — persistent session history
  ------------------------------------------------------------------ */
  var termBody = null;
  var termHistory = null;
  var termQueue = Promise.resolve();

  function termLine(html, className) {
    var line = document.createElement("p");
    line.className = "term-line" + (className ? " " + className : "");
    line.innerHTML = html;
    if (termHistory) {
      termHistory.appendChild(line);
      // Safety valve: keep memory bounded on very long sessions.
      while (termHistory.children.length > 160) termHistory.removeChild(termHistory.firstChild);
    }
    return line;
  }

  function typeInto(el, text, speed) {
    return new Promise(function (resolve) {
      if (reducedMotion) { el.textContent = text; resolve(); return; }
      var index = 0;
      (function tick() {
        if (index <= text.length) {
          el.textContent = text.slice(0, index);
          index += 1;
          setTimeout(tick, speed);
        } else {
          resolve();
        }
      })();
    });
  }

  function scrollToLine(lineEl) {
    if (!termBody || !lineEl) return;
    var top = Math.max((lineEl.offsetTop || 0) - 14, 0);
    try {
      termBody.scrollTo({ top: top, behavior: reducedMotion ? "auto" : "smooth" });
    } catch (err) {
      termBody.scrollTop = top;
    }
  }

  /* Keep the visible history short — only the most recent lines stay.
     These are the last command's prompt/run/ok plus the boot banner. */
  function pruneHistory() {
    if (!termHistory) return;
    while (termHistory.children.length > 6) {
      termHistory.removeChild(termHistory.firstChild);
    }
  }

  /* Types a prompt line, an exec line, then an ok line. Queued. */
  function runInstruction(userLine, execLine, okLine) {
    termQueue = termQueue.then(function () {
      var prompt = termLine('<span class="p">jola@portfolio:~$</span> ');
      var typed = document.createElement("span");
      typed.className = "c";
      prompt.appendChild(typed);
      var caret = document.createElement("span");
      caret.className = "term-caret";
      prompt.appendChild(caret);
      scrollToLine(prompt);

      return typeInto(typed, userLine, 24).then(function () {
        caret.remove();
        if (!execLine) return;
        var exec = termLine('<span class="o">›</span> ');
        return typeInto(exec, execLine, 11);
      }).then(function () {
        return sleep(140);
      }).then(function () {
        var last = null;
        if (okLine) last = termLine(okLine, "ok");
        pruneHistory();
        scrollToLine(last || prompt);
      });
    }).catch(function () { /* never let a typo kill the session */ });
    return termQueue;
  }

  function bootSequence() {
    runInstruction("./home --boot", "loading portfolio_terminal v3.0 …", null).then(function () {
      termLine("✓ mounted: github_fetch.sh · resume.json · poems/ · art/", "ok");
      termLine("✓ jola_amodu.exe running — pick any command up top", "ok");
      pruneHistory();
      // Reveal the home view now that boot is done — it starts hidden via
      // .dm-reveal (opacity 0) and only a nav click used to reveal it.
      var active = activeViewEl() || $("#mode-technical");
      if (reducedMotion) forceIn(active);
      else staggerReveals(active);
    });
  }

  /* ------------------------------------------------------------------
     3. Views — clear the screen, run the command, populate the page
  ------------------------------------------------------------------ */
  var VIEWS = ["home", "about", "projects", "experience", "contact"];
  var CREATIVE_IDS = ["gallery", "writings", "journal", "creative-about", "creative-contact"];

  function activeViewEl() {
    return $("#term-view .dm-view.is-active");
  }

  function viewEl(name) {
    return $('#term-view .dm-view[data-view="' + name + '"]');
  }

  function commandSpec(name) {
    var projectCount = $all(".dm-project").length;
    var skillCount = $all(".dm-skill").length;
    switch (name) {
      case "about":      return ["./about", "cat about/me.txt && cat education.json && ls skills/", "✓ bio + education + " + skillCount + " skills mounted"];
      case "projects":   return ["./projects", "./fetch_projects --source=github", "✓ " + projectCount + " repositories staged"];
      case "experience": return ["./experience", "cat content/resume.json --section=work", "✓ timeline rendered"];
      case "contact":    return ["./contact", "open channels --email --linkedin", "✓ all channels open — say hi"];
      default:           return ["./home --welcome", "resuming profile …", "✓ jola_amodu.exe running"];
    }
  }

  function showView(name) {
    if (VIEWS.indexOf(name) === -1) name = "home";

    // 1. Clear the screen — the typed instructions in history stay.
    $all("#term-view .dm-view").forEach(function (v) { v.classList.remove("is-active"); });
    $all(".term-cmd[data-dm-view]").forEach(function (btn) {
      btn.classList.toggle("is-active", btn.dataset.dmView === name);
    });

    // 2. Run the instruction…
    var spec = commandSpec(name);
    runInstruction(spec[0], spec[1], spec[2]).then(function () {
      // 3. …then populate the page with the requested data.
      var el = viewEl(name);
      if (!el) return;
      el.classList.add("is-active");
      if (reducedMotion) forceIn(el);
      else staggerReveals(el);
    });
  }

  function runActionCmd(kind, btn) {
    if (kind === "resume") {
      runInstruction("./resume.pdf", "open assets/documents/Jolas_CV.pdf", "✓ streaming resume to a new tab");
      window.open(btn.dataset.resumeUrl || "#", "_blank");
    } else if (kind === "linkedin") {
      var url = btn.dataset.linkedinUrl || "https://www.linkedin.com/in/jola-amodu/";
      var target = url.indexOf("http") === 0 ? url.replace(/^https?:\/\//, "") : "linkedin_profile.pdf";
      runInstruction("./linkedin", "open " + target, "✓ opening profile");
      window.open(url, "_blank");
    } else if (kind === "blog") {
      runInstruction("./blog --flip", "switching to creative side · opening journal", "✓ flipping the medallion");
      applyMode("creative");
      setTimeout(function () {
        var journal = document.getElementById("journal");
        if (journal) journal.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      }, reducedMotion ? 0 : 380);
    }
  }

  function initViewNav() {
    $all(".term-cmd[data-dm-view]").forEach(function (btn) {
      btn.addEventListener("click", function () { showView(btn.dataset.dmView); });
    });
    $all("[data-dm-cmd]").forEach(function (btn) {
      btn.addEventListener("click", function () { runActionCmd(btn.dataset.dmCmd, btn); });
    });
  }

  /* ------------------------------------------------------------------
     4. Typewriter — rotating titles on the home view
  ------------------------------------------------------------------ */
  function startTypewriter() {
    var el = document.getElementById("typewriter");
    if (!el || el.dataset.running) return;
    el.dataset.running = "1";

    var words = [
      "Full-Stack Developer",
      "AI & Automation Enthusiast",
      '"If it exists, we can automate"',
      "Visual Storyteller",
      "Digital Product Builder",
      "Dark Mode Evangelist"
    ];
    var wordIndex = 0;
    var charIndex = 0;
    var isDeleting = false;
    var typingSpeed = 100;

    (function type() {
      var currentWord = words[wordIndex];
      if (isDeleting) {
        el.textContent = currentWord.substring(0, charIndex - 1);
        charIndex -= 1;
        typingSpeed = 50;
      } else {
        el.textContent = currentWord.substring(0, charIndex + 1);
        charIndex += 1;
        typingSpeed = 100;
      }

      if (!isDeleting && charIndex === currentWord.length) {
        typingSpeed = 2000;
        isDeleting = true;
      } else if (isDeleting && charIndex === 0) {
        isDeleting = false;
        wordIndex = (wordIndex + 1) % words.length;
        typingSpeed = 500;
      }
      setTimeout(type, typingSpeed);
    })();
  }

  /* ------------------------------------------------------------------
     5. Project tag filters (rendered from the data itself)
  ------------------------------------------------------------------ */
  function collectTags() {
    var tags = [];
    $all(".dm-project").forEach(function (card) {
      (card.dataset.tags || "").split(/\s+/).forEach(function (tag) {
        if (tag && tags.indexOf(tag) === -1) tags.push(tag);
      });
    });
    return tags.sort();
  }

  function countVisible(tag) {
    if (tag === "all") return $all(".dm-project").length;
    return $all(".dm-project").filter(function (card) {
      return (card.dataset.tags || "").split(/\s+/).indexOf(tag) !== -1;
    }).length;
  }

  function filterProjects(tag) {
    $all(".dm-tag").forEach(function (chip) {
      chip.classList.toggle("active", chip.dataset.tag === tag);
    });
    $all(".dm-project").forEach(function (card) {
      var tags = (card.dataset.tags || "").split(/\s+/);
      var show = tag === "all" || tags.indexOf(tag) !== -1;
      card.classList.toggle("is-hidden", !show);
      if (show) {
        card.classList.remove("is-in");
        card.style.setProperty("--dm-delay", (card.dataset.index || 0) * 60 + "ms");
        requestAnimationFrame(function () {
          requestAnimationFrame(function () { card.classList.add("is-in"); });
        });
      }
    });
  }

  function buildTagBar() {
    var bar = $("#dm-tagbar");
    if (!bar) return;
    collectTags().forEach(function (tag) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "dm-tag";
      chip.dataset.tag = tag;
      chip.textContent = tag;
      chip.addEventListener("click", function () {
        filterProjects(tag);
        runInstruction(
          'user.click("Filter: ' + tag + '")',
          "executing git_fetch_projects.sh --tag=" + tag,
          "✓ " + countVisible(tag) + ' repositories matched --tag=' + tag
        );
      });
      bar.appendChild(chip);
    });
  }

  /* ------------------------------------------------------------------
     6. Polaroids — click / Enter flips to the story side
  ------------------------------------------------------------------ */
  function initPolaroids() {
    $all(".dm-polaroid").forEach(function (card) {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-pressed", "false");
      function flip() {
        var flipped = card.classList.toggle("is-flipped");
        card.setAttribute("aria-pressed", String(flipped));
      }
      card.addEventListener("click", flip);
      card.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          flip();
        }
      });
    });
  }

  /* ------------------------------------------------------------------
     7. Notepads — line-by-line reveal as the card scrolls into view
  ------------------------------------------------------------------ */
  var noteObserver = null;

  function observeNotepads() {
    var cards = $all(".dm-notepad");
    if (!cards.length) return;

    if (reducedMotion || !("IntersectionObserver" in window)) {
      cards.forEach(function (card) {
        $all(".dm-note-line", card).forEach(function (line) { line.classList.add("shown"); });
      });
      return;
    }

    if (!noteObserver) {
      noteObserver = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var card = entry.target;
          noteObserver.unobserve(card);
          $all(".dm-note-line", card).forEach(function (line, index) {
            setTimeout(function () { line.classList.add("shown"); }, index * 210);
          });
        });
      }, { threshold: 0.25 });
    }
    cards.forEach(function (card) {
      if (!card.classList.contains("dm-note-armed")) {
        card.classList.add("dm-note-armed");
        noteObserver.observe(card);
      }
    });
  }

  /* ------------------------------------------------------------------
     8. Anchor routing — /#contact etc. still work from any page
  ------------------------------------------------------------------ */
  function initAnchorRouting() {
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest('a[href*="#"]') : null;
      if (!link) return;
      var href = link.getAttribute("href") || "";
      var hashIndex = href.indexOf("#");
      if (hashIndex === -1) return;
      var path = href.slice(0, hashIndex);
      if (path && path !== "/" && path !== "./" && path !== window.location.pathname) return;

      var id = href.slice(hashIndex + 1);
      if (!id) return;

      if (VIEWS.indexOf(id) !== -1) {
        event.preventDefault();
        if (currentMode !== "technical") {
          applyMode("technical");
          setTimeout(function () { showView(id); }, reducedMotion ? 0 : 340);
        } else {
          showView(id);
        }
        return;
      }

      if (CREATIVE_IDS.indexOf(id) !== -1) {
        event.preventDefault();
        var go = function () {
          var target = document.getElementById(id);
          if (target) target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        };
        if (currentMode !== "creative") {
          applyMode("creative");
          setTimeout(go, reducedMotion ? 0 : 340);
        } else {
          go();
        }
      }
    });
  }

  /* ------------------------------------------------------------------
     9. Boot
  ------------------------------------------------------------------ */
  function init() {
    termBody = $("#term-body");
    termHistory = $("#term-history");
    initMedallion();      // <- was never called! the toggle couldn't work
    buildTagBar();
    initViewNav();
    initPolaroids();
    initAnchorRouting();
    startTypewriter();

    // Default project state: everything visible, chips ready.
    filterProjects("all");

    // Stored mode (or a #hash deep link) decides which side greets you.
    var stored = readStoredMode();
    applyMode(stored, { instant: true });

    var hash = (window.location.hash || "").replace("#", "");
    if (hash) {
      if (VIEWS.indexOf(hash) !== -1) {
        showView(hash);
      } else if (CREATIVE_IDS.indexOf(hash) !== -1) {
        if (stored !== "creative") applyMode("creative", { instant: true });
        setTimeout(function () {
          var target = document.getElementById(hash);
          if (target) target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
        }, reducedMotion ? 0 : 350);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})();

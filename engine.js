// Splitter engine: reads a textbook PDF, finds where lessons/units start, and splits it.
// No DOM code here — the UI lives in app.js.
const Splitter = (() => {
  const tick = () => new Promise(r => setTimeout(r));

  // ---------- Libraries (loaded on demand to keep the landing page fast) ----------
  const LIBS = [
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  ];
  let libsPromise = null;
  function loadLibs() {
    if (!libsPromise) {
      libsPromise = Promise.all(LIBS.map(src => new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = src; s.async = true; s.onload = resolve;
        s.onerror = () => reject(new Error("تعذّر تحميل مكتبات PDF. تحقق من اتصال الإنترنت."));
        document.head.appendChild(s);
      }))).then(() => {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }).catch(err => { libsPromise = null; throw err; });
    }
    return libsPromise;
  }

  // ---------- Loading ----------
  async function load(bytes, onProgress) {
    await loadLibs();
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice() }).promise;
    const book = { bytes, pdf, numPages: pdf.numPages, pageLines: [], outline: await readOutline(pdf) };
    let chars = 0;
    for (let i = 1; i <= book.numPages; i++) {
      const lines = await extractLines(await pdf.getPage(i));
      book.pageLines.push(lines);
      chars += lines.reduce((a, l) => a + l.text.length, 0);
      if (i % 4 === 0 || i === book.numPages) { onProgress && onProgress(i, book.numPages); await tick(); }
    }
    book.hasText = chars > book.numPages * 20;
    book.bodySize = bodyFontSize(book.pageLines);
    return book;
  }

  async function readOutline(pdf) {
    const out = [];
    const items = await pdf.getOutline().catch(() => null);
    if (!items) return out;
    async function walk(list, level) {
      for (const it of list) {
        let page = null;
        try {
          let dest = it.dest;
          if (typeof dest === "string") dest = await pdf.getDestination(dest);
          if (Array.isArray(dest)) page = typeof dest[0] === "number" ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1;
        } catch (e) {}
        if (page) out.push({ title: (it.title || "").trim(), page, level });
        if (it.items && it.items.length) await walk(it.items, level + 1);
      }
    }
    await walk(items, 0);
    return out;
  }

  async function extractLines(page) {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const groups = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5], size = Math.hypot(it.transform[2], it.transform[3]) || it.height || 0;
      let g = groups.find(g => Math.abs(g.y - y) < Math.max(3, size * 0.4));
      if (!g) { g = { y, items: [], size: 0 }; groups.push(g); }
      g.items.push({ x: it.transform[4], str: it.str });
      g.size = Math.max(g.size, size);
    }
    groups.sort((a, b) => b.y - a.y);
    return groups.map(g => {
      const rtl = /[؀-ۿﭐ-﻿]/.test(g.items.map(i => i.str).join(""));
      g.items.sort((a, b) => rtl ? b.x - a.x : a.x - b.x);
      return { text: g.items.map(i => i.str).join(" ").replace(/\s+/g, " ").trim(), size: g.size, yRatio: 1 - g.y / vp.height };
    });
  }

  // Typical body-text font size of the whole book (weighted by characters).
  function bodyFontSize(pageLines) {
    const counts = {};
    pageLines.flat().forEach(l => { const k = Math.round(l.size); counts[k] = (counts[k] || 0) + l.text.length; });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? +best[0] : 0;
  }

  // ---------- Text helpers ----------
  function normalize(s) {
    return s.normalize("NFKC")
      .replace(/[ً-ٰٟـ]/g, "")                       // tashkeel + tatweel
      .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة(?=\s|$)/g, "ه")
      .replace(/\s+/g, " ").trim();
  }
  // Arabic textbook PDFs often extract slightly garbled ("الأول" -> "األول"), so only the
  // keyword itself is required at the start of a heading line.
  const EN_NUM = "\\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve";
  const AR_END = "(?=[\\s:：0-9٠-٩]|$)";
  const PATTERNS = {
    lesson:  [new RegExp(`^(ال)?درس${AR_END}`), new RegExp(`^lesson\\s*(${EN_NUM})\\b`, "i")],
    unit:    [new RegExp(`^(ال)?وحده${AR_END}`), new RegExp(`^(unit|module)\\s*(${EN_NUM})\\b`, "i")],
    chapter: [new RegExp(`^(ال)?فصل${AR_END}`), new RegExp(`^chapter\\s*(${EN_NUM})\\b`, "i")],
    back:    [/^(المسرد|الملاحق|الملحق|المراجع|قائمه المصطلحات|معجم المصطلحات)$/, /^(glossary|index|appendix|appendices|references|bibliography)\b/i],
  };
  const REVIEW = /(اسئله|تقويم|مراجعه|review|questions|assessment)/i;

  function cleanTitle(s) {
    return s.normalize("NFKC").replace(/[ً-ٰٟـ�]/g, "")
      .replace(/ا([أإآ])ل/g, "ال$1").replace(/(^|\s)اال/g, "$1ال")
      .replace(/\s*\(\s*/g, " (").replace(/\s*\)\s*/g, ") ").replace(/\s+/g, " ").trim();
  }
  function headingKind(t) {
    t = t.replace(/^[^\p{L}\p{N}]+/u, "");
    const candidates = [t, [...t].reverse().join(""), t.split(" ").reverse().join(" ")];
    for (const kind in PATTERNS)
      for (const c of candidates)
        if (PATTERNS[kind].some(r => r.test(c))) return kind;
    return null;
  }
  function customMatch(t, kws) {
    const candidates = [t, [...t].reverse().join("")];
    return kws.some(k => candidates.some(c => c.toLowerCase().startsWith(k.toLowerCase())));
  }
  // Visual category of a row, used by the UI for colors/labels.
  function displayKind(title, kind) {
    const n = normalize(title);
    if (REVIEW.test(n)) return "review";
    if (kind === "chapter") return "unit";
    return kind || headingKind(n) || "lesson";
  }

  // ---------- Detection ----------
  function scanHeadings(book, kws) {
    const hits = [], bodySize = book.bodySize;
    book.pageLines.forEach((lines, idx) => {
      if (lines.slice(0, 4).some(l => /^(المحتويات|الفهرس|فهرس المحتويات|(table of )?contents|index)$/i.test(normalize(l.text).replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "")))) return;
      const found = [];
      lines.forEach((l, li) => {
        if (l.text.length > 90 || l.yRatio > 0.4 || l.size < bodySize * 1.05) return;
        const t = normalize(l.text);
        const k = headingKind(t) || (kws.length && customMatch(t, kws) ? "custom" : null);
        if (k) found.push({ l, li, k });
      });
      if (!found.length || found.length >= 3) return;   // 3+ hits = table of contents
      found.sort((a, b) => b.l.size - a.l.size);
      const { l, li, k } = found[0];
      let title = l.text;
      const next = lines[li + 1];   // "الدَّرس" on one line, "الأول + name" on the next
      if (title.length < 30 && next && next.text.length < 80 && next.yRatio - l.yRatio < 0.08 && next.size >= bodySize * 1.05) title += " " + next.text;
      hits.push({ title: cleanTitle(title), start: idx + 1, kind: k, key: normalize(title) });
    });
    return hits.filter((h, i) => !(i && hits[i - 1].key === h.key && hits[i - 1].kind === h.kind));
  }

  function fromText(book, kinds, kws) {
    const hits = scanHeadings(book, kws);
    const wanted = hits.filter(h => kinds.includes(h.kind) || h.kind === "custom");
    if (!wanted.length) return [];
    const extra = hits.filter(h => !wanted.includes(h) && ["unit", "chapter", "back"].includes(h.kind) && h.start >= wanted[0].start - 5);
    return [...wanted, ...extra].map(h => ({ title: h.title, start: h.start, kind: displayKind(h.title, h.kind === "custom" ? "lesson" : h.kind) }));
  }

  function outlineLevels(book) {
    const o = book.outline;
    const levels = [...new Set(o.map(x => x.level))].sort();
    const cnt = l => new Set(o.filter(x => x.level <= l).map(x => x.page)).size;
    const lessonLevel = levels.find(l => {
      const its = o.filter(x => x.level === l);
      return its.filter(x => headingKind(normalize(x.title)) === "lesson").length >= its.length / 2;
    });
    let best = levels[0];
    for (const l of levels) if (book.numPages / cnt(l) >= 3 && cnt(l) > cnt(best)) best = l;
    return { levels: levels.map(l => ({ level: l, count: o.filter(x => x.level === l).length })), def: lessonLevel ?? best };
  }

  // opts: {mode: auto|outline|text, kinds: [...], kws: "a, b", level}
  function detect(book, opts) {
    const kinds = opts.kinds && opts.kinds.length ? opts.kinds : ["lesson"];
    const kws = (opts.kws || "").split(/[,،]/).map(normalize).filter(Boolean);
    let rows = [], source = "";
    if (opts.mode !== "text" && book.outline.length) {
      const lvl = opts.level ?? outlineLevels(book).def;
      rows = book.outline.filter(o => o.level <= lvl)
        .map(o => ({ title: o.title, start: o.page, level: o.level, kind: displayKind(o.title, o.level < lvl ? "unit" : "lesson") }))
        .sort((a, b) => a.start - b.start || b.level - a.level);
      source = "outline";
    }
    if ((opts.mode === "auto" && rows.length < 2) || opts.mode === "text") {
      rows = fromText(book, kinds, kws); source = "text";
      if (opts.mode === "auto" && rows.length < 2 && kinds.length === 1 && kinds[0] === "lesson") {
        const alt = fromText(book, ["unit", "chapter"], kws);
        if (alt.length > rows.length) { rows = alt; source = "text-units"; }
      }
    }
    rows.sort((a, b) => a.start - b.start);
    rows = rows.filter((r, i) => i === 0 || r.start !== rows[i - 1].start);
    return { rows: rows.map(r => ({ title: r.title, start: r.start, kind: r.kind })), source };
  }

  // ---------- Rendering & splitting ----------
  const renderTasks = new WeakMap();
  async function renderPage(book, n, canvas, cssWidth) {
    const page = await book.pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: (cssWidth / base.width) * Math.min(2, window.devicePixelRatio || 1) });
    const prev = renderTasks.get(canvas);
    if (prev) prev.cancel();
    const off = document.createElement("canvas");
    off.width = vp.width; off.height = vp.height;
    const task = page.render({ canvasContext: off.getContext("2d"), viewport: vp });
    renderTasks.set(canvas, task);
    try { await task.promise; } catch (e) { return false; }
    canvas.width = off.width; canvas.height = off.height;
    canvas.getContext("2d").drawImage(off, 0, 0);
    return true;
  }

  function safeName(s) { return s.replace(/[\\/:*?"<>|\n\r\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "درس"; }

  // parts: [{title, start, end, num}]
  async function split(book, parts, onProgress) {
    const { PDFDocument } = PDFLib;
    const src = await PDFDocument.load(book.bytes, { ignoreEncryption: true });
    const zip = new JSZip();
    const pad = Math.max(2, String(parts.length).length);
    let done = 0;
    for (const p of parts) {
      if (p.end >= p.start) {
        const out = await PDFDocument.create();
        const idx = Array.from({ length: p.end - p.start + 1 }, (_, j) => p.start - 1 + j);
        (await out.copyPages(src, idx)).forEach(pg => out.addPage(pg));
        out.setTitle(p.title);
        zip.file(`${String(p.num).padStart(pad, "0")} - ${safeName(p.title)}.pdf`, await out.save());
      }
      onProgress && onProgress(++done, parts.length);
      await tick();
    }
    return zip.generateAsync({ type: "blob" });
  }

  // One part as a single PDF (for downloading one lesson).
  async function extractOne(book, p) {
    const { PDFDocument } = PDFLib;
    const src = await PDFDocument.load(book.bytes, { ignoreEncryption: true });
    const out = await PDFDocument.create();
    const idx = Array.from({ length: p.end - p.start + 1 }, (_, j) => p.start - 1 + j);
    (await out.copyPages(src, idx)).forEach(pg => out.addPage(pg));
    out.setTitle(p.title);
    return new Blob([await out.save()], { type: "application/pdf" });
  }

  return { loadLibs, load, detect, outlineLevels, renderPage, split, extractOne, safeName };
})();

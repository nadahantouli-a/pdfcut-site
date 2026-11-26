// UI for مِقَصّ. Detection/splitting logic lives in engine.js.
(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const LESSON_COLORS = ["var(--t1)", "var(--t2)", "var(--t3)", "var(--t4)", "var(--t6)", "var(--t7)"];
  const KIND = {
    lesson: { label: "درس" }, unit: { label: "وحدة", color: "var(--ink)" }, review: { label: "مراجعة", color: "var(--t5)" },
    back: { label: "ملحق", color: "#9A8F78" }, intro: { label: "مقدمة", color: "#9A8F78" },
  };

  let book = null, fileName = "", rows = [], sel = -1, curPage = 1, lastZipUrl = null;

  const setStage = s => { document.body.dataset.stage = s; window.scrollTo({ top: 0 }); };
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pagesWord = n => n === 1 ? "صفحة واحدة" : n === 2 ? "صفحتان" : n <= 10 ? `${n} صفحات` : `${n} صفحة`;

  // ───────── Upload ─────────
  const drop = $("#drop"), input = $("#file");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) open(f); });
  drop.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  drop.addEventListener("click", e => { if (document.body.dataset.stage === "loading") e.preventDefault(); });
  input.addEventListener("change", () => { if (input.files[0]) open(input.files[0]); input.value = ""; });
  // Start fetching the PDF libraries as soon as the visitor shows intent to upload.
  const prefetch = () => Splitter.loadLibs().catch(() => {});
  ["pointerenter", "focusin", "touchstart"].forEach(ev => drop.addEventListener(ev, prefetch, { once: true, passive: true }));
  document.addEventListener("dragenter", prefetch, { once: true });

  async function open(file) {
    $("#dropError").textContent = "";
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { $("#dropError").textContent = "هذا ليس ملف PDF. جرّب ملفاً آخر."; return; }
    fileName = file.name.replace(/\.pdf$/i, "");
    setStage("loading");
    $("#busyTitle").textContent = "نقرأ الكتاب…";
    $("#meterFill").style.width = "0%";
    $("#busyText").textContent = file.name;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      book = await Splitter.load(bytes, (i, n) => {
        $("#meterFill").style.width = (i / n * 100) + "%";
        $("#busyText").textContent = `صفحة ${i} من ${n}`;
      });
    } catch (err) {
      console.error(err);
      setStage("upload");
      const msg = String(err && err.name + " " + err.message);
      $("#dropError").textContent = /password/i.test(msg) ? "الملف محمي بكلمة سر، افتح الحماية ثم جرّب مرة أخرى."
        : /مكتبات/.test(msg) ? err.message
        : "تعذّرت قراءة الملف. تأكد أنه PDF سليم.";
      return;
    }
    track("book-opened", "فتح كتاب");
    setupReview();
  }

  // Anonymous usage counter (GoatCounter): sends only the event name, never the
  // book, its name, or anything about the visitor. Does nothing if the script is blocked.
  function track(path, title) {
    try { window.goatcounter && window.goatcounter.count && window.goatcounter.count({ path, title, event: true }); } catch (e) {}
  }

  // ───────── Review ─────────
  function setupReview() {
    $("#bookTitle").textContent = fileName;
    $("#pgTotal").textContent = book.numPages;
    $("#pgInput").max = book.numPages;
    $("#stripEnd").textContent = "ص " + book.numPages;
    const lv = $("#outlineLevel");
    if (book.outline.length) {
      const { levels, def } = Splitter.outlineLevels(book);
      lv.innerHTML = levels.map(l => `<option value="${l.level}">المستوى ${l.level + 1} · ${l.count} عنوان</option>`).join("");
      lv.value = def; lv.disabled = false;
    } else { lv.innerHTML = "<option>لا يوجد فهرس جانبي</option>"; lv.disabled = true; }
    setStage("review");
    detect();
  }

  function detect() {
    const opts = {
      mode: $("input[name=mode]:checked").value,
      kinds: $$(".kind:checked").map(c => c.value),
      kws: $("#customKw").value,
      level: book.outline.length ? +$("#outlineLevel").value : undefined,
    };
    const res = Splitter.detect(book, opts);
    rows = res.rows;
    const n = rows.length, lessons = rows.filter(r => r.kind === "lesson").length, units = rows.filter(r => r.kind === "unit").length;
    const how = res.source === "outline" ? "من الفهرس الجانبي للكتاب" : "من عناوين الصفحات";
    if (n) notice("ok", `<b>وجدنا ${lessons} ${lessons === 1 ? "درس" : "دروس"}${units ? ` في ${units} ${units === 1 ? "وحدة" : "وحدات"}` : ""}</b> ${how}. راجع القائمة، وصحّح أي بداية خاطئة من المعاينة، ثم اضغط «قُصّ ونزّل» لكل الدروس، أو «نزّل» بجانب أي درس لتنزيله وحده.`);
    else if (!book.hasText) notice("warn", "<b>يبدو أن الكتاب صور ممسوحة (سكانر)</b> ولا يحتوي نصاً، لذا لم نكتشف الدروس تلقائياً. تنقّل في المعاينة واضغط «درس جديد من هنا» عند بداية كل درس.");
    else notice("warn", "<b>لم نجد عناوين دروس.</b> افتح «خيارات الاكتشاف» وجرّب الوحدات أو الفصول، أو اكتب الكلمة التي تبدأ بها الدروس، أو أضف الدروس يدوياً من المعاينة.");
    sel = rows.length ? 0 : -1;
    render(true);
    goTo(sel >= 0 ? rows[0].start : 1);
  }

  function notice(type, html) { const el = $("#notice"); el.className = `notice show ${type}`; el.innerHTML = html; }

  // Rows + optional intro, with computed end pages, numbers and colors.
  function parts() {
    const out = [];
    if ($("#includeIntro").checked && rows.length && rows[0].start > 1)
      out.push({ title: "مقدمة", start: 1, end: rows[0].start - 1, kind: "intro", idx: -1 });
    let li = 0;
    rows.forEach((r, i) => {
      const end = i < rows.length - 1 ? rows[i + 1].start - 1 : book.numPages;
      const color = KIND[r.kind] && KIND[r.kind].color || LESSON_COLORS[li++ % LESSON_COLORS.length];
      out.push({ ...r, end, idx: i, color });
    });
    out.forEach((p, k) => { p.num = out[0].kind === "intro" ? k : k + 1; if (p.kind === "intro") p.color = KIND.intro.color; });
    return out;
  }

  function render(animate) {
    $("#lessons").classList.toggle("anim", !!animate);
    const ps = parts();
    const total = rows.length;
    $("#bookStats").textContent = `${book.numPages} صفحة · ${total ? `${ps.length} ملف` : "لا ملفات بعد"}`;
    $("#splitBtn").disabled = !total;
    if ($("#splitBtn2")) { $("#splitBtn2").disabled = !total; $("#splitCount").textContent = total ? `سيُنزَّل ${ps.length} ملف في ZIP واحد.` : ""; }

    // strip
    $("#strip").innerHTML = ps.map(p => {
      const pages = Math.max(0, p.end - p.start + 1);
      return `<button class="seg-b k-${p.kind}${p.idx === sel && p.idx >= 0 ? " sel" : ""}" style="flex:${Math.max(pages, .3)};--c:${p.color}" data-idx="${p.idx}" data-start="${p.start}" title="${esc(p.title)} · ص ${p.start}–${p.end}"><span>${pages >= 4 ? String(p.num).padStart(2, "0") : ""}</span></button>`;
    }).join("");

    // list
    $("#lessons").innerHTML = ps.map((p, k) => {
      const pages = p.end - p.start + 1;
      const label = (KIND[p.kind] || KIND.lesson).label;
      if (p.kind === "intro") return `
        <li class="lesson intro" style="--i:${k};--c:${p.color}" data-idx="-1" data-start="1">
          <span class="num">00</span>
          <input class="title" value="مقدمة الكتاب (الغلاف والفهرس)" disabled>
          <span class="side"><button class="dl" data-act="dl" title="نزّل هذا الدرس وحده" aria-label="نزّل هذا الدرس وحده"><svg><use href="#i-download"/></svg><span>نزّل</span></button></span>
          <span class="meta"><span class="kind-tag">${label}</span> ص ${p.start} – ${p.end} · ${pagesWord(pages)}</span>
        </li>`;
      return `
        <li class="lesson ${p.kind}${p.idx === sel ? " sel" : ""}" style="--i:${k};--c:${p.color}" data-idx="${p.idx}">
          <span class="num">${String(p.num).padStart(2, "0")}</span>
          <input class="title" value="${esc(p.title)}" aria-label="اسم الملف">
          <span class="side">
            <span class="stepper" title="صفحة البداية">
              <button data-act="dec" aria-label="أقل">−</button>
              <input type="number" class="start" min="1" max="${book.numPages}" value="${p.start}" aria-label="صفحة البداية">
              <button data-act="inc" aria-label="أكثر">+</button>
            </span>
            ${pages >= 1 ? '<button class="dl" data-act="dl" title="نزّل هذا الدرس وحده" aria-label="نزّل هذا الدرس وحده"><svg><use href="#i-download"/></svg><span>نزّل</span></button>' : ""}
            <button class="del" data-act="del" title="حذف"><svg><use href="#i-x"/></svg></button>
          </span>
          <span class="meta"><span class="kind-tag">${label}</span>
            ${pages < 1 ? `<span class="bad">بدايته بعد الدرس التالي!</span>` : `ص ${p.start} – ${p.end} · ${pagesWord(pages)}`}</span>
        </li>`;
    }).join("");
    updateHint();
  }

  function select(idx, page) {
    sel = idx;
    $$(".lesson").forEach(el => el.classList.toggle("sel", +el.dataset.idx === idx && idx >= 0));
    $$(".seg-b").forEach(el => el.classList.toggle("sel", +el.dataset.idx === idx && idx >= 0));
    if (page) goTo(page);
  }

  function setStart(idx, value) {
    const r = rows[idx];
    r.start = Math.min(book.numPages, Math.max(1, Math.round(+value) || 1));
    rows.sort((a, b) => a.start - b.start);
    sel = rows.indexOf(r);
    render();
    goTo(r.start);
  }

  // list events (delegated)
  const list = $("#lessons");
  list.addEventListener("click", e => {
    const li = e.target.closest(".lesson"); if (!li) return;
    const idx = +li.dataset.idx;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "dl") { downloadOne(idx, e.target.closest(".dl")); return; }
    if (act === "del") { rows.splice(idx, 1); sel = Math.min(idx, rows.length - 1); render(); if (sel >= 0) goTo(rows[sel].start); return; }
    if (act === "inc" || act === "dec") { setStart(idx, rows[idx].start + (act === "inc" ? 1 : -1)); return; }
    if (idx === -1) { select(-1, 1); return; }
    if (idx !== sel || !e.target.matches("input")) select(idx, rows[idx].start);
  });
  list.addEventListener("input", e => {
    if (!e.target.matches(".title")) return;
    const idx = +e.target.closest(".lesson").dataset.idx;
    rows[idx].title = e.target.value;
    const seg = $(`.seg-b[data-idx="${idx}"]`); if (seg) seg.title = e.target.value;
    updateHint();
  });
  list.addEventListener("change", e => {
    if (!e.target.matches(".start")) return;
    setStart(+e.target.closest(".lesson").dataset.idx, e.target.value);
  });
  list.addEventListener("focusin", e => {
    const li = e.target.closest(".lesson"); if (!li) return;
    const idx = +li.dataset.idx; if (idx >= 0 && idx !== sel) select(idx, rows[idx].start);
  });

  $("#strip").addEventListener("click", e => {
    const b = e.target.closest(".seg-b"); if (!b) return;
    const idx = +b.dataset.idx;
    select(idx, +b.dataset.start);
    const li = $(`.lesson[data-idx="${idx}"]`); if (li) li.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  $("#addRow").addEventListener("click", () => addAt(Math.min(book.numPages, (rows.length ? rows[rows.length - 1].start : 0) + 1)));
  $("#newHere").addEventListener("click", () => addAt(curPage));
  $("#startHere").addEventListener("click", () => { if (sel >= 0) setStart(sel, curPage); });

  function addAt(page) {
    const existing = rows.findIndex(r => r.start === page);
    if (existing >= 0) { select(existing, page); focusTitle(existing); return; }
    const r = { title: `درس جديد (ص ${page})`, start: page, kind: "lesson" };
    rows.push(r); rows.sort((a, b) => a.start - b.start);
    sel = rows.indexOf(r);
    render(); goTo(page); focusTitle(sel);
    if (rows.length === 1) $("#notice").classList.remove("show");
  }
  function focusTitle(idx) {
    const t = $(`.lesson[data-idx="${idx}"] .title`);
    if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.focus({ preventScroll: true }); t.select(); }
  }

  // options
  $$("input[name=mode], .kind, #outlineLevel").forEach(el => el.addEventListener("change", detect));
  $("#redetect").addEventListener("click", detect);
  $("#customKw").addEventListener("keydown", e => { if (e.key === "Enter") detect(); });
  $("#includeIntro").addEventListener("change", render);
  $("#newFile").addEventListener("click", () => { book = null; rows = []; setStage("upload"); });

  // ───────── Viewer ─────────
  let renderSeq = 0;
  async function goTo(n) {
    if (!book) return;
    curPage = Math.min(book.numPages, Math.max(1, n));
    $("#pgInput").value = curPage;
    updateHint();
    const seq = ++renderSeq;
    const canvas = $("#pgCanvas");
    const w = Math.max(280, canvas.parentElement.clientWidth || 340);
    await Splitter.renderPage(book, curPage, canvas, w);
    if (seq !== renderSeq) return;
  }
  function updateHint() {
    const hint = $("#canvasHint");
    const at = rows.find(r => r.start === curPage);
    hint.textContent = at ? `✂ بداية: ${at.title}` : "";
    hint.classList.toggle("show", !!at);
    const part = parts().find(p => curPage >= p.start && curPage <= p.end);
    $("#viewerTag").textContent = part ? part.title : "معاينة";
    const s = $("#startHere");
    s.disabled = sel < 0 || (rows[sel] && rows[sel].start === curPage);
    s.textContent = sel >= 0 && rows[sel] ? `يبدأ «${trim(rows[sel].title, 18)}» هنا` : "يبدأ الدرس المحدد هنا";
  }
  const trim = (s, n) => s.length > n ? s.slice(0, n) + "…" : s;
  $("#pgPrev").addEventListener("click", () => goTo(curPage - 1));
  $("#pgNext").addEventListener("click", () => goTo(curPage + 1));
  $("#pgInput").addEventListener("change", e => goTo(+e.target.value || 1));
  document.addEventListener("keydown", e => {
    if (document.body.dataset.stage !== "review" || e.target.matches("input, select, textarea") || !$("#overlay").hidden) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); goTo(curPage + 1); }     // RTL: left = forward
    if (e.key === "ArrowRight") { e.preventDefault(); goTo(curPage - 1); }
  });

  // ───────── Split ─────────
  async function downloadOne(idx, btn) {
    const p = parts().find(x => x.idx === idx);
    if (!p || p.end < p.start || (btn && btn.disabled)) return;
    if (btn) { btn.disabled = true; btn.classList.add("busy"); }
    try {
      const blob = await Splitter.extractOne(book, p);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${String(p.num).padStart(2, "0")} - ${Splitter.safeName(p.title)}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      track("download-one", "تنزيل درس واحد");
    } catch (err) {
      console.error(err);
      notice("warn", "<b>تعذّر تنزيل الدرس.</b> " + esc(String(err && err.message || "")));
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove("busy"); }
    }
  }
  if ($("#splitBtn2")) $("#splitBtn2").addEventListener("click", () => $("#splitBtn").click());
  const ov = $("#overlay");
  $("#splitBtn").addEventListener("click", async () => {
    const ps = parts().filter(p => p.end >= p.start);
    if (!ps.length) return;
    ov.hidden = false; ov.classList.remove("done");
    const anim = ov.querySelector(".cut-anim");
    anim.style.setProperty("--p", "0%");
    $("#ovTitle").textContent = "نقصّ الدروس…";
    $("#ovText").textContent = `0 من ${ps.length}`;
    try {
      const blob = await Splitter.split(book, ps, (i, n) => {
        anim.style.setProperty("--p", (i / n * 100) + "%");
        $("#ovText").textContent = `${i} من ${n}`;
      });
      if (lastZipUrl) URL.revokeObjectURL(lastZipUrl);
      lastZipUrl = URL.createObjectURL(blob);
      const a = $("#ovDownload");
      a.href = lastZipUrl;
      a.download = `${Splitter.safeName(fileName)} - دروس.zip`;
      a.click();
      track("split", "تقسيم كتاب");
      ov.classList.add("done");
      $("#ovTitle").textContent = "جاهز!";
      $("#ovText").textContent = `${ps.length} ملف في ZIP واحد (${(blob.size / 1048576).toFixed(1)} م.ب). بدأ التنزيل تلقائياً.`;
    } catch (err) {
      console.error(err);
      ov.classList.add("done");
      $("#ovTitle").textContent = "حدث خطأ";
      $("#ovText").textContent = "لم نتمكن من تقسيم الملف: " + err.message;
    }
  });
  $("#ovClose").addEventListener("click", () => { ov.hidden = true; });
  ov.addEventListener("click", e => { if (e.target === ov && ov.classList.contains("done")) ov.hidden = true; });

  // Dev helper (local testing only): ?src=file.pdf loads a PDF from the same folder.
  const src = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get("src");
  if (src && /^[\w.\-]+\.pdf$/i.test(src)) fetch(src).then(r => r.blob()).then(b => open(new File([b], decodeURIComponent(src.split("/").pop()), { type: "application/pdf" })));
})();

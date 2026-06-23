const NOTES_KEY = "reading_notes_v1";
const PREFS_KEY = "reader_prefs_v1";

const state = {
  library: null,
  query: "",
  sidebarOpen: false,
  currentCleanup: null,
  notesQuery: "",
};

window.addEventListener("hashchange", renderApp);
window.addEventListener("DOMContentLoaded", renderApp);

async function renderApp() {
  cleanupCurrentView();
  const app = document.getElementById("app");
  const route = getRoute();

  if (route.name === "reader") {
    await renderReaderPage(app, route.id);
    return;
  }

  if (route.name === "notes") {
    await renderNotesPage(app);
    return;
  }

  await renderLibraryPage(app);
}

async function renderLibraryPage(app) {
  const library = await loadLibrary();
  const books = filterBooks(library.books, state.query);

  app.innerHTML = `
    <div class="app-shell">
      <div class="library-page">
        <div class="library-head">
          <div>
            <h1 class="library-title">黑读</h1>
            <p class="library-subtitle">本地极简阅读 + 独立笔记。目录入口直接读取 ${escapeHtml(library.libraryRoot)}</p>
            <div class="top-nav">
              <a href="#/" class="active">书库</a>
              <a href="#/notes">笔记</a>
            </div>
          </div>
          <div class="library-actions">
            <input class="search-input" id="search-input" placeholder="搜索书名 / 文件类型" value="${escapeAttr(state.query)}" />
            <button class="ghost-btn" id="refresh-btn">刷新目录</button>
          </div>
        </div>
        <div class="book-grid">
          ${books.length ? books.map(renderBookCard).join("") : `<div class="empty-state">没搜到结果，换个关键词试试。</div>`}
        </div>
      </div>
    </div>
  `;

  app.querySelector("#search-input").addEventListener("input", (event) => {
    state.query = event.target.value;
    renderLibraryPage(app);
  });

  app.querySelector("#refresh-btn").addEventListener("click", async () => {
    state.library = null;
    await renderLibraryPage(app);
  });
}

async function renderNotesPage(app) {
  const library = await loadLibrary();
  const notes = getAllNotes()
    .filter((note) => {
      const q = state.notesQuery.trim().toLowerCase();
      if (!q) return true;
      return [note.title, note.content, note.bookTitle, note.createdAtLabel].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  app.innerHTML = `
    <div class="app-shell">
      <div class="notes-page">
        <div class="library-head">
          <div>
            <h1 class="library-title">笔记</h1>
            <p class="library-subtitle">阅读和记录分开。这里单独沉淀你的想法、摘抄、交易感受与日期。</p>
            <div class="top-nav">
              <a href="#/">书库</a>
              <a href="#/notes" class="active">笔记</a>
            </div>
          </div>
          <div class="library-actions">
            <input class="search-input" id="notes-search-input" placeholder="搜索笔记 / 书名 / 日期" value="${escapeAttr(state.notesQuery)}" />
          </div>
        </div>

        <div class="note-compose">
          <div class="note-compose-row">
            <input id="new-note-title" class="search-input" placeholder="笔记标题" />
            <select id="new-note-book" class="search-input">
              <option value="">选择关联书籍（可不选）</option>
              ${library.books.map((book) => `<option value="${escapeAttr(book.id)}">${escapeHtml(book.title)}</option>`).join("")}
            </select>
          </div>
          <textarea id="new-note-content" class="search-input" style="min-height:160px; resize:vertical;" placeholder="写下你的摘抄、感受、判断、复盘......"></textarea>
          <div style="display:flex; gap:12px; flex-wrap:wrap;">
            <button class="primary-btn" id="create-note-btn">保存笔记</button>
            <div class="note-meta">会自动记录创建日期与时间。</div>
          </div>
        </div>

        <div class="notes-grid">
          ${notes.length ? notes.map(renderNoteCard).join("") : `<div class="empty-state">还没有笔记，先写第一条。</div>`}
        </div>
      </div>
    </div>
  `;

  app.querySelector("#notes-search-input").addEventListener("input", (event) => {
    state.notesQuery = event.target.value;
    renderNotesPage(app);
  });

  app.querySelector("#create-note-btn").addEventListener("click", () => {
    const title = app.querySelector("#new-note-title").value.trim();
    const content = app.querySelector("#new-note-content").value.trim();
    const bookId = app.querySelector("#new-note-book").value;
    const book = library.books.find((item) => item.id === bookId);
    if (!title && !content) return;

    const createdAt = Date.now();
    const notes = getAllNotes();
    notes.unshift({
      id: crypto.randomUUID(),
      title: title || "未命名笔记",
      content,
      bookId,
      bookTitle: book?.title || "未绑定书籍",
      createdAt,
      createdAtLabel: new Date(createdAt).toLocaleString("zh-CN"),
    });
    saveAllNotes(notes);
    renderNotesPage(app);
  });
}

function renderNoteCard(note) {
  return `
    <article class="note-card">
      <h3 class="note-card-title">${escapeHtml(note.title || "未命名笔记")}</h3>
      <div class="note-card-book">${escapeHtml(note.bookTitle || "未绑定书籍")}</div>
      <div class="note-card-content">${escapeHtml(note.content || "")}</div>
      <div class="note-card-date">${escapeHtml(note.createdAtLabel || "")}</div>
    </article>
  `;
}

async function renderReaderPage(app, id) {
  const library = await loadLibrary();
  const book = library.books.find((item) => item.id === id);
  if (!book) {
    location.hash = "#/";
    return;
  }

  const prefs = getPrefs();
  applyPrefs(prefs);

  app.innerHTML = `
    <div class="reader-page">
      <div class="reader-toolbar">
        <div class="reader-toolbar-left">
          <button id="back-btn">返回目录</button>
          <div class="reader-title">${escapeHtml(book.title)}</div>
        </div>
        <div class="reader-toolbar-right">
          <div class="reader-progress" id="reader-progress">准备中...</div>
          <button id="sidebar-toggle">面板</button>
        </div>
      </div>
      <div class="reader-layout">
        <div class="reader-main">
          <div class="reader-stage" id="reader-stage"></div>
        </div>
        <aside class="reader-sidebar ${state.sidebarOpen ? "open" : ""}" id="reader-sidebar">
          <section class="reader-panel">
            <h3>阅读设置</h3>
            <div class="font-row">
              <button class="font-chip" data-font="18">A-</button>
              <button class="font-chip" data-font="22">A</button>
              <button class="font-chip" data-font="26">A+</button>
              <button class="font-chip" data-font="30">A++</button>
            </div>
            <div style="margin-top:14px;">
              <div class="note-meta" style="margin-bottom:8px;">阅读宽度</div>
              <input id="width-range" class="range-input" type="range" min="620" max="1080" step="20" value="${getPrefs().pageWidth || 860}" />
            </div>
            <p class="reader-tip">字体仿宋加粗。笔记已从阅读器拆分为独立页面，阅读和记录分开。</p>
            <div class="mobile-reading-actions">
              <a class="ghost-btn" href="#/notes">打开笔记页</a>
              <a class="ghost-btn" href="#/">回书库</a>
            </div>
          </section>
          <section class="reader-panel">
            <h3>当前书信息</h3>
            <div class="note-meta">类型：${book.ext.toUpperCase()}</div>
            <div class="note-meta">文件：${escapeHtml(book.relativePath)}</div>
            <div class="note-meta">大小：${formatSize(book.size)}</div>
            <div class="note-meta" style="margin-top:14px;">想记录时，请去独立笔记页，按书籍名称绑定保存。</div>
          </section>
        </aside>
      </div>
    </div>
  `;

  app.querySelector("#back-btn").addEventListener("click", () => {
    location.hash = "#/";
  });

  app.querySelector("#sidebar-toggle").addEventListener("click", () => {
    state.sidebarOpen = !state.sidebarOpen;
    app.querySelector("#reader-sidebar").classList.toggle("open", state.sidebarOpen);
  });

  app.querySelectorAll("[data-font]").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.font) === prefs.fontSize);
    button.addEventListener("click", () => {
      prefs.fontSize = Number(button.dataset.font);
      savePrefs(prefs);
      applyPrefs(prefs);
      renderApp();
    });
  });

  app.querySelector("#width-range").addEventListener("input", (event) => {
    prefs.pageWidth = Number(event.target.value);
    savePrefs(prefs);
    applyPrefs(prefs);
  });

  const stage = app.querySelector("#reader-stage");
  const progressEl = app.querySelector("#reader-progress");

  if (book.ext === "epub") {
    progressEl.textContent = "EPUB HTML 模式加载中...";
    try {
      state.currentCleanup = await mountEpubHtmlFallback(stage, book, progressEl);
    } catch (fallbackError) {
      console.error("EPUB fallback failed:", fallbackError);
      progressEl.textContent = "EPUB 打开失败";
      stage.innerHTML = `
        <div class="text-reader">
          <div class="text-reader-content">
EPUB HTML 后备模式也失败了。

错误信息：
${escapeHtml(String(fallbackError?.message || fallbackError || "unknown error"))}
          </div>
        </div>
      `;
      state.currentCleanup = null;
    }
  } else {
    state.currentCleanup = await mountTextReader(stage, book, progressEl);
  }
}

function renderBookCard(book) {
  return `
    <article class="book-card">
      <div>
        <div class="book-type">${book.ext.toUpperCase()}</div>
        <div class="book-name">${escapeHtml(book.title)}</div>
        <div class="book-meta">${escapeHtml(book.relativePath)}</div>
      </div>
      <div>
        <div class="book-meta">${formatSize(book.size)} · ${new Date(book.updatedAt).toLocaleDateString("zh-CN")}</div>
        <div class="book-actions">
          <a class="primary-btn" href="#/reader/${book.id}">开始阅读</a>
        </div>
      </div>
    </article>
  `;
}

async function mountTextReader(stage, book, progressEl) {
  const response = await fetch(book.textEndpoint || book.publicPath);
  const text = await response.text();
  stage.innerHTML = `
    <div class="text-reader" id="text-reader-scroll">
      <div class="text-reader-content">${escapeHtml(normalizeText(text))}</div>
    </div>
  `;

  const scroller = stage.querySelector("#text-reader-scroll");
  const saveKey = `progress_${book.id}`;
  const savedRatio = Number(localStorage.getItem(saveKey) || 0);
  requestAnimationFrame(() => {
    scroller.scrollTop = Math.max(0, (scroller.scrollHeight - scroller.clientHeight) * savedRatio);
    updateTextProgress(scroller, progressEl);
  });

  const onScroll = () => {
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const ratio = scroller.scrollTop / max;
    localStorage.setItem(saveKey, String(ratio));
    updateTextProgress(scroller, progressEl);
  };

  scroller.addEventListener("scroll", onScroll);
  return () => scroller.removeEventListener("scroll", onScroll);
}

async function mountEpubReader(stage, book, prefs, progressEl) {
  stage.innerHTML = `<div id="epub-reader"></div>`;
  const container = stage.querySelector("#epub-reader");

  if (typeof window.ePub !== "function") {
    throw new Error("window.ePub is not available");
  }

  const epubBook = window.ePub(`/api/books/${book.id}/file`);
  const rendition = epubBook.renderTo(container, {
    width: "100%",
    height: "100%",
    spread: "none",
    flow: "paginated",
    allowScriptedContent: true,
  });

  rendition.themes.default({
    body: {
      background: "#080808",
      color: "#f4f0e7",
      "font-family": 'FangSong, STFangsong, serif',
      "font-weight": '700',
      "line-height": '1.95',
      margin: '0',
      padding: '0 2vw',
    },
    p: { "font-size": `${prefs.fontSize}px` }
  });
  rendition.themes.fontSize(`${prefs.fontSize}px`);

  const saveKey = `epub_cfi_${book.id}`;
  const savedCfi = localStorage.getItem(saveKey);

  const relocated = (location) => {
    if (location?.start?.cfi) {
      localStorage.setItem(saveKey, location.start.cfi);
    }
    const percent = Math.round((location?.start?.percentage || 0) * 100);
    progressEl.textContent = `进度 ${percent}%`;
  };

  const failed = (error) => {
    console.error("EPUB internal error:", error);
  };

  rendition.on("relocated", relocated);
  rendition.on("displayError", failed);
  rendition.on("renderError", failed);

  await rendition.display(savedCfi || undefined);
  progressEl.textContent = progressEl.textContent === "准备中..." ? "已打开" : progressEl.textContent;

  return () => rendition.destroy();
}

async function mountEpubHtmlFallback(stage, book, progressEl) {
  const response = await fetch(`/api/books/${book.id}/epub-html`);
  if (!response.ok) {
    throw new Error(`fallback api failed: ${response.status}`);
  }

  const payload = await response.json();
  const chapters = payload.chapters || [];
  const tocHtml = chapters
    .map((chapter, index) => `<button class="font-chip" data-chapter-index="${index}">${escapeHtml(chapter.title || `章节 ${index + 1}`)}</button>`)
    .join("");
  const bodyHtml = chapters.length
    ? chapters.map((chapter, index) => `<section id="chapter-${index}" style="margin-bottom:40px;"><h2>${escapeHtml(chapter.title || `章节 ${index + 1}`)}</h2><div>${chapter.html || `<p>${escapeHtml(chapter.text || '')}</p>`}</div></section>`).join("")
    : `<div class="text-reader-content">${escapeHtml(payload.fullText || "没有解析出正文内容")}</div>`;

  stage.innerHTML = `
    <div class="text-reader" id="epub-fallback-scroll">
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:24px;">
        ${tocHtml || '<span class="reader-tip">没有可用目录，已直接展示正文。</span>'}
      </div>
      <div class="text-reader-content">${bodyHtml}</div>
    </div>
  `;

  const scroller = stage.querySelector("#epub-fallback-scroll");
  const saveKey = `epub_fallback_progress_${book.id}`;
  const savedRatio = Number(localStorage.getItem(saveKey) || 0);

  requestAnimationFrame(() => {
    scroller.scrollTop = Math.max(0, (scroller.scrollHeight - scroller.clientHeight) * savedRatio);
    updateTextProgress(scroller, progressEl);
  });

  const onScroll = () => {
    const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
    const ratio = scroller.scrollTop / max;
    localStorage.setItem(saveKey, String(ratio));
    updateTextProgress(scroller, progressEl);
  };

  scroller.addEventListener("scroll", onScroll);
  scroller.querySelectorAll("[data-chapter-index]").forEach((button) => {
    button.addEventListener("click", () => {
      const section = scroller.querySelector(`#chapter-${button.dataset.chapterIndex}`);
      if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  progressEl.textContent = "EPUB HTML 模式";
  return () => scroller.removeEventListener("scroll", onScroll);
}

async function loadLibrary() {
  if (state.library) return state.library;
  const response = await fetch("/api/library");
  state.library = await response.json();
  return state.library;
}

function getRoute() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const match = raw.match(/^\/reader\/([^/]+)$/);
  if (match) return { name: "reader", id: match[1] };
  if (raw === "/notes") return { name: "notes" };
  return { name: "library" };
}

function filterBooks(books, query) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return books;
  return books.filter((book) => {
    return [book.title, book.relativePath, book.ext].join(" ").toLowerCase().includes(keyword);
  });
}

function getAllNotes() {
  return JSON.parse(localStorage.getItem(NOTES_KEY) || "[]");
}

function saveAllNotes(notes) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
}

function getPrefs() {
  return JSON.parse(localStorage.getItem(PREFS_KEY) || '{"fontSize":22,"pageWidth":860}');
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function applyPrefs(prefs) {
  document.documentElement.style.setProperty("--font-size", `${prefs.fontSize}px`);
  document.documentElement.style.setProperty("--page-width", `${prefs.pageWidth || 860}px`);
}

function cleanupCurrentView() {
  if (typeof state.currentCleanup === "function") {
    state.currentCleanup();
    state.currentCleanup = null;
  }
}

function updateTextProgress(scroller, target) {
  const max = Math.max(1, scroller.scrollHeight - scroller.clientHeight);
  const percent = Math.round((scroller.scrollTop / max) * 100);
  target.textContent = `进度 ${percent}%`;
}

function normalizeText(text) {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function formatSize(size) {
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

function escapeHtml(value = "") {
  return value.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function escapeAttr(value = "") {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

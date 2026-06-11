"use strict";

/* =========================================================
   PDIC スペルテスト PWA
   - データはすべて IndexedDB（端末内）に保存
   - 外部へのネットワーク送信は一切なし
   ========================================================= */

/* ---------- IndexedDB ---------- */

const DB_NAME = "pdic-spell-test";
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("groups")) {
        d.createObjectStore("groups", { keyPath: "id", autoIncrement: true });
      }
      if (!d.objectStoreNames.contains("dicts")) {
        const s = d.createObjectStore("dicts", { keyPath: "id", autoIncrement: true });
        s.createIndex("groupId", "groupId");
      }
      if (!d.objectStoreNames.contains("words")) {
        const s = d.createObjectStore("words", { keyPath: "id", autoIncrement: true });
        s.createIndex("dictId", "dictId");
      }
      if (!d.objectStoreNames.contains("meta")) {
        d.createObjectStore("meta", { keyPath: "key" });
      }
      if (!d.objectStoreNames.contains("history")) {
        d.createObjectStore("history", { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
  });
}

function store(name, mode = "readonly") {
  return db.transaction(name, mode).objectStore(name);
}

async function metaGet(key, fallback = null) {
  const r = await idb(store("meta").get(key));
  return r ? r.value : fallback;
}

async function metaSet(key, value) {
  await idb(store("meta", "readwrite").put({ key, value }));
}

/* ---------- DOM ヘルパー ---------- */

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.appendChild(c);
  return node;
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const SCREENS = ["home", "import", "list", "setup", "test", "result"];

function showScreen(name) {
  for (const s of SCREENS) {
    $("screen-" + s).classList.toggle("hidden", s !== name);
  }
  window.scrollTo(0, 0);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fillLevelSelect(sel, value) {
  clear(sel);
  for (let i = 0; i <= 15; i++) {
    sel.appendChild(el("option", { value: String(i), text: String(i) }));
  }
  sel.value = String(value);
}

/* ---------- アプリ状態 ---------- */

let currentGroupId = null;
let groupsCache = [];
let dictsCache = []; // 現在のグループの辞書

/* =========================================================
   ホーム画面：グループと辞書ファイル
   ========================================================= */

async function loadGroups() {
  groupsCache = await idb(store("groups").getAll());
  if (groupsCache.length === 0) {
    const id = await idb(store("groups", "readwrite").add({ name: "マイ辞書", createdAt: Date.now() }));
    groupsCache = await idb(store("groups").getAll());
    currentGroupId = id;
    await metaSet("lastGroupId", id);
  }
  const last = await metaGet("lastGroupId");
  if (last != null && groupsCache.some((g) => g.id === last)) {
    currentGroupId = last;
  } else {
    currentGroupId = groupsCache[0].id;
    await metaSet("lastGroupId", currentGroupId);
  }
}

function renderGroupSelect() {
  const sel = $("groupSelect");
  clear(sel);
  for (const g of groupsCache) {
    sel.appendChild(el("option", { value: String(g.id), text: g.name }));
  }
  sel.value = String(currentGroupId);
}

async function loadDicts() {
  dictsCache = await idb(store("dicts").index("groupId").getAll(currentGroupId));
  dictsCache.sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

async function getSelectedDictIds() {
  const map = await metaGet("selectedDicts", {});
  const saved = map[String(currentGroupId)];
  const existing = new Set(dictsCache.map((d) => d.id));
  if (Array.isArray(saved)) {
    return saved.filter((id) => existing.has(id));
  }
  return dictsCache.map((d) => d.id); // 初回のデフォルトは全選択
}

async function saveSelectedDictIds(ids) {
  const map = await metaGet("selectedDicts", {});
  map[String(currentGroupId)] = ids;
  await metaSet("selectedDicts", map);
}

async function renderDictList() {
  const box = $("dictList");
  clear(box);
  const selected = new Set(await getSelectedDictIds());
  let total = 0;
  if (dictsCache.length === 0) {
    box.appendChild(el("p", { class: "empty-note", text: "辞書ファイルがまだありません。下のボタンからインポートしてください。" }));
  }
  for (const d of dictsCache) {
    total += d.wordCount || 0;
    const cb = el("input", { type: "checkbox" });
    cb.checked = selected.has(d.id);
    cb.addEventListener("change", async () => {
      const ids = [];
      box.querySelectorAll("input[type=checkbox]").forEach((c, i) => {
        if (c.checked) ids.push(dictsCache[i].id);
      });
      await saveSelectedDictIds(ids);
    });
    const row = el("div", { class: "dict-row" }, [
      el("label", {}, [
        cb,
        el("span", { class: "dict-name", text: d.name }),
        el("span", { class: "dict-count", text: `${d.wordCount || 0}語` }),
      ]),
      el("button", {
        class: "dict-del",
        text: "削除",
        onclick: async () => {
          if (!confirm(`辞書「${d.name}」を削除しますか？\n（この辞書の単語データも消えます）`)) return;
          await deleteDict(d.id);
          await refreshHome();
        },
      }),
    ]);
    box.appendChild(row);
  }
  $("dictTotalCount").textContent = dictsCache.length > 0 ? `合計 ${total} 語` : "";
}

async function deleteDict(dictId) {
  const tx = db.transaction(["dicts", "words"], "readwrite");
  tx.objectStore("dicts").delete(dictId);
  const idx = tx.objectStore("words").index("dictId");
  const keys = await idb(idx.getAllKeys(dictId));
  for (const k of keys) tx.objectStore("words").delete(k);
  await txDone(tx);
}

async function renderHistory() {
  const box = $("historyList");
  clear(box);
  const all = await idb(store("history").getAll());
  all.sort((a, b) => b.date - a.date);
  const recent = all.slice(0, 20);
  if (recent.length === 0) {
    box.appendChild(el("p", { class: "empty-note", text: "まだテスト履歴がありません。" }));
    return;
  }
  for (const h of recent) {
    const d = new Date(h.date);
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
    const rate = h.total > 0 ? Math.round((h.correctCount / h.total) * 100) : 0;
    box.appendChild(
      el("div", { class: "history-row" }, [
        el("div", { class: "history-date", text: `${dateStr}　${h.groupName || ""}` }),
        el("div", { text: `出題 ${h.total}　正解 ${h.correctCount}　不正解 ${h.wrongCount}　正答率 ${rate}%` }),
      ])
    );
  }
}

async function refreshHome() {
  await loadGroups();
  renderGroupSelect();
  await loadDicts();
  await renderDictList();
  await renderHistory();
}

/* --- グループ操作 --- */

function setupGroupHandlers() {
  $("groupSelect").addEventListener("change", async (e) => {
    currentGroupId = Number(e.target.value);
    await metaSet("lastGroupId", currentGroupId);
    await loadDicts();
    await renderDictList();
  });

  $("btnNewGroup").addEventListener("click", async () => {
    const name = prompt("新しいグループ名を入力してください（例：英語、トルコ語）");
    if (!name || !name.trim()) return;
    const id = await idb(store("groups", "readwrite").add({ name: name.trim(), createdAt: Date.now() }));
    currentGroupId = id;
    await metaSet("lastGroupId", id);
    await refreshHome();
  });

  $("btnRenameGroup").addEventListener("click", async () => {
    const g = groupsCache.find((x) => x.id === currentGroupId);
    if (!g) return;
    const name = prompt("新しいグループ名を入力してください", g.name);
    if (!name || !name.trim()) return;
    g.name = name.trim();
    await idb(store("groups", "readwrite").put(g));
    await refreshHome();
  });

  $("btnDeleteGroup").addEventListener("click", async () => {
    const g = groupsCache.find((x) => x.id === currentGroupId);
    if (!g) return;
    if (!confirm(`グループ「${g.name}」を削除しますか？\n（このグループの辞書と単語データもすべて消えます）`)) return;
    for (const d of dictsCache) await deleteDict(d.id);
    await idb(store("groups", "readwrite").delete(g.id));
    currentGroupId = null;
    await metaSet("lastGroupId", null);
    await refreshHome();
  });
}

/* =========================================================
   インポート：UTF-16 PDIC CSV
   ========================================================= */

const PDIC_COLUMNS = ["word", "trans", "exp", "level", "memory", "modify", "pron", "filelink"];
let importState = null; // { entries, fileName, skipped, warnings }

function decodeUtf16(buffer) {
  const bytes = new Uint8Array(buffer);
  let encoding = null;
  let offset = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = "utf-16le";
    offset = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = "utf-16be";
    offset = 2;
  } else {
    // BOMなし：先頭部分の0x00バイトの位置からLE/BEを推定
    let evenZero = 0, oddZero = 0;
    const n = Math.min(bytes.length, 2000);
    for (let i = 0; i < n; i++) {
      if (bytes[i] === 0) {
        if (i % 2 === 0) evenZero++;
        else oddZero++;
      }
    }
    encoding = evenZero > oddZero ? "utf-16be" : "utf-16le";
  }
  const decoder = new TextDecoder(encoding);
  return decoder.decode(bytes.subarray(offset));
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += c;
        i++;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
    } else if (c === ",") {
      row.push(field);
      field = "";
      i++;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
    } else {
      field += c;
      i++;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // 完全な空行は除く
  const cleaned = rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
  return { rows: cleaned, unterminatedQuote: inQuotes };
}

function rowsToEntries(rows) {
  const warnings = [];
  let skippedEmptyWord = 0;
  let colIndex = {};
  let dataRows = rows;

  // 1行目がヘッダーかどうかを判定
  const first = rows[0] || [];
  const firstNorm = first.map((c) => c.trim().toLowerCase());
  if (firstNorm[0] === "word") {
    PDIC_COLUMNS.forEach((name) => {
      const idx = firstNorm.indexOf(name);
      if (idx >= 0) colIndex[name] = idx;
    });
    dataRows = rows.slice(1);
  } else {
    PDIC_COLUMNS.forEach((name, idx) => (colIndex[name] = idx));
    warnings.push("1行目にヘッダー行（word,trans,...）が見つからなかったため、標準のカラム順として読み込みます。");
  }

  const entries = [];
  let badLevel = 0;
  dataRows.forEach((r, lineNo) => {
    const get = (name) => {
      const idx = colIndex[name];
      return idx != null && idx < r.length ? r[idx] : "";
    };
    const word = get("word");
    if (word.trim() === "") {
      skippedEmptyWord++;
      return;
    }
    let level = parseInt(get("level"), 10);
    if (Number.isNaN(level)) {
      if (get("level").trim() !== "") badLevel++;
      level = 0;
    }
    level = Math.max(0, Math.min(15, level));
    const memory = get("memory").trim() === "1" ? 1 : 0;
    entries.push({
      word: word,
      trans: get("trans"),
      exp: get("exp"),
      level: level,
      memory: memory,
      modify: get("modify"),
      pron: get("pron"),
      filelink: get("filelink"),
    });
  });
  if (skippedEmptyWord > 0) warnings.push(`見出語（word）が空の行 ${skippedEmptyWord} 行はスキップしました。`);
  if (badLevel > 0) warnings.push(`level が数値でない行が ${badLevel} 行あったため、レベル0として読み込みます。`);
  return { entries, warnings, skippedEmptyWord };
}

function showImportError(msg) {
  const box = $("importError");
  box.textContent = msg;
  box.classList.remove("hidden");
  $("importPreview").classList.add("hidden");
  importState = null;
}

async function handleFileSelected(file) {
  $("importError").classList.add("hidden");
  $("importPreview").classList.add("hidden");
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".txt")) {
    showImportError("拡張子が .txt のファイルを選択してください。");
    return;
  }
  let text;
  try {
    const buf = await file.arrayBuffer();
    text = decodeUtf16(buf);
  } catch (e) {
    showImportError("ファイルの読み込みに失敗しました：" + e.message);
    return;
  }
  if (text.includes("�")) {
    showImportError(
      "ファイルを UTF-16 として正しく読み取れませんでした。\nPDICのCSV出力時に文字コードを「Unicode（UTF-16）」にして出力し直してください。"
    );
    return;
  }
  const { rows, unterminatedQuote } = parseCSV(text);
  if (unterminatedQuote) {
    showImportError("CSVの形式エラー：閉じられていないダブルクォート（\"）があります。ファイルの内容を確認してください。");
    return;
  }
  if (rows.length === 0) {
    showImportError("ファイルにデータがありません。");
    return;
  }
  const { entries, warnings } = rowsToEntries(rows);
  if (entries.length === 0) {
    showImportError("取り込める単語がありませんでした。見出語（word）列が空でないか確認してください。");
    return;
  }
  importState = { entries, warnings, fileName: file.name };
  renderImportPreview();
}

function renderImportPreview() {
  const { entries, warnings, fileName } = importState;

  const summary = $("importSummary");
  clear(summary);
  summary.appendChild(el("p", { class: "import-summary-line", text: `ファイル名：${fileName}` }));
  summary.appendChild(el("p", { class: "import-summary-line", text: `取り込み件数：${entries.length} 語` }));
  summary.appendChild(
    el("p", { class: "import-summary-line", text: `カラム：${PDIC_COLUMNS.join(", ")}` })
  );
  for (const w of warnings) {
    summary.appendChild(el("p", { class: "import-summary-line hint warn", text: "⚠ " + w }));
  }

  const table = $("previewTable");
  clear(table);
  const headTr = el("tr");
  for (const c of ["word", "trans", "level", "memory", "pron"]) {
    headTr.appendChild(el("th", { text: c }));
  }
  table.appendChild(headTr);
  for (const entry of entries.slice(0, 5)) {
    const tr = el("tr");
    tr.appendChild(el("td", { text: entry.word }));
    tr.appendChild(el("td", { text: entry.trans.slice(0, 60) }));
    tr.appendChild(el("td", { text: String(entry.level) }));
    tr.appendChild(el("td", { text: String(entry.memory) }));
    tr.appendChild(el("td", { text: entry.pron }));
    table.appendChild(tr);
  }

  const defaultName = fileName.replace(/\.txt$/i, "");
  $("dictNameInput").value = defaultName;
  updateImportModeBox();
  $("importPreview").classList.remove("hidden");
}

function updateImportModeBox() {
  const name = $("dictNameInput").value.trim();
  const exists = dictsCache.some((d) => d.name === name);
  $("importModeBox").classList.toggle("hidden", !exists);
}

async function doImport() {
  if (!importState) return;
  const name = $("dictNameInput").value.trim();
  if (!name) {
    alert("辞書ファイル名を入力してください。");
    return;
  }
  const btn = $("btnDoImport");
  btn.disabled = true;
  btn.textContent = "取り込み中…";
  try {
    const existing = dictsCache.find((d) => d.name === name);
    const mode = existing
      ? document.querySelector('input[name="importMode"]:checked').value
      : "new";

    const tx = db.transaction(["dicts", "words"], "readwrite");
    const dictStore = tx.objectStore("dicts");
    const wordStore = tx.objectStore("words");

    let dictId;
    let baseCount = 0;
    if (existing) {
      dictId = existing.id;
      if (mode === "overwrite") {
        const keys = await idb(wordStore.index("dictId").getAllKeys(dictId));
        for (const k of keys) wordStore.delete(k);
      } else {
        baseCount = existing.wordCount || 0;
      }
    } else {
      dictId = await idb(dictStore.add({ groupId: currentGroupId, name, wordCount: 0, importedAt: Date.now() }));
    }
    for (const entry of importState.entries) {
      wordStore.add({ dictId, ...entry });
    }
    const newCount = baseCount + importState.entries.length;
    const dictRec = existing
      ? { ...existing, wordCount: newCount, importedAt: Date.now() }
      : { id: dictId, groupId: currentGroupId, name, wordCount: newCount, importedAt: Date.now() };
    dictStore.put(dictRec);
    await txDone(tx);

    alert(`「${name}」に ${importState.entries.length} 語を取り込みました。`);
    importState = null;
    $("fileInput").value = "";
    await refreshHome();
    showScreen("home");
  } catch (e) {
    showImportError("取り込みに失敗しました：" + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "この内容で取り込む";
  }
}

function setupImportHandlers() {
  $("btnImport").addEventListener("click", () => {
    const g = groupsCache.find((x) => x.id === currentGroupId);
    $("importGroupName").textContent = g ? g.name : "";
    $("importError").classList.add("hidden");
    $("importPreview").classList.add("hidden");
    $("fileInput").value = "";
    importState = null;
    showScreen("import");
  });
  $("fileInput").addEventListener("change", (e) => handleFileSelected(e.target.files[0]));
  $("dictNameInput").addEventListener("input", updateImportModeBox);
  $("btnDoImport").addEventListener("click", doImport);
}

/* =========================================================
   単語一覧・検索
   ========================================================= */

let listWords = [];      // 現在のグループの全単語（辞書名付き）
let listFiltered = [];
let listShown = 0;
const LIST_PAGE = 200;

async function getWordsForDicts(dictIds) {
  const result = [];
  const dictNames = new Map(dictsCache.map((d) => [d.id, d.name]));
  for (const id of dictIds) {
    const words = await idb(store("words").index("dictId").getAll(id));
    for (const w of words) {
      w.dictName = dictNames.get(id) || "";
      result.push(w);
    }
  }
  return result;
}

async function openWordList() {
  showScreen("list");
  $("listCount").textContent = "読み込み中…";
  clear($("wordList"));
  listWords = await getWordsForDicts(dictsCache.map((d) => d.id));
  listWords.sort((a, b) => a.word.localeCompare(b.word));
  applyListFilter();
}

function applyListFilter() {
  const q = $("searchInput").value.trim().toLowerCase();
  const inWord = $("searchWord").checked;
  const inTrans = $("searchTrans").checked;
  const inExp = $("searchExp").checked;
  const min = Number($("listLevelMin").value);
  const max = Number($("listLevelMax").value);
  const memF = $("listMemoryFilter").value;

  listFiltered = listWords.filter((w) => {
    if (w.level < min || w.level > max) return false;
    if (memF !== "all" && String(w.memory) !== memF) return false;
    if (q !== "") {
      let hit = false;
      if (inWord && w.word.toLowerCase().includes(q)) hit = true;
      if (!hit && inTrans && w.trans.toLowerCase().includes(q)) hit = true;
      if (!hit && inExp && w.exp.toLowerCase().includes(q)) hit = true;
      if (!hit) return false;
    }
    return true;
  });
  listShown = 0;
  clear($("wordList"));
  $("listCount").textContent = `${listFiltered.length} 語が見つかりました（全 ${listWords.length} 語中）`;
  renderMoreList();
}

function renderMoreList() {
  const box = $("wordList");
  const next = listFiltered.slice(listShown, listShown + LIST_PAGE);
  for (const w of next) {
    const badges = [el("span", { class: "badge", text: "Lv." + w.level })];
    if (w.memory === 1) badges.push(el("span", { class: "badge mem", text: "暗記必須" }));
    const row = el(
      "div",
      { class: "word-row", onclick: () => showWordModal(w) },
      [
        el("div", { class: "w-head" }, [
          el("span", { class: "w-word", text: w.word }),
          el("span", { class: "w-badges" }, badges),
        ]),
        el("div", { class: "w-trans", text: w.trans }),
      ]
    );
    box.appendChild(row);
  }
  listShown += next.length;
  $("btnMoreList").classList.toggle("hidden", listShown >= listFiltered.length);
}

function showWordModal(w) {
  const body = $("modalBody");
  clear(body);
  body.appendChild(el("h3", { text: w.word }));
  if (w.pron) body.appendChild(el("div", { class: "m-pron", text: w.pron }));
  body.appendChild(el("div", { class: "m-label", text: "訳語（trans）" }));
  body.appendChild(el("div", { class: "m-text", text: w.trans || "（なし）" }));
  body.appendChild(el("div", { class: "m-label", text: "補足（exp）" }));
  body.appendChild(el("div", { class: "m-text", text: w.exp || "（なし）" }));
  body.appendChild(el("div", { class: "m-label", text: "情報" }));
  body.appendChild(
    el("div", {
      class: "m-text",
      text: `レベル：${w.level}　暗記必須：${w.memory === 1 ? "はい" : "いいえ"}\n辞書：${w.dictName || ""}`,
    })
  );
  $("modalOverlay").classList.remove("hidden");
}

function setupListHandlers() {
  $("btnGoList").addEventListener("click", openWordList);
  $("searchInput").addEventListener("input", applyListFilter);
  for (const id of ["searchWord", "searchTrans", "searchExp", "listLevelMin", "listLevelMax", "listMemoryFilter"]) {
    $(id).addEventListener("change", applyListFilter);
  }
  $("btnMoreList").addEventListener("click", renderMoreList);
  $("btnCloseModal").addEventListener("click", () => $("modalOverlay").classList.add("hidden"));
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) $("modalOverlay").classList.add("hidden");
  });
}

/* =========================================================
   テスト設定
   ========================================================= */

let setupWords = []; // 選択辞書の全単語

async function openSetup() {
  const selectedIds = await getSelectedDictIds();
  if (selectedIds.length === 0) {
    alert("テストに使う辞書を1つ以上選択してください。");
    return;
  }
  const names = $("setupDictNames");
  clear(names);
  for (const id of selectedIds) {
    const d = dictsCache.find((x) => x.id === id);
    if (d) names.appendChild(el("li", { text: `${d.name}（${d.wordCount || 0}語）` }));
  }
  setupWords = await getWordsForDicts(selectedIds);
  if (setupWords.length === 0) {
    alert("選択した辞書に単語がありません。");
    return;
  }
  const saved = await metaGet("lastTestSettings", { levelMin: 0, levelMax: 15, memoryOnly: false });
  fillLevelSelect($("setupLevelMin"), saved.levelMin);
  fillLevelSelect($("setupLevelMax"), saved.levelMax);
  $("setupMemoryOnly").checked = !!saved.memoryOnly;
  updateSetupCount();
  showScreen("setup");
}

function getSetupFiltered() {
  const min = Number($("setupLevelMin").value);
  const max = Number($("setupLevelMax").value);
  const memOnly = $("setupMemoryOnly").checked;
  return setupWords.filter((w) => w.level >= min && w.level <= max && (!memOnly || w.memory === 1));
}

function updateSetupCount() {
  const n = getSetupFiltered().length;
  $("setupCount").textContent = String(n);
  $("btnStartTest").disabled = n === 0;
}

function setupSetupHandlers() {
  $("btnGoSetup").addEventListener("click", openSetup);
  for (const id of ["setupLevelMin", "setupLevelMax", "setupMemoryOnly"]) {
    $(id).addEventListener("change", updateSetupCount);
  }
  $("btnStartTest").addEventListener("click", async () => {
    const min = Number($("setupLevelMin").value);
    const max = Number($("setupLevelMax").value);
    if (min > max) {
      alert("レベルの範囲が正しくありません（最小値が最大値より大きくなっています）。");
      return;
    }
    await metaSet("lastTestSettings", {
      levelMin: min,
      levelMax: max,
      memoryOnly: $("setupMemoryOnly").checked,
    });
    const words = getSetupFiltered();
    if (words.length === 0) return;
    startMainTest(words);
  });
}

/* =========================================================
   テスト本体（本テスト＋補習テスト）
   ========================================================= */

let test = null;
/*
test = {
  phase: "main" | "remedial",
  queue: [...],          // 本テスト：シャッフル済みの出題リスト
  idx: 0,
  current: word,
  answered: false,       // 現在の問題が確定（正解 or 答えを見た）したか
  missedThis: false,     // 現在の問題で1回でも間違えた／答えを見たか
  wrongWords: [...],     // 本テストで不正解だった単語
  // 補習用
  remedialAll: [...],    // 補習対象の全単語（リセット時に戻す元）
  remedialPool: [...],   // いま残っている補習対象
}
*/

function startMainTest(words) {
  test = {
    phase: "main",
    queue: shuffle(words),
    idx: 0,
    current: null,
    answered: false,
    missedThis: false,
    wrongWords: [],
    remedialAll: [],
    remedialPool: [],
  };
  showScreen("test");
  nextMainQuestion();
}

function nextMainQuestion() {
  if (test.idx >= test.queue.length) {
    finishMainTest();
    return;
  }
  test.current = test.queue[test.idx];
  test.answered = false;
  test.missedThis = false;
  renderQuestion();
}

function startRemedial() {
  if (!test || test.wrongWords.length === 0) return;
  test.phase = "remedial";
  test.remedialAll = test.wrongWords.slice();
  test.remedialPool = test.wrongWords.slice();
  test.current = null;
  showScreen("test");
  nextRemedialQuestion(null);
}

function nextRemedialQuestion(excludeWord) {
  if (test.remedialPool.length === 0) {
    finishRemedial();
    return;
  }
  let pool = test.remedialPool;
  if (excludeWord && pool.length > 1) {
    pool = pool.filter((w) => w !== excludeWord);
  }
  test.current = pool[Math.floor(Math.random() * pool.length)];
  test.answered = false;
  test.missedThis = false;
  renderQuestion();
}

function renderQuestion() {
  const w = test.current;
  if (test.phase === "main") {
    $("testModeLabel").textContent = "テスト";
    $("testProgress").textContent = `${test.idx + 1} / ${test.queue.length}`;
  } else {
    $("testModeLabel").textContent = "補習テスト";
    $("testProgress").textContent = `残り ${test.remedialPool.length} 語`;
  }
  $("questionTrans").textContent = w.trans;
  const fb = $("feedback");
  fb.textContent = "";
  fb.className = "feedback";
  $("answerPanel").classList.add("hidden");
  $("btnNext").classList.add("hidden");
  $("btnReveal").classList.remove("hidden");
  $("btnJudge").disabled = false;
  const input = $("answerInput");
  input.value = "";
  input.disabled = false;
  input.focus();
}

function showAnswerPanel() {
  const w = test.current;
  $("answerWord").textContent = w.word;
  $("answerPron").textContent = w.pron || "";
  $("answerExp").textContent = w.exp || "";
  $("answerPanel").classList.remove("hidden");
}

function judge() {
  if (!test || test.answered) return;
  const w = test.current;
  const input = $("answerInput").value.trim();
  if (input === "") return;
  const fb = $("feedback");
  // 完全一致のみ正解（大文字小文字・トルコ語の i/ı/İ/I なども区別する）
  if (input === w.word) {
    fb.textContent = "✅ 正解！";
    fb.className = "feedback ok";
    settleQuestion(!test.missedThis);
  } else {
    fb.textContent = "❌ 不正解… もう一度入力できます";
    fb.className = "feedback ng";
    if (!test.missedThis) {
      test.missedThis = true;
      recordMiss();
    }
    const inp = $("answerInput");
    inp.select();
    inp.focus();
  }
}

function reveal() {
  if (!test || test.answered) return;
  const fb = $("feedback");
  fb.textContent = "答えを見たので不正解扱いになります";
  fb.className = "feedback ng";
  if (!test.missedThis) {
    test.missedThis = true;
    recordMiss();
  }
  settleQuestion(false);
}

function recordMiss() {
  const w = test.current;
  if (test.phase === "main") {
    if (!test.wrongWords.includes(w)) test.wrongWords.push(w);
  } else {
    // 補習中に1問でも間違えたら、補習対象を全復活させる
    test.remedialPool = test.remedialAll.slice();
  }
}

function settleQuestion(correctClean) {
  // correctClean: 1回も間違えず・答えも見ずに正解したか
  test.answered = true;
  showAnswerPanel();
  if (test.phase === "remedial" && correctClean) {
    test.remedialPool = test.remedialPool.filter((w) => w !== test.current);
  }
  $("answerInput").disabled = true;
  $("btnJudge").disabled = true;
  $("btnReveal").classList.add("hidden");
  const btnNext = $("btnNext");
  btnNext.classList.remove("hidden");
  btnNext.textContent =
    test.phase === "remedial" && test.remedialPool.length === 0 ? "補習完了へ →" : "次へ →";
  btnNext.focus();
}

function goNext() {
  if (!test || !test.answered) return;
  if (test.phase === "main") {
    test.idx++;
    nextMainQuestion();
  } else {
    nextRemedialQuestion(test.missedThis ? test.current : null);
  }
}

async function finishMainTest() {
  if (test.finished) return; // 連打などによる二重実行を防ぐ
  test.finished = true;
  const total = test.queue.length;
  const wrong = test.wrongWords.length;
  const correct = total - wrong;
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0;

  const g = groupsCache.find((x) => x.id === currentGroupId);
  try {
    await idb(
      store("history", "readwrite").add({
        date: Date.now(),
        groupName: g ? g.name : "",
        total,
        correctCount: correct,
        wrongCount: wrong,
        wrongWords: test.wrongWords.map((w) => ({ word: w.word, trans: w.trans })),
      })
    );
  } catch (e) {
    console.error("履歴の保存に失敗:", e);
  }

  $("resultTitle").textContent = "テスト結果";
  renderResultStats(total, correct, wrong, rate);
  const wrongBox = $("resultWrongBox");
  const wrongList = $("resultWrongList");
  clear(wrongList);
  if (wrong > 0) {
    for (const w of test.wrongWords) {
      wrongList.appendChild(el("li", { text: `${w.word}　${w.trans.slice(0, 40)}` }));
    }
    wrongBox.classList.remove("hidden");
    $("btnStartRemedial").classList.remove("hidden");
  } else {
    wrongBox.classList.add("hidden");
    $("btnStartRemedial").classList.add("hidden");
  }
  await renderHistory();
  showScreen("result");
}

function renderResultStats(total, correct, wrong, rate) {
  const stats = $("resultStats");
  clear(stats);
  const mk = (num, label) =>
    el("div", {}, [
      el("div", { class: "stat-num", text: String(num) }),
      el("div", { class: "stat-label", text: label }),
    ]);
  stats.appendChild(mk(total, "出題数"));
  stats.appendChild(mk(correct, "正解"));
  stats.appendChild(mk(wrong, "不正解"));
  $("resultRate").textContent = `正答率 ${rate}%`;
}

function finishRemedial() {
  $("resultTitle").textContent = "🎉 補習完了！";
  const stats = $("resultStats");
  clear(stats);
  stats.appendChild(
    el("div", { text: `間違えた ${test.remedialAll.length} 語を全問連続で正解しました！` })
  );
  $("resultRate").textContent = "おつかれさまでした";
  $("resultWrongBox").classList.add("hidden");
  $("btnStartRemedial").classList.add("hidden");
  test = null;
  showScreen("result");
}

function setupTestHandlers() {
  $("btnJudge").addEventListener("click", judge);
  $("btnReveal").addEventListener("click", reveal);
  $("btnNext").addEventListener("click", goNext);
  $("answerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (test && test.answered) goNext();
      else judge();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && test && test.answered && !$("screen-test").classList.contains("hidden")) {
      e.preventDefault();
      goNext();
    }
  });
  $("btnQuitTest").addEventListener("click", () => {
    const msg =
      test && test.phase === "remedial"
        ? "補習テストを中断しますか？（補習は最後までやるのがおすすめです）"
        : "テストを中断しますか？";
    if (confirm(msg)) {
      test = null;
      showScreen("home");
    }
  });
  $("btnStartRemedial").addEventListener("click", startRemedial);
  $("btnResultHome").addEventListener("click", () => {
    test = null;
    showScreen("home");
  });
}

/* =========================================================
   初期化
   ========================================================= */

function setupBackButtons() {
  document.querySelectorAll(".btn-back[data-back]").forEach((b) => {
    b.addEventListener("click", () => showScreen(b.getAttribute("data-back")));
  });
}

async function init() {
  db = await openDB();
  fillLevelSelect($("listLevelMin"), 0);
  fillLevelSelect($("listLevelMax"), 15);
  setupGroupHandlers();
  setupImportHandlers();
  setupListHandlers();
  setupSetupHandlers();
  setupTestHandlers();
  setupBackButtons();
  await refreshHome();
  showScreen("home");

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((e) => {
      console.warn("Service Worker の登録に失敗:", e);
    });
  }
}

init().catch((e) => {
  alert("アプリの起動に失敗しました：" + e.message);
  console.error(e);
});

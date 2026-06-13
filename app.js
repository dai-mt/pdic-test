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

const SCREENS = ["home", "import", "export", "list", "setup", "test", "result"];

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
// importSources: [{ label, defaultName, entries, warnings }]
let importSources = [];

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

function parseCSV(text, delimiter = ",") {
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
    if (c === '"' && field === "") {
      // クォートはフィールドの先頭にある場合のみ「囲み」として扱う
      inQuotes = true;
      i++;
    } else if (c === delimiter) {
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
}

function clearImportError() {
  $("importError").classList.add("hidden");
  $("importError").textContent = "";
}

/* --- xlsx 読み込み（外部ライブラリなし：ブラウザ内蔵のzip解凍機能を使用） --- */

async function unzipFile(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // 末尾から End of Central Directory を探す
  let eocd = -1;
  const minPos = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip形式として読み取れません");
  const count = view.getUint16(eocd + 10, true);
  let off = view.getUint32(eocd + 16, true);
  const files = new Map();
  const utf8 = new TextDecoder("utf-8");
  for (let n = 0; n < count; n++) {
    if (view.getUint32(off, true) !== 0x02014b50) break;
    const method = view.getUint16(off + 10, true);
    const compSize = view.getUint32(off + 20, true);
    const nameLen = view.getUint16(off + 28, true);
    const extraLen = view.getUint16(off + 30, true);
    const commentLen = view.getUint16(off + 32, true);
    const localOff = view.getUint32(off + 42, true);
    const name = utf8.decode(bytes.subarray(off + 46, off + 46 + nameLen));
    files.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  async function read(name) {
    const f = files.get(name);
    if (!f) return null;
    const nameLen = view.getUint16(f.localOff + 26, true);
    const extraLen = view.getUint16(f.localOff + 28, true);
    const start = f.localOff + 30 + nameLen + extraLen;
    const data = bytes.subarray(start, start + f.compSize);
    if (f.method === 0) return data;
    if (f.method === 8) {
      const ds = new DecompressionStream("deflate-raw");
      const stream = new Blob([data]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    throw new Error("未対応の圧縮形式です");
  }
  return { names: [...files.keys()], read };
}

function colRefToIndex(ref) {
  // "BC12" → 列文字部分を 0始まりの列番号に変換
  const letters = ref.replace(/\d+$/, "");
  if (!letters) return -1;
  let idx = 0;
  for (const ch of letters) idx = idx * 26 + (ch.charCodeAt(0) - 64);
  return idx - 1;
}

function sheetDocToRows(sheetDoc, shared) {
  const rows = [];
  for (const rowEl of sheetDoc.getElementsByTagName("row")) {
    const row = [];
    for (const c of rowEl.getElementsByTagName("c")) {
      let colIdx = colRefToIndex(c.getAttribute("r") || "");
      if (colIdx < 0) colIdx = row.length;
      const t = c.getAttribute("t");
      let val = "";
      if (t === "s") {
        const v = c.getElementsByTagName("v")[0];
        val = v ? shared[parseInt(v.textContent, 10)] ?? "" : "";
      } else if (t === "inlineStr") {
        for (const tt of c.getElementsByTagName("t")) val += tt.textContent;
      } else {
        const v = c.getElementsByTagName("v")[0];
        val = v ? v.textContent : "";
      }
      while (row.length < colIdx) row.push("");
      row[colIdx] = val;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

async function parseXlsxWorkbook(buffer) {
  // 全シートを [{ name, rows }] で返す（ブック内の並び順）
  if (typeof DecompressionStream === "undefined") {
    throw new Error("お使いのブラウザは xlsx の読み込みに対応していません。PDICのCSV形式（.txt）でお試しください。");
  }
  const zip = await unzipFile(buffer);
  const utf8 = new TextDecoder("utf-8");
  const readXml = async (name) => {
    const data = await zip.read(name);
    if (!data) return null;
    return new DOMParser().parseFromString(utf8.decode(data), "application/xml");
  };
  // 共有文字列テーブル
  const shared = [];
  const ss = await readXml("xl/sharedStrings.xml");
  if (ss) {
    for (const si of ss.getElementsByTagName("si")) {
      let s = "";
      for (const t of si.getElementsByTagName("t")) s += t.textContent;
      shared.push(s);
    }
  }
  // workbook.xml のシート一覧と rels の対応からパスを解決
  const sheets = [];
  const wb = await readXml("xl/workbook.xml");
  const rels = await readXml("xl/_rels/workbook.xml.rels");
  if (wb && rels) {
    const relMap = new Map();
    for (const rel of rels.getElementsByTagName("Relationship")) {
      let t = rel.getAttribute("Target") || "";
      relMap.set(rel.getAttribute("Id"), t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""));
    }
    for (const sheetEl of wb.getElementsByTagName("sheet")) {
      const name = sheetEl.getAttribute("name") || "";
      const rid = sheetEl.getAttribute("r:id");
      const path = rid ? relMap.get(rid) : null;
      if (path && zip.names.includes(path)) sheets.push({ name, path });
    }
  }
  if (sheets.length === 0) {
    // 解決できなかったときは sheetN.xml を順に拾う
    const paths = zip.names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
    paths.forEach((p, i) => sheets.push({ name: `Sheet${i + 1}`, path: p }));
  }
  if (sheets.length === 0) throw new Error("xlsxの中にワークシートが見つかりません");
  const result = [];
  for (const s of sheets) {
    const doc = await readXml(s.path);
    result.push({ name: s.name || "Sheet", rows: doc ? sheetDocToRows(doc, shared) : [] });
  }
  return result;
}

/* --- インポート：ファイル選択（複数可）と貼り付け --- */

async function sourceFromFile(file) {
  // .txt（PDIC CSV）→ ソース1つ
  const text = decodeUtf16(await file.arrayBuffer());
  if (text.includes("�")) {
    throw new Error("UTF-16として正しく読み取れませんでした。PDICのCSV出力時に文字コードを「Unicode（UTF-16）」にしてください。");
  }
  const { rows, unterminatedQuote } = parseCSV(text);
  if (unterminatedQuote) throw new Error("閉じられていないダブルクォート（\"）があります。");
  if (rows.length === 0) throw new Error("データがありません。");
  const { entries, warnings } = rowsToEntries(rows);
  if (entries.length === 0) throw new Error("取り込める単語がありませんでした。見出語（word）列を確認してください。");
  return {
    label: file.name,
    defaultName: file.name.replace(/\.txt$/i, ""),
    entries,
    warnings,
    selected: true,
    showCheckbox: false,
  };
}

async function sourcesFromXlsx(file, errors) {
  // .xlsx → シートごとにソースを作る（複数シートなら画面で選択できる）
  const sheets = await parseXlsxWorkbook(await file.arrayBuffer());
  const multi = sheets.length > 1;
  const sources = [];
  for (const sh of sheets) {
    if (sh.rows.length === 0) {
      if (multi) errors.push(`${file.name}：シート「${sh.name}」は空のためスキップしました。`);
      else errors.push(`${file.name}：データがありません。`);
      continue;
    }
    const { entries, warnings } = rowsToEntries(sh.rows);
    if (entries.length === 0) {
      errors.push(`${file.name} シート「${sh.name}」：取り込める単語がありませんでした。見出語（word）列を確認してください。`);
      continue;
    }
    sources.push({
      label: multi ? `${file.name} — シート「${sh.name}」` : file.name,
      defaultName: multi ? sh.name : file.name.replace(/\.xlsx$/i, ""),
      entries,
      warnings,
      selected: true,
      showCheckbox: multi, // 複数シートのときはチェックで取り込み対象を選べる
    });
  }
  return sources;
}

async function handleFilesSelected(fileList) {
  clearImportError();
  const files = Array.from(fileList || []);
  if (files.length === 0) return;
  const errors = [];
  const sources = [];
  for (const f of files) {
    try {
      const lower = f.name.toLowerCase();
      if (lower.endsWith(".txt")) {
        sources.push(await sourceFromFile(f));
      } else if (lower.endsWith(".xlsx")) {
        sources.push(...(await sourcesFromXlsx(f, errors)));
      } else {
        throw new Error("拡張子が .txt または .xlsx のファイルを選択してください。");
      }
    } catch (e) {
      errors.push(`${f.name}：${e.message}`);
    }
  }
  if (errors.length > 0) {
    showImportError("読み込めなかったものがあります。\n" + errors.join("\n"));
  }
  if (sources.length > 0) {
    importSources = sources;
    renderImportPreview();
  } else {
    $("importPreview").classList.add("hidden");
    importSources = [];
  }
}

function handlePasteLoad() {
  clearImportError();
  const text = $("pasteInput").value;
  if (text.trim() === "") {
    showImportError("貼り付け欄が空です。エクセルでセル範囲をコピーして貼り付けてください。");
    return;
  }
  const { rows, unterminatedQuote } = parseCSV(text, "\t");
  if (unterminatedQuote || rows.length === 0) {
    showImportError("貼り付けた内容を読み取れませんでした。エクセルからコピーした内容か確認してください。");
    return;
  }
  const { entries, warnings } = rowsToEntries(rows);
  if (entries.length === 0) {
    showImportError("取り込める単語がありませんでした。1列目（word）が空でないか確認してください。");
    return;
  }
  const d = new Date();
  importSources = [
    {
      label: "貼り付けた内容",
      defaultName: `貼り付け ${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}${String(d.getMinutes()).padStart(2, "0")}`,
      entries,
      warnings,
      selected: true,
      showCheckbox: false,
    },
  ];
  renderImportPreview();
}

function renderImportPreview() {
  const box = $("importSources");
  clear(box);
  importSources.forEach((src, i) => {
    const card = el("div", { class: "card source-card" });
    if (src.showCheckbox) {
      const selCb = el("input", { type: "checkbox" });
      selCb.checked = src.selected;
      selCb.addEventListener("change", () => {
        src.selected = selCb.checked;
        card.classList.toggle("source-off", !src.selected);
      });
      card.appendChild(
        el("label", { class: "check-line source-check" }, [
          selCb,
          document.createTextNode(" このシートを取り込む"),
        ])
      );
    }
    card.appendChild(el("h3", { text: src.label }));
    card.appendChild(el("p", { class: "import-summary-line", text: `取り込み件数：${src.entries.length} 語` }));
    for (const w of src.warnings) {
      card.appendChild(el("p", { class: "import-summary-line hint warn", text: "⚠ " + w }));
    }
    // 先頭5件のプレビュー
    const scroll = el("div", { class: "preview-scroll" });
    const table = el("table");
    const headTr = el("tr");
    for (const c of ["word", "trans", "level", "memory", "pron"]) headTr.appendChild(el("th", { text: c }));
    table.appendChild(headTr);
    for (const entry of src.entries.slice(0, 5)) {
      const tr = el("tr");
      tr.appendChild(el("td", { text: entry.word }));
      tr.appendChild(el("td", { text: entry.trans.slice(0, 60) }));
      tr.appendChild(el("td", { text: String(entry.level) }));
      tr.appendChild(el("td", { text: String(entry.memory) }));
      tr.appendChild(el("td", { text: entry.pron }));
      table.appendChild(tr);
    }
    scroll.appendChild(table);
    card.appendChild(scroll);
    // 辞書名入力
    card.appendChild(el("label", { class: "field-label", text: "辞書ファイル名（アプリ内での表示名）" }));
    const nameInput = el("input", { type: "text", class: "input-big", "data-src": String(i) });
    nameInput.value = src.defaultName;
    card.appendChild(nameInput);
    // 既存辞書と同名の場合のモード選択
    const modeLine = el("div", { class: "mode-select-line hidden" }, [
      el("span", { class: "hint warn", text: "同じ名前の辞書があります：" }),
    ]);
    const modeSel = el("select", { "data-srcmode": String(i) });
    modeSel.appendChild(el("option", { value: "overwrite", text: "上書きする（入れ替え）" }));
    modeSel.appendChild(el("option", { value: "append", text: "追加する（追記）" }));
    modeLine.appendChild(modeSel);
    card.appendChild(modeLine);
    const updateMode = () => {
      const exists = dictsCache.some((d) => d.name === nameInput.value.trim());
      modeLine.classList.toggle("hidden", !exists);
    };
    nameInput.addEventListener("input", updateMode);
    updateMode();
    box.appendChild(card);
  });
  $("importPreview").classList.remove("hidden");
}

async function importOneSource(src, name, mode) {
  const existing = dictsCache.find((d) => d.name === name);
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
  for (const entry of src.entries) {
    wordStore.add({ dictId, ...entry });
  }
  const newCount = baseCount + src.entries.length;
  const dictRec = existing
    ? { ...existing, wordCount: newCount, importedAt: Date.now() }
    : { id: dictId, groupId: currentGroupId, name, wordCount: newCount, importedAt: Date.now() };
  dictStore.put(dictRec);
  await txDone(tx);
}

async function doImport() {
  if (importSources.length === 0) return;
  // 取り込み対象（チェックされたもの）の辞書名を回収・検証
  const targets = [];
  for (let i = 0; i < importSources.length; i++) {
    if (!importSources[i].selected) continue;
    const input = document.querySelector(`input[data-src="${i}"]`);
    const name = input ? input.value.trim() : "";
    if (!name) {
      alert("辞書ファイル名が空のものがあります。名前を入力してください。");
      return;
    }
    targets.push({ index: i, name });
  }
  if (targets.length === 0) {
    alert("取り込むシートが選択されていません。");
    return;
  }
  // 同時に取り込むソース同士で名前が重複していたら止める
  if (new Set(targets.map((t) => t.name)).size !== targets.length) {
    alert("同じ辞書ファイル名が複数あります。別の名前にしてください。");
    return;
  }
  const btn = $("btnDoImport");
  btn.disabled = true;
  btn.textContent = "取り込み中…";
  try {
    let total = 0;
    for (const t of targets) {
      const modeSel = document.querySelector(`select[data-srcmode="${t.index}"]`);
      const mode = modeSel ? modeSel.value : "overwrite";
      await importOneSource(importSources[t.index], t.name, mode);
      await loadDicts(); // 次のソースの重複判定のために更新
      total += importSources[t.index].entries.length;
    }
    alert(`${targets.length} 個の辞書に合計 ${total} 語を取り込みました。`);
    importSources = [];
    $("fileInput").value = "";
    $("pasteInput").value = "";
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
    clearImportError();
    $("importPreview").classList.add("hidden");
    $("fileInput").value = "";
    $("pasteInput").value = "";
    importSources = [];
    showScreen("import");
  });
  $("fileInput").addEventListener("change", (e) => handleFilesSelected(e.target.files));
  $("btnLoadPaste").addEventListener("click", handlePasteLoad);
  $("btnDoImport").addEventListener("click", doImport);
}

/* =========================================================
   エクスポート：PDIC CSV形式（UTF-16LE・BOM付き）
   ========================================================= */

function buildPdicCsv(words) {
  const q = (s) => '"' + String(s ?? "").replace(/"/g, '""') + '"';
  const lines = [PDIC_COLUMNS.join(",")];
  for (const w of words) {
    const modify = String(w.modify).trim() === "1" ? 1 : 0;
    lines.push(
      [q(w.word), q(w.trans), q(w.exp), w.level, w.memory, modify, q(w.pron), q(w.filelink)].join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

function encodeUtf16le(text) {
  const buf = new Uint8Array(2 + text.length * 2);
  buf[0] = 0xff;
  buf[1] = 0xfe; // BOM
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    buf[2 + i * 2] = c & 0xff;
    buf[3 + i * 2] = c >> 8;
  }
  return buf;
}

/* --- zip 作成（無圧縮・外部ライブラリなし） --- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files) {
  // files: [{ name, data: Uint8Array }]
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameB = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // ファイル名はUTF-8
    local.setUint16(8, 0, true); // 無圧縮
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, f.data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, f.data.length, true);
    cd.setUint32(24, f.data.length, true);
    cd.setUint16(28, nameB.length, true);
    cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), nameB);
    offset += 30 + nameB.length + f.data.length;
  }
  let cdSize = 0;
  for (const p of central) cdSize += p.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, files.length, true);
  eocd.setUint16(10, files.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: "application/zip" });
}

function sanitizeName(name) {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "無題";
}

/* --- xlsx 作成（インポートと同じカラム構成・そのまま再インポート可能） --- */

function xmlEscape(s) {
  return String(s ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "") // XMLで使えない制御文字を除去
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function xmlEscapeAttr(s) {
  return xmlEscape(s).replace(/"/g, "&quot;").replace(/\n/g, " ");
}

function sanitizeSheetName(name, used) {
  // Excelのシート名制限：31文字まで、[ ] : * ? / \ は使えない
  let n = String(name).replace(/[\[\]:*?/\\]/g, "_").trim();
  if (!n) n = "Sheet";
  n = n.slice(0, 31);
  let base = n;
  let i = 2;
  while (used.has(n)) {
    const suffix = `(${i++})`;
    n = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(n);
  return n;
}

function buildXlsxBlob(sheetDefs) {
  // sheetDefs: [{ name, words }]
  const used = new Set();
  const sheets = sheetDefs.map((s, i) => ({
    name: sanitizeSheetName(s.name, used),
    words: s.words,
    file: `sheet${i + 1}.xml`,
  }));
  const colLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const cellStr = (ref, v) =>
    `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  const cellNum = (ref, v) => `<c r="${ref}"><v>${Number(v) || 0}</v></c>`;

  const sheetXml = (words) => {
    const rows = [];
    rows.push(
      '<row r="1">' + PDIC_COLUMNS.map((c, ci) => cellStr(colLetters[ci] + "1", c)).join("") + "</row>"
    );
    words.forEach((w, wi) => {
      const r = wi + 2;
      const modify = String(w.modify).trim() === "1" ? 1 : 0;
      rows.push(
        `<row r="${r}">` +
          cellStr("A" + r, w.word) +
          cellStr("B" + r, w.trans) +
          cellStr("C" + r, w.exp) +
          cellNum("D" + r, w.level) +
          cellNum("E" + r, w.memory) +
          cellNum("F" + r, modify) +
          cellStr("G" + r, w.pron) +
          cellStr("H" + r, w.filelink) +
          "</row>"
      );
    });
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      "<sheetData>" +
      rows.join("") +
      "</sheetData></worksheet>"
    );
  };

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets
      .map(
        (s) =>
          `<Override PartName="/xl/worksheets/${s.file}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      )
      .join("") +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets
      .map((s, i) => `<sheet name="${xmlEscapeAttr(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("") +
    "</sheets></workbook>";

  const wbRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets
      .map(
        (s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/${s.file}"/>`
      )
      .join("") +
    "</Relationships>";

  const enc = new TextEncoder();
  const files = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(wbRels) },
    ...sheets.map((s) => ({ name: `xl/worksheets/${s.file}`, data: enc.encode(sheetXml(s.words)) })),
  ];
  return makeZip(files);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function exportDictTxtData(dictId) {
  // 常にDBから読み直すので、アプリ上での編集が反映された最新の内容になる
  const words = await idb(store("words").index("dictId").getAll(dictId));
  return encodeUtf16le(buildPdicCsv(words));
}

async function openExport() {
  if (dictsCache.length === 0) {
    alert("エクスポートできる辞書がありません。");
    return;
  }
  const g = groupsCache.find((x) => x.id === currentGroupId);
  $("btnExportGroup").textContent = `グループ「${g ? g.name : ""}」をまるごとエクスポート（zip）`;
  const box = $("exportDictList");
  clear(box);
  for (const d of dictsCache) {
    const cb = el("input", { type: "checkbox", "data-exportdict": String(d.id) });
    box.appendChild(
      el("div", { class: "export-row" }, [
        el("label", {}, [
          cb,
          el("span", { class: "dict-name", text: d.name }),
          el("span", { class: "dict-count", text: `${d.wordCount || 0}語` }),
        ]),
      ])
    );
  }
  showScreen("export");
}

async function exportGroup() {
  const g = groupsCache.find((x) => x.id === currentGroupId);
  const gname = sanitizeName(g ? g.name : "辞書グループ");
  const files = [];
  for (const d of dictsCache) {
    files.push({ name: `${gname}/${sanitizeName(d.name)}.txt`, data: await exportDictTxtData(d.id) });
  }
  downloadBlob(makeZip(files), `${gname}.zip`);
}

async function exportGroupXlsx() {
  // グループ全体を1つの.xlsxに：各辞書ファイル＝1シート（シート名＝辞書名）
  const g = groupsCache.find((x) => x.id === currentGroupId);
  const gname = sanitizeName(g ? g.name : "辞書グループ");
  const sheetDefs = [];
  for (const d of dictsCache) {
    const words = await idb(store("words").index("dictId").getAll(d.id));
    sheetDefs.push({ name: d.name, words });
  }
  downloadBlob(buildXlsxBlob(sheetDefs), `${gname}.xlsx`);
}

async function exportSelectedDicts() {
  const ids = [];
  document.querySelectorAll("input[data-exportdict]").forEach((c) => {
    if (c.checked) ids.push(Number(c.getAttribute("data-exportdict")));
  });
  if (ids.length === 0) {
    alert("エクスポートする辞書にチェックを入れてください。");
    return;
  }
  if (ids.length === 1) {
    const d = dictsCache.find((x) => x.id === ids[0]);
    const data = await exportDictTxtData(d.id);
    downloadBlob(new Blob([data], { type: "text/plain" }), `${sanitizeName(d.name)}.txt`);
  } else {
    const g = groupsCache.find((x) => x.id === currentGroupId);
    const files = [];
    for (const id of ids) {
      const d = dictsCache.find((x) => x.id === id);
      files.push({ name: `${sanitizeName(d.name)}.txt`, data: await exportDictTxtData(id) });
    }
    downloadBlob(makeZip(files), `${sanitizeName(g ? g.name : "辞書")}_選択辞書.zip`);
  }
}

function setupExportHandlers() {
  $("btnGoExport").addEventListener("click", openExport);
  $("btnExportGroup").addEventListener("click", exportGroup);
  $("btnExportGroupXlsx").addEventListener("click", exportGroupXlsx);
  $("btnExportSelected").addEventListener("click", exportSelectedDicts);
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

let listSelectMode = false;
const listSelected = new Set(); // 選択中の単語id

function makeWordRow(w) {
  const headChildren = [el("span", { class: "w-word", text: w.word })];
  if (w.pron) headChildren.push(el("span", { class: "w-pron", text: w.pron }));
  headChildren.push(
    el("span", { class: "w-badges" }, [el("span", { class: "badge", text: "Lv." + w.level })])
  );
  const bodyChildren = [
    el("div", { class: "w-head" }, headChildren),
    el("div", { class: "w-trans", text: w.trans }),
  ];
  if ($("listShowExp").checked && w.exp) {
    bodyChildren.push(el("div", { class: "w-exp", text: w.exp }));
  }
  // 右下の1文字バッジ（Lv.の下に縦に並ぶ位置）：「暗」=暗記必須、「修」=修正済
  const flags = [];
  if (w.memory === 1) flags.push(el("span", { class: "badge mem", text: "暗" }));
  if (String(w.modify).trim() === "1") flags.push(el("span", { class: "badge mod", text: "修" }));
  if (flags.length > 0) bodyChildren.push(el("div", { class: "w-flags" }, flags));
  const body = el("div", { class: "w-body" }, bodyChildren);
  const row = el("div", { class: "word-row" });
  if (listSelectMode) {
    const cb = el("input", { type: "checkbox", class: "w-check" });
    cb.checked = listSelected.has(w.id);
    row.appendChild(el("div", { class: "w-headline" }, [cb, body]));
    row.classList.toggle("selected", listSelected.has(w.id));
    row.addEventListener("click", () => {
      if (listSelected.has(w.id)) listSelected.delete(w.id);
      else listSelected.add(w.id);
      cb.checked = listSelected.has(w.id);
      row.classList.toggle("selected", listSelected.has(w.id));
      updateBulkCount();
    });
  } else {
    row.appendChild(body);
    row.addEventListener("click", () => showWordModal(w));
  }
  return row;
}

function renderMoreList() {
  const box = $("wordList");
  const next = listFiltered.slice(listShown, listShown + LIST_PAGE);
  for (const w of next) box.appendChild(makeWordRow(w));
  listShown += next.length;
  $("btnMoreList").classList.toggle("hidden", listShown >= listFiltered.length);
}

function rerenderList() {
  // 表示済みの件数を保ったまま描き直す
  const count = Math.max(listShown, LIST_PAGE);
  listShown = 0;
  clear($("wordList"));
  const box = $("wordList");
  const slice = listFiltered.slice(0, count);
  for (const w of slice) box.appendChild(makeWordRow(w));
  listShown = slice.length;
  $("btnMoreList").classList.toggle("hidden", listShown >= listFiltered.length);
}

/* --- 単語の保存（編集の反映） --- */

function touchModify(w) {
  if (String(w.modify).trim() !== "1") w.modify = 1;
}

async function persistWords(words) {
  const tx = db.transaction("words", "readwrite");
  const s = tx.objectStore("words");
  for (const w of words) {
    const rec = { ...w };
    delete rec.dictName; // 表示用の項目はDBに保存しない
    s.put(rec);
  }
  await txDone(tx);
}

/* --- 一括変更 --- */

function updateBulkCount() {
  $("bulkCount").textContent = String(listSelected.size);
}

function selectedWordObjects() {
  return listWords.filter((w) => listSelected.has(w.id));
}

async function bulkApply(kind) {
  const targets = selectedWordObjects();
  if (targets.length === 0) {
    alert("単語が選択されていません。単語をタップして選択してください。");
    return;
  }
  if (kind === "level") {
    const v = Number($("bulkLevel").value);
    for (const w of targets) {
      if (w.level !== v) {
        w.level = v;
        touchModify(w);
      }
    }
  } else if (kind === "memory") {
    const v = Number($("bulkMemory").value);
    for (const w of targets) {
      if (w.memory !== v) {
        w.memory = v;
        touchModify(w);
      }
    }
  } else if (kind === "modify") {
    const v = Number($("bulkModify").value);
    for (const w of targets) w.modify = v;
  }
  await persistWords(targets);
  rerenderList();
  alert(`${targets.length} 語を変更しました。`);
}

function toggleSelectMode() {
  listSelectMode = !listSelectMode;
  listSelected.clear();
  updateBulkCount();
  $("bulkBar").classList.toggle("hidden", !listSelectMode);
  $("btnSelectMode").textContent = listSelectMode ? "選択をやめる" : "選択して一括変更";
  rerenderList();
}

/* --- 単語詳細・編集モーダル --- */

let modalWord = null;

function showWordModal(w) {
  modalWord = w;
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
      text: `レベル：${w.level}　暗記必須：${w.memory === 1 ? "はい" : "いいえ"}　修正済：${String(w.modify).trim() === "1" ? "あり" : "なし"}\n辞書：${w.dictName || ""}`,
    })
  );
  $("btnEditWord").classList.remove("hidden");
  $("modalOverlay").classList.remove("hidden");
}

function showWordEditForm() {
  const w = modalWord;
  if (!w) return;
  const body = $("modalBody");
  clear(body);
  body.appendChild(el("h3", { text: "単語を編集" }));

  const mkText = (label, value) => {
    const input = el("input", { type: "text", autocapitalize: "none", autocomplete: "off", spellcheck: "false" });
    input.value = value;
    body.appendChild(el("div", { class: "edit-field" }, [el("label", { text: label }), input]));
    return input;
  };
  const mkArea = (label, value) => {
    const ta = el("textarea", {});
    ta.value = value;
    body.appendChild(el("div", { class: "edit-field" }, [el("label", { text: label }), ta]));
    return ta;
  };

  const inWord = mkText("見出語（word）※テストの正答になります", w.word);
  const inTrans = mkArea("訳語（trans）", w.trans);
  const inExp = mkArea("補足（exp）", w.exp);
  const inPron = mkText("発音記号（pron）", w.pron);
  const levelSel = el("select", {});
  for (let i = 0; i <= 15; i++) levelSel.appendChild(el("option", { value: String(i), text: String(i) }));
  levelSel.value = String(w.level);
  body.appendChild(el("div", { class: "edit-field" }, [el("label", { text: "レベル（level）" }), levelSel]));
  const memCb = el("input", { type: "checkbox" });
  memCb.checked = w.memory === 1;
  body.appendChild(
    el("div", { class: "edit-field" }, [el("label", {}, [memCb, document.createTextNode(" 暗記必須（memory=1）")])])
  );
  body.appendChild(el("p", { class: "hint", text: "保存すると、この単語に修正済（modify）フラグが自動で付きます。" }));

  const btnSave = el("button", { class: "btn primary full", text: "保存する" });
  const btnCancel = el("button", { class: "btn secondary full", text: "編集をやめる" });
  body.appendChild(btnSave);
  body.appendChild(btnCancel);
  $("btnEditWord").classList.add("hidden");

  btnCancel.addEventListener("click", () => showWordModal(w));
  btnSave.addEventListener("click", async () => {
    const newWord = inWord.value;
    if (newWord.trim() === "") {
      alert("見出語（word）は空にできません。");
      return;
    }
    const changed =
      newWord !== w.word ||
      inTrans.value !== w.trans ||
      inExp.value !== w.exp ||
      inPron.value !== w.pron ||
      Number(levelSel.value) !== w.level ||
      (memCb.checked ? 1 : 0) !== w.memory;
    if (changed) {
      w.word = newWord;
      w.trans = inTrans.value;
      w.exp = inExp.value;
      w.pron = inPron.value;
      w.level = Number(levelSel.value);
      w.memory = memCb.checked ? 1 : 0;
      touchModify(w); // modifyフラグがなければ自動で付ける
      await persistWords([w]);
      rerenderList();
    }
    showWordModal(w);
  });
}

function setupListHandlers() {
  $("btnGoList").addEventListener("click", () => {
    if (listSelectMode) toggleSelectMode();
    openWordList();
  });
  $("searchInput").addEventListener("input", applyListFilter);
  for (const id of ["searchWord", "searchTrans", "searchExp", "listLevelMin", "listLevelMax", "listMemoryFilter"]) {
    $(id).addEventListener("change", applyListFilter);
  }
  $("btnMoreList").addEventListener("click", renderMoreList);
  $("listShowExp").addEventListener("change", rerenderList);
  $("btnCloseModal").addEventListener("click", () => $("modalOverlay").classList.add("hidden"));
  $("modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("modalOverlay")) $("modalOverlay").classList.add("hidden");
  });
  $("btnEditWord").addEventListener("click", showWordEditForm);
  $("btnSelectMode").addEventListener("click", toggleSelectMode);
  $("btnBulkAll").addEventListener("click", () => {
    for (const w of listFiltered) listSelected.add(w.id);
    updateBulkCount();
    rerenderList();
  });
  $("btnBulkNone").addEventListener("click", () => {
    listSelected.clear();
    updateBulkCount();
    rerenderList();
  });
  $("btnBulkLevel").addEventListener("click", () => bulkApply("level"));
  $("btnBulkMemory").addEventListener("click", () => bulkApply("memory"));
  $("btnBulkModify").addEventListener("click", () => bulkApply("modify"));
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

// タッチ端末（スマホ・タブレット）の判定。trueのときは自動でキーボードを出さない。
const IS_TOUCH = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);

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
    // 現在連続正解数 / (補習対象問題数 + 1)　※+1は現在出題中の問題を含む意図
    const cleared = test.remedialAll.length - test.remedialPool.length;
    $("testProgress").textContent = `${cleared} / ${test.remedialAll.length + 1}`;
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
  // スマホでは自動でキーボードを出さない（出すと画面が下までスクロールしてしまうため）。
  // PCでは入力欄に自動フォーカス（preventScrollでスクロールしない）。
  if (!IS_TOUCH) input.focus({ preventScroll: true });
}

// 不正解時、正解と食い違う最初の1文字を選択状態にする
function selectFirstMismatch(inputEl, answer) {
  const typed = inputEl.value;
  let i = 0;
  const n = Math.min(typed.length, answer.length);
  while (i < n && typed[i] === answer[i]) i++;
  let end = i + 1;
  if (i >= typed.length) {
    // 入力が正解の先頭部分と一致していて短い場合は、末尾にカーソルを置く
    i = typed.length;
    end = typed.length;
  } else if (end > typed.length) {
    end = typed.length;
  }
  try {
    inputEl.setSelectionRange(i, end);
  } catch (e) {
    inputEl.select();
  }
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
    selectFirstMismatch(inp, w.word);
    inp.focus({ preventScroll: true });
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
  // スマホでは下部ボタンへフォーカスしない（画面が下までスクロールしてしまうため）
  if (!IS_TOUCH) btnNext.focus({ preventScroll: true });
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

function finishMainTest() {
  concludeMainTest(test.queue.length, false);
}

async function concludeMainTest(total, interrupted) {
  if (test.finished) return; // 連打などによる二重実行を防ぐ
  test.finished = true;
  const wrong = test.wrongWords.length;
  const correct = Math.max(0, total - wrong);
  const rate = total > 0 ? Math.round((correct / total) * 100) : 0;

  const g = groupsCache.find((x) => x.id === currentGroupId);
  if (total > 0) {
    try {
      await idb(
        store("history", "readwrite").add({
          date: Date.now(),
          groupName: g ? g.name : "",
          total,
          correctCount: correct,
          wrongCount: wrong,
          interrupted: !!interrupted,
          wrongWords: test.wrongWords.map((w) => ({ word: w.word, trans: w.trans })),
        })
      );
    } catch (e) {
      console.error("履歴の保存に失敗:", e);
    }
  }

  $("resultTitle").textContent = interrupted ? "テスト中断（ここまでの結果）" : "テスト結果";
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
    if (e.key !== "Enter") return;
    if (!test || test.answered) return; // 確定後の「次へ」は document 側に任せる
    e.preventDefault();
    // PCでは Shift+Enter で「答えを見る」、Enter で「判定する」
    if (e.shiftKey) reveal();
    else judge();
  });
  document.addEventListener("keydown", (e) => {
    // 入力欄側で処理済み（判定・答えを見る）のEnterはここでは無視する。
    // これにより、正解確定と同じEnterで次の問題へ飛んでしまうのを防ぐ。
    if (e.defaultPrevented) return;
    if (e.key === "Enter" && test && test.answered && !$("screen-test").classList.contains("hidden")) {
      e.preventDefault();
      goNext();
    }
  });
  $("btnQuitTest").addEventListener("click", async () => {
    if (!test) {
      showScreen("home");
      return;
    }
    if (test.phase === "remedial") {
      if (confirm("補習テストを中断しますか？（補習は最後までやるのがおすすめです）")) {
        test = null;
        showScreen("home");
      }
      return;
    }
    // 本テストの中断：ここまでの不正解があれば、その単語で補習テストができる
    const engaged = test.answered || test.missedThis;
    const answered = test.idx + (engaged ? 1 : 0);
    const wrong = test.wrongWords.length;
    if (wrong > 0) {
      if (confirm(`テストを中断します。\nここまでの不正解 ${wrong} 語で補習テストができます。よろしいですか？`)) {
        await concludeMainTest(answered, true);
      }
    } else if (confirm("テストを中断しますか？")) {
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
  fillLevelSelect($("bulkLevel"), 0);
  setupGroupHandlers();
  setupImportHandlers();
  setupExportHandlers();
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

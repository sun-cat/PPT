const DATABASE_NAME = "mini-hanghai-scene-templates-v1";
const DATABASE_VERSION = 1;
const TEMPLATE_STORE = "templates";
const SUMMARY_STORE = "summaries";

export const MAX_SCENE_TEMPLATES = 12;

function getIndexedDb() {
  const database = globalThis.indexedDB;
  if (!database) {
    throw new Error("当前浏览器不支持常用场景保存，请使用最新版 Chrome、Edge 或 Safari。");
  }
  return database;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("常用场景读取失败。"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("常用场景保存失败。"));
    transaction.onerror = () => reject(transaction.error || new Error("常用场景保存失败。"));
  });
}

function openDatabase() {
  const request = getIndexedDb().open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(TEMPLATE_STORE)) {
      database.createObjectStore(TEMPLATE_STORE, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(SUMMARY_STORE)) {
      const summaries = database.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
      summaries.createIndex("updatedAt", "updatedAt");
    }
  };
  return requestResult(request);
}

export async function saveSceneTemplate(template, summary) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([TEMPLATE_STORE, SUMMARY_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(TEMPLATE_STORE).put(template);
    transaction.objectStore(SUMMARY_STORE).put(summary);
    await done;
  } finally {
    database.close();
  }
}

export async function listSceneTemplateSummaries() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SUMMARY_STORE, "readonly");
    const done = transactionDone(transaction);
    const summaries = await requestResult(transaction.objectStore(SUMMARY_STORE).getAll());
    await done;
    return summaries.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  } finally {
    database.close();
  }
}

export async function getSceneTemplate(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(TEMPLATE_STORE, "readonly");
    const done = transactionDone(transaction);
    const template = await requestResult(transaction.objectStore(TEMPLATE_STORE).get(id));
    await done;
    return template || null;
  } finally {
    database.close();
  }
}

export async function renameSceneTemplate(id, name) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([TEMPLATE_STORE, SUMMARY_STORE], "readwrite");
    const done = transactionDone(transaction);
    const templateStore = transaction.objectStore(TEMPLATE_STORE);
    const summaryStore = transaction.objectStore(SUMMARY_STORE);
    const [template, summary] = await Promise.all([
      requestResult(templateStore.get(id)),
      requestResult(summaryStore.get(id)),
    ]);
    if (!template || !summary) throw new Error("这个常用场景已不存在，请刷新后重试。");
    const updatedAt = Date.now();
    templateStore.put({ ...template, name, updatedAt });
    summaryStore.put({ ...summary, name, updatedAt });
    await done;
  } finally {
    database.close();
  }
}

export async function deleteSceneTemplate(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([TEMPLATE_STORE, SUMMARY_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(TEMPLATE_STORE).delete(id);
    transaction.objectStore(SUMMARY_STORE).delete(id);
    await done;
  } finally {
    database.close();
  }
}

export const sceneTemplateStoreMetadata = Object.freeze({
  databaseName: DATABASE_NAME,
  templateStore: TEMPLATE_STORE,
  summaryStore: SUMMARY_STORE,
  maxTemplates: MAX_SCENE_TEMPLATES,
});

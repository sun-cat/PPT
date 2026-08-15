const DATABASE_NAME = "mini-hanghai-courseware-archive-v1";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const SUMMARY_STORE = "summaries";

function getIndexedDb() {
  const database = globalThis.indexedDB;
  if (!database) {
    throw new Error("当前浏览器不支持本地作品存档，请使用最新版 Chrome 或 Edge。");
  }
  return database;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地存档读取失败。"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("本地存档写入失败。"));
    transaction.onerror = () => reject(transaction.error || new Error("本地存档写入失败。"));
  });
}

function openDatabase() {
  const request = getIndexedDb().open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(PROJECT_STORE)) {
      database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
    }
    if (!database.objectStoreNames.contains(SUMMARY_STORE)) {
      const summaries = database.createObjectStore(SUMMARY_STORE, { keyPath: "id" });
      summaries.createIndex("updatedAt", "updatedAt");
    }
  };
  return requestResult(request);
}

export async function saveCoursewareArchive(project, summary) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([PROJECT_STORE, SUMMARY_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(PROJECT_STORE).put(project);
    transaction.objectStore(SUMMARY_STORE).put(summary);
    await done;
  } finally {
    database.close();
  }
}

export async function listCoursewareArchives() {
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

export async function getCoursewareArchive(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const done = transactionDone(transaction);
    const project = await requestResult(transaction.objectStore(PROJECT_STORE).get(id));
    await done;
    return project || null;
  } finally {
    database.close();
  }
}

export async function deleteCoursewareArchive(id) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction([PROJECT_STORE, SUMMARY_STORE], "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore(PROJECT_STORE).delete(id);
    transaction.objectStore(SUMMARY_STORE).delete(id);
    await done;
  } finally {
    database.close();
  }
}

export const archiveStoreMetadata = Object.freeze({
  databaseName: DATABASE_NAME,
  projectStore: PROJECT_STORE,
  summaryStore: SUMMARY_STORE,
});

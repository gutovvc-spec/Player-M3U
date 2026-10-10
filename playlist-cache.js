(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PlaylistCache = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const DATABASE_NAME = "player-m3u-playlists";
  const STORE_NAME = "playlists";
  const DATABASE_VERSION = 1;
  const CACHE_VERSION = 2;
  const CACHE_LIFETIME_MS = 20 * 60 * 60 * 1000;
  let databasePromise;

  function isFresh(record, now = Date.now()) {
    return Boolean(
      record
      && record.version === CACHE_VERSION
      && typeof record.content === "string"
      && Number.isFinite(record.savedAt)
      && record.savedAt <= now
      && now - record.savedAt < CACHE_LIFETIME_MS
    );
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("O armazenamento local de playlists não está disponível neste navegador."));
    }

    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "url" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Não foi possível abrir o cache local da playlist."));
      request.onblocked = () => reject(new Error("O cache local está bloqueado por outra aba do player."));
    }).catch((error) => {
      databasePromise = null;
      throw error;
    });
    return databasePromise;
  }

  async function get(url) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(url);
      let result = null;
      request.onsuccess = () => {
        const record = request.result;
        if (isFresh(record)) {
          result = record;
        } else if (record) {
          store.delete(url);
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error("Não foi possível ler o cache local da playlist."));
      transaction.onabort = () => reject(transaction.error || new Error("A leitura do cache local da playlist foi cancelada."));
    });
  }

  async function put(url, content) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put({ url, content, savedAt: Date.now(), version: CACHE_VERSION });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Não foi possível salvar o cache local da playlist."));
      transaction.onabort = () => reject(transaction.error || new Error("O armazenamento do cache local da playlist foi cancelado."));
    });
  }

  async function remove(url) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(url);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Não foi possível remover o cache local da playlist."));
      transaction.onabort = () => reject(transaction.error || new Error("A remoção do cache local da playlist foi cancelada."));
    });
  }

  return { CACHE_LIFETIME_MS, CACHE_VERSION, get, isFresh, put, remove };
});

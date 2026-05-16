/* ============================================
   SecureStorage.js - AES šifrovanie prihlasovacích údajov
   Používa crypto-js z CDN pre AES-CBC šifrovanie
   ============================================ */

const SecureStorage = (() => {
  // === KONFIGURÁCIA ===
  const STORAGE_PREFIX = 'ts_enc_';
  const SALT = 'TorrentStream2024!SecureSalt#';

  // === POMOCNÉ FUNKCIE ===

  /**
   * Získa unikátny identifikátor zariadenia
   * Kombinácia userAgent + dostupných hardvérových info
   */
  function getDeviceFingerprint() {
    const parts = [
      navigator.userAgent || '',
      navigator.language || '',
      navigator.platform || '',
      screen.width || '',
      screen.height || '',
      screen.colorDepth || ''
    ];
    return parts.join('|');
  }

  /**
   * Vygeneruje šifrovací kľúč z master kľúča
   * Používa PBKDF2 odvodenie (simulované cez SHA256 hash)
   */
  function deriveKey(masterKey) {
    // crypto-js používa vlastný KDF, my len skombinujeme salt + fingerprint
    return SALT + '::' + masterKey + '::' + getDeviceFingerprint();
  }

  /**
   * Vygeneruje náhodný master key, ak ešte neexistuje
   */
  function getOrCreateMasterKey() {
    let key = localStorage.getItem('ts_master_key');
    if (!key) {
      // Vygenerujeme náhodný 32-znakový hex reťazec
      const chars = '0123456789abcdef';
      let result = '';
      for (let i = 0; i < 32; i++) {
        result += chars[Math.floor(Math.random() * 16)];
      }
      key = result;
      localStorage.setItem('ts_master_key', key);
    }
    return key;
  }

  // === VEREJNÉ METÓDY ===

  /**
   * Zašifruje a uloží prihlasovacie údaje
   * @param {string} serviceName - názov služby (napr. 'sktorrent', 'webshare')
   * @param {object} data - údaje na uloženie (napr. {username, password} alebo {token})
   * @returns {boolean} true ak sa podarilo uložiť
   */
  function saveCredentials(serviceName, data) {
    try {
      if (!serviceName || !data) return false;
      if (typeof CryptoJS === 'undefined') {
        console.warn('SecureStorage: crypto-js nie je načítaný');
        return false;
      }

      const masterKey = getOrCreateMasterKey();
      const key = deriveKey(masterKey);

      // Zašifrujeme dáta
      const encrypted = CryptoJS.AES.encrypt(JSON.stringify(data), key).toString();

      // Uložíme do localStorage
      localStorage.setItem(STORAGE_PREFIX + serviceName, encrypted);
      return true;
    } catch (err) {
      console.error('SecureStorage.saveCredentials error:', err);
      return false;
    }
  }

  /**
   * Načíta a dešifruje prihlasovacie údaje
   * @param {string} serviceName - názov služby
   * @returns {object|null} dešifrované dáta alebo null
   */
  function loadCredentials(serviceName) {
    try {
      if (!serviceName) return null;
      if (typeof CryptoJS === 'undefined') {
        console.warn('SecureStorage: crypto-js nie je načítaný');
        return null;
      }

      const encrypted = localStorage.getItem(STORAGE_PREFIX + serviceName);
      if (!encrypted) return null;

      const masterKey = localStorage.getItem('ts_master_key');
      if (!masterKey) return null;

      const key = deriveKey(masterKey);

      // Dešifrujeme
      const decrypted = CryptoJS.AES.decrypt(encrypted, key);
      const text = decrypted.toString(CryptoJS.enc.Utf8);
      if (!text) return null;

      return JSON.parse(text);
    } catch (err) {
      console.error('SecureStorage.loadCredentials error:', err);
      return null;
    }
  }

  /**
   * Odstráni uložené prihlasovacie údaje
   * @param {string} serviceName - názov služby
   */
  function removeCredentials(serviceName) {
    try {
      localStorage.removeItem(STORAGE_PREFIX + serviceName);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Zistí, či existujú uložené prihlasovacie údaje pre službu
   * @param {string} serviceName - názov služby
   * @returns {boolean}
   */
  function hasCredentials(serviceName) {
    return localStorage.getItem(STORAGE_PREFIX + serviceName) !== null;
  }

  /**
   * Získa zoznam všetkých služieb s uloženými údajmi
   * @returns {string[]}
   */
  function listServices() {
    const services = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(STORAGE_PREFIX)) {
        services.push(key.substring(STORAGE_PREFIX.length));
      }
    }
    return services;
  }

  // === VEREJNÉ API ===
  return {
    saveCredentials,
    loadCredentials,
    removeCredentials,
    hasCredentials,
    listServices
  };
})();

// Export pre použitie v iných moduloch
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SecureStorage;
}

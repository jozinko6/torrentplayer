/* ============================================
   SktorrentProvider.js - Poskytovateľ pre sktorrent.eu
   ============================================
   Podporuje:
   - online.sktorrent.eu (verejné CZ/SK videá)
   - sktorrent.eu (súkromný tracker, vyžaduje prihlásenie)
   ============================================ */

const SktorrentProvider = (() => {
  // === KONFIGURÁCIA ===
  const ONLINE_BASE = 'https://online.sktorrent.eu';
  const TRACKER_BASE = 'https://sktorrent.eu';
  // Use the same CORS proxy as the main app, with fallbacks
  const CORS_PROXY = (typeof window !== 'undefined' && window.CORS_PROXY_URL) ? window.CORS_PROXY_URL : 'https://corsproxy.io/?';
  const LOCAL_PROXY = 'http://localhost:8080/';

  // === POMOCNÉ FUNKCIE ===

  /**
   * Extrahuje jazyk z názvu videa podľa vlajok v zátvorkách
   * @param {string} name - názov videa
   * @returns {{ language: string, flag: string, cleanName: string }}
   */
  function extractFlags(name) {
    const flagMap = {
      '(CZ)': { language: 'Český dabing', flag: '🇨🇿' },
      '(SK)': { language: 'Slovenský dabing', flag: '🇸🇰' },
      '(EN)': { language: 'Anglický dabing', flag: '🇬🇧' },
      '(CS)': { language: 'Český dabing', flag: '🇨🇿' },
      '(DE)': { language: 'Nemecký dabing', flag: '🇩🇪' },
      '(FR)': { language: 'Francúzsky dabing', flag: '🇫🇷' },
      '(PL)': { language: 'Poľský dabing', flag: '🇵🇱' },
      '(HU)': { language: 'Maďarský dabing', flag: '🇭🇺' },
      '(RU)': { language: 'Ruský dabing', flag: '🇷🇺' },
      '(CZ/SK)': { language: 'Český/Slovenský dabing', flag: '🇨🇿🇸🇰' },
      '(SK/CZ)': { language: 'Slovenský/Český dabing', flag: '🇸🇰🇨🇿' },
      'CZ': { language: 'Český dabing', flag: '🇨🇿' },
      'SK': { language: 'Slovenský dabing', flag: '🇸🇰' },
      'EN': { language: 'Anglický dabing', flag: '🇬🇧' },
      'CS': { language: 'Český dabing', flag: '🇨🇿' },
      'DE': { language: 'Nemecký dabing', flag: '🇩🇪' }
    };

    let result = { language: 'Neznámy', flag: '🌐', cleanName: name };

    for (const [key, value] of Object.entries(flagMap)) {
      if (name.toUpperCase().includes(key)) {
        result.language = value.language;
        result.flag = value.flag;
        result.cleanName = name.replace(new RegExp(key.replace(/[()]/g, '\\$&'), 'gi'), '').replace(/\s+/g, ' ').trim();
        break;
      }
    }

    return result;
  }

  /**
   * Extrahuje kvalitu z názvu
   */
  function extractQuality(name) {
    const qualities = ['2160p', '1080p', '720p', '480p', '360p', '4K', 'HD', 'SD'];
    for (const q of qualities) {
      if (name.includes(q)) return q;
    }
    return 'Neznáma';
  }

  /**
   * Vytvorí URL cez CORS proxy
   * Podporuje rôzne formáty proxy:
   * - corsproxy.io/? (pridá encodeURIComponent(url) za ?)
   * - http://localhost:8080/ (pridá url za /)
   */
  function proxyUrl(url) {
    if (CORS_PROXY.endsWith('?')) {
      return CORS_PROXY + encodeURIComponent(url);
    }
    const proxy = CORS_PROXY.endsWith('/') ? CORS_PROXY : CORS_PROXY + '/';
    return proxy + url;
  }

  // === ONLINE.SKTORRENT.EU (Verejné videá) ===

  /**
   * Vyhľadáva na online.sktorrent.eu
   * @param {string} query - vyhľadávací dotaz
   * @returns {Promise<Array>} pole výsledkov
   */
  async function searchOnline(query) {
    try {
      const url = `${ONLINE_BASE}/search/videos?search_query=${encodeURIComponent(query)}`;
      const response = await fetch(proxyUrl(url));
      if (!response.ok) return [];

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const results = [];
      const links = doc.querySelectorAll('a[href*="/video/"]');

      links.forEach(link => {
        const href = link.getAttribute('href');
        if (!href || !href.startsWith('/video/')) return;

        const name = link.textContent.trim();
        if (!name || name.length < 3) return;

        const flagInfo = extractFlags(name);
        const quality = extractQuality(name);

        // Extrahujeme ID z href
        const idMatch = href.match(/\/video\/(\d+)/);
        const id = idMatch ? idMatch[1] : null;

        if (!id) return;

        results.push({
          id: 'online_' + id,
          title: flagInfo.cleanName,
          originalName: name,
          language: flagInfo.language,
          flag: flagInfo.flag,
          quality: quality,
          url: ONLINE_BASE + href,
          source: 'online.sktorrent.eu',
          sourceType: 'online',
          type: 'video'
        });
      });

      // Odstránime duplicity
      const unique = [];
      const seen = new Set();
      results.forEach(r => {
        if (!seen.has(r.title.toLowerCase())) {
          seen.add(r.title.toLowerCase());
          unique.push(r);
        }
      });

      return unique.slice(0, 30);
    } catch (err) {
      console.error('SktorrentProvider.searchOnline error:', err);
      return [];
    }
  }

  /**
   * Získa priamy .mp4 odkaz z detailu videa
   * @param {string} videoUrl - URL stránky videa
   * @returns {Promise<{url: string, qualities: Array}>}
   */
  async function getOnlineStream(videoUrl) {
    try {
      const response = await fetch(proxyUrl(videoUrl));
      if (!response.ok) return null;

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Hľadáme video element s priamym odkazom
      const video = doc.querySelector('video source');
      if (video) {
        const src = video.getAttribute('src');
        if (src) return { url: src, qualities: [{ url: src, quality: '720p' }] };
      }

      // Hľadáme v scriptoch (JSON dáta)
      const scripts = doc.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        // Hľadáme .mp4 URL v JavaScripte
        const mp4Match = text.match(/(https?:\/\/[^"'\s]+\.mp4)/);
        if (mp4Match) {
          return { url: mp4Match[1], qualities: [{ url: mp4Match[1], quality: '720p' }] };
        }
        // Hľadáme JSON blob s videami
        const jsonMatch = text.match(/sources:\s*(\[[^\]]+\])/);
        if (jsonMatch) {
          try {
            const sources = JSON.parse(jsonMatch[1]);
            if (Array.isArray(sources) && sources.length > 0) {
              const qualities = sources.map(s => ({
                url: s.src || s.file || s.url,
                quality: s.label || s.quality || '720p'
              }));
              return { url: qualities[0].url, qualities };
            }
          } catch {}
        }
      }

      return null;
    } catch (err) {
      console.error('SktorrentProvider.getOnlineStream error:', err);
      return null;
    }
  }

  // === SKTORRENT.EU (Tracker - vyžaduje prihlásenie) ===

  /**
   * Nastaví cookies pre autentifikáciu na tracker
   */
  function setTrackerCookies(credentials) {
    if (!credentials) return;
    // V reálnom prehliadači nastavíme cookies cez document.cookie
    if (credentials.uid) {
      document.cookie = `uid=${credentials.uid}; domain=.sktorrent.eu; path=/; Secure`;
    }
    if (credentials.pass) {
      document.cookie = `pass=${credentials.pass}; domain=.sktorrent.eu; path=/; Secure`;
    }
  }

  /**
   * Vyhľadáva na sktorrent.eu trackeri
   * @param {string} query - vyhľadávací dotaz
   * @param {object} credentials - {uid, pass} z SecureStorage
   * @returns {Promise<Array>} pole výsledkov
   */
  async function searchTracker(query, credentials) {
    try {
      if (!credentials || !credentials.uid || !credentials.pass) return [];

      setTrackerCookies(credentials);

      const url = `${TRACKER_BASE}/torrent/torrents_v2.php?search=${encodeURIComponent(query)}`;
      const response = await fetch(proxyUrl(url), {
        credentials: 'include',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!response.ok) return [];

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      const results = [];

      // Hľadáme riadky tabuľky s torrentami
      const rows = doc.querySelectorAll('tr');
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length < 5) return;

        const nameCell = cells[0] || cells[1];
        const nameLink = nameCell ? nameCell.querySelector('a') : null;
        if (!nameLink) return;

        const name = nameLink.textContent.trim();
        const href = nameLink.getAttribute('href') || '';

        // Extrahujeme ID
        const idMatch = href.match(/id=(\d+)/);
        const id = idMatch ? idMatch[1] : null;
        if (!id) return;

        // Seeders / Leechers
        const seeders = parseInt(cells[cells.length - 2]?.textContent.trim()) || 0;
        const leechers = parseInt(cells[cells.length - 1]?.textContent.trim()) || 0;

        // Veľkosť
        let sizeText = '';
        for (const cell of cells) {
          const text = cell.textContent.trim();
          if (text.match(/\d+\.?\d*\s*(GB|MB|KB)/i)) {
            sizeText = text;
            break;
          }
        }

        const flagInfo = extractFlags(name);

        results.push({
          id: 'tracker_' + id,
          title: flagInfo.cleanName,
          originalName: name,
          language: flagInfo.language,
          flag: flagInfo.flag,
          seeders,
          leechers,
          size: sizeText,
          url: TRACKER_BASE + '/torrent/' + href,
          detailUrl: `${TRACKER_BASE}/torrent/torrents_v2.php?id=${id}`,
          source: 'sktorrent.eu',
          sourceType: 'tracker',
          type: 'torrent'
        });
      });

      return results.slice(0, 30);
    } catch (err) {
      console.error('SktorrentProvider.searchTracker error:', err);
      return [];
    }
  }

  /**
   * Získa magnet link z detailu torrentu
   * @param {string} detailUrl - URL detailu torrentu
   * @returns {Promise<string|null>} magnet link
   */
  async function getTrackerMagnet(detailUrl) {
    try {
      const response = await fetch(proxyUrl(detailUrl), {
        credentials: 'include',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      if (!response.ok) return null;

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Hľadáme magnet link
      const magnetLink = doc.querySelector('a[href^="magnet:?"]');
      if (magnetLink) return magnetLink.getAttribute('href');

      // Hľadáme download link s infohashom
      const downloadLink = doc.querySelector('a[href*="download.php?id="]');
      if (downloadLink) {
        const href = downloadLink.getAttribute('href');
        const idMatch = href.match(/id=([a-f0-9]{40})/i);
        if (idMatch) {
          return `magnet:?xt=urn:btih:${idMatch[1]}&dn=${encodeURIComponent(doc.title || 'video')}&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.opentrackr.org:1337`;
        }
      }

      return null;
    } catch (err) {
      console.error('SktorrentProvider.getTrackerMagnet error:', err);
      return null;
    }
  }

  // === VEREJNÉ API ===

  /**
   * Hlavná vyhľadávacia funkcia - kombinuje online aj tracker
   * @param {string} query - vyhľadávací dotaz
   * @returns {Promise<Array>} pole výsledkov
   */
  async function search(query) {
    if (!query || query.trim().length < 2) return [];

    const credentials = typeof SecureStorage !== 'undefined'
      ? SecureStorage.loadCredentials('sktorrent')
      : null;

    const [onlineResults, trackerResults] = await Promise.all([
      searchOnline(query),
      credentials ? searchTracker(query, credentials) : Promise.resolve([])
    ]);

    // Skombinujeme a označíme zdroj
    const allResults = [
      ...onlineResults.map(r => ({ ...r, provider: 'Sktorrent Online' })),
      ...trackerResults.map(r => ({ ...r, provider: 'Sktorrent Tracker' }))
    ];

    return allResults;
  }

  /**
   * Získa stream URL z výsledku
   * @param {object} result - výsledok vyhľadávania
   * @returns {Promise<{url: string, type: string, qualities?: Array}>}
   */
  async function getStream(result) {
    if (!result) return null;

    if (result.sourceType === 'online') {
      const stream = await getOnlineStream(result.url);
      if (stream) return { ...stream, type: 'direct' };
      return null;
    }

    if (result.sourceType === 'tracker') {
      const magnet = await getTrackerMagnet(result.detailUrl);
      if (magnet) return { url: magnet, type: 'magnet' };
      return null;
    }

    return null;
  }

  // === EXPORT ===
  return {
    search,
    getStream,
    searchOnline,
    searchTracker,
    getOnlineStream,
    getTrackerMagnet,
    extractFlags,
    extractQuality
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SktorrentProvider;
}

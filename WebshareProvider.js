/* ============================================
   WebshareProvider.js - official webshare.cz API
   ============================================ */

const WebshareProvider = (() => {
  const API_BASE = 'https://webshare.cz/api';
  const LOCAL_PROXY = 'http://localhost:8080/';
  const CORS_PROXY = (typeof window !== 'undefined' && window.CORS_PROXY_URL) ? window.CORS_PROXY_URL : LOCAL_PROXY;

  let token = '';
  let username = '';
  let lastError = '';

  function proxyUrl(url) {
    const proxy = CORS_PROXY || LOCAL_PROXY;
    if (proxy.endsWith('?')) return proxy + encodeURIComponent(url);
    return (proxy.endsWith('/') ? proxy : proxy + '/') + url;
  }

  function getText(doc, tag) {
    return doc.querySelector(tag)?.textContent?.trim() || '';
  }

  function parseXml(text) {
    return new DOMParser().parseFromString(text, 'text/xml');
  }

  function parseResponse(text) {
    const xml = parseXml(text);
    const status = getText(xml, 'status');
    const message = getText(xml, 'message');
    return { xml, status, message };
  }

  async function apiPost(endpoint, data = {}) {
    const body = new URLSearchParams(data);
    if (token && !body.has('wst')) body.set('wst', token);
    const res = await fetch(proxyUrl(`${API_BASE}/${endpoint}/`), {
      method: 'POST',
      headers: {
        'Accept': 'text/xml; charset=UTF-8',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Referer': 'https://webshare.cz/',
        'X-Origin': 'https://webshare.cz'
      },
      body: body.toString()
    });
    if (!res.ok) throw new Error(`Webshare API HTTP ${res.status}`);
    const parsed = parseResponse(await res.text());
    if (parsed.status && parsed.status !== 'OK') {
      throw new Error(parsed.message || getText(parsed.xml, 'code') || 'Webshare API error');
    }
    return parsed.xml;
  }

  function bytesToWordArray(bytes) {
    const words = [];
    for (let i = 0; i < bytes.length; i++) words[i >>> 2] |= bytes[i] << (24 - (i % 4) * 8);
    return CryptoJS.lib.WordArray.create(words, bytes.length);
  }

  function wordArrayToBytes(wordArray) {
    const bytes = [];
    for (let i = 0; i < wordArray.sigBytes; i++) {
      bytes.push((wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff);
    }
    return bytes;
  }

  function md5Bytes(bytes) {
    return wordArrayToBytes(CryptoJS.MD5(bytesToWordArray(bytes)));
  }

  function utf8Bytes(text) {
    return Array.from(new TextEncoder().encode(text));
  }

  function md5Crypt(password, salt) {
    const magic = '$1$';
    let cleanSalt = String(salt || '').split('$').filter(Boolean).pop() || '';
    cleanSalt = cleanSalt.split('.')[0].slice(0, 8);
    const pw = utf8Bytes(password);
    const saltBytes = utf8Bytes(cleanSalt);
    const magicBytes = utf8Bytes(magic);
    let ctx = [...pw, ...magicBytes, ...saltBytes];
    let finalBytes = md5Bytes([...pw, ...saltBytes, ...pw]);
    for (let left = pw.length; left > 0; left -= 16) ctx.push(...finalBytes.slice(0, Math.min(16, left)));
    for (let i = pw.length; i > 0; i >>= 1) ctx.push(i & 1 ? 0 : pw[0]);
    finalBytes = md5Bytes(ctx);
    for (let i = 0; i < 1000; i++) {
      let round = [];
      round.push(...(i & 1 ? pw : finalBytes));
      if (i % 3) round.push(...saltBytes);
      if (i % 7) round.push(...pw);
      round.push(...(i & 1 ? finalBytes : pw));
      finalBytes = md5Bytes(round);
    }
    const chars = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    const to64 = (value, length) => {
      let out = '';
      while (length-- > 0) {
        out += chars[value & 0x3f];
        value >>= 6;
      }
      return out;
    };
    const b = finalBytes;
    return magic + cleanSalt + '$' +
      to64((b[0] << 16) | (b[6] << 8) | b[12], 4) +
      to64((b[1] << 16) | (b[7] << 8) | b[13], 4) +
      to64((b[2] << 16) | (b[8] << 8) | b[14], 4) +
      to64((b[3] << 16) | (b[9] << 8) | b[15], 4) +
      to64((b[4] << 16) | (b[10] << 8) | b[5], 4) +
      to64(b[11], 2);
  }

  async function hashPassword(user, password) {
    const saltXml = await apiPost('salt', { username_or_email: user });
    const salt = getText(saltXml, 'salt');
    if (!salt) throw new Error('Webshare nevratil salt pre heslo');
    return CryptoJS.SHA1(md5Crypt(password, salt)).toString();
  }

  async function login(user, password) {
    lastError = '';
    try {
      if (!user || !password) throw new Error('Zadajte Webshare meno/e-mail a heslo');
      const passwordHash = await hashPassword(user, password);
      const loginXml = await apiPost('login', {
        username_or_email: user,
        password: passwordHash,
        keep_logged_in: '1'
      });
      token = getText(loginXml, 'token');
      if (!token) throw new Error('Webshare nevratil prihlasovaci token');
      username = user;
      return { ok: true, token };
    } catch (err) {
      token = '';
      username = '';
      lastError = err.message || 'Webshare login zlyhal';
      return { ok: false, error: lastError };
    }
  }

  function setSession(session) {
    token = session?.token || '';
    username = session?.username || '';
  }

  function isLoggedIn() {
    return Boolean(token);
  }

  function extractQuality(name) {
    const match = String(name || '').match(/\b(2160p|1080p|720p|480p|360p|4k|uhd|hd|sd)\b/i);
    return match ? match[1].toUpperCase().replace('4K', '4K') : '';
  }

  async function search(query) {
    if (!query || query.trim().length < 2 || !token) return [];
    try {
      const xml = await apiPost('search', {
        what: query.trim(),
        sort: 'rating',
        limit: '50',
        offset: '0',
        category: 'video'
      });
      return Array.from(xml.querySelectorAll('file')).map(file => {
        const name = getText(file, 'name');
        const ident = getText(file, 'ident');
        return {
          id: `webshare_${ident}`,
          ident,
          title: name,
          originalName: name,
          name,
          source: 'webshare.cz',
          sourceType: 'webshare',
          provider: 'Webshare',
          size: Number(getText(file, 'size')) || 0,
          quality: extractQuality(name),
          type: 'video',
          fileType: getText(file, 'type'),
          posterUrl: getText(file, 'img') || null,
          passwordProtected: getText(file, 'password') === '1',
          _provider: 'Webshare',
          _providerBadge: 'WS',
          _type: 'direct'
        };
      }).filter(item => item.ident && !item.passwordProtected);
    } catch (err) {
      lastError = err.message;
      console.warn('WebshareProvider.search error:', err.message);
      return [];
    }
  }

  async function getStream(result) {
    if (!result || !result.ident || !token) return null;
    try {
      const xml = await apiPost('file_link', {
        ident: result.ident,
        download_type: 'video_stream',
        force_https: '1'
      });
      const link = getText(xml, 'link');
      return link ? { url: link, type: 'direct' } : null;
    } catch (err) {
      lastError = err.message;
      console.warn('WebshareProvider.getStream error:', err.message);
      return null;
    }
  }

  function getStatus() {
    return { loggedIn: isLoggedIn(), username, error: lastError };
  }

  return {
    login,
    setSession,
    isLoggedIn,
    search,
    getStream,
    getStatus
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WebshareProvider;
}

/* ============================================
   SktorrentOnlineProvider.js - Poskytovateľ pre online.sktorrent.eu
   ============================================
   Podporuje prihlásenie používateľa, vyhľadávanie videí
   a získavanie priamych .mp4 streamov.
   
   Používa CORS proxy, ktorá musí podporovať preposielanie
   Set-Cookie hlavičiek (napr. lokálna proxy na porte 8080).
   ============================================ */

class SktorrentOnlineProvider {
  /**
   * @param {string} username - Používateľské meno na online.sktorrent.eu
   * @param {string} password - Heslo na online.sktorrent.eu
   */
  constructor(username, password) {
    this.baseUrl = 'https://online.sktorrent.eu';
    this.username = username || '';
    this.password = password || '';
    
    // Session cookie (napr. "PHPSESSID=abc123; path=/; secure; HttpOnly")
    this.sessionCookie = null;
    this.cookieMap = {};
    
    // Dátum posledného prihlásenia - pre automatické obnovenie
    this.lastLoginTime = 0;
    
    // CORS proxy - používame lokálnu proxy, ktorá vie preposielať cookies
    this.corsProxy = (typeof window !== 'undefined' && window.CORS_PROXY_URL) 
      ? window.CORS_PROXY_URL 
      : 'https://corsproxy.io/?';
    
    // Lokálna proxy (pre prihlásenie, kde potrebujeme Set-Cookie)
    this.localProxy = 'http://localhost:8080/';
    
    // User-Agent pre realistické požiadavky
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }

  /**
   * Vytvorí URL cez CORS proxy
   * @param {string} url - Cieľová URL
   * @param {boolean} useLocalProxy - Použiť lokálnu proxy (pre prihlásenie)
   * @returns {string}
   */
  _proxyUrl(url, useLocalProxy = false) {
    const proxy = useLocalProxy ? this.localProxy : this.corsProxy;
    if (proxy.endsWith('?')) {
      return proxy + encodeURIComponent(url);
    }
    const p = proxy.endsWith('/') ? proxy : proxy + '/';
    return p + url;
  }

  _normalizeUrl(url) {
    if (!url) return '';
    const cleanUrl = String(url).replace(/\\\//g, '/').replace(/&amp;/g, '&').trim();
    try {
      return new URL(cleanUrl, this.baseUrl).href;
    } catch {
      return cleanUrl;
    }
  }

  _streamProxyUrl(url) {
    return this._proxyUrl(this._normalizeUrl(url), true);
  }

  _storeSetCookie(setCookieHeader) {
    if (!setCookieHeader) return;
    String(setCookieHeader).split(/,(?=\s*[^;,]+=)/).forEach(part => {
      const pair = part.split(';')[0].trim();
      const eq = pair.indexOf('=');
      if (eq > 0) this.cookieMap[pair.slice(0, eq)] = pair.slice(eq + 1);
    });
    this.sessionCookie = Object.entries(this.cookieMap)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  _readCookieFromResponse(response) {
    this._storeSetCookie(response.headers.get('x-set-cookie') || response.headers.get('set-cookie'));
  }

  _extractCsrfToken(html) {
    const metaMatch = html.match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i);
    if (metaMatch) return metaMatch[1];
    const inputMatch = html.match(/<input[^>]+name=["'](?:_token|csrf_token)["'][^>]*>/i);
    if (!inputMatch) return '';
    const valueMatch = inputMatch[0].match(/value=["']([^"']+)["']/i);
    return valueMatch ? valueMatch[1] : '';
  }

  _isLoginPage(html) {
    const text = String(html || '').toLowerCase();
    return /name=["']?(username|email|password)/i.test(text) &&
      (text.includes('/login') || text.includes('prihl') || text.includes('login'));
  }

  _isLoggedInHtml(html) {
    const text = String(html || '').toLowerCase();
    if (text.includes('logout') || text.includes('odhl') || text.includes('profil') || text.includes('/account')) return true;
    return !this._isLoginPage(html);
  }

  _extractVideoId(href) {
    const cleanHref = this._normalizeUrl(href);
    const patterns = [/\/video\/(\d+)/i, /\/watch\/(\d+)/i, /[?&](?:id|video_id)=(\d+)/i, /\/(\d+)(?:[-_/]|$)/i];
    for (const pattern of patterns) {
      const match = cleanHref.match(pattern);
      if (match) return match[1];
    }
    return '';
  }

  /**
   * Vytvorí základné hlavičky pre fetch požiadavku
   * @param {boolean} includeCookie - Pridať Cookie hlavičku
   * @returns {object}
   */
  _getHeaders(includeCookie = true) {
    const headers = {
      'User-Agent': this.userAgent,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'sk,cs;q=0.9,en;q=0.8',
      'Referer': this.baseUrl + '/',
      'X-Referer': this.baseUrl + '/',
      'X-Origin': this.baseUrl
    };
    
    // Pridáme session cookie, ak ju máme
    // POZNÁMKA: Niektoré prehliadače blokujú manuálne nastavenie Cookie hlavičky.
    // Alternatíva: použiť X-Cookie hlavičku a upraviť proxy, aby ju preposlala ako Cookie.
    if (includeCookie && this.sessionCookie) {
      // Pre prípad, že proxy podporuje X-Cookie -> Cookie mapovanie
      headers['X-Cookie'] = this.sessionCookie;
    }
    
    return headers;
  }

  /**
   * Vykoná HTTP GET požiadavku s podporou cookies
   * @param {string} url - Cieľová URL
   * @param {boolean} useLocalProxy - Použiť lokálnu proxy
   * @returns {Promise<Response>}
   */
  async _fetch(url, useLocalProxy = false) {
    const proxyUrl = this._proxyUrl(url, useLocalProxy);
    
    const options = {
      method: 'GET',
      headers: this._getHeaders(true),
      // Dôležité: redirect: 'follow' aby sme získali finálny obsah
      redirect: 'follow'
    };
    
    // Ak používame lokálnu proxy, skúsime credentials: 'include'
    // aby sa automaticky posielali cookies (ak ich prehliadač už má)
    if (useLocalProxy) {
      options.credentials = 'include';
    }
    
    const response = await fetch(proxyUrl, options);
    
    // Ak sme dostali Set-Cookie z proxy, uložíme ju
    // (lokálna proxy by mala preposielať Set-Cookie)
    this._readCookieFromResponse(response);
    
    return response;
  }

  /**
   * Vykoná HTTP POST požiadavku (pre prihlásenie)
   * @param {string} url - Cieľová URL
   * @param {object} body - Telo požiadavky (form data)
   * @returns {Promise<Response>}
   */
  async _fetchPost(url, body) {
    // Pre prihlásenie používame lokálnu proxy, ktorá vie preposlať Set-Cookie
    const proxyUrl = this._proxyUrl(url, true);
    
    const formBody = Object.entries(body)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    
    const response = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'sk,cs;q=0.9,en;q=0.8',
        'Referer': this.baseUrl + '/login',
        'Origin': this.baseUrl,
        'X-Referer': this.baseUrl + '/login',
        'X-Origin': this.baseUrl,
        ...(this.sessionCookie ? { 'X-Cookie': this.sessionCookie } : {})
      },
      body: formBody,
      redirect: 'manual',  // Dôležité: nezahadzujeme presmerovanie
      credentials: 'include'
    });
    
    // Extrahujeme Set-Cookie hlavičku
    // Pri použití lokálnej proxy by mala byť dostupná
    const setCookieHeader = response.headers.get('x-set-cookie') || response.headers.get('set-cookie');
    if (setCookieHeader) {
      this._storeSetCookie(setCookieHeader);
      console.log('SktorrentOnline: Získaná cookie:', setCookieHeader.substring(0, 50) + '...');
    } else {
      console.warn('SktorrentOnline: Žiadna Set-Cookie hlavička v odpovedi');
      // Skúsime pozrieť všetky hlavičky pre debug
      console.log('SktorrentOnline: Response headers:', 
        Array.from(response.headers.entries()).map(h => h[0] + ': ' + h[1]).join(', '));
    }
    
    // Ak je odpoveď 302 (presmerovanie), skúsime nasledovať presmerovanie
    // a extrahovať cookie z Location hlavičky
    if (response.status === 302 || response.status === 301) {
      const location = response.headers.get('location');
      console.log('SktorrentOnline: Presmerovanie na:', location);
      
      // Ak sme dostali cookie, sme prihlásení
      if (this.sessionCookie) {
        return response;
      }
      
      // Inak skúsime nasledovať presmerovanie
      if (location) {
        const redirectUrl = this._normalizeUrl(location);
        const redirectResponse = await this._fetch(redirectUrl, true);
        
        // Skúsime extrahovať cookie z presmerovania
        this._readCookieFromResponse(redirectResponse);
        
        return redirectResponse;
      }
    }
    
    return response;
  }

  /**
   * Prihlási používateľa na online.sktorrent.eu
   * @returns {Promise<boolean>} true ak bolo prihlásenie úspešné
   */
  async login() {
    if (!this.username || !this.password) {
      console.warn('SktorrentOnline: Nie sú nastavené prihlasovacie údaje');
      return false;
    }
    
    try {
      console.log('SktorrentOnline: Pokus o prihlásenie...');
      
      // 1. Najprv načítame login stránku, aby sme získali prípadný CSRF token
      const loginPageUrl = `${this.baseUrl}/login`;
      const loginPageResponse = await this._fetch(loginPageUrl, true);
      
      if (!loginPageResponse.ok && loginPageResponse.status !== 302) {
        console.warn('SktorrentOnline: Nepodarilo sa načítať login stránku, status:', loginPageResponse.status);
      }
      
      const loginPageHtml = await loginPageResponse.text();
      
      // Hľadáme CSRF token v HTML (ak existuje)
      const csrfToken = this._extractCsrfToken(loginPageHtml);
      if (csrfToken) {
        console.log('SktorrentOnline: Nájdený CSRF token');
      }
      
      // 2. Odošleme prihlasovacie údaje
      const loginBody = {
        username: this.username,
        password: this.password
      };
      
      // Pridáme CSRF token ak bol nájdený
      if (csrfToken) {
        loginBody._token = csrfToken;
      }
      
      // Skúsime aj alternatívne názvy polí (podľa HTML formulára)
      loginBody.email = this.username;
      loginBody['email_or_username'] = this.username;
      
      const response = await this._fetchPost(`${this.baseUrl}/login`, loginBody);
      
      // 3. Overíme, či je prihlásenie úspešné
      // Skúsime načítať stránku, ktorá vyžaduje prihlásenie
      const testUrl = `${this.baseUrl}/videos`;
      const testResponse = await this._fetch(testUrl, true);
      
      if (testResponse.ok) {
        const testHtml = await testResponse.text();
        
        // Skontrolujeme, či nie sme presmerovaní späť na login
        if (this._isLoggedInHtml(testHtml)) {
          this.lastLoginTime = Date.now();
          console.log('SktorrentOnline: Prihlásenie úspešné');
          return true;
        }
      }
      
      // Ak máme cookie, skúsime ešte jeden pokus
      if (this.sessionCookie) {
        this.lastLoginTime = Date.now();
        console.log('SktorrentOnline: Prihlásenie pravdepodobne úspešné (máme cookie)');
        return true;
      }
      
      console.warn('SktorrentOnline: Prihlásenie zlyhalo - nesprávne meno alebo heslo?');
      return false;
    } catch (err) {
      console.error('SktorrentOnline.login error:', err);
      return false;
    }
  }

  /**
   * Skontroluje, či je session stále platná a prípadne sa znova prihlási
   * @returns {Promise<boolean>}
   */
  async _ensureLoggedIn() {
    // Ak sme sa prihlásili pred menej ako 30 minútami, považujeme session za platnú
    if (this.sessionCookie && (Date.now() - this.lastLoginTime) < 30 * 60 * 1000) {
      return true;
    }
    
    // Inak sa skúsime prihlásiť
    return await this.login();
  }

  /**
   * Vyhľadáva videá na online.sktorrent.eu
   * @param {string} query - Vyhľadávací dotaz
   * @returns {Promise<Array>} Pole výsledkov
   */
  async search(query) {
    if (!query || query.trim().length < 2) return [];
    
    // Zabezpečíme prihlásenie
    const loggedIn = await this._ensureLoggedIn();
    if (!loggedIn) {
      console.warn('SktorrentOnline: Nie je možné vyhľadávať bez prihlásenia');
      return [];
    }
    
    try {
      const encoded = encodeURIComponent(query.trim());
      const searchUrls = [
        `${this.baseUrl}/search/videos?search_query=${encoded}`,
        `${this.baseUrl}/search?search_query=${encoded}`,
        `${this.baseUrl}/search?query=${encoded}`,
        `${this.baseUrl}/videos?search=${encoded}`
      ];
      let response = null;
      let html = '';
      let okUrl = '';
      for (const searchUrl of searchUrls) {
        response = await this._fetch(searchUrl, true);
        if (!response.ok) continue;
        html = await response.text();
        if (html && !this._isLoginPage(html)) {
          okUrl = searchUrl;
          break;
        }
      }
      
      if (!response.ok) {
        console.warn('SktorrentOnline: Vyhľadávanie zlyhalo, status:', response.status);
        return [];
      }
      
      if (!html || this._isLoginPage(html)) {
        console.warn('SktorrentOnline: Vyhladavanie zlyhalo alebo session vratila login stranku');
        this.sessionCookie = null;
        return [];
      }
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      const results = [];
      
      // Hľadáme video karty/odkazy - online.sktorrent.eu používa rôzne štruktúry
      // Skúsime viacero selektorov
      
      // 1. Selektor pre karty videí (moderná verzia)
      const videoCards = doc.querySelectorAll('.video-card, .video-item, .card, article, .movie, .item, .thumb, .col');
      
      videoCards.forEach(card => {
        const link = card.querySelector('a[href*="/video/"], a[href*="/watch/"], a[href*="video_id="], a[href*="id="]');
        if (!link) return;
        
        const href = link.getAttribute('href');
        const heading = card.querySelector('h1,h2,h3,.title,.name');
        const img = card.querySelector('img');
        const name = (link.textContent || heading?.textContent || link.getAttribute('title') || img?.getAttribute('alt') || '').trim();
        
        if (!name || name.length < 2) return;
        
        // Extrahujeme ID z href
        const videoId = this._extractVideoId(href);
        if (!videoId) return;
        
        // Extrahujeme náhľadový obrázok
        const thumbnail = img ? this._normalizeUrl(img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
        
        // Extrahujeme flag (CZ, SK, EN, ...)
        const flagInfo = this._extractFlags(name);
        const quality = this._extractQuality(name);
        
        results.push({
          id: 'skonline_' + videoId,
          videoId: videoId,
          title: flagInfo.cleanName,
          originalName: name,
          language: flagInfo.language,
          flag: flagInfo.flag,
          quality: quality,
          thumbnail: thumbnail,
          url: this._normalizeUrl(href),
          source: 'online.sktorrent.eu',
          sourceType: 'online',
          type: 'video',
          _provider: 'Sktorrent Online',
          _providerBadge: flagInfo.flag || '🇨🇿',
          _type: 'direct'
        });
      });
      
      // 2. Ak nenašiel žiadne karty, skúsime jednoduché odkazy
      if (results.length === 0) {
        const links = doc.querySelectorAll('a[href*="/video/"], a[href*="/watch/"], a[href*="video_id="]');
        
        links.forEach(link => {
          const href = link.getAttribute('href');
          const name = (link.textContent || link.getAttribute('title') || '').trim();
          
          if (!name || name.length < 2) return;
          
          const videoId = this._extractVideoId(href);
          if (!videoId) return;
          const flagInfo = this._extractFlags(name);
          const quality = this._extractQuality(name);
          
          results.push({
            id: 'skonline_' + videoId,
            videoId: videoId,
            title: flagInfo.cleanName,
            originalName: name,
            language: flagInfo.language,
            flag: flagInfo.flag,
            quality: quality,
            thumbnail: '',
            url: this._normalizeUrl(href),
            source: 'online.sktorrent.eu',
            sourceType: 'online',
            type: 'video',
            _provider: 'Sktorrent Online',
            _providerBadge: flagInfo.flag || '🇨🇿',
            _type: 'direct'
          });
        });
      }
      
      // 3. Ak stále nič, skúsime hľadať v tabuľke
      if (results.length === 0) {
        const rows = doc.querySelectorAll('tr');
        rows.forEach(row => {
          const cells = row.querySelectorAll('td');
          if (cells.length < 2) return;
          
          const link = row.querySelector('a[href*="/video/"], a[href*="/watch/"], a[href*="video_id="]');
          if (!link) return;
          
          const href = link.getAttribute('href');
          const name = link.textContent.trim();
          
          if (!name || name.length < 2) return;
          
          const videoId = this._extractVideoId(href);
          if (!videoId) return;
          const flagInfo = this._extractFlags(name);
          const quality = this._extractQuality(name);
          
          results.push({
            id: 'skonline_' + videoId,
            videoId: videoId,
            title: flagInfo.cleanName,
            originalName: name,
            language: flagInfo.language,
            flag: flagInfo.flag,
            quality: quality,
            thumbnail: '',
            url: this._normalizeUrl(href),
            source: 'online.sktorrent.eu',
            sourceType: 'online',
            type: 'video',
            _provider: 'Sktorrent Online',
            _providerBadge: flagInfo.flag || '🇨🇿',
            _type: 'direct'
          });
        });
      }
      
      // Odstránime duplicity
      const unique = [];
      const seen = new Set();
      results.forEach(r => {
        const key = r.title.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(r);
        }
      });
      
      console.log(`SktorrentOnline: Nájdených ${unique.length} výsledkov pre "${query}"`);
      return unique.slice(0, 50);
    } catch (err) {
      console.error('SktorrentOnline.search error:', err);
      return [];
    }
  }

  /**
   * Získa priamy .mp4 stream URL pre dané video ID
   * @param {string|number} videoId - ID videa
   * @returns {Promise<{url: string, qualities: Array}|null>}
   */
  async getStreamUrl(videoId) {
    if (!videoId) return null;
    
    const loggedIn = await this._ensureLoggedIn();
    if (!loggedIn) return null;
    
    try {
      const videoPageUrl = `${this.baseUrl}/video/${videoId}`;
      const response = await this._fetch(videoPageUrl, true);
      
      if (!response.ok) return null;
      
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // === METÓDA 1: Hľadáme video element s priamym odkazom ===
      const videoSource = doc.querySelector('video source, video[src]');
      if (videoSource) {
        const src = videoSource.getAttribute('src');
        if (src && src.includes('.mp4')) {
          const streamUrl = this._streamProxyUrl(src);
          return { url: streamUrl, qualities: [{ url: streamUrl, quality: '720p' }] };
        }
      }
      
      // === METÓDA 2: Hľadáme v <script> tagoch base_url a video_id ===
      const scripts = doc.querySelectorAll('script');
      let baseUrl = '';
      let vidId = '';
      
      for (const script of scripts) {
        const text = script.textContent || '';
        
        // Hľadáme base_url
        const baseMatch = text.match(/base_url\s*[=:]\s*["']([^"']+)["']/i);
        if (baseMatch) baseUrl = baseMatch[1];
        
        // Hľadáme video_id
        const idMatch = text.match(/video_id\s*[=:]\s*["']([^"']+)["']/i);
        if (idMatch) vidId = idMatch[1];
        
        // Hľadáme priamo .mp4 URL
        const mp4Match = text.match(/(https?:\/\/[^"'\s]+\.mp4)/);
        if (mp4Match) {
          const streamUrl = this._streamProxyUrl(mp4Match[1]);
          return { url: streamUrl, qualities: [{ url: streamUrl, quality: '720p' }] };
        }
        
        // Hľadáme JSON blob s videami (sources, playlist, atď.)
        const sourcesMatch = text.match(/sources\s*:\s*(\[[^\]]+\])/i);
        if (sourcesMatch) {
          try {
            const sources = JSON.parse(sourcesMatch[1]);
            if (Array.isArray(sources) && sources.length > 0) {
              const qualities = sources.map(s => {
                const url = s.src || s.file || s.url;
                return {
                  url: url ? this._streamProxyUrl(url) : '',
                  quality: s.label || s.quality || (s.height ? s.height + 'p' : '720p')
                };
              }).filter(s => s.url);
              
              if (qualities.length > 0) {
                return { url: qualities[0].url, qualities };
              }
            }
          } catch {}
        }
        
        // Hľadáme playlist (HLS)
        const hlsMatch = text.match(/["']([^"']+\.m3u8[^"']*)["']/);
        if (hlsMatch) {
          const streamUrl = this._streamProxyUrl(hlsMatch[1]);
          return { url: streamUrl, qualities: [{ url: streamUrl, quality: 'HLS' }] };
        }
      }
      
      // === METÓDA 3: Ak máme base_url a video_id, zostavíme URL ===
      if (baseUrl && vidId) {
        // Skúsime rôzne kvality
        const qualities = ['1080', '720', '480', '360'];
        const streamUrls = [];
        
        for (const quality of qualities) {
          const streamUrl = this._normalizeUrl(`${baseUrl}/videos/${vidId}/${quality}.mp4`);
          streamUrls.push({ url: streamUrl, quality: quality + 'p' });
        }
        
        // Overíme prvú funkčnú kvalitu HEAD požiadavkou
        for (const stream of streamUrls) {
          try {
            const headResponse = await fetch(this._proxyUrl(stream.url, true), { method: 'HEAD' });
            if (headResponse.ok) {
              const proxied = streamUrls.map(item => ({ ...item, url: this._proxyUrl(item.url, true) }));
              return { url: this._proxyUrl(stream.url, true), qualities: proxied };
            }
          } catch {}
        }
        
        // Ak žiadna nefunguje, vrátime aspoň prvú
        const proxied = streamUrls.map(item => ({ ...item, url: this._proxyUrl(item.url, true) }));
        return { url: proxied[0].url, qualities: proxied };
      }
      
      // === METÓDA 4: Hľadáme akýkoľvek odkaz na video súbor ===
      const allLinks = doc.querySelectorAll('a[href$=".mp4"], a[href*=".mp4?"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const fullUrl = this._streamProxyUrl(href);
          return { url: fullUrl, qualities: [{ url: fullUrl, quality: '720p' }] };
        }
      }
      
      console.warn('SktorrentOnline: Nenašiel sa žiadny stream pre video', videoId);
      return null;
    } catch (err) {
      console.error('SktorrentOnline.getStreamUrl error:', err);
      return null;
    }
  }

  /**
   * Získa stream z výsledku vyhľadávania
   * @param {object} result - Výsledok vyhľadávania
   * @returns {Promise<{url: string, type: string, qualities?: Array}|null>}
   */
  async getStream(result) {
    if (!result) return null;
    
    if (result.sourceType === 'online' && result.videoId) {
      const stream = await this.getStreamUrl(result.videoId);
      if (stream) return { ...stream, type: 'direct' };
    }
    
    return null;
  }

  /**
   * Extrahuje jazyk z názvu videa
   * @param {string} name - Názov videa
   * @returns {{ language: string, flag: string, cleanName: string }}
   */
  _extractFlags(name) {
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
   * @param {string} name - Názov videa
   * @returns {string}
   */
  _extractQuality(name) {
    const qualities = ['2160p', '1080p', '720p', '480p', '360p', '4K', 'HD', 'SD'];
    for (const q of qualities) {
      if (name.includes(q)) return q;
    }
    return 'Neznáma';
  }

  /**
   * Zistí, či je používateľ prihlásený
   * @returns {boolean}
   */
  isLoggedIn() {
    return this.sessionCookie !== null;
  }

  /**
   * Vráti aktuálny stav prihlásenia
   * @returns {{ loggedIn: boolean, username: string, cookiePreview: string }}
   */
  getStatus() {
    return {
      loggedIn: this.isLoggedIn(),
      username: this.username,
      cookiePreview: this.sessionCookie ? this.sessionCookie.substring(0, 40) + '...' : 'žiadna'
    };
  }
}

// Export pre použitie v prehliadači aj Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = SktorrentOnlineProvider;
}

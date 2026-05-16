/* ============================================
   TorrentStream - Netflix-like PWA/Desktop App
   ============================================ */

// ============================================
// 0. CONFIGURATION
// ============================================

// CORS proxy configuration
// Primary: uses corsproxy.io which works from any origin (including file://)
// Fallback: local proxy for Electron/desktop mode
const CORS_PROXY_URL = 'https://corsproxy.io/?';
const LOCAL_PROXY_URL = 'http://localhost:8080/';
const PUBLIC_CORS_PROXIES = [
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
  'https://cors-anywhere.herokuapp.com/'
];
const TMDB_API_KEY = '1ac0e1fa00be762d0ca47ea7c4b83f33';
const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const OPENSUBTITLES_API_KEY = '';
const OPENSUBTITLES_BASE = 'https://api.opensubtitles.com/api/v1';

// Expose CORS proxy URL globally so providers can use it
if (typeof window !== 'undefined') {
  window.CORS_PROXY_URL = CORS_PROXY_URL;
}

const isElectron = typeof window !== 'undefined' && window.torrentAPI !== undefined;

// ============================================
// 1. STATE
// ============================================

let client = null;
let currentTorrent = null;
let currentFileIndex = 0;
let currentPlayingFile = null;
let progressInterval = null;
let deferredPrompt = null;
let connectionAttempts = 0;
let torrentDownloaded = false;
let videoEnded = false;
let torrentFiles = [];
let lastSearchTime = 0;
let currentSearchResults = [];
let heroMovie = null;
let popoutWindow = null;
let popoutSyncInterval = null;
let currentSubtitles = [];
let currentAudioTracks = [];
let selectedAudioTrack = 0;
let selectedSubtitle = null;
let currentPage = 0;
const RESULTS_PER_PAGE = 20;
let currentViewMode = 'grid';
let czDubbingOnly = false;
let currentSourceFilter = 'all';
let currentDetailMovie = null;
let skonlineProvider = null;

const MAX_CONNECTION_ATTEMPTS = 3;
const SEARCH_THROTTLE_MS = 2000;
const MAX_SEARCH_RESULTS = 100;
const SEARCH_HISTORY_KEY = 'torrentStreamSearchHistory';
const MAX_SEARCH_HISTORY = 10;

const FAVORITES_KEY = 'torrentStreamFavorites';
const CONTINUE_WATCHING_KEY = 'torrentStreamContinueWatching';

const CZ_DUBBING_KEYWORDS = ["CZ", "český", "dabing", "czech", "CS", "slovenský", "SK", "český dabing", "slovenský dabing", "czech dub", "sk"];

// ============================================
// 2. DOM REFS
// ============================================

const $ = id => document.getElementById(id);

const videoElement = $('video-element');
const heroBanner = $('hero-banner');
const heroBackdrop = $('hero-backdrop');
const heroTitle = $('hero-title');
const heroYear = $('hero-year');
const heroRating = $('hero-rating');
const heroOverview = $('hero-overview');
const heroPlayBtn = $('hero-play-btn');
const heroInfoBtn = $('hero-info-btn');
const searchInput = $('search-input');
const categorySelect = $('category-select');
const searchBtn = $('search-btn');
const resultsSection = $('results-section');
const resultsTitle = $('results-title');
const searchResultsEl = $('search-results');
const statusBar = $('status-bar');
const progressBar = $('progress-bar');
const statusText = $('status-text');
const videoModal = $('video-modal');
const videoModalTitle = $('video-modal-title');
const videoCloseBtn = $('video-close-btn');
const loadingOverlay = $('loading-overlay');
const playPauseBtn = $('play-pause-btn');
const seekBackBtn = $('seek-back-btn');
const seekForwardBtn = $('seek-forward-btn');
const progressSlider = $('progress-slider');
const currentTimeEl = $('current-time');
const durationEl = $('duration');
const volumeBtn = $('volume-btn');
const volumeSlider = $('volume-slider');
const fullscreenBtn = $('fullscreen-btn');
const popoutBtn = $('popout-btn');
const stopBtn = $('stop-btn');
const sourceBtn = $('source-btn');
const sourceModal = $('source-modal');
const sourceCloseBtn = $('source-close-btn');
const fileInput = $('file-input');
const magnetInput = $('magnet-input');
const magnetLoad = $('magnet-load');
const urlInput = $('url-input');
const urlLoad = $('url-load');
const fileModal = $('file-modal');
const fileList = $('file-list');
const fileCloseBtn = $('file-close-btn');
const saveDialogOverlay = $('save-dialog-overlay');
const saveDialogMessage = $('save-dialog-message');
const saveBtn = $('save-btn');
const discardBtn = $('discard-btn');
const installBtn = $('install-btn');
const audioTrackBtn = $('audio-track-btn');
const subtitleBtn = $('subtitle-btn');
const subtitleMenu = $('subtitle-menu');
const audioTrackMenu = $('audio-track-menu');
const mainContent = $('main-content');
const browseRows = $('browse-rows');

// ============================================
// 3. INIT WEBTORRENT
// ============================================

if (!isElectron) {
  if (typeof WebTorrent === 'undefined') {
    console.error('WebTorrent not loaded');
  } else {
    client = new WebTorrent({
      tracker: {
        announce: [
          'wss://tracker.btorrent.xyz:443/announce',
          'wss://tracker.openwebtorrent.com:443/announce',
          'wss://tracker.files.fm:7073/announce',
          'wss://tracker.webtorrent.dev:443/announce'
        ]
      }
    });
    client.on('error', err => console.error('Client error:', err));
  }
} else {
  currentTorrent = { progress: 0, downloadSpeed: 0, uploadSpeed: 0, numPeers: 0 };
  window.torrentAPI.onTorrentAdded(data => { torrentFiles = data.files || []; showStatus('Načítavam metadáta...'); });
  window.torrentAPI.onTorrentReady(data => {
    torrentFiles = data.files || [];
    const vids = filterVideoFiles(torrentFiles);
    if (vids.length === 0) { showStatus('Žiadne video súbory', true); return; }
    if (vids.length === 1) playFileElectron(vids[0]);
    else {
      loadingOverlay.classList.add('hidden');
      videoModal.style.display = 'none';
      showFileList(vids);
    }
    startProgressUpdates();
  });
  window.torrentAPI.onTorrentError(msg => {
    connectionAttempts++;
    if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) showStatus(`Chyba, skúšam znovu... (${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`, true);
    else showStatus('Chyba: ' + msg, true);
  });
  window.torrentAPI.onTorrentWarning(msg => { if (msg && msg.includes('Unsupported tracker protocol')) return; });
  window.torrentAPI.onTorrentProgress(data => {
    if (currentTorrent) {
      currentTorrent.progress = data.progress;
      currentTorrent.downloadSpeed = data.downloadSpeed;
      currentTorrent.uploadSpeed = data.uploadSpeed;
      currentTorrent.numPeers = data.numPeers;
    }
  });
  window.torrentAPI.onTorrentDone(() => { torrentDownloaded = true; showStatus('Sťahovanie dokončené!'); checkAndShowSaveDialog(); });
}

// ============================================
// 4. TMDb API - Service Layer
// ============================================

async function fetchFromTMDB(endpoint, params = {}) {
  if (!TMDB_API_KEY) return null;
  const query = new URLSearchParams({ api_key: TMDB_API_KEY, language: 'sk', ...params });
  const url = `${TMDB_BASE}/${endpoint}?${query}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function fetchTMDB(query, type = 'movie') {
  if (!TMDB_API_KEY) return null;
  const endpoint = type === 'movie' ? 'search/movie' : 'search/tv';
  const data = await fetchFromTMDB(endpoint, { query: encodeURIComponent(query) });
  if (data && data.results && data.results.length > 0) return data.results[0];
  return null;
}

async function fetchTMDBMovie(title) { return fetchTMDB(title, 'movie'); }
async function fetchTMDBTV(title) { return fetchTMDB(title, 'tv'); }
async function fetchPopular() { return fetchFromTMDB('movie/popular'); }
async function fetchTrending(timeWindow = 'week') { return fetchFromTMDB(`trending/movie/${timeWindow}`); }
async function fetchTopRated() { return fetchFromTMDB('movie/top_rated'); }
async function fetchNowPlaying() { return fetchFromTMDB('movie/now_playing'); }
async function fetchUpcoming() { return fetchFromTMDB('movie/upcoming'); }
async function fetchRecommendations(movieId) { return fetchFromTMDB(`movie/${movieId}/recommendations`); }
async function fetchSimilar(movieId) { return fetchFromTMDB(`movie/${movieId}/similar`); }
async function fetchGenres() { return fetchFromTMDB('genre/movie/list'); }
async function fetchByGenre(genreId) { return fetchFromTMDB('discover/movie', { with_genres: genreId, sort_by: 'popularity.desc' }); }
async function fetchMovieDetails(movieId) { return fetchFromTMDB(`movie/${movieId}`); }
async function fetchMovieCredits(movieId) { return fetchFromTMDB(`movie/${movieId}/credits`); }
async function fetchTVDetails(tvId) { return fetchFromTMDB(`tv/${tvId}`); }
async function fetchTVCredits(tvId) { return fetchFromTMDB(`tv/${tvId}/credits`); }
async function fetchTVSeason(tvId, seasonNumber) { return fetchFromTMDB(`tv/${tvId}/season/${seasonNumber}`); }

function getPosterUrl(path, size = 'w200') {
  if (!path) return null;
  return `${TMDB_IMG}/${size}${path}`;
}

function getBackdropUrl(path) {
  if (!path) return null;
  return `${TMDB_IMG}/original${path}`;
}

function getYear(dateString) {
  if (!dateString) return '';
  return dateString.substring(0, 4);
}

// ============================================
// 5. OPENSUBTITLES API
// ============================================

async function searchSubtitles(query, year = '') {
  if (!OPENSUBTITLES_API_KEY) return [];
  try {
    const url = `${OPENSUBTITLES_BASE}/subtitles?query=${encodeURIComponent(query)}&languages=sk,cs,en&year=${year}&order_by=download_count&order_direction=desc&limit=10`;
    const res = await fetch(url, {
      headers: { 'Api-Key': OPENSUBTITLES_API_KEY, 'Content-Type': 'application/json', 'User-Agent': 'TorrentStream v1.0' }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.data || [];
  } catch { return []; }
}

async function downloadSubtitle(fileId) {
  if (!OPENSUBTITLES_API_KEY) return null;
  try {
    const res = await fetch(`${OPENSUBTITLES_BASE}/download`, {
      method: 'POST',
      headers: { 'Api-Key': OPENSUBTITLES_API_KEY, 'Content-Type': 'application/json', 'User-Agent': 'TorrentStream v1.0' },
      body: JSON.stringify({ file_id: fileId })
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.link) {
      const subRes = await fetch(data.link);
      return await subRes.text();
    }
    return null;
  } catch { return null; }
}

async function loadSubtitlesForVideo(title, year) {
  if (!OPENSUBTITLES_API_KEY) return;
  const subs = await searchSubtitles(title, year);
  currentSubtitles = subs;
  renderSubtitleMenu(subs);
}

function renderSubtitleMenu(subs) {
  if (!subtitleMenu) return;
  subtitleMenu.innerHTML = '';
  const off = document.createElement('button');
  off.className = 'subtitle-option';
  off.textContent = 'Vypnut titulky';
  off.addEventListener('click', () => { removeSubtitles(); subtitleMenu.style.display = 'none'; });
  subtitleMenu.appendChild(off);
  const nativeTracks = videoElement.textTracks ? Array.from(videoElement.textTracks) : [];
  nativeTracks.forEach((track, index) => {
    const btn = document.createElement('button');
    btn.className = 'subtitle-option';
    btn.textContent = `${getFlagEmoji(track.language || track.srclang || '')} ${track.label || `Titulky ${index + 1}`}`;
    if (track.mode === 'showing') btn.style.color = 'var(--accent)';
    btn.addEventListener('click', () => {
      nativeTracks.forEach(t => { t.mode = 'hidden'; });
      track.mode = 'showing';
      subtitleMenu.style.display = 'none';
    });
    subtitleMenu.appendChild(btn);
  });
  const externalSubs = Array.isArray(subs) ? subs : [];
  externalSubs.forEach(sub => {
    const btn = document.createElement('button');
    btn.className = 'subtitle-option';
    const lang = sub.attributes ? (sub.attributes.language || 'en') : 'en';
    const langName = sub.attributes ? (sub.attributes.language_name || 'Unknown') : 'Unknown';
    btn.textContent = `${getFlagEmoji(lang)} ${langName}`;
    btn.addEventListener('click', async () => {
      const content = await downloadSubtitle(sub.id);
      if (content) { applySubtitles(content); selectedSubtitle = sub; subtitleMenu.style.display = 'none'; showStatus(`Titulky: ${langName}`); }
      else { showStatus('Chyba načítania titulkov', true); }
    });
    subtitleMenu.appendChild(btn);
  });
  if (nativeTracks.length === 0 && externalSubs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'subtitle-option disabled';
    empty.textContent = 'Titulky nie su dostupne';
    subtitleMenu.appendChild(empty);
  }
}

function getFlagEmoji(lang) {
  const map = { 'sk': '🇸🇰', 'cs': '🇨🇿', 'en': '🇬🇧', 'de': '🇩🇪', 'fr': '🇫🇷', 'es': '🇪🇸', 'it': '🇮🇹', 'pl': '🇵🇱', 'hu': '🇭🇺' };
  return map[lang] || '🌐';
}

function applySubtitles(vttContent) {
  removeSubtitles();
  let vtt = vttContent;
  if (!vtt.trim().startsWith('WEBVTT')) vtt = 'WEBVTT\n\n' + vtt;
  const blob = new Blob([vtt], { type: 'text/vtt' });
  const url = URL.createObjectURL(blob);
  const track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = 'OpenSubtitles';
  track.srclang = 'sk';
  track.src = url;
  track.default = true;
  videoElement.appendChild(track);
  for (let i = 0; i < videoElement.textTracks.length; i++) videoElement.textTracks[i].mode = 'hidden';
  if (videoElement.textTracks.length > 0) videoElement.textTracks[videoElement.textTracks.length - 1].mode = 'showing';
}

function removeSubtitles() {
  if (videoElement.textTracks) Array.from(videoElement.textTracks).forEach(track => { track.mode = 'hidden'; });
  const tracks = videoElement.querySelectorAll('track');
  tracks.forEach(t => { const url = t.src; t.remove(); if (url) URL.revokeObjectURL(url); });
  selectedSubtitle = null;
}

// ============================================
// 6. LOCAL STORAGE - Favorites & Continue Watching
// ============================================

function getLocalData(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

function setLocalData(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); } catch {}
}

function getFavorites() { return getLocalData(FAVORITES_KEY); }

function addToFavorites(item) {
  let favs = getFavorites();
  if (!favs.some(f => f.id === item.id)) {
    favs.unshift({ id: item.id, title: item.title || item.name, poster_path: item.poster_path, media_type: item.media_type || 'movie', backdrop_path: item.backdrop_path, vote_average: item.vote_average, overview: item.overview, release_date: item.release_date || item.first_air_date });
    setLocalData(FAVORITES_KEY, favs);
    return true;
  }
  return false;
}

function removeFromFavorites(itemId) {
  let favs = getFavorites().filter(f => f.id !== itemId);
  setLocalData(FAVORITES_KEY, favs);
}

function isFavorite(itemId) {
  return getFavorites().some(f => f.id === itemId);
}

function getContinueWatching() { return getLocalData(CONTINUE_WATCHING_KEY); }

function addToContinueWatching(item, progress) {
  let cw = getContinueWatching().filter(c => c.id !== item.id);
  cw.unshift({ id: item.id, title: item.title || item.name, poster_path: item.poster_path, media_type: item.media_type || 'movie', backdrop_path: item.backdrop_path, progress: progress, last_played: Date.now() });
  if (cw.length > 20) cw = cw.slice(0, 20);
  setLocalData(CONTINUE_WATCHING_KEY, cw);
}

// ============================================
// 7. PIRATE BAY PROVIDER
// ============================================

async function searchPirateBay(query, category) {
  if (!query || query.trim().length < 2) return [];
  const now = Date.now();
  if (now - lastSearchTime < SEARCH_THROTTLE_MS) {
    await new Promise(r => setTimeout(r, SEARCH_THROTTLE_MS - (now - lastSearchTime)));
  }
  lastSearchTime = Date.now();
  const apiUrl = `https://apibay.org/q.php?q=${encodeURIComponent(query.trim())}&cat=${category}`;
  
  // Try direct fetch first (apibay.org may support CORS)
  try {
    const directRes = await fetch(apiUrl);
    if (directRes.ok) {
      const data = await directRes.json();
      if (!Array.isArray(data)) return [];
      return data.filter(item => item && item.name && item.info_hash && item.seeders !== undefined).slice(0, MAX_SEARCH_RESULTS);
    }
  } catch (e) {
    // Direct failed, try via proxy
  }
  
  // Fallback to CORS proxies
  const errors = [];
  const proxyAttempts = [
    CORS_PROXY_URL,
    LOCAL_PROXY_URL,
    ...PUBLIC_CORS_PROXIES
  ];
  // Remove duplicates
  const uniqueProxies = [...new Set(proxyAttempts)];
  for (const proxy of uniqueProxies) {
    try {
      let proxyUrl;
      if (proxy.endsWith('?')) {
        // corsproxy.io style: ?url
        proxyUrl = proxy + encodeURIComponent(apiUrl);
      } else if (proxy.endsWith('/')) {
        // local proxy style: /url
        proxyUrl = proxy + apiUrl;
      } else {
        proxyUrl = proxy + '/' + apiUrl;
      }
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.filter(item => item && item.name && item.info_hash && item.seeders !== undefined).slice(0, MAX_SEARCH_RESULTS);
      }
      errors.push(proxy + ': HTTP ' + res.status);
    } catch (err) { errors.push(proxy + ': ' + err.message); }
  }
  
  console.warn('All PirateBay proxies failed:', errors);
  return [];
}

function createMagnetLink(infoHash, name) {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.opentrackr.org:1337&tr=wss://tracker.btorrent.xyz:443/announce&tr=wss://tracker.openwebtorrent.com:443/announce`;
}

function addFromInfoHash(infoHash, name) {
  addTorrent(createMagnetLink(infoHash, name));
}

// ============================================
// 7b. CZ/SK DUBBING FILTER
// ============================================

function hasCZDubbing(title) {
  if (!title) return false;
  const upper = title.toUpperCase();
  return CZ_DUBBING_KEYWORDS.some(keyword => upper.includes(keyword.toUpperCase()));
}

function filterByCZDubbing(results) {
  if (!czDubbingOnly) return results;
  return results.filter(item => {
    if (item._provider === 'Sktorrent Online' || item.sourceType === 'online') return true;
    const title = item.title || item.name || item.originalName || '';
    return hasCZDubbing(title);
  });
}

// ============================================
// 7c. DEDUPLICATION
// ============================================

function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/[_-]/g, ' ')
    .replace(/[\(\)\[\]]/g, '')
    .replace(/\b(1080p|720p|2160p|4k|bluray|web-dl|webrip|hdrip|x264|x265|hevc|aac|dd5\.1|ac3|hdtv|dvdrip|brrip)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectQuality(title) {
  const value = String(title || '');
  const match = value.match(/\b(2160p|1080p|720p|480p|360p|4k|uhd|hdr|hd|sd)\b/i);
  if (!match) return '';
  return match[1].toUpperCase() === '4K' ? '4K' : match[1].toUpperCase();
}

function qualityRank(quality) {
  const q = String(quality || '').toLowerCase();
  if (q.includes('2160') || q.includes('4k') || q.includes('uhd')) return 5;
  if (q.includes('1080')) return 4;
  if (q.includes('720') || q === 'hd') return 3;
  if (q.includes('480')) return 2;
  if (q.includes('360') || q === 'sd') return 1;
  return 0;
}

function detectLanguageTag(title, language) {
  const haystack = `${title || ''} ${language || ''}`.toUpperCase();
  if (/\b(CZ\/SK|SK\/CZ|CZSK|CS)\b/.test(haystack)) return 'CZ/SK';
  if (/\b(CZ|CZECH|CESK|ČESK|DABING)\b/.test(haystack)) return 'CZ';
  if (/\b(SK|SLOVAK|SLOVENSK)\b/.test(haystack)) return 'SK';
  if (/\b(EN|ENG|ENGLISH)\b/.test(haystack)) return 'EN';
  return language && language !== 'NeznĂˇmy' && language !== 'Neznámy' ? language : '';
}

function detectContentType(title, category) {
  const value = String(title || '');
  if (/\bS\d{1,2}E\d{1,3}\b/i.test(value) || /\bE\d{1,3}\b/i.test(value)) return 'epizóda';
  if (/\bS\d{1,2}\b/i.test(value) || /season|sezona|séria|serie/i.test(value)) return 'seriál';
  if (category === '208') return 'seriál';
  return 'film';
}

function getComparableSize(size) {
  if (typeof size === 'number') return size;
  const text = String(size || '').replace(',', '.');
  const match = text.match(/([\d.]+)\s*(TB|GB|MB|KB|B)/i);
  if (!match) return Number(size) || 0;
  const value = Number(match[1]) || 0;
  const unit = match[2].toUpperCase();
  const map = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return value * (map[unit] || 1);
}

function normalizeSearchResult(item, category = categorySelect?.value || '200') {
  const rawTitle = item.title || item.name || item.originalName || '';
  const quality = item.quality && item.quality !== 'NeznĂˇma' ? item.quality : detectQuality(rawTitle);
  const languageTag = detectLanguageTag(rawTitle, item.language);
  const source = item._provider || item.provider || item.source || 'Unknown';
  const seeders = Number(item.seeders ?? item.peers ?? item.downloads ?? 0) || 0;
  const normalized = {
    ...item,
    title: rawTitle,
    name: item.name || rawTitle,
    originalName: item.originalName || rawTitle,
    source,
    quality: quality || 'N/A',
    languageTag,
    contentType: item.contentType || detectContentType(rawTitle, category),
    seeders,
    peers: Number(item.peers ?? item.leechers ?? seeders) || 0,
    size: getComparableSize(item.size),
    sizeText: item.sizeText || (typeof item.size === 'string' ? item.size : ''),
    _provider: source,
    _providerBadge: item._providerBadge || source,
    _type: item._type || (item.info_hash ? 'torrent' : item.sourceType === 'public-domain' ? 'torrent-url' : 'direct'),
    _dedupeKey: normalizeTitle(rawTitle).replace(/\b(s\d{1,2}e\d{1,3})\b/i, '$1')
  };
  normalized._sort = {
    local: languageTag === 'CZ/SK' || languageTag === 'CZ' || languageTag === 'SK' || hasCZDubbing(rawTitle) ? 1 : 0,
    quality: qualityRank(normalized.quality),
    seeders: normalized.seeders
  };
  return normalized;
}

function compareSearchResults(a, b) {
  if ((b._sort?.local || 0) !== (a._sort?.local || 0)) return (b._sort?.local || 0) - (a._sort?.local || 0);
  if ((b._sort?.quality || 0) !== (a._sort?.quality || 0)) return (b._sort?.quality || 0) - (a._sort?.quality || 0);
  return (b._sort?.seeders || 0) - (a._sort?.seeders || 0);
}

function deduplicateResults(results) {
  const seen = new Map();
  const deduped = [];
  results.forEach(item => {
    item = normalizeSearchResult(item);
    const normalized = item._dedupeKey || normalizeTitle(item.title || item.name || item.originalName || '');
    if (!normalized) return;
    if (seen.has(normalized)) {
      const existing = seen.get(normalized);
      if (!existing.sources) existing.sources = [existing._provider || 'Unknown'];
      const provider = item._provider || 'Unknown';
      if (!existing.sources.includes(provider)) existing.sources.push(provider);
      if (compareSearchResults(item, existing) < 0) {
        existing.seeders = item.seeders;
        existing.leechers = item.leechers;
        existing.peers = item.peers;
        existing.size = item.size;
        existing.sizeText = item.sizeText;
        existing.info_hash = item.info_hash || existing.info_hash;
        existing.url = item.url || existing.url;
        existing.ident = item.ident || existing.ident;
        existing.detailUrl = item.detailUrl || existing.detailUrl;
        existing._type = item._type || existing._type;
        existing.quality = item.quality || existing.quality;
        existing.languageTag = item.languageTag || existing.languageTag;
        existing.contentType = item.contentType || existing.contentType;
        existing._sort = item._sort || existing._sort;
      }
    } else {
      item.sources = [item._provider || 'Unknown'];
      seen.set(normalized, item);
      deduped.push(item);
    }
  });
  return deduped.sort(compareSearchResults);
}

// ============================================
// 7d. SEARCH - MAIN FUNCTION
// ============================================

async function performSearch() {
  const query = searchInput.value.trim();
  if (query.length < 2) { showStatus('Zadajte aspoň 2 znaky', true); return; }
  const category = categorySelect.value;
  currentPage = 0;
  searchResultsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary)"><div class="spinner"></div><p style="margin-top:0.5rem">Vyhľadávam...</p></div>';
  resultsSection.style.display = 'block';
  resultsTitle.textContent = `Výsledky pre "${query}"`;
  if (browseRows) browseRows.style.display = 'none';
  try {
    const [pirateResults, sktorrentResults, skonlineResults, webshareResults, publicResults] = await Promise.all([
      (async () => { try { return await searchPirateBay(query, category); } catch(e) { console.warn('PirateBay error:', e.message); return []; } })(),
      (async () => { try { return typeof SktorrentProvider !== 'undefined' ? await SktorrentProvider.search(query) : []; } catch(e) { console.warn('Sktorrent error:', e.message); return []; } })(),
      (async () => { 
        try { 
          // Použije SktorrentOnlineProvider ak je inicializovaný, inak skúsi starý SktorrentProvider.searchOnline
          if (typeof skonlineProvider !== 'undefined' && skonlineProvider && skonlineProvider.isLoggedIn()) {
            const onlineResults = await skonlineProvider.search(query);
            return onlineResults.map(r => ({ ...r, provider: 'Sktorrent Online' }));
          }
          // Fallback: skúsime starý SktorrentProvider.searchOnline
          if (typeof SktorrentProvider !== 'undefined' && SktorrentProvider.searchOnline) {
            const onlineFallback = await SktorrentProvider.searchOnline(query);
            return onlineFallback.map(r => ({ ...r, provider: 'Sktorrent Online' }));
          }
          return [];
        } catch(e) { 
          console.warn('SktorrentOnline error:', e.message); 
          return []; 
        }
      })(),
      (async () => { try { return typeof WebshareProvider !== 'undefined' ? await WebshareProvider.search(query) : []; } catch(e) { console.warn('Webshare error:', e.message); return []; } })(),
      (async () => { try { return typeof PublicDomainProvider !== 'undefined' ? await PublicDomainProvider.search(query) : []; } catch(e) { console.warn('PublicDomain error:', e.message); return []; } })()
    ]);
    const enrichedPirate = await Promise.all(pirateResults.map(async item => {
      let cleanTitle = item.name.replace(/\./g, ' ').replace(/[_-]/g, ' ').replace(/\d{4}.*$/, '').replace(/(1080p|720p|2160p|4K|BluRay|WEB-DL|WEBRip|HDRip|x264|x265|HEVC|AAC|DD5\.1|AC3).*/i, '').trim();
      let tmdb = null;
      if (TMDB_API_KEY) { tmdb = await fetchTMDBMovie(cleanTitle); if (!tmdb) tmdb = await fetchTMDBTV(cleanTitle); }
      return { ...item, tmdb, title: tmdb ? (tmdb.title || tmdb.name) : item.name, year: tmdb ? (tmdb.release_date || tmdb.first_air_date || '').substring(0, 4) : '', rating: tmdb ? tmdb.vote_average : null, overview: tmdb ? tmdb.overview : '', posterUrl: getPosterUrl(tmdb ? tmdb.poster_path : null), backdropUrl: getBackdropUrl(tmdb ? tmdb.backdrop_path : null), _provider: 'PirateBay', _providerBadge: '🏴', _type: 'torrent' };
    }));
    const enrichedSktorrent = sktorrentResults.map(item => ({ ...item, title: item.title || item.originalName, seeders: item.seeders || 0, leechers: item.leechers || 0, size: item.size || 0, _provider: item.provider || 'Sktorrent', _providerBadge: item.flag || '🇨🇿', _type: item.sourceType === 'online' ? 'direct' : 'torrent' }));
    const enrichedWebshare = webshareResults.map(item => ({ ...item, _provider: 'Webshare', _providerBadge: 'WS', _type: 'direct' }));
    const enrichedPublic = publicResults.map(item => ({ ...item, _provider: 'Free / Public domain', _providerBadge: 'FREE', _type: 'torrent-url' }));
    const allResults = [...enrichedPirate, ...enrichedSktorrent, ...skonlineResults, ...enrichedWebshare, ...enrichedPublic];
    const deduped = deduplicateResults(allResults);
    const filtered = filterByCZDubbing(deduped);
    currentSearchResults = filtered;
    displaySearchResults(filtered);
    if (filtered.length > 0) {
      const sourceCounts = [];
      if (enrichedPirate.length > 0) sourceCounts.push(`${enrichedPirate.length}x PirateBay`);
      if (enrichedSktorrent.length > 0) sourceCounts.push(`${enrichedSktorrent.length}x Sktorrent`);
      if (enrichedWebshare.length > 0) sourceCounts.push(`${enrichedWebshare.length}x Webshare`);
      if (enrichedPublic.length > 0) sourceCounts.push(`${enrichedPublic.length}x Free/Public`);
      showStatus(`Nájdené: ${sourceCounts.join(', ')}`);
      saveSearchHistory(query);
    } else { showStatus('Žiadne výsledky', true); }
  } catch (err) {
    console.error('Search error:', err);
    searchResultsEl.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--accent)">Chyba: ${err.message}</div>`;
    showStatus('Chyba vyhľadávania', true);
  }
}

// ============================================
// 7e. DISPLAY SEARCH RESULTS
// ============================================

function displaySearchResults(results) {
  searchResultsEl.innerHTML = '';
  let filteredResults = results;
  if (currentSourceFilter !== 'all') {
    filteredResults = results.filter(item => {
      const provider = (item._provider || '').toLowerCase();
      return provider.includes(currentSourceFilter);
    });
  }
  if (filteredResults.length === 0) {
    searchResultsEl.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary)">Žiadne výsledky</div>';
    return;
  }
  const endIdx = (currentPage + 1) * RESULTS_PER_PAGE;
  const pageResults = filteredResults.slice(0, endIdx);
  renderSourceTabs(results);
  renderViewToggle();
  if (currentViewMode === 'grid') { searchResultsEl.className = 'results-grid'; }
  else { searchResultsEl.className = 'results-list'; }
  pageResults.forEach(item => { const card = createResultCard(item); searchResultsEl.appendChild(card); });
  if (endIdx < filteredResults.length) {
    const loadMore = document.createElement('div');
    loadMore.style.cssText = 'grid-column:1/-1;text-align:center;padding:1rem;';
    const btn = document.createElement('button');
    btn.className = 'btn btn-info';
    btn.textContent = `Načítať ďalších ${RESULTS_PER_PAGE}`;
    btn.addEventListener('click', () => { currentPage++; displaySearchResults(results); });
    loadMore.appendChild(btn);
    searchResultsEl.appendChild(loadMore);
  }
}

function renderSourceTabs(results) {
  const existingTabs = document.querySelector('.source-filter-tabs');
  if (existingTabs) existingTabs.remove();
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'source-filter-tabs';
  tabsContainer.style.cssText = 'display:flex;gap:0.5rem;margin-bottom:1rem;flex-wrap:wrap;';
  const sources = [
    { id: 'all', label: 'Všetky' },
    { id: 'piratebay', label: 'Pirate Bay' },
    { id: 'sktorrent', label: 'SkTorrent' },
    { id: 'webshare', label: 'Webshare' },
    { id: 'free', label: 'Free / Public domain' }
  ];
  sources.forEach(source => {
    const btn = document.createElement('button');
    btn.className = 'source-filter-btn';
    btn.textContent = source.label;
    btn.dataset.source = source.id;
    if (currentSourceFilter === source.id) {
      btn.style.cssText = 'background:var(--accent);color:white;border:none;padding:0.4rem 1rem;border-radius:4px;cursor:pointer;font-size:0.85rem;font-weight:600;';
    } else {
      btn.style.cssText = 'background:var(--bg-card);color:var(--text-secondary);border:1px solid var(--border);padding:0.4rem 1rem;border-radius:4px;cursor:pointer;font-size:0.85rem;transition:all 0.2s;';
    }
    btn.addEventListener('click', () => { currentSourceFilter = source.id; currentPage = 0; displaySearchResults(results); });
    tabsContainer.appendChild(btn);
  });
  const sectionHeader = document.querySelector('.section-header');
  if (sectionHeader) sectionHeader.after(tabsContainer);
}

function renderViewToggle() {
  const existingToggle = document.querySelector('.view-toggle');
  if (existingToggle) existingToggle.remove();
  const toggle = document.createElement('div');
  toggle.className = 'view-toggle';
  toggle.style.cssText = 'display:flex;gap:0.3rem;margin-bottom:0.5rem;';
  const gridBtn = document.createElement('button');
  gridBtn.innerHTML = '▦';
  gridBtn.title = 'Zobrazenie dlaždice';
  gridBtn.style.cssText = `background:${currentViewMode === 'grid' ? 'var(--accent)' : 'var(--bg-card)'};color:white;border:none;padding:0.3rem 0.6rem;border-radius:3px;cursor:pointer;font-size:1rem;`;
  gridBtn.addEventListener('click', () => { currentViewMode = 'grid'; displaySearchResults(currentSearchResults); });
  const listBtn = document.createElement('button');
  listBtn.innerHTML = '☰';
  listBtn.title = 'Zobrazenie zoznam';
  listBtn.style.cssText = `background:${currentViewMode === 'list' ? 'var(--accent)' : 'var(--bg-card)'};color:white;border:none;padding:0.3rem 0.6rem;border-radius:3px;cursor:pointer;font-size:1rem;`;
  listBtn.addEventListener('click', () => { currentViewMode = 'list'; displaySearchResults(currentSearchResults); });
  toggle.appendChild(gridBtn);
  toggle.appendChild(listBtn);
  const tabsContainer = document.querySelector('.source-filter-tabs');
  if (tabsContainer) tabsContainer.after(toggle);
}

function createResultCard(item) {
  const card = document.createElement('div');
  card.className = 'result-card';
  const providerBadge = document.createElement('div');
  providerBadge.className = 'provider-badge';
  if (item._providerBadge) providerBadge.textContent = item._providerBadge + ' ' + (item._provider || '');
  else providerBadge.textContent = item._provider || '';
  if (item._provider === 'Sktorrent Online' || item._provider === 'Sktorrent Tracker') providerBadge.style.background = 'var(--success)';
  if (item.language && item.language !== 'Neznámy') providerBadge.textContent += ' · ' + item.language;
  card.appendChild(providerBadge);
  if (item.sources && item.sources.length > 1) {
    const sourcesRow = document.createElement('div');
    sourcesRow.style.cssText = 'position:absolute;top:28px;left:6px;z-index:5;display:flex;gap:2px;';
    item.sources.forEach(src => {
      const icon = document.createElement('span');
      icon.style.cssText = 'background:rgba(0,0,0,0.7);color:white;font-size:0.6rem;padding:0.1rem 0.3rem;border-radius:2px;';
      icon.textContent = src === 'PirateBay' ? '🏴' : src === 'Sktorrent Online' || src === 'Sktorrent Tracker' ? '🇨🇿' : '☁️';
      sourcesRow.appendChild(icon);
    });
    card.appendChild(sourcesRow);
  }
  if (item.posterUrl) { const img = document.createElement('img'); img.className = 'result-poster'; img.src = item.posterUrl; img.alt = item.title; img.loading = 'lazy'; card.appendChild(img); }
  else { const placeholder = document.createElement('div'); placeholder.className = 'result-poster-placeholder'; placeholder.textContent = '🎬'; card.appendChild(placeholder); }
  const info = document.createElement('div'); info.className = 'result-info';
  const name = document.createElement('div'); name.className = 'result-name'; name.textContent = item.title || item.name; info.appendChild(name);
  const meta = document.createElement('div'); meta.className = 'result-meta';
  if (item.rating) { const rating = document.createElement('span'); rating.className = 'result-rating'; rating.textContent = '★ ' + item.rating.toFixed(1); meta.appendChild(rating); }
  if (item.year) { const year = document.createElement('span'); year.className = 'result-year'; year.textContent = item.year; meta.appendChild(year); }
  if (item.seeders !== undefined) { const seeders = document.createElement('span'); seeders.className = 'result-badge badge-seeders'; seeders.textContent = '▲ ' + (item.seeders || 0); meta.appendChild(seeders); }
  if (item.leechers !== undefined) { const leechers = document.createElement('span'); leechers.className = 'result-badge badge-leechers'; leechers.textContent = '▼ ' + (item.leechers || 0); meta.appendChild(leechers); }
  const size = document.createElement('span'); size.textContent = formatBytes(parseInt(item.size) || 0); meta.appendChild(size);
  if (item.quality) { const quality = document.createElement('span'); quality.className = 'result-badge'; quality.textContent = item.quality; meta.appendChild(quality); }
  info.appendChild(meta); card.appendChild(info);
  const overlay = document.createElement('div'); overlay.className = 'result-overlay';
  const playBtn = document.createElement('button'); playBtn.className = 'result-overlay-btn'; playBtn.textContent = '▶ Prehrať';
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (item._type === 'direct') {
      if (item.sourceType === 'online') {
        const provider = skonlineProvider || (typeof SktorrentProvider !== 'undefined' ? SktorrentProvider : null);
        const stream = provider && provider.getStream ? await provider.getStream(item) : null;
        if (stream && stream.url) { playDirectStream(stream.url, item.title || item.name); }
        else showStatus('Nepodarilo sa získať stream', true);
      } else if (typeof WebshareProvider !== 'undefined' && item.sourceType === 'webshare') {
        const stream = await WebshareProvider.getStream(item);
        if (stream && stream.url) { playDirectStream(stream.url, item.title || item.name); }
        else showStatus('Nepodarilo sa získať stream', true);
      } else {
        showStatus('Nepodporovaný typ zdroja', true);
      }
    } else if (item._type === 'torrent' && item.info_hash) {
      addFromInfoHash(item.info_hash, item.name);
    } else if (item.sourceType === 'tracker' && item.detailUrl) {
      if (typeof SktorrentProvider !== 'undefined') {
        const stream = await SktorrentProvider.getStream(item);
        if (stream && stream.url && stream.type === 'magnet') {
          addTorrent(stream.url);
        } else showStatus('Nepodarilo sa získať magnet link z trackeru', true);
      }
    } else {
      showStatus('Nepodporovaný typ zdroja', true);
    }
  });
  overlay.appendChild(playBtn);

  // Magnet button for torrents
  if (item._type === 'torrent' && item.info_hash) {
    const magnetBtn = document.createElement('button');
    magnetBtn.className = 'result-overlay-btn-small';
    magnetBtn.textContent = '🔗 Magnet';
    magnetBtn.addEventListener('click', (e) => { e.stopPropagation(); copyMagnet(item.info_hash, item.name); });
    overlay.appendChild(magnetBtn);
  }

  // Detail button
  const detailBtn = document.createElement('button');
  detailBtn.className = 'result-overlay-btn-small';
  detailBtn.textContent = 'ℹ Detail';
  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailModal(item);
  });
  overlay.appendChild(detailBtn);

  card.appendChild(overlay);
  card.addEventListener('click', () => playBtn.click());
  return card;
}

function createResultCardClean(item) {
  const card = document.createElement('div');
  card.className = 'result-card';
  const providerBadge = document.createElement('div');
  providerBadge.className = 'provider-badge';
  providerBadge.textContent = `${item._providerBadge || ''} ${item._provider || item.source || ''}`.trim();
  if (item._provider === 'Sktorrent Online' || item._provider === 'Sktorrent Tracker' || item.legal) providerBadge.style.background = 'var(--success)';
  if (item.languageTag) providerBadge.textContent += ' · ' + item.languageTag;
  card.appendChild(providerBadge);

  if (item.posterUrl) {
    const img = document.createElement('img');
    img.className = 'result-poster';
    img.src = item.posterUrl;
    img.alt = item.title;
    img.loading = 'lazy';
    card.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'result-poster-placeholder';
    placeholder.textContent = 'Video';
    card.appendChild(placeholder);
  }

  const info = document.createElement('div');
  info.className = 'result-info';
  const name = document.createElement('div');
  name.className = 'result-name';
  name.textContent = item.title || item.name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'result-meta';
  const addMeta = (text, className = 'result-badge') => {
    if (!text && text !== 0) return;
    const span = document.createElement('span');
    span.className = className;
    span.textContent = text;
    meta.appendChild(span);
  };
  if (item.rating) addMeta('* ' + item.rating.toFixed(1), 'result-rating');
  addMeta(item.year, 'result-year');
  addMeta(item.contentType);
  addMeta(item.languageTag);
  if (item.quality && item.quality !== 'N/A') addMeta(item.quality);
  if (item.seeders !== undefined) addMeta('seed ' + (item.seeders || 0), 'result-badge badge-seeders');
  if (item.peers !== undefined && item.peers !== item.seeders) addMeta('peers ' + (item.peers || 0), 'result-badge badge-leechers');
  if (item.size) addMeta(item.sizeText || formatBytes(item.size), '');
  info.appendChild(meta);
  card.appendChild(info);

  const overlay = document.createElement('div');
  overlay.className = 'result-overlay';
  const playBtn = document.createElement('button');
  playBtn.className = 'result-overlay-btn';
  playBtn.textContent = 'Prehrat';
  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await playStreamResult(item);
  });
  overlay.appendChild(playBtn);

  if (item._type === 'torrent' && item.info_hash) {
    const magnetBtn = document.createElement('button');
    magnetBtn.className = 'result-overlay-btn-small';
    magnetBtn.textContent = 'Magnet';
    magnetBtn.addEventListener('click', (e) => { e.stopPropagation(); copyMagnet(item.info_hash, item.name); });
    overlay.appendChild(magnetBtn);
  }

  const detailBtn = document.createElement('button');
  detailBtn.className = 'result-overlay-btn-small';
  detailBtn.textContent = 'Detail';
  detailBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailModal(item);
  });
  overlay.appendChild(detailBtn);
  card.appendChild(overlay);
  card.addEventListener('click', () => playBtn.click());
  return card;
}

createResultCard = createResultCardClean;

async function copyMagnet(infoHash, name) {
  const magnet = createMagnetLink(infoHash, name);
  try { await navigator.clipboard.writeText(magnet); showStatus('Magnet skopírovaný'); }
  catch { const ta = document.createElement('textarea'); ta.value = magnet; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); showStatus('Magnet skopírovaný'); }
}

// ============================================
// 8. SEARCH HISTORY
// ============================================

function loadSearchHistory() {
  try { return JSON.parse(localStorage.getItem(SEARCH_HISTORY_KEY) || '[]'); } catch { return []; }
}

function saveSearchHistory(query) {
  try { let h = loadSearchHistory().filter(i => i.toLowerCase() !== query.toLowerCase()); h.unshift(query); if (h.length > MAX_SEARCH_HISTORY) h = h.slice(0, MAX_SEARCH_HISTORY); localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(h)); } catch {}
}

// ============================================
// 9. HERO BANNER
// ============================================

function updateHero(item) {
  heroMovie = item;
  if (item.backdropUrl) { heroBackdrop.style.backgroundImage = `url(${item.backdropUrl})`; }
  else { heroBackdrop.style.backgroundImage = 'none'; heroBackdrop.style.background = 'linear-gradient(135deg, #141414 0%, #222 100%)'; }
  heroTitle.textContent = item.title || item.name;
  heroYear.textContent = item.year || '';
  heroRating.textContent = item.rating ? '★ ' + item.rating.toFixed(1) : '';
  heroOverview.textContent = item.overview || 'Streamujte torrenty priamo vo vašom prehliadači. Vyhľadávajte, prehrávajte a užívajte si.';
  heroPlayBtn.onclick = async () => {
    if (item.info_hash) { addFromInfoHash(item.info_hash, item.name); return; }
    openDetailModal(item);
  };
  heroInfoBtn.onclick = async () => {
    openDetailModal(item);
  };
}

// ============================================
// 10. TORRENT MANAGEMENT
// ============================================

function isValidMagnetLink(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'magnet:') return false;
    return url.searchParams.getAll('xt').some(xt => /^urn:btih:([a-f0-9]{40}|[a-z2-7]{32})$/i.test(xt));
  } catch {
    return false;
  }
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

async function addTorrent(torrent) {
  if (torrent instanceof File && !torrent.name.toLowerCase().endsWith('.torrent')) {
    showStatus('Neplatny .torrent subor', true);
    return false;
  }

  if (typeof torrent === 'string') {
    torrent = torrent.trim();
    if (torrent.startsWith('magnet:?') && !isValidMagnetLink(torrent)) {
      showStatus('Neplatny magnet link', true);
      return false;
    }
    if (!torrent.startsWith('magnet:?') && !isValidHttpUrl(torrent)) {
      showStatus('Neplatna URL', true);
      return false;
    }
  }

  torrentDownloaded = false; videoEnded = false; currentPlayingFile = null; hideSaveDialog(); closePopout();
  if (currentTorrent && !isElectron) {
    if (currentTorrent.destroy) currentTorrent.destroy();
    currentTorrent = null;
  }
  resetUI(); connectionAttempts = 0; showStatus('Pripajam sa...');

  try {
    if (isElectron) {
      let result = null;
      if (torrent instanceof File) {
        const buffer = await torrent.arrayBuffer();
        result = await window.torrentAPI.addTorrentBuffer(new Uint8Array(buffer));
      } else if (typeof torrent === 'string' && torrent.startsWith('magnet:?')) {
        result = await window.torrentAPI.addTorrentMagnet(torrent);
      } else if (typeof torrent === 'string') {
        const response = await fetch(torrent);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const buffer = await response.arrayBuffer();
        result = await window.torrentAPI.addTorrentBuffer(new Uint8Array(buffer));
      }

      if (result && result.duplicate) {
        loadingOverlay.classList.add('hidden');
        videoModal.style.display = 'none';
        showStatus('Torrent uz je pridany');
        return true;
      }
      if (result && result.error) throw new Error(result.error);
      currentTorrent = { progress: 0, downloadSpeed: 0, uploadSpeed: 0, numPeers: 0 };
      return true;
    }

    client.add(torrent, onTorrentAdded);
    return true;
  } catch (err) {
    loadingOverlay.classList.add('hidden');
    videoModal.style.display = 'none';
    showStatus('Chyba: ' + err.message, true);
    return false;
  }
}

function onTorrentAdded(torrent) {
  currentTorrent = torrent;
  torrent.on('error', err => { connectionAttempts++; if (connectionAttempts < MAX_CONNECTION_ATTEMPTS) showStatus(`Chyba, skúšam znovu... (${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})`, true); else showStatus('Chyba: ' + err.message, true); });
  torrent.on('warning', msg => { if (msg && msg.includes('Unsupported tracker protocol')) return; });
  torrent.on('ready', () => {
    connectionAttempts = 0;
    const vids = filterVideoFiles(torrent.files);
    if (vids.length === 0) { showStatus('Ziadne video subory', true); return; }
    if (vids.length === 1) playFile(vids[0]);
    else {
      loadingOverlay.classList.add('hidden');
      videoModal.style.display = 'none';
      showFileList(vids);
    }
    startProgressUpdates();
  });
  torrent.on('done', () => { torrentDownloaded = true; showStatus('Sťahovanie dokončené!'); checkAndShowSaveDialog(); });
}

function filterVideoFiles(files) {
  const exts = ['.mp4', '.webm', '.mkv', '.avi', '.mov'];
  return files
    .filter(f => exts.includes(f.name.substring(f.name.lastIndexOf('.')).toLowerCase()))
    .sort(compareVideoFiles);
}

function getEpisodeSortKey(name) {
  const clean = (name || '').toLowerCase();
  const seasonEpisode = clean.match(/s(\d{1,2})\s*e(\d{1,3})/i);
  if (seasonEpisode) return { season: Number(seasonEpisode[1]), episode: Number(seasonEpisode[2]) };
  const episode = clean.match(/(?:^|[^\d])(?:ep|e|episode|cast|diel)?\s*(\d{1,3})(?:[^\d]|$)/i);
  return { season: 0, episode: episode ? Number(episode[1]) : 0 };
}

function compareVideoFiles(a, b) {
  const aKey = getEpisodeSortKey(a.name || a.path || '');
  const bKey = getEpisodeSortKey(b.name || b.path || '');
  if (aKey.season !== bKey.season) return aKey.season - bKey.season;
  if (aKey.episode !== bKey.episode) return aKey.episode - bKey.episode;
  return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
}

function playFile(file) {
  currentPlayingFile = file; videoModal.style.display = 'flex'; loadingOverlay.classList.remove('hidden'); videoModalTitle.textContent = file.name;
  try { file.renderTo(videoElement, { autoplay: true }, () => {}); } catch (err) { console.error('renderTo error:', err); }
  showStatus('Sťahovanie... 0% · 0 B/s'); detectAudioTracks(); tryLoadSubtitles(file.name);
}

async function playFileElectron(file) {
  currentPlayingFile = file; videoModal.style.display = 'flex'; loadingOverlay.classList.remove('hidden'); videoModalTitle.textContent = file.name;
  const result = await window.torrentAPI.getFileStream(file.index || 0);
  if (result.error) { showStatus('Chyba streamu: ' + result.error, true); return; }
  videoElement.src = result.url; videoElement.play().catch(() => {}); showStatus('Sťahovanie... 0% · 0 B/s'); detectAudioTracks(); tryLoadSubtitles(file.name);
}

function showFileList(files) {
  fileList.innerHTML = '';
  files.forEach((file, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'file-name'; name.textContent = file.name;
    const btn = document.createElement('button'); btn.textContent = 'Prehrať';
    btn.addEventListener('click', () => { fileModal.style.display = 'none'; if (isElectron) playFileElectron(file); else playFile(file); });
    li.appendChild(name); li.appendChild(btn); fileList.appendChild(li);
  });
  fileModal.style.display = 'flex';
}

function startProgressUpdates() { clearInterval(progressInterval); progressInterval = setInterval(updateProgress, 500); }

function updateProgress() {
  if (!currentTorrent) return;
  const pct = currentTorrent.progress * 100;
  progressBar.style.width = pct + '%'; statusBar.style.display = 'flex';
  const speed = formatBytes(currentTorrent.downloadSpeed) + '/s'; const peers = currentTorrent.numPeers;
  showStatus(`Sťahovanie ${pct.toFixed(1)}% · ${speed} · ${peers} peerov`);
  if (pct >= 100) showStatus('Sťahovanie dokončené');
}

// ============================================
// 11. AUDIO TRACKS
// ============================================

function detectAudioTracks() {
  currentAudioTracks = [];
  if (videoElement.audioTracks && videoElement.audioTracks.length > 0) {
    for (let i = 0; i < videoElement.audioTracks.length; i++) {
      const track = videoElement.audioTracks[i];
      currentAudioTracks.push({ index: i, label: track.label || `Stopa ${i + 1}`, language: track.language || 'unknown', enabled: track.enabled });
    }
  }
  renderAudioTrackMenu();
}

function renderAudioTrackMenu() {
  if (!audioTrackMenu) return;
  audioTrackMenu.innerHTML = '';
  if (currentAudioTracks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'subtitle-option disabled';
    empty.textContent = 'Audio stopy nie su dostupne';
    audioTrackMenu.appendChild(empty);
    return;
  }
  currentAudioTracks.forEach((track, i) => {
    const btn = document.createElement('button'); btn.className = 'subtitle-option';
    btn.textContent = `${getFlagEmoji(track.language)} ${track.label}`;
    if (track.enabled) btn.style.color = 'var(--accent)';
    btn.addEventListener('click', () => { for (let j = 0; j < videoElement.audioTracks.length; j++) videoElement.audioTracks[j].enabled = j === i; selectedAudioTrack = i; audioTrackMenu.style.display = 'none'; showStatus(`Audio: ${track.label}`); });
    audioTrackMenu.appendChild(btn);
  });
}

// ============================================
// 12. SUBTITLES AUTO-LOAD
// ============================================

async function tryLoadSubtitles(fileName) {
  if (!OPENSUBTITLES_API_KEY) return;
  let name = fileName.replace(/\.(mp4|webm|mkv|avi|mov)$/i, '').replace(/\./g, ' ').replace(/[_-]/g, ' ').replace(/(1080p|720p|2160p|4K|BluRay|WEB-DL|WEBRip|HDRip|x264|x265|HEVC|AAC|DD5\.1|AC3).*/i, '').trim();
  const yearMatch = name.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : '';
  if (year) name = name.replace(/\b(19\d{2}|20\d{2})\b/, '').trim();
  const subs = await searchSubtitles(name, year);
  currentSubtitles = subs; renderSubtitleMenu(subs);
  if (subs.length > 0) showStatus(`Nájdené titulky (${subs.length})`);
}

// ============================================
// 13. VIDEO CONTROLS
// ============================================

playPauseBtn.addEventListener('click', () => { if (videoElement.paused) videoElement.play().catch(() => {}); else videoElement.pause(); });
progressSlider.addEventListener('input', () => { if (videoElement.duration) videoElement.currentTime = (progressSlider.value / 100) * videoElement.duration; });
if (seekBackBtn) seekBackBtn.addEventListener('click', () => seekVideoBy(-15));
if (seekForwardBtn) seekForwardBtn.addEventListener('click', () => seekVideoBy(15));
volumeBtn.addEventListener('click', () => { videoElement.muted = !videoElement.muted; updateVolumeIcon(); });
volumeSlider.addEventListener('input', () => { const vol = volumeSlider.value / 100; videoElement.volume = vol; videoElement.muted = vol === 0; updateVolumeIcon(); });

function seekVideoBy(seconds) {
  if (!videoElement.duration || !isFinite(videoElement.duration)) return;
  videoElement.currentTime = Math.max(0, Math.min(videoElement.duration, videoElement.currentTime + seconds));
}

fullscreenBtn.addEventListener('click', () => {
  const container = videoModal.querySelector('.video-modal-content') || videoElement;
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) container.requestFullscreen().catch(() => {});
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
    else if (container.msRequestFullscreen) container.msRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
    else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    else if (document.msExitFullscreen) document.msExitFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  const controls = document.querySelector('.video-controls');
  if (controls) {
    controls.style.opacity = '1';
    if (document.fullscreenElement) { clearTimeout(window.controlsTimeout); window.controlsTimeout = setTimeout(() => { if (document.fullscreenElement && !videoElement.paused) controls.style.opacity = '0'; }, 3000); }
    else controls.style.opacity = '1';
  }
});

document.addEventListener('mousemove', () => {
  const controls = document.querySelector('.video-controls');
  if (controls && document.fullscreenElement) { controls.style.opacity = '1'; clearTimeout(window.controlsTimeout); window.controlsTimeout = setTimeout(() => { if (document.fullscreenElement && !videoElement.paused) controls.style.opacity = '0'; }, 3000); }
});

stopBtn.addEventListener('click', stopStream);

// ============================================
// 14. POPOUT PLAYER
// ============================================

function openPopoutPlayer() {
  const src = videoElement.currentSrc || videoElement.src;
  if (!src) return;
  if (popoutWindow && !popoutWindow.closed) { popoutWindow.focus(); return; }
  videoElement.pause();
  popoutWindow = window.open('', 'popout-player', 'width=960,height=620,menubar=no,toolbar=no,location=no,status=no');
  if (!popoutWindow) { alert('Povorte vyskakovacie okná pre automatické otvorenie prehrávača.'); return; }
  const currentTime = videoElement.currentTime || 0;
  const title = videoModalTitle.textContent || 'TorrentStream';
  popoutWindow.document.write('<!DOCTYPE html><html><head><title>' + title + ' - TorrentStream</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;flex-direction:column;height:100vh;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Oxygen,Ubuntu,sans-serif;user-select:none}.video-wrap{flex:1;display:flex;align-items:center;justify-content:center;background:#000;position:relative}video{width:100%;height:100%;object-fit:contain}.controls{display:flex;align-items:center;gap:8px;padding:8px 14px;background:#181818;border-top:1px solid #333;transition:opacity .3s ease;flex-shrink:0}.controls button{background:transparent;border:none;color:#fff;cursor:pointer;padding:6px 8px;border-radius:4px;font-size:16px;line-height:1;transition:background .15s;display:flex;align-items:center;justify-content:center;flex-shrink:0}.controls button:hover{background:rgba(255,255,255,0.12)}.controls button:active{background:rgba(255,255,255,0.2)}.controls input[type=range]{-webkit-appearance:none;appearance:none;height:4px;background:#444;border-radius:2px;outline:none;cursor:pointer;transition:background .2s}.controls input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:13px;height:13px;background:#E50914;border-radius:50%;cursor:pointer;transition:transform .15s}.controls input[type=range]::-webkit-slider-thumb:hover{transform:scale(1.3)}.controls input[type=range]::-moz-range-thumb{width:13px;height:13px;background:#E50914;border-radius:50%;border:none;cursor:pointer}.time{font-size:13px;color:#999;min-width:42px;text-align:center;font-variant-numeric:tabular-nums;flex-shrink:0}.seek-bar{flex:1;min-width:0}.vol-wrap{display:flex;align-items:center;gap:5px;flex-shrink:0}.vol-wrap input[type=range]{width:65px}.title-bar{display:flex;align-items:center;padding:6px 14px;background:#141414;border-bottom:1px solid #222;gap:8px;flex-shrink:0}.title-bar .name{flex:1;font-size:13px;color:#ccc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.title-bar .close-btn{background:transparent;border:none;color:#999;cursor:pointer;font-size:18px;padding:2px 6px;border-radius:3px;transition:color .15s}.title-bar .close-btn:hover{color:#E50914}.badge{font-size:10px;background:#E50914;color:#fff;padding:1px 5px;border-radius:2px;margin-left:6px}</style></head><body><div class="title-bar"><span class="name">' + title + '</span><button class="close-btn" id="closeBtn">&times;</button></div><div class="video-wrap"><video id="pv" playsinline></video></div><div class="controls" id="ctrl"><button id="ppBtn">⏸</button><span class="time" id="ct">0:00</span><input type="range" class="seek-bar" id="ps" min="0" max="100" value="0" step="0.1"><span class="time" id="dr">0:00</span><div class="vol-wrap"><button id="vbBtn">🔊</button><input type="range" id="vs" min="0" max="100" value="80"></div><button id="fsBtn">⛶</button></div><script>var v=document.getElementById("pv");var pp=document.getElementById("ppBtn");var ps=document.getElementById("ps");var ct=document.getElementById("ct");var dr=document.getElementById("dr");var vb=document.getElementById("vbBtn");var vs=document.getElementById("vs");var fs=document.getElementById("fsBtn");var cl=document.getElementById("closeBtn");v.src="' + src + '";v.currentTime=' + currentTime + ';v.play().catch(function(){});v.addEventListener("timeupdate",function(){if(v.duration){ps.value=(v.currentTime/v.duration)*100;var m=Math.floor(v.currentTime/60);var s=Math.floor(v.currentTime%60);ct.textContent=m+":"+(s<10?"0":"")+s}});v.addEventListener("loadedmetadata",function(){var m=Math.floor(v.duration/60);var s=Math.floor(v.duration%60);dr.textContent=m+":"+(s<10?"0":"")+s});pp.addEventListener("click",function(){if(v.paused){v.play();pp.textContent="⏸"}else{v.pause();pp.textContent="▶"}});ps.addEventListener("input",function(){if(v.duration)v.currentTime=(ps.value/100)*v.duration});vb.addEventListener("click",function(){v.muted=!v.muted;vb.textContent=v.muted?"🔇":"🔊"});vs.addEventListener("input",function(){v.volume=vs.value/100;v.muted=v.volume===0;vb.textContent=v.muted?"🔇":"🔊"});fs.addEventListener("click",function(){var c=document.querySelector(".controls");if(v.requestFullscreen){v.requestFullscreen()}else if(v.webkitRequestFullscreen){v.webkitRequestFullscreen()}else if(v.msRequestFullscreen){v.msRequestFullscreen()}});cl.addEventListener("click",function(){window.close()});var ctrl=document.getElementById("ctrl");var t;document.addEventListener("mousemove",function(){ctrl.style.opacity="1";clearTimeout(t);t=setTimeout(function(){if(document.fullscreenElement&&!v.paused)ctrl.style.opacity="0"},3000)});document.addEventListener("fullscreenchange",function(){ctrl.style.opacity="1"});v.addEventListener("play",function(){pp.textContent="⏸"});v.addEventListener("pause",function(){pp.textContent="▶"});<\/script></body></html>');
  popoutWindow.document.close();
  const checkClosed = setInterval(() => { if (popoutWindow.closed) { clearInterval(checkClosed); popoutWindow = null; if (videoElement.paused && videoElement.src) videoElement.play().catch(() => {}); } }, 1000);
}

if (popoutBtn) popoutBtn.addEventListener('click', openPopoutPlayer);

function closePopout() { if (popoutWindow && !popoutWindow.closed) popoutWindow.close(); popoutWindow = null; }

videoCloseBtn.addEventListener('click', stopStream);

function stopStream() {
  videoElement.pause(); videoElement.removeAttribute('src'); videoElement.load();
  videoModal.style.display = 'none'; fileModal.style.display = 'none';
  progressBar.style.width = '0%'; statusBar.style.display = 'none'; loadingOverlay.classList.add('hidden');
  closePopout(); removeSubtitles();
  if (window.torrentAPI && window.torrentAPI.destroyTorrent) window.torrentAPI.destroyTorrent().catch(() => {});
  else if (currentTorrent && currentTorrent.destroy) try { currentTorrent.destroy(); } catch {}
  currentTorrent = null; currentPlayingFile = null; clearInterval(progressInterval);
}

// ============================================
// 15. VIDEO EVENTS
// ============================================

videoElement.addEventListener('play', () => { playPauseBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h6v14H6z"/><path d="M14 5h6v14h-6z"/></svg>'; });
videoElement.addEventListener('pause', () => { playPauseBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; });
videoElement.addEventListener('timeupdate', () => { if (videoElement.duration) { progressSlider.value = (videoElement.currentTime / videoElement.duration) * 100; currentTimeEl.textContent = formatTime(videoElement.currentTime); } });
videoElement.addEventListener('loadedmetadata', () => {
  durationEl.textContent = formatTime(videoElement.duration);
  loadingOverlay.classList.add('hidden');
  detectAudioTracks();
  renderSubtitleMenu(currentSubtitles);
});
videoElement.addEventListener('waiting', () => loadingOverlay.classList.remove('hidden'));
videoElement.addEventListener('canplay', () => loadingOverlay.classList.add('hidden'));
videoElement.addEventListener('error', () => {
  loadingOverlay.classList.add('hidden');
  const err = videoElement.error;
  showStatus('Chyba prehravania' + (err ? ' (kod ' + err.code + ')' : ''), true);
});
videoElement.addEventListener('ended', () => { videoEnded = true; checkAndShowSaveDialog(); });

// ============================================
// 16. SOURCE MODAL
// ============================================

sourceBtn.addEventListener('click', () => sourceModal.style.display = 'flex');
sourceCloseBtn.addEventListener('click', () => sourceModal.style.display = 'none');
sourceModal.addEventListener('click', (e) => { if (e.target === sourceModal) sourceModal.style.display = 'none'; });
document.querySelectorAll('.source-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.source-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.source-tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    const target = document.getElementById(tab.dataset.tab + '-tab');
    if (target) target.classList.add('active');
  });
});
fileInput.addEventListener('change', async () => { if (fileInput.files.length > 0 && await addTorrent(fileInput.files[0])) sourceModal.style.display = 'none'; });
magnetLoad.addEventListener('click', async () => { const m = magnetInput.value.trim(); if (await addTorrent(m)) sourceModal.style.display = 'none'; });
magnetInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); magnetLoad.click(); } });
urlLoad.addEventListener('click', async () => { const u = urlInput.value.trim(); if (await addTorrent(u)) sourceModal.style.display = 'none'; });
urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); urlLoad.click(); } });

// ============================================
// 17. FILE MODAL
// ============================================

fileCloseBtn.addEventListener('click', () => fileModal.style.display = 'none');
fileModal.addEventListener('click', (e) => { if (e.target === fileModal) fileModal.style.display = 'none'; });

// ============================================
// 18. SAVE DIALOG
// ============================================

function showSaveDialog() { if (!currentPlayingFile) return; saveDialogMessage.textContent = 'Súbor "' + currentPlayingFile.name + '" bol stiahnutý. Chcete si ho uložiť?'; saveDialogOverlay.style.display = 'flex'; }
function hideSaveDialog() { saveDialogOverlay.style.display = 'none'; }
function checkAndShowSaveDialog() { if (videoEnded && torrentDownloaded && currentPlayingFile) showSaveDialog(); }
async function saveFile() {
  if (!currentPlayingFile) return;
  if (isElectron) { const r = await window.torrentAPI.saveFile(currentPlayingFile.index); if (r.canceled) hideSaveDialog(); else if (r.error) showStatus('Chyba pri ukladaní', true); else { showStatus('Súbor uložený'); hideSaveDialog(); } }
  else {
    try {
      if ('showSaveFilePicker' in window) { const h = await window.showSaveFilePicker({ suggestedName: currentPlayingFile.name }); currentPlayingFile.getBlob((err, blob) => { if (err) { fallbackSave(); return; } h.createWritable().then(w => w.write(blob).then(() => w.close())); showStatus('Súbor uložený'); hideSaveDialog(); }); }
      else fallbackSave();
    } catch { hideSaveDialog(); }
  }
}
function fallbackSave() { if (!currentPlayingFile) return; currentPlayingFile.getBlob((err, blob) => { if (err) return; const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = currentPlayingFile.name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); hideSaveDialog(); }); }
saveBtn.addEventListener('click', saveFile);
discardBtn.addEventListener('click', () => { hideSaveDialog(); showStatus('Súbor zahodený'); });

// ============================================
// 19. SEARCH EVENTS
// ============================================

searchBtn.addEventListener('click', performSearch);
searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') performSearch(); });

// ============================================
// 20. SUBTITLE / AUDIO MENU TOGGLE
// ============================================

if (subtitleBtn) {
  subtitleBtn.addEventListener('click', () => { if (subtitleMenu) { renderSubtitleMenu(currentSubtitles); const isVisible = subtitleMenu.style.display === 'block'; subtitleMenu.style.display = isVisible ? 'none' : 'block'; if (audioTrackMenu) audioTrackMenu.style.display = 'none'; } });
}
if (audioTrackBtn) {
  audioTrackBtn.addEventListener('click', () => { if (audioTrackMenu) { detectAudioTracks(); const isVisible = audioTrackMenu.style.display === 'block'; audioTrackMenu.style.display = isVisible ? 'none' : 'block'; if (subtitleMenu) subtitleMenu.style.display = 'none'; } });
}
document.addEventListener('click', (e) => {
  if (subtitleMenu && !e.target.closest('#subtitle-btn') && !e.target.closest('#subtitle-menu')) subtitleMenu.style.display = 'none';
  if (audioTrackMenu && !e.target.closest('#audio-track-btn') && !e.target.closest('#audio-track-menu')) audioTrackMenu.style.display = 'none';
});

// ============================================
// 21. PWA INSTALL
// ============================================

if (!isElectron) {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; installBtn.style.display = 'flex'; });
  installBtn.addEventListener('click', () => { if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => { deferredPrompt = null; installBtn.style.display = 'none'; }); } });
} else installBtn.style.display = 'none';

// ============================================
// 22. UI HELPERS
// ============================================

function showStatus(msg, isError = false) { statusBar.style.display = 'flex'; statusText.textContent = msg; statusText.style.color = isError ? 'var(--accent)' : 'var(--text-secondary)'; }
function resetUI() {
  videoModal.style.display = 'none'; fileModal.style.display = 'none'; progressBar.style.width = '0%'; statusBar.style.display = 'none';
  currentTimeEl.textContent = '0:00'; durationEl.textContent = '0:00'; progressSlider.value = 0; loadingOverlay.classList.add('hidden');
  hideSaveDialog(); if (videoElement.src) { videoElement.pause(); videoElement.removeAttribute('src'); videoElement.load(); }
  currentSubtitles = []; currentAudioTracks = [];
  clearInterval(progressInterval); removeSubtitles(); renderSubtitleMenu([]); renderAudioTrackMenu();
}
function updateVolumeIcon() {
  if (videoElement.muted || videoElement.volume === 0) volumeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13 3a4.5 4.5 0 0 0-2.5-4v8a4.49 4.49 0 0 0 2.5-4z"/></svg>';
  else if (videoElement.volume < 0.5) volumeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.49 4.49 0 0 0 2.5-3.5z"/></svg>';
  else volumeBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>';
}

// ============================================
// 23. FORMATTING
// ============================================

function formatTime(seconds) { if (isNaN(seconds) || !isFinite(seconds)) return '0:00'; const m = Math.floor(seconds / 60); const s = Math.floor(seconds % 60); return m + ':' + s.toString().padStart(2, '0'); }
function formatBytes(bytes) { if (bytes === 0) return '0 B'; const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.floor(Math.log(bytes) / Math.log(k)); return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]; }

// ============================================
// 24. NAVBAR SCROLL
// ============================================

window.addEventListener('scroll', () => { const navbar = document.querySelector('.navbar'); if (window.scrollY > 50) navbar.classList.add('scrolled'); else navbar.classList.remove('scrolled'); });

// ============================================
// 25. DRAG & DROP
// ============================================

document.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('drop', (e) => { e.preventDefault(); const file = e.dataTransfer.files[0]; if (file) addTorrent(file); });

// ============================================
// 26. NETFLIX-STYLE HOMEPAGE RENDERING
// ============================================

async function getRecommendedForYou() {
  const continueWatching = getContinueWatching();
  let seedMovieId = null;
  if (continueWatching.length > 0) seedMovieId = continueWatching[0].id;
  else { const popular = await fetchPopular(); if (popular && popular.results && popular.results.length > 0) seedMovieId = popular.results[0].id; }
  if (seedMovieId) return fetchRecommendations(seedMovieId);
  return null;
}

function createMovieCard(item, index) {
  const card = document.createElement('div');
  card.className = 'movie-card';
  card.style.animationDelay = (index * 0.05) + 's';
  const poster = document.createElement('img');
  poster.className = 'movie-card-poster';
  poster.src = getPosterUrl(item.poster_path, 'w200') || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect fill="%23222" width="200" height="300"/><text x="100" y="150" text-anchor="middle" fill="%23666" font-size="40">🎬</text></svg>';
  poster.alt = item.title || item.name || '';
  poster.loading = 'lazy';
  card.appendChild(poster);
  const overlay = document.createElement('div');
  overlay.className = 'movie-card-overlay';
  const title = document.createElement('div');
  title.className = 'movie-card-title';
  title.textContent = item.title || item.name || '';
  overlay.appendChild(title);
  const meta = document.createElement('div');
  meta.className = 'movie-card-meta';
  if (item.vote_average) { const rating = document.createElement('span'); rating.textContent = '★ ' + item.vote_average.toFixed(1); meta.appendChild(rating); }
  if (item.release_date || item.first_air_date) { const year = document.createElement('span'); year.textContent = getYear(item.release_date || item.first_air_date); meta.appendChild(year); }
  overlay.appendChild(meta);
  const playIcon = document.createElement('div');
  playIcon.className = 'movie-card-play';
  playIcon.innerHTML = '▶';
  overlay.appendChild(playIcon);
  card.appendChild(overlay);
  card.addEventListener('click', () => {
    const detailItem = { ...item, title: item.title || item.name, year: getYear(item.release_date || item.first_air_date), rating: item.vote_average, overview: item.overview, posterUrl: getPosterUrl(item.poster_path), backdropUrl: getBackdropUrl(item.backdrop_path) };
    openDetailModal(detailItem);
  });
  return card;
}

function createCategoryRow(title, items) {
  if (!items || items.length === 0) return null;
  const section = document.createElement('section');
  section.className = 'category-section';
  const header = document.createElement('div');
  header.className = 'category-header';
  const h2 = document.createElement('h2');
  h2.className = 'category-title';
  h2.textContent = title;
  header.appendChild(h2);
  section.appendChild(header);
  const container = document.createElement('div');
  container.className = 'category-row';
  items.forEach((item, i) => {
    const card = createMovieCard(item, i);
    container.appendChild(card);
  });
  section.appendChild(container);
  return section;
}

async function renderHomePage() {
  if (!browseRows) return;
  browseRows.style.display = 'block';
  browseRows.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-secondary)"><div class="spinner"></div><p style="margin-top:0.5rem">Načítavam...</p></div>';
  try {
    const [popular, trending, topRated, nowPlaying, upcoming, favorites, continueWatching, recommended] = await Promise.all([
      fetchPopular(),
      fetchTrending(),
      fetchTopRated(),
      fetchNowPlaying(),
      fetchUpcoming(),
      Promise.resolve(getFavorites()),
      Promise.resolve(getContinueWatching()),
      getRecommendedForYou()
    ]);
    browseRows.innerHTML = '';
    if (continueWatching.length > 0) {
      const row = createCategoryRow('Naposledy pozerané', continueWatching);
      if (row) browseRows.appendChild(row);
    }
    if (favorites.length > 0) {
      const row = createCategoryRow('Obľúbené', favorites);
      if (row) browseRows.appendChild(row);
    }
    if (recommended && recommended.results && recommended.results.length > 0) {
      const row = createCategoryRow('Odporúčané', recommended.results.slice(0, 20));
      if (row) browseRows.appendChild(row);
    }
    if (popular && popular.results && popular.results.length > 0) {
      const row = createCategoryRow('Populárne', popular.results.slice(0, 20));
      if (row) browseRows.appendChild(row);
      const first = popular.results[0];
      if (first) updateHero({ ...first, title: first.title || first.name, year: getYear(first.release_date || first.first_air_date), rating: first.vote_average, overview: first.overview, posterUrl: getPosterUrl(first.poster_path), backdropUrl: getBackdropUrl(first.backdrop_path), media_type: first.media_type || 'movie' });
    }
    if (trending && trending.results && trending.results.length > 0) {
      const row = createCategoryRow('Trendy', trending.results.slice(0, 20));
      if (row) browseRows.appendChild(row);
    }
    if (topRated && topRated.results && topRated.results.length > 0) {
      const row = createCategoryRow('Top hodnotené', topRated.results.slice(0, 20));
      if (row) browseRows.appendChild(row);
    }
    if (nowPlaying && nowPlaying.results && nowPlaying.results.length > 0) {
      const row = createCategoryRow('Teraz v kinách', nowPlaying.results.slice(0, 20));
      if (row) browseRows.appendChild(row);
    }
    if (upcoming && upcoming.results && upcoming.results.length > 0) {
      const row = createCategoryRow('Čoskoro', upcoming.results.slice(0, 20));
      if (row) browseRows.appendChild(row);
    }
  } catch (err) {
    console.error('Homepage error:', err);
    browseRows.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--accent)">Chyba načítania domovskej stránky</div>';
  }
}

// ============================================
// 27. DETAIL MODAL
// ============================================

async function openDetailModal(item) {
  currentDetailMovie = item;
  const existingModal = document.querySelector('.detail-modal-overlay');
  if (existingModal) existingModal.remove();
  const overlay = document.createElement('div');
  overlay.className = 'detail-modal-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:1000;overflow-y:auto;display:flex;align-items:flex-start;justify-content:center;padding:2rem 1rem;';
  const modal = document.createElement('div');
  modal.className = 'detail-modal';
  modal.style.cssText = 'max-width:900px;width:100%;background:var(--bg-card);border-radius:12px;overflow:hidden;position:relative;margin-top:2rem;';
  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'position:absolute;top:12px;right:16px;background:rgba(0,0,0,0.6);color:white;border:none;font-size:28px;width:40px;height:40px;border-radius:50%;cursor:pointer;z-index:10;display:flex;align-items:center;justify-content:center;line-height:1;';
  closeBtn.addEventListener('click', () => overlay.remove());
  modal.appendChild(closeBtn);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  // Backdrop
  const backdropSection = document.createElement('div');
  backdropSection.style.cssText = 'height:350px;background-size:cover;background-position:center;position:relative;';
  if (item.backdropUrl) backdropSection.style.backgroundImage = `url(${item.backdropUrl})`;
  else backdropSection.style.background = 'linear-gradient(135deg, #141414 0%, #222 100%)';
  const gradient = document.createElement('div');
  gradient.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:60%;background:linear-gradient(transparent, var(--bg-card));';
  backdropSection.appendChild(gradient);
  modal.appendChild(backdropSection);
  // Content
  const content = document.createElement('div');
  content.style.cssText = 'padding:0 2rem 2rem;margin-top:-80px;position:relative;z-index:2;display:flex;gap:2rem;flex-wrap:wrap;';
  // Poster
  const posterDiv = document.createElement('div');
  posterDiv.style.cssText = 'flex-shrink:0;width:180px;';
  const posterImg = document.createElement('img');
  posterImg.src = item.posterUrl || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect fill="%23222" width="200" height="300"/><text x="100" y="150" text-anchor="middle" fill="%23666" font-size="40">🎬</text></svg>';
  posterImg.style.cssText = 'width:100%;border-radius:8px;box-shadow:0 4px 20px rgba(0,0,0,0.5);';
  posterDiv.appendChild(posterImg);
  content.appendChild(posterDiv);
  // Info
  const infoDiv = document.createElement('div');
  infoDiv.style.cssText = 'flex:1;min-width:250px;';
  const title = document.createElement('h1');
  title.style.cssText = 'font-family:"Bebas Neue",sans-serif;font-size:2.5rem;color:white;margin:0 0 0.5rem;letter-spacing:1px;';
  title.textContent = item.title || item.name || 'Neznámy názov';
  infoDiv.appendChild(title);
  const metaRow = document.createElement('div');
  metaRow.style.cssText = 'display:flex;gap:1rem;align-items:center;margin-bottom:0.8rem;flex-wrap:wrap;';
  if (item.year) { const y = document.createElement('span'); y.style.cssText = 'color:var(--text-secondary);font-size:0.95rem;'; y.textContent = item.year; metaRow.appendChild(y); }
  if (item.rating) { const r = document.createElement('span'); r.style.cssText = 'color:#f5c518;font-size:0.95rem;'; r.textContent = '★ ' + (typeof item.rating === 'number' ? item.rating.toFixed(1) : item.rating); metaRow.appendChild(r); }
  infoDiv.appendChild(metaRow);
  // Genres
  const genresDiv = document.createElement('div');
  genresDiv.style.cssText = 'display:flex;gap:0.4rem;flex-wrap:wrap;margin-bottom:0.8rem;';
  if (item.genre_ids && Array.isArray(item.genre_ids)) {
    const genreNames = { 28:'Akčný',12:'Dobrodružný',16:'Animovaný',35:'Komédia',80:'Kriminálny',99:'Dokumentárny',18:'Dráma',10751:'Rodinný',14:'Fantasy',36:'Historický',27:'Horor',10402:'Hudobný',9648:'Mysteriózny',10749:'Romantický',878:'Sci-Fi',10770:'TV film',53:'Thriller',10752:'Vojnový',37:'Western' };
    item.genre_ids.forEach(id => {
      const g = document.createElement('span');
      g.style.cssText = 'background:rgba(229,9,20,0.2);color:var(--accent);padding:0.15rem 0.5rem;border-radius:3px;font-size:0.75rem;';
      g.textContent = genreNames[id] || 'Žáner';
      genresDiv.appendChild(g);
    });
  }
  infoDiv.appendChild(genresDiv);
  // Overview
  if (item.overview) {
    const overview = document.createElement('p');
    overview.style.cssText = 'color:var(--text-secondary);font-size:0.9rem;line-height:1.6;margin-bottom:1rem;';
    overview.textContent = item.overview;
    infoDiv.appendChild(overview);
  }
  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:0.6rem;flex-wrap:wrap;margin-bottom:1rem;';
  const playBestBtn = document.createElement('button');
  playBestBtn.className = 'btn btn-primary';
  playBestBtn.textContent = 'Prehrat najlepsi';
  playBestBtn.disabled = true;
  playBestBtn.addEventListener('click', () => {
    if (playBestBtn._bestStream) playStreamResult(playBestBtn._bestStream);
    else showStatus('Zatial sa nenasiel prehratelny stream', true);
  });
  actions.appendChild(playBestBtn);
  const favBtn = document.createElement('button');
  favBtn.className = 'btn btn-secondary';
  const isFav = isFavorite(item.id);
  favBtn.textContent = isFav ? '♥ V obľúbených' : '♡ Pridať do obľúbených';
  favBtn.addEventListener('click', () => {
    if (isFavorite(item.id)) { removeFromFavorites(item.id); favBtn.textContent = '♡ Pridať do obľúbených'; showStatus('Odstránené z obľúbených'); }
    else { addToFavorites(item); favBtn.textContent = '♥ V obľúbených'; showStatus('Pridané do obľúbených'); }
  });
  actions.appendChild(favBtn);
  const shareBtn = document.createElement('button');
  shareBtn.className = 'btn btn-secondary';
  shareBtn.textContent = '📤 Zdieľať';
  shareBtn.addEventListener('click', () => {
    if (navigator.share) { navigator.share({ title: item.title || item.name, text: item.overview || '' }).catch(() => {}); }
    else { navigator.clipboard.writeText(window.location.href).then(() => showStatus('Odkaz skopírovaný')).catch(() => {}); }
  });
  actions.appendChild(shareBtn);
  infoDiv.appendChild(actions);
  // Stream sources
  const streamsHeader = document.createElement('h3');
  streamsHeader.style.cssText = 'color:white;font-size:1.1rem;margin:1rem 0 0.5rem;';
  streamsHeader.textContent = 'Dostupné streamy';
  infoDiv.appendChild(streamsHeader);
  const streamsList = document.createElement('div');
  streamsList.id = 'detail-streams-list';
  streamsList.style.cssText = 'max-height:200px;overflow-y:auto;';
  infoDiv.appendChild(streamsList);
  content.appendChild(infoDiv);
  modal.appendChild(content);
  // Cast section
  const castSection = document.createElement('div');
  castSection.style.cssText = 'padding:0 2rem 2rem;';
  const castHeader = document.createElement('h3');
  castHeader.style.cssText = 'color:white;font-size:1.1rem;margin-bottom:0.8rem;';
  castHeader.textContent = 'Herci';
  castSection.appendChild(castHeader);
  const castRow = document.createElement('div');
  castRow.id = 'detail-cast-row';
  castRow.style.cssText = 'display:flex;gap:0.8rem;overflow-x:auto;padding-bottom:0.5rem;';
  castRow.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;">Načítavam...</div>';
  castSection.appendChild(castRow);
  modal.appendChild(castSection);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Load TMDB details
  loadDetailData(item, streamsList, castRow, playBestBtn);
}

function getItemMediaType(item) {
  if (item.media_type === 'tv' || item.first_air_date || item.name && !item.title) return 'tv';
  return 'movie';
}

function renderSeasonList(item, details, modal) {
  if (!modal || getItemMediaType(item) !== 'tv' || !details.seasons || details.seasons.length === 0) return;
  let section = modal.querySelector('.detail-seasons-section');
  if (!section) {
    section = document.createElement('div');
    section.className = 'detail-seasons-section';
    section.style.cssText = 'padding:0 2rem 2rem;';
    const castSection = modal.querySelector('#detail-cast-row')?.parentElement;
    if (castSection) modal.insertBefore(section, castSection);
    else modal.appendChild(section);
  }
  section.innerHTML = '<h3 style="color:white;font-size:1.1rem;margin-bottom:0.8rem;">Serie a epizody</h3>';
  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:0.45rem;';
  details.seasons
    .filter(season => season.season_number > 0)
    .forEach(season => {
      const row = document.createElement('div');
      row.style.cssText = 'background:var(--bg);border-radius:4px;padding:0.6rem 0.75rem;';
      const header = document.createElement('button');
      header.className = 'subtitle-option';
      header.style.cssText = 'display:flex;justify-content:space-between;gap:0.5rem;width:100%;font-weight:600;';
      header.innerHTML = `<span>${season.name || `Sezona ${season.season_number}`}</span><span>${season.episode_count || 0} epizod</span>`;
      const episodes = document.createElement('div');
      episodes.style.cssText = 'display:none;margin-top:0.5rem;color:var(--text-secondary);font-size:0.8rem;line-height:1.5;';
      header.addEventListener('click', async () => {
        const isOpen = episodes.style.display === 'block';
        episodes.style.display = isOpen ? 'none' : 'block';
        if (!isOpen && !episodes.dataset.loaded) {
          episodes.textContent = 'Nacitavam epizody...';
          const data = await fetchTVSeason(item.id, season.season_number);
          if (data && data.episodes && data.episodes.length > 0) {
            episodes.innerHTML = '';
            data.episodes.forEach(ep => {
              const epDiv = document.createElement('div');
              epDiv.textContent = `${ep.episode_number}. ${ep.name || 'Epizoda'}${ep.air_date ? ' (' + getYear(ep.air_date) + ')' : ''}`;
              episodes.appendChild(epDiv);
            });
          } else {
            episodes.textContent = 'Epizody nie su dostupne';
          }
          episodes.dataset.loaded = '1';
        }
      });
      row.appendChild(header);
      row.appendChild(episodes);
      list.appendChild(row);
    });
  section.appendChild(list);
}

function buildDetailSearchQueries(item, details) {
  const titles = [
    details?.original_title,
    details?.original_name,
    details?.title,
    details?.name,
    item.original_title,
    item.original_name,
    item.title,
    item.name
  ].filter(Boolean);
  const uniqueTitles = [...new Set(titles.map(t => String(t).trim()).filter(t => t.length >= 2))];
  const year = getYear(details?.release_date || details?.first_air_date || item.release_date || item.first_air_date || '');
  const queries = [];
  uniqueTitles.forEach(title => {
    if (year) queries.push(`${title} ${year}`);
    queries.push(title);
  });
  return [...new Set(queries)].slice(0, 4);
}

async function searchAllStreamProviders(query, category = '200') {
  const [pirateResults, sktorrentResults, skonlineResults, webshareResults, publicResults] = await Promise.all([
    (async () => { try { return await searchPirateBay(query, category); } catch(e) { return []; } })(),
    (async () => { try { return typeof SktorrentProvider !== 'undefined' ? await SktorrentProvider.search(query) : []; } catch(e) { return []; } })(),
    (async () => {
      try {
        if (typeof skonlineProvider !== 'undefined' && skonlineProvider && skonlineProvider.isLoggedIn()) {
          return (await skonlineProvider.search(query)).map(r => ({ ...r, provider: 'Sktorrent Online' }));
        }
        if (typeof SktorrentProvider !== 'undefined' && SktorrentProvider.searchOnline) {
          return (await SktorrentProvider.searchOnline(query)).map(r => ({ ...r, provider: 'Sktorrent Online' }));
        }
        return [];
      } catch(e) { return []; }
    })(),
    (async () => { try { return typeof WebshareProvider !== 'undefined' ? await WebshareProvider.search(query) : []; } catch(e) { return []; } })(),
    (async () => { try { return typeof PublicDomainProvider !== 'undefined' ? await PublicDomainProvider.search(query) : []; } catch(e) { return []; } })()
  ]);
  const enrichedPirate = pirateResults.map(item => ({
    ...item, title: item.name, _provider: 'PirateBay', _providerBadge: 'PB', _type: 'torrent',
    seeders: parseInt(item.seeders) || 0, leechers: parseInt(item.leechers) || 0, size: item.size || 0
  }));
  const enrichedSktorrent = sktorrentResults.map(item => ({
    ...item, _provider: item.provider || 'Sktorrent', _providerBadge: item.flag || 'SK',
    _type: item.sourceType === 'online' ? 'direct' : 'torrent'
  }));
  const enrichedOnline = skonlineResults.map(item => ({
    ...item, _provider: item.provider || 'Sktorrent Online', _providerBadge: item.flag || 'SK',
    _type: 'direct'
  }));
  const enrichedWebshare = webshareResults.map(item => ({
    ...item, _provider: 'Webshare', _providerBadge: 'WS', _type: 'direct'
  }));
  const enrichedPublic = publicResults.map(item => ({
    ...item, _provider: 'Free / Public domain', _providerBadge: 'FREE', _type: 'torrent-url'
  }));
  return deduplicateResults([...enrichedPirate, ...enrichedSktorrent, ...enrichedOnline, ...enrichedWebshare, ...enrichedPublic]);
}

async function loadDetailData(item, streamsList, castRow, playBestBtn) {
  let movieId = item.id;
  let details = null;
  let credits = null;
  const mediaType = getItemMediaType(item);
  if (movieId && TMDB_API_KEY) {
    details = mediaType === 'tv' ? await fetchTVDetails(movieId) : await fetchMovieDetails(movieId);
    credits = mediaType === 'tv' ? await fetchTVCredits(movieId) : await fetchMovieCredits(movieId);
  }
  if (details) {
    const titleEl = streamsList.closest('.detail-modal')?.querySelector('h1');
    if (titleEl && (details.title || details.name)) titleEl.textContent = details.title || details.name;
    const metaRow = titleEl?.nextElementSibling;
    if (metaRow) {
      const releasedAt = details.release_date || details.first_air_date;
      if (releasedAt) { const y = metaRow.querySelector('span:first-child'); if (y) y.textContent = getYear(releasedAt); }
      if (details.vote_average) { const r = metaRow.querySelector('span:nth-child(2)'); if (r) r.textContent = '★ ' + details.vote_average.toFixed(1); }
    }
    if (details.genres) {
      const genresDiv = metaRow?.nextElementSibling;
      if (genresDiv && genresDiv.tagName === 'DIV') {
        genresDiv.innerHTML = '';
        details.genres.forEach(g => {
          const span = document.createElement('span');
          span.style.cssText = 'background:rgba(229,9,20,0.2);color:var(--accent);padding:0.15rem 0.5rem;border-radius:3px;font-size:0.75rem;';
          span.textContent = g.name;
          genresDiv.appendChild(span);
        });
      }
    }
    renderSeasonList(item, details, streamsList.closest('.detail-modal'));
  }
  // Cast
  if (credits && credits.cast && credits.cast.length > 0) {
    castRow.innerHTML = '';
    credits.cast.slice(0, 15).forEach(actor => {
      const actorDiv = document.createElement('div');
      actorDiv.style.cssText = 'flex-shrink:0;text-align:center;width:80px;';
      const img = document.createElement('img');
      img.src = getPosterUrl(actor.profile_path, 'w92') || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 138"><rect fill="%23333" width="92" height="138"/><text x="46" y="75" text-anchor="middle" fill="%23666" font-size="30">👤</text></svg>';
      img.style.cssText = 'width:70px;height:70px;border-radius:50%;object-fit:cover;';
      img.alt = actor.name;
      const name = document.createElement('div');
      name.style.cssText = 'font-size:0.7rem;color:var(--text-secondary);margin-top:0.3rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      name.textContent = actor.name;
      actorDiv.appendChild(img);
      actorDiv.appendChild(name);
      castRow.appendChild(actorDiv);
    });
  } else {
    castRow.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;">Nenašli sa žiadni herci</div>';
  }
  // Stream sources - search if not already in currentSearchResults
  const title = details?.title || details?.name || item.title || item.name || '';
  let searchResults = currentSearchResults.filter(r => {
    const rTitle = r.title || r.name || '';
    return normalizeTitle(rTitle).includes(normalizeTitle(title)) || normalizeTitle(title).includes(normalizeTitle(rTitle));
  });
  // If no results found in current search, search all providers
  if (searchResults.length === 0 && title.length >= 2) {
    streamsList.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;">Vyhľadávam streamy...</div>';
    try {
      const [pirateResults, sktorrentResults, skonlineResults, webshareResults] = await Promise.all([
        (async () => { try { return await searchPirateBay(title, '200'); } catch(e) { return []; } })(),
        (async () => { try { return typeof SktorrentProvider !== 'undefined' ? await SktorrentProvider.search(title) : []; } catch(e) { return []; } })(),
        (async () => { 
          try { 
            if (typeof skonlineProvider !== 'undefined' && skonlineProvider && skonlineProvider.isLoggedIn()) {
              return await skonlineProvider.search(title);
            } else if (typeof SktorrentProvider !== 'undefined' && SktorrentProvider.searchOnline) {
              return await SktorrentProvider.searchOnline(title);
            }
            return [];
          } catch(e) { return []; }
        })(),
        (async () => { try { return typeof WebshareProvider !== 'undefined' ? await WebshareProvider.search(title) : []; } catch(e) { return []; } })()
      ]);
      const enrichedPirate = pirateResults.map(item => ({
        ...item, title: item.name, _provider: 'PirateBay', _providerBadge: '🏴', _type: 'torrent',
        seeders: parseInt(item.seeders) || 0, leechers: parseInt(item.leechers) || 0, size: item.size || 0
      }));
      const enrichedSktorrent = sktorrentResults.map(item => ({
        ...item, _provider: item.provider || 'Sktorrent', _providerBadge: item.flag || '🇨🇿',
        _type: item.sourceType === 'online' ? 'direct' : 'torrent'
      }));
      const enrichedWebshare = webshareResults.map(item => ({
        ...item, _provider: 'Webshare', _providerBadge: '☁️', _type: 'direct'
      }));
      searchResults = deduplicateResults([...enrichedPirate, ...enrichedSktorrent, ...skonlineResults, ...enrichedWebshare]);
    } catch(e) {
      console.warn('Detail search error:', e);
    }
  }
  if (searchResults.length === 0) {
    const fallbackQueries = buildDetailSearchQueries(item, details).filter(query => normalizeTitle(query) !== normalizeTitle(title));
    for (const query of fallbackQueries) {
      try {
        streamsList.innerHTML = `<div style="color:var(--text-secondary);font-size:0.85rem;">Vyhladavam streamy pre "${query}"...</div>`;
        searchResults = await searchAllStreamProviders(query, mediaType === 'tv' ? '208' : '207');
        if (searchResults.length > 0) break;
      } catch(e) {
        console.warn('Detail fallback search error:', e);
      }
    }
  }
  if (searchResults.length > 0) {
    streamsList.innerHTML = '';
    const sorted = [...searchResults].sort((a, b) => {
      const aCZ = hasCZDubbing(a.title || a.name || '') ? 1 : 0;
      const bCZ = hasCZDubbing(b.title || b.name || '') ? 1 : 0;
      if (bCZ !== aCZ) return bCZ - aCZ;
      return (b.seeders || 0) - (a.seeders || 0);
    });
    if (playBestBtn) {
      playBestBtn._bestStream = sorted[0];
      playBestBtn.disabled = false;
    }
    sorted.forEach(s => {
      const streamItem = document.createElement('div');
      streamItem.style.cssText = 'display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.6rem;background:var(--bg);border-radius:4px;margin-bottom:0.3rem;font-size:0.85rem;';
      const badge = document.createElement('span');
      badge.style.cssText = 'background:var(--accent);color:white;padding:0.1rem 0.4rem;border-radius:2px;font-size:0.7rem;font-weight:600;';
      badge.textContent = s._providerBadge || s._provider || '?';
      streamItem.appendChild(badge);
      const name = document.createElement('span');
      name.style.cssText = 'flex:1;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = s.title || s.name || '';
      streamItem.appendChild(name);
      if (s.seeders !== undefined) {
        const seeds = document.createElement('span');
        seeds.style.cssText = 'color:var(--success);font-size:0.75rem;';
        seeds.textContent = '▲' + (s.seeders || 0);
        streamItem.appendChild(seeds);
      }
      if (s.size) {
        const sz = document.createElement('span');
        sz.style.cssText = 'color:var(--text-secondary);font-size:0.75rem;';
        sz.textContent = formatBytes(parseInt(s.size) || 0);
        streamItem.appendChild(sz);
      }
      const playBtn = document.createElement('button');
      playBtn.className = 'btn btn-primary';
      playBtn.style.cssText = 'padding:0.2rem 0.6rem;font-size:0.75rem;';
      playBtn.textContent = '▶';
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playStreamResult(s);
        return;
        e.target.closest('.detail-modal-overlay')?.remove();
        if (s._type === 'direct') {
          if (s.sourceType === 'online') {
            const provider = skonlineProvider || (typeof SktorrentProvider !== 'undefined' ? SktorrentProvider : null);
            provider && provider.getStream
              ? provider.getStream(s).then(stream => { if (stream && stream.url) playDirectStream(stream.url, s.title || s.name); else showStatus('Nie je k dispozicii priamy stream', true); })
              : showStatus('Nie je k dispozicii priamy stream', true);
          } else if (s.url) playDirectStream(s.url, s.title || s.name);
          else showStatus('Nie je k dispozícii priamy stream', true);
        } else if (s.info_hash) {
          addFromInfoHash(s.info_hash, s.name);
        } else if (s.detailUrl && typeof SktorrentProvider !== 'undefined') {
          SktorrentProvider.getStream(s).then(stream => { if (stream && stream.url) addTorrent(stream.url); });
        }
      });
      streamItem.appendChild(playBtn);
      streamsList.appendChild(streamItem);
    });
  } else {
    streamsList.innerHTML = '<div style="color:var(--text-secondary);font-size:0.85rem;">Pre tento film nie sú k dispozícii žiadne streamy. Skúste vyhľadať názov.</div>';
  }
}

// ============================================
// 28. DIRECT STREAM PLAYER
// ============================================

async function playStreamResult(item) {
  const ov = document.querySelector('.detail-modal-overlay');
  if (ov) ov.remove();
  if (item._type === 'torrent-url' && item.torrentUrl) {
    addTorrent(item.torrentUrl);
  } else if (item._type === 'direct') {
    if (item.sourceType === 'online') {
      const provider = skonlineProvider || (typeof SktorrentProvider !== 'undefined' ? SktorrentProvider : null);
      const stream = provider && provider.getStream ? await provider.getStream(item) : null;
      if (stream && stream.url) playDirectStream(stream.url, item.title || item.name);
      else showStatus('Nie je k dispozicii priamy stream', true);
    } else if (typeof WebshareProvider !== 'undefined' && item.sourceType === 'webshare') {
      const stream = await WebshareProvider.getStream(item);
      if (stream && stream.url) playDirectStream(stream.url, item.title || item.name);
      else showStatus('Nepodarilo sa ziskat stream', true);
    } else if (item.url) {
      playDirectStream(item.url, item.title || item.name);
    } else {
      showStatus('Nie je k dispozicii priamy stream', true);
    }
  } else if (item.info_hash) {
    addFromInfoHash(item.info_hash, item.name || item.title);
  } else if (item.detailUrl && typeof SktorrentProvider !== 'undefined') {
    const stream = await SktorrentProvider.getStream(item);
    if (stream && stream.url) addTorrent(stream.url);
    else showStatus('Nepodarilo sa ziskat magnet link', true);
  } else {
    showStatus('Nepodporovany typ zdroja', true);
  }
}

function playDirectStream(url, title) {
  stopStream();
  videoModalTitle.textContent = title || 'Priamy stream';
  videoElement.src = url;
  videoModal.style.display = 'flex';
  loadingOverlay.classList.remove('hidden');
  videoElement.play().catch(err => {
    loadingOverlay.classList.add('hidden');
    showStatus('Chyba prehravania: ' + err.message, true);
  });
  showStatus('Prehrávam priamy stream');
}

// ============================================
// 29. INIT
// ============================================

async function init() {
  renderHomePage();
  // Logo click -> home
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.addEventListener('click', (e) => {
      e.preventDefault();
      resultsSection.style.display = 'none';
      if (browseRows) browseRows.style.display = 'block';
      renderHomePage();
    });
  }
  // Favorites button
  const favNavBtn = document.querySelector('.nav-fav-btn');
  if (favNavBtn) {
    favNavBtn.addEventListener('click', () => {
      const favs = getFavorites();
      if (favs.length === 0) { showStatus('Žiadne obľúbené', true); return; }
      resultsSection.style.display = 'block';
      resultsTitle.textContent = 'Obľúbené';
      if (browseRows) browseRows.style.display = 'none';
      currentSearchResults = favs.map(f => ({ ...f, title: f.title, posterUrl: getPosterUrl(f.poster_path), backdropUrl: getBackdropUrl(f.backdrop_path), _provider: 'Obľúbené', _type: 'favorite' }));
      displaySearchResults(currentSearchResults);
    });
  }
  // CZ dubbing checkbox
  const czCheckbox = document.getElementById('cz-dubbing-checkbox');
  if (czCheckbox) {
    czCheckbox.addEventListener('change', () => {
      czDubbingOnly = czCheckbox.checked;
      if (currentSearchResults.length > 0) {
        const filtered = filterByCZDubbing(currentSearchResults);
        currentPage = 0;
        displaySearchResults(filtered);
      }
    });
  }
  // Client-side filter input
  const filterInput = document.getElementById('filter-results');
  if (filterInput) {
    filterInput.addEventListener('input', () => {
      const q = filterInput.value.trim().toLowerCase();
      if (!q) { displaySearchResults(currentSearchResults); return; }
      const filtered = currentSearchResults.filter(r => {
        const title = (r.title || r.name || '').toLowerCase();
        return title.includes(q);
      });
      currentPage = 0;
      displaySearchResults(filtered);
    });
  }
  // Accounts modal
  const accountsBtn = document.getElementById('accounts-btn');
  const accountsModal = document.getElementById('accounts-modal');
  const accountsCloseBtn = document.getElementById('accounts-close-btn');
  if (accountsBtn && accountsModal) {
    accountsBtn.addEventListener('click', () => { accountsModal.style.display = 'flex'; });
    if (accountsCloseBtn) accountsCloseBtn.addEventListener('click', () => { accountsModal.style.display = 'none'; });
    accountsModal.addEventListener('click', (e) => { if (e.target === accountsModal) accountsModal.style.display = 'none'; });
  }
  // Sktorrent credentials
  const skUid = document.getElementById('sktorrent-uid');
  const skPass = document.getElementById('sktorrent-pass');
  const skSaveBtn = document.getElementById('sktorrent-save-btn');
  const skClearBtn = document.getElementById('sktorrent-clear-btn');
  const skStatus = document.getElementById('sktorrent-status');
  if (skSaveBtn && skUid && skPass) {
    // Load existing credentials
    if (typeof SecureStorage !== 'undefined') {
      const creds = SecureStorage.loadCredentials('sktorrent');
      if (creds) {
        skUid.value = creds.uid || '';
        skPass.value = creds.pass || '';
        if (skStatus) skStatus.textContent = '✅ Údaje uložené';
      }
    }
    skSaveBtn.addEventListener('click', () => {
      const uid = skUid.value.trim();
      const pass = skPass.value.trim();
      if (!uid || !pass) { if (skStatus) skStatus.textContent = '❌ Vyplňte obe polia'; return; }
      if (typeof SecureStorage !== 'undefined') {
        SecureStorage.saveCredentials('sktorrent', { uid, pass });
        if (skStatus) skStatus.textContent = '✅ Údaje uložené';
        showStatus('Prihlasovacie údaje pre sktorrent uložené');
      } else {
        if (skStatus) skStatus.textContent = '❌ SecureStorage nie je k dispozícii';
      }
    });
    if (skClearBtn) {
      skClearBtn.addEventListener('click', () => {
        skUid.value = '';
        skPass.value = '';
        if (typeof SecureStorage !== 'undefined') {
          SecureStorage.removeCredentials('sktorrent');
        }
        if (skStatus) skStatus.textContent = '🗑️ Údaje vymazané';
        showStatus('Prihlasovacie údaje pre sktorrent vymazané');
      });
    }
  }
  // online.sktorrent.eu login
  const skOnlineUsername = document.getElementById('skonline-username');
  const skOnlinePassword = document.getElementById('skonline-password');
  const skOnlineLoginBtn = document.getElementById('skonline-login-btn');
  const skOnlineClearBtn = document.getElementById('skonline-clear-btn');
  const skOnlineStatus = document.getElementById('skonline-status');
  
  // Načíta uložené prihlasovacie údaje a automaticky vytvorí providera
  function loadSktorrentOnlineCredentials() {
    let savedUser = null;
    let savedPass = null;
    if (typeof SecureStorage !== 'undefined') {
      const creds = SecureStorage.loadCredentials('skonline');
      if (creds) {
        savedUser = creds.username || '';
        savedPass = creds.password || '';
      }
    }
    // Fallback na localStorage (pre prípad, že SecureStorage nie je k dispozícii)
    if (!savedUser || !savedPass) {
      savedUser = localStorage.getItem('skonline_user') || '';
      savedPass = localStorage.getItem('skonline_pass') || '';
    }
    if (skOnlineUsername && savedUser) skOnlineUsername.value = savedUser;
    if (skOnlinePassword && savedPass) skOnlinePassword.value = savedPass;
    if (savedUser && savedPass) {
      // Vytvoríme inštanciu providera
      skonlineProvider = new SktorrentOnlineProvider(savedUser, savedPass);
      // Pokúsime sa prihlásiť na pozadí
      skonlineProvider.login().then(success => {
        if (skOnlineStatus) {
          skOnlineStatus.textContent = success ? '✅ Prihlásený ako ' + savedUser : '❌ Prihlásenie zlyhalo';
          skOnlineStatus.style.color = success ? 'var(--success)' : 'var(--accent)';
        }
        if (success) console.log('SktorrentOnline: Automatické prihlásenie úspešné');
        else console.warn('SktorrentOnline: Automatické prihlásenie zlyhalo');
      });
    } else {
      if (skOnlineStatus) skOnlineStatus.textContent = '⚠️ Zadajte prihlasovacie údaje pre online.sktorrent.eu';
    }
  }
  
  loadSktorrentOnlineCredentials();
  
  if (skOnlineLoginBtn && skOnlineUsername && skOnlinePassword) {
    skOnlineLoginBtn.addEventListener('click', async () => {
      const user = skOnlineUsername.value.trim();
      const pass = skOnlinePassword.value.trim();
      if (!user || !pass) {
        if (skOnlineStatus) { skOnlineStatus.textContent = '❌ Vyplňte obe polia'; skOnlineStatus.style.color = 'var(--accent)'; }
        return;
      }
      if (skOnlineStatus) { skOnlineStatus.textContent = '⏳ Prihlasujem...'; skOnlineStatus.style.color = 'var(--text-secondary)'; }
      // Vytvoríme novú inštanciu
      skonlineProvider = new SktorrentOnlineProvider(user, pass);
      const success = await skonlineProvider.login();
      if (success) {
        // Uložíme údaje
        if (typeof SecureStorage !== 'undefined') {
          SecureStorage.saveCredentials('skonline', { username: user, password: pass });
        }
        localStorage.setItem('skonline_user', user);
        localStorage.setItem('skonline_pass', pass);
        if (skOnlineStatus) { skOnlineStatus.textContent = '✅ Prihlásený ako ' + user; skOnlineStatus.style.color = 'var(--success)'; }
        showStatus('Prihlásený na online.sktorrent.eu');
      } else {
        if (skOnlineStatus) { skOnlineStatus.textContent = '❌ Prihlásenie zlyhalo. Skontrolujte údaje.'; skOnlineStatus.style.color = 'var(--accent)'; }
        showStatus('Prihlásenie na online.sktorrent.eu zlyhalo', true);
        skonlineProvider = null;
      }
    });
  }
  
  if (skOnlineClearBtn) {
    skOnlineClearBtn.addEventListener('click', () => {
      if (skOnlineUsername) skOnlineUsername.value = '';
      if (skOnlinePassword) skOnlinePassword.value = '';
      if (typeof SecureStorage !== 'undefined') {
        SecureStorage.removeCredentials('skonline');
      }
      localStorage.removeItem('skonline_user');
      localStorage.removeItem('skonline_pass');
      skonlineProvider = null;
      if (skOnlineStatus) { skOnlineStatus.textContent = '🗑️ Odhlásené'; skOnlineStatus.style.color = 'var(--text-secondary)'; }
      showStatus('Odhlásený z online.sktorrent.eu');
    });
  }
  
  // Webshare login (official webshare.cz API)
  const webshareUsername = document.getElementById('webshare-username');
  const websharePassword = document.getElementById('webshare-password');
  const webshareLoginBtn = document.getElementById('webshare-login-btn');
  const webshareClearBtn = document.getElementById('webshare-clear-btn');
  const webshareStatus = document.getElementById('webshare-status');

  async function loginWebshareFromFields(showMessages = true) {
    if (typeof WebshareProvider === 'undefined') return false;
    const user = webshareUsername?.value.trim() || '';
    const pass = websharePassword?.value || '';
    if (!user || !pass) {
      if (webshareStatus) { webshareStatus.textContent = 'Vyplnte Webshare meno/e-mail a heslo'; webshareStatus.style.color = 'var(--accent)'; }
      return false;
    }
    if (webshareStatus) { webshareStatus.textContent = 'Prihlasujem do Webshare...'; webshareStatus.style.color = 'var(--text-secondary)'; }
    const result = await WebshareProvider.login(user, pass);
    if (result.ok) {
      if (typeof SecureStorage !== 'undefined') SecureStorage.saveCredentials('webshare', { username: user, password: pass, token: result.token });
      if (webshareStatus) { webshareStatus.textContent = 'Prihlaseny do Webshare'; webshareStatus.style.color = 'var(--success)'; }
      if (showMessages) showStatus('Webshare prihlasenie uspesne');
      return true;
    }
    if (webshareStatus) { webshareStatus.textContent = 'Webshare login zlyhal: ' + result.error; webshareStatus.style.color = 'var(--accent)'; }
    if (showMessages) showStatus('Webshare login zlyhal: ' + result.error, true);
    return false;
  }

  if (typeof SecureStorage !== 'undefined' && typeof WebshareProvider !== 'undefined') {
    const saved = SecureStorage.loadCredentials('webshare');
    if (saved) {
      if (webshareUsername) webshareUsername.value = saved.username || '';
      if (websharePassword) websharePassword.value = saved.password || '';
      if (saved.token) WebshareProvider.setSession({ username: saved.username, token: saved.token });
      if (webshareStatus) {
        webshareStatus.textContent = saved.token ? 'Webshare token ulozeny' : 'Webshare udaje ulozene';
        webshareStatus.style.color = 'var(--success)';
      }
      if (saved.username && saved.password) loginWebshareFromFields(false);
    }
  }

  if (webshareLoginBtn) webshareLoginBtn.addEventListener('click', () => loginWebshareFromFields(true));
  if (webshareClearBtn) {
    webshareClearBtn.addEventListener('click', () => {
      if (webshareUsername) webshareUsername.value = '';
      if (websharePassword) websharePassword.value = '';
      if (typeof SecureStorage !== 'undefined') SecureStorage.removeCredentials('webshare');
      if (typeof WebshareProvider !== 'undefined') WebshareProvider.setSession(null);
      if (webshareStatus) { webshareStatus.textContent = 'Webshare odhlaseny'; webshareStatus.style.color = 'var(--text-secondary)'; }
      showStatus('Webshare udaje vymazane');
    });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const detailOverlay = document.querySelector('.detail-modal-overlay');
      if (detailOverlay) detailOverlay.remove();
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const active = document.activeElement;
      if (active && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInput.focus();
      }
    }
  });
}

// Run init when DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose for debugging
window.TorrentStream = {
  search: performSearch,
  addTorrent,
  stopStream,
  playDirectStream,
  openDetailModal,
  renderHomePage,
  getFavorites,
  addToFavorites,
  removeFromFavorites
};

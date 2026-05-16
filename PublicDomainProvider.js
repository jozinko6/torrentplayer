/* ============================================
   PublicDomainProvider.js - legal/public torrents
   Uses Internet Archive public APIs.
   ============================================ */

const PublicDomainProvider = (() => {
  const SEARCH_URL = 'https://archive.org/advancedsearch.php';

  function qualityFromName(name) {
    const match = String(name || '').match(/\b(2160p|1080p|720p|480p|360p|4k|hd|sd)\b/i);
    return match ? match[1].toUpperCase() : 'Public';
  }

  async function search(query) {
    if (!query || query.trim().length < 2) return [];
    const params = new URLSearchParams({
      q: `(${query.trim()}) AND mediatype:movies`,
      fl: 'identifier,title,year,description,downloads,item_size',
      rows: '25',
      page: '1',
      output: 'json'
    });
    try {
      const res = await fetch(`${SEARCH_URL}?${params.toString()}`);
      if (!res.ok) return [];
      const data = await res.json();
      const docs = data?.response?.docs || [];
      return docs.map(item => {
        const title = item.title || item.identifier;
        const torrentUrl = `https://archive.org/download/${encodeURIComponent(item.identifier)}/${encodeURIComponent(item.identifier)}_archive.torrent`;
        return {
          id: `ia_${item.identifier}`,
          ident: item.identifier,
          title,
          originalName: title,
          name: title,
          year: item.year || '',
          overview: Array.isArray(item.description) ? item.description[0] : (item.description || ''),
          source: 'Internet Archive',
          sourceType: 'public-domain',
          provider: 'Free / Public domain',
          quality: qualityFromName(title),
          language: 'Free / Public domain',
          type: 'movie',
          contentType: 'film',
          seeders: Number(item.downloads) || 0,
          peers: Number(item.downloads) || 0,
          size: Number(item.item_size) || 0,
          torrentUrl,
          url: torrentUrl,
          posterUrl: `https://archive.org/services/img/${encodeURIComponent(item.identifier)}`,
          _provider: 'Free / Public domain',
          _providerBadge: 'FREE',
          _type: 'torrent-url',
          legal: true
        };
      });
    } catch (err) {
      console.warn('PublicDomainProvider.search error:', err.message);
      return [];
    }
  }

  return { search };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PublicDomainProvider;
}

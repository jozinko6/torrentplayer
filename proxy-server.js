// Simple CORS proxy server - supports GET/POST and keeps a tiny in-memory cookie jar
const http = require('http');
const https = require('https');

const PORT = 8080;
const cookieJar = new Map();

function getCookieHeader(hostname) {
  const cookies = cookieJar.get(hostname);
  if (!cookies) return '';
  return Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join('; ');
}

function storeSetCookie(hostname, setCookie) {
  if (!setCookie) return;
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  const cookies = cookieJar.get(hostname) || {};

  values.forEach(header => {
    String(header).split(/,(?=\s*[^;,]+=)/).forEach(part => {
      const pair = part.split(';')[0].trim();
      const eq = pair.indexOf('=');
      if (eq > 0) cookies[pair.slice(0, eq)] = pair.slice(eq + 1);
    });
  });

  cookieJar.set(hostname, cookies);
}

const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
  res.setHeader('Access-Control-Expose-Headers', 'X-Set-Cookie, Location, Content-Length, Content-Range, Accept-Ranges, Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Get the target URL from the request path (remove leading /)
  const targetUrl = req.url.slice(1);
  
  if (!targetUrl || !targetUrl.startsWith('http')) {
    res.writeHead(400);
    res.end('Usage: GET /<target-url>');
    return;
  }

  console.log('Proxying:', req.method, targetUrl);

  // Determine if http or https
  const client = targetUrl.startsWith('https') ? https : http;

  const options = new URL(targetUrl);
  options.method = req.method;
  options.headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': req.headers.accept || 'application/json, text/plain, */*'
  };

  // Forward important headers from the original request
  const forwardHeaders = ['content-type', 'authorization', 'x-requested-with', 'range', 'if-range'];
  forwardHeaders.forEach(h => {
    if (req.headers[h]) {
      options.headers[h.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-')] = req.headers[h];
    }
  });

  if (req.headers['x-referer']) {
    options.headers.Referer = req.headers['x-referer'];
  } else {
    options.headers.Referer = options.origin + '/';
  }

  if (req.headers['x-origin']) {
    options.headers.Origin = req.headers['x-origin'];
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    options.headers.Origin = options.origin;
  }

  const requestCookie = req.headers['x-cookie'] || req.headers.cookie || getCookieHeader(options.hostname);
  if (requestCookie) {
    options.headers.Cookie = requestCookie;
  }

  // Collect request body for POST
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    body = Buffer.concat(body);

    const proxyReq = client.request(options, (proxyRes) => {
      // Forward response headers
      const headers = { ...proxyRes.headers };
      storeSetCookie(options.hostname, proxyRes.headers['set-cookie']);

      if (proxyRes.headers['set-cookie']) {
        headers['x-set-cookie'] = Array.isArray(proxyRes.headers['set-cookie'])
          ? proxyRes.headers['set-cookie'].join(', ')
          : proxyRes.headers['set-cookie'];
      }

      // Remove problematic headers
      delete headers['content-security-policy'];
      delete headers['x-frame-options'];
      delete headers['access-control-allow-origin'];
      delete headers['access-control-allow-credentials'];
      
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      console.error('Proxy error:', err.message);
      res.writeHead(500);
      res.end('Proxy error: ' + err.message);
    });

    // Forward body for POST
    if (body.length > 0) {
      proxyReq.write(body);
    }
    proxyReq.end();
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log('CORS proxy uz bezi na porte ' + PORT + ' (port je obsadeny)');
    console.log('Ak chcete proxy restartovat, najprv ukoncite beziacu instanciu.');
    process.exit(0);
  } else {
    console.error('Chyba servera:', err.message);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log('CORS proxy server running on http://localhost:' + PORT);
  console.log('Usage: fetch("http://localhost:' + PORT + '/https://apibay.org/q.php?q=...")');
});

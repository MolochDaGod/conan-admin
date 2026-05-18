const http = require('http');

function httpGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(url, { headers }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function httpPost(url, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const postData = typeof data === 'string' ? data : JSON.stringify(data);
    const opts = {
      hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search,
      method: 'POST',
      headers: { 'Content-Length': Buffer.byteLength(postData), ...headers }
    };
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  try {
    // Step 1: Get login page
    console.log('Fetching gateway login page...');
    const page = await httpGet('http://10.0.0.1/');
    const cookies = page.headers['set-cookie'] || [];
    console.log('Cookies:', cookies.map(c => c.split(';')[0]));

    // Extract form fields
    const inputs = page.body.match(/<input[^>]+>/gi) || [];
    inputs.forEach(i => console.log('Input:', i.replace(/\s+/g, ' ').substring(0, 100)));

    // Check what auth mechanism is used
    if (page.body.includes('password')) console.log('\nHas password field');
    if (page.body.includes('csrf')) console.log('Has CSRF protection');
    if (page.body.includes('ajax')) console.log('Uses AJAX');

    // Look for JavaScript API endpoints
    const apiCalls = page.body.match(/(?:url|href|action|src)\s*[:=]\s*["'][^"']*(?:port|forward|firewall|nat|dmz)[^"']*/gi) || [];
    if (apiCalls.length) {
      console.log('\nPort-related endpoints found:');
      apiCalls.forEach(a => console.log(' ', a));
    }

    // Check for common Xfinity gateway API paths
    console.log('\nProbing known Xfinity API paths...');
    const paths = [
      '/actionHandler/ajax_port_forwarding.php',
      '/actionHandler/ajaxSet_port_forwarding.php',
      '/port_forwarding.jst',
      '/connected_devices_computers.jst',
      '/at_a_glance.jst',
    ];
    for (const p of paths) {
      try {
        const r = await httpGet(`http://10.0.0.1${p}`);
        if (r.status !== 404 && r.status !== 302) {
          console.log(`  ${p} -> ${r.status} (${r.body.length} bytes)`);
        }
      } catch {}
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

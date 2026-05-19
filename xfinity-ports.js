const http = require('http');

function get(path, cookies) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: '10.0.0.1', port: 80, path, headers: {} };
    if (cookies) opts.headers.Cookie = cookies;
    http.get(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function post(path, data, cookies, contentType) {
  return new Promise((resolve, reject) => {
    const postData = typeof data === 'string' ? data : JSON.stringify(data);
    const opts = {
      hostname: '10.0.0.1', port: 80, path, method: 'POST',
      headers: {
        'Content-Type': contentType || 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      }
    };
    if (cookies) opts.headers.Cookie = cookies;
    const req = http.request(opts, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        const newCookies = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        resolve({ status: res.statusCode, headers: res.headers, body, cookies: newCookies });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

(async () => {
  try {
    // Step 1: Get login page
    console.log('Getting login page...');
    const loginPage = await get('/');
    const setCookies = (loginPage.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    console.log('Cookies:', setCookies || 'none');

    // Try default Xfinity credentials: admin/password, then cusadmin/highspeed
    const creds = [
      { user: 'admin', pass: 'password' },
      { user: 'cusadmin', pass: 'highspeed' },
      { user: 'admin', pass: 'admin' },
    ];

    let sessionCookie = '';
    for (const cred of creds) {
      console.log(`Trying ${cred.user}/${cred.pass}...`);
      const result = await post('/check.jst', `username=${cred.user}&password=${cred.pass}&locale=en-us`, setCookies);
      if (result.cookies && !result.body.includes('invalid') && !result.body.includes('incorrect') && !result.body.includes('failed')) {
        console.log('LOGIN OK with', cred.user);
        sessionCookie = result.cookies || setCookies;
        
        // Try to access port forwarding page
        const pfPage = await get('/port_forwarding.jst', sessionCookie);
        console.log('Port forwarding page:', pfPage.status, pfPage.body.length, 'bytes');
        
        // Try the AJAX endpoint
        const pfData = await get('/actionHandler/ajax_port_forwarding.php', sessionCookie);
        if (pfData.body.includes('port') || pfData.body.length > 500) {
          console.log('Port forwarding data accessible!');
          console.log(pfData.body.substring(0, 500));
        } else {
          console.log('Port forwarding response:', pfData.body.substring(0, 200));
        }
        break;
      } else {
        console.log('Failed:', result.body.substring(0, 100));
      }
    }

    if (!sessionCookie) {
      console.log('\nAll default passwords failed.');
      console.log('You need to log into http://10.0.0.1 manually.');
      console.log('Check the sticker on your Xfinity gateway for the password.');
      console.log('Or reset it via the Xfinity app on your phone.');
    }

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

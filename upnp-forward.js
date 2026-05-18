// Direct UPnP SOAP port forwarding - bypasses Windows COM API
// Works better with Xfinity gateways that ignore COM-based UPnP

const dgram = require('dgram');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PORTS = [
  { ext: 7777, int: 7777, proto: 'UDP', ip: '10.0.0.132', desc: 'Conan Game' },
  { ext: 7778, int: 7778, proto: 'UDP', ip: '10.0.0.132', desc: 'Conan Game Raw' },
  { ext: 27015, int: 27015, proto: 'UDP', ip: '10.0.0.132', desc: 'Conan Steam Query' },
];

// Step 1: SSDP discover gateway
function discover() {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    const msg = Buffer.from(
      'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 3\r\n' +
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n'
    );
    sock.send(msg, 1900, '239.255.255.250');
    sock.on('message', (data) => {
      const text = data.toString();
      const loc = text.match(/LOCATION:\s*(.+)/i);
      if (loc) { sock.close(); resolve(loc[1].trim()); }
    });
    setTimeout(() => { sock.close(); reject(new Error('No UPnP gateway found')); }, 5000);
  });
}

// Step 2: Get device description and find WANIPConnection control URL
function getControlUrl(descUrl) {
  return new Promise((resolve, reject) => {
    http.get(descUrl, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        // Find WANIPConnection or WANPPPConnection service
        const match = body.match(/<serviceType>urn:schemas-upnp-org:service:WANIP(Connection|PPPConnection):1<\/serviceType>[\s\S]*?<controlURL>([^<]+)<\/controlURL>/);
        if (match) {
          const base = new URL(descUrl);
          const controlPath = match[2];
          const controlUrl = controlPath.startsWith('http') ? controlPath : `${base.origin}${controlPath}`;
          console.log('Control URL:', controlUrl);
          resolve({ url: controlUrl, type: match[1] === 'PPPConnection' ? 'PPP' : 'IP' });
        } else {
          // Try alternate pattern
          const alt = body.match(/<controlURL>([^<]*[Ww][Aa][Nn][^<]*)<\/controlURL>/);
          if (alt) {
            const base = new URL(descUrl);
            resolve({ url: `${base.origin}${alt[1]}`, type: 'IP' });
          } else {
            reject(new Error('Could not find WANIPConnection control URL'));
          }
        }
      });
    }).on('error', reject);
  });
}

// Step 3: Send SOAP AddPortMapping
function addPortMapping(controlUrl, serviceType, rule) {
  const svcUrn = `urn:schemas-upnp-org:service:WAN${serviceType === 'PPP' ? 'PPP' : 'IP'}Connection:1`;
  const soap = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:AddPortMapping xmlns:u="${svcUrn}">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${rule.ext}</NewExternalPort>
      <NewProtocol>${rule.proto}</NewProtocol>
      <NewInternalPort>${rule.int}</NewInternalPort>
      <NewInternalClient>${rule.ip}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>${rule.desc}</NewPortMappingDescription>
      <NewLeaseDuration>0</NewLeaseDuration>
    </u:AddPortMapping>
  </s:Body>
</s:Envelope>`;

  return new Promise((resolve, reject) => {
    const url = new URL(controlUrl);
    const opts = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset="utf-8"',
        'Content-Length': Buffer.byteLength(soap),
        'SOAPAction': `"${svcUrn}#AddPortMapping"`,
      }
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ ok: true, port: rule.ext, proto: rule.proto });
        } else {
          // 718 = ConflictInMappingEntry (already exists) — that's fine
          if (body.includes('718')) {
            resolve({ ok: true, port: rule.ext, proto: rule.proto, note: 'already exists' });
          } else {
            resolve({ ok: false, port: rule.ext, status: res.statusCode, body: body.substring(0, 200) });
          }
        }
      });
    });
    req.on('error', e => resolve({ ok: false, port: rule.ext, error: e.message }));
    req.write(soap);
    req.end();
  });
}

// Main
(async () => {
  try {
    console.log('Discovering UPnP gateway...');
    const descUrl = await discover();
    console.log('Gateway:', descUrl);

    const { url: controlUrl, type } = await getControlUrl(descUrl);
    console.log(`Service type: WAN${type}Connection\n`);

    for (const rule of PORTS) {
      const result = await addPortMapping(controlUrl, type, rule);
      if (result.ok) {
        console.log(`✓ ${rule.proto} ${rule.ext} -> ${rule.ip}:${rule.int} [${rule.desc}]${result.note ? ' (' + result.note + ')' : ''}`);
      } else {
        console.log(`✗ ${rule.proto} ${rule.ext} FAILED:`, result.body || result.error);
      }
    }

    // Verify with external check
    console.log('\nVerifying external reachability...');
    const { exec } = require('child_process');
    exec('node -e "const d=require(\'dgram\'),c=d.createSocket(\'udp4\');c.send(Buffer.from([0xFF,0xFF,0xFF,0xFF,0x54,0x53,0x6F,0x75,0x72,0x63,0x65,0x20,0x45,0x6E,0x67,0x69,0x6E,0x65,0x20,0x51,0x75,0x65,0x72,0x79,0x00]),27015,\'76.31.186.50\',e=>{});c.on(\'message\',m=>{let i=6;const rs=()=>{let s=\'\';while(m[i]!==0)s+=String.fromCharCode(m[i++]);i++;return s};console.log(\'EXTERNAL QUERY OK:\',rs());c.close()});setTimeout(()=>{console.log(\'External query: no response (NAT hairpin may block self-test)\');c.close()},4000)"', (e, out) => {
      console.log(out.trim());
    });

  } catch (e) {
    console.error('Error:', e.message);
  }
})();

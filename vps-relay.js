const dgram = require("dgram");
const net = require("net");

const PORTS = [9300, 9301, 27015];
const TCP_HOST = "127.0.0.1";
const TCP_PORT = 19300;

PORTS.forEach(port => {
  const udpServer = dgram.createSocket("udp4");
  const clients = new Map();
  
  udpServer.on("message", (msg, rinfo) => {
    const key = rinfo.address + ":" + rinfo.port;
    
    if (!clients.has(key)) {
      const tcp = net.connect(TCP_PORT, TCP_HOST);
      tcp.on("data", data => {
        while (data.length >= 6) {
          const len = data.readUInt32LE(0);
          const payload = data.slice(6, 6 + len);
          udpServer.send(payload, rinfo.port, rinfo.address);
          data = data.slice(6 + len);
        }
      });
      tcp.on("error", () => clients.delete(key));
      tcp.on("close", () => clients.delete(key));
      clients.set(key, { tcp, lastSeen: Date.now() });
      setTimeout(() => { if (clients.has(key)) { clients.get(key).tcp.end(); clients.delete(key); } }, 300000);
    }
    
    const client = clients.get(key);
    client.lastSeen = Date.now();
    const header = Buffer.alloc(6);
    header.writeUInt32LE(msg.length, 0);
    header.writeUInt16LE(rinfo.port, 4);
    client.tcp.write(Buffer.concat([header, msg]));
  });
  
  udpServer.bind(port, "0.0.0.0", () => console.log(`VPS relay: UDP ${port} -> TCP tunnel`));
});

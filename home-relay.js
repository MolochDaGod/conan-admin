const dgram = require("dgram");
const net = require("net");

const UDP_HOST = "127.0.0.1";
const UDP_PORT = 9300;
const TCP_PORT = 19300;
const clients = new Map();

const tcpServer = net.createServer(tcp => {
  console.log("TCP client connected");
  const udp = dgram.createSocket("udp4");
  
  tcp.on("data", data => {
    // First 6 bytes: 4 byte length + 2 byte client port
    while (data.length >= 6) {
      const len = data.readUInt32LE(0);
      const port = data.readUInt16LE(4);
      const payload = data.slice(6, 6 + len);
      udp.send(payload, UDP_PORT, UDP_HOST);
      data = data.slice(6 + len);
    }
  });
  
  udp.on("message", (msg, rinfo) => {
    const header = Buffer.alloc(6);
    header.writeUInt32LE(msg.length, 0);
    header.writeUInt16LE(rinfo.port, 4);
    tcp.write(Buffer.concat([header, msg]));
  });
  
  tcp.on("close", () => { udp.close(); console.log("TCP disconnected"); });
  tcp.on("error", () => { udp.close(); });
});

tcpServer.listen(TCP_PORT, "0.0.0.0", () => console.log(`Home relay: TCP ${TCP_PORT} <-> UDP ${UDP_PORT}`));

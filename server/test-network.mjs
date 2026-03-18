import net from 'net';

const targets = [
  { host: '192.168.2.1', port: 3200, label: 'gateway:3200' },
  { host: '192.168.2.150', port: 3022, label: 'local-model:3022' },
  { host: '192.168.2.150', port: 80, label: 'local-model:80' },
  { host: '127.0.0.1', port: 3100, label: 'localhost:3100' },
];

console.log(`PID: ${process.pid}, PPID: ${process.ppid}`);
console.log(`Node: ${process.execPath}`);
console.log(`---`);

for (const { host, port, label } of targets) {
  await new Promise((resolve) => {
    const s = net.createConnection({ host, port, timeout: 3000 });
    s.on('connect', () => {
      console.log(`${label.padEnd(25)} -> SUCCESS`);
      s.destroy();
      resolve();
    });
    s.on('error', (e) => {
      console.log(`${label.padEnd(25)} -> FAILED: ${e.message}`);
      resolve();
    });
    s.on('timeout', () => {
      console.log(`${label.padEnd(25)} -> TIMEOUT`);
      s.destroy();
      resolve();
    });
  });
}

process.exit(0);

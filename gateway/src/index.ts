import { createGatewayServer } from './server.js';

const PORT = parseInt(process.env.GATEWAY_PORT || '3200', 10);
if (isNaN(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Error: GATEWAY_PORT must be a valid port number (1-65535), got: ${process.env.GATEWAY_PORT}`);
  process.exit(1);
}

const GATEWAY_SECRET = process.env.GATEWAY_SECRET;
if (!GATEWAY_SECRET) {
  console.error('Error: GATEWAY_SECRET environment variable is required');
  process.exit(1);
}

const server = createGatewayServer({
  gatewaySecret: GATEWAY_SECRET,
  trustProxy: process.env.GATEWAY_TRUST_PROXY === 'true',
});

server.listen(PORT, () => {
  console.log(`Gateway server listening on port ${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
});

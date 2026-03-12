#!/usr/bin/env node

import WebSocket from 'ws';

const GATEWAY_URL = 'ws://localhost:3200/ws';
const GATEWAY_SECRET = 'test-secret-my-claudia-2026';

console.log('🧪 Testing Gateway WebSocket connection...\n');

// Test 1: Client authentication with correct secret
console.log('Test 1: Client authentication (correct secret)');
const client1 = new WebSocket(GATEWAY_URL);

client1.on('open', () => {
  console.log('✅ WebSocket connected');

  // Send auth message
  client1.send(JSON.stringify({
    type: 'gateway_auth',
    gatewaySecret: GATEWAY_SECRET
  }));
});

client1.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📨 Received:', message);

  if (message.type === 'gateway_auth_result' && message.success) {
    console.log('✅ Client authenticated successfully\n');

    // Test list backends
    console.log('Test 2: List backends');
    client1.send(JSON.stringify({
      type: 'list_backends'
    }));
  }

  if (message.type === 'backends_list') {
    console.log('✅ Backends list received:', message.backends);
    console.log(`   Total backends: ${message.backends.length}\n`);

    // Close after successful test
    setTimeout(() => {
      client1.close();
      testWrongSecret();
    }, 500);
  }
});

client1.on('error', (error) => {
  console.error('❌ WebSocket error:', error);
  process.exit(1);
});

// Test 2: Authentication with wrong secret
function testWrongSecret() {
  console.log('Test 3: Client authentication (wrong secret)');
  const client2 = new WebSocket(GATEWAY_URL);

  client2.on('open', () => {
    console.log('✅ WebSocket connected');

    client2.send(JSON.stringify({
      type: 'gateway_auth',
      gatewaySecret: 'wrong-secret'
    }));
  });

  client2.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📨 Received:', message);

    if (message.type === 'gateway_auth_result' && !message.success) {
      console.log('✅ Authentication correctly rejected\n');
      console.log('🎉 All tests passed!');
      process.exit(0);
    }
  });

  client2.on('close', () => {
    console.log('✅ Connection closed as expected\n');
    console.log('🎉 All tests passed!');
    process.exit(0);
  });
}

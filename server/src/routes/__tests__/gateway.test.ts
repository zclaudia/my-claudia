import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import Database from 'better-sqlite3';
import { createGatewayRouter, GatewayConfig, GatewayStatus } from '../gateway.js';

describe('Gateway API Integration Tests', () => {
  let app: express.Application;
  let db: Database.Database;
  let mockGetGatewayStatus: ReturnType<typeof vi.fn>;
  let mockConnectGateway: ReturnType<typeof vi.fn>;
  let mockDisconnectGateway: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create in-memory database with schema
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS gateway_config (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        gateway_url TEXT,
        gateway_secret TEXT,
        backend_name TEXT,
        backend_id TEXT,
        proxy_url TEXT,
        proxy_username TEXT,
        proxy_password TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO gateway_config (id, enabled, created_at, updated_at)
      VALUES (1, 0, ${Date.now()}, ${Date.now()});
    `);

    // Setup mock functions
    mockGetGatewayStatus = vi.fn().mockReturnValue({
      enabled: false,
      connected: false,
      backendId: null,
      gatewayUrl: null,
      backendName: null
    });

    mockConnectGateway = vi.fn().mockResolvedValue(undefined);
    mockDisconnectGateway = vi.fn().mockResolvedValue(undefined);

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/gateway', createGatewayRouter(
      db,
      mockGetGatewayStatus,
      mockConnectGateway,
      mockDisconnectGateway
    ));
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  describe('GET /api/gateway/config', () => {
    it('should return gateway configuration with default values', async () => {
      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        id: 1,
        enabled: false,
        gatewayUrl: null,
        gatewaySecret: null,
        backendName: null,
        backendId: null,
        proxyUrl: null,
        proxyUsername: null,
        proxyPassword: null
      });
      expect(response.body.data.createdAt).toBeDefined();
      expect(response.body.data.updatedAt).toBeDefined();
    });

    it('should mask gatewaySecret when present', async () => {
      // Update config with secret
      db.prepare(`
        UPDATE gateway_config
        SET gateway_url = ?, gateway_secret = ?
        WHERE id = 1
      `).run('https://gateway.example.com', 'my-secret-key');

      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.gatewayUrl).toBe('https://gateway.example.com');
      expect(response.body.data.gatewaySecret).toBe('********');
    });

    it('should mask proxyPassword when present', async () => {
      // Update config with proxy credentials
      db.prepare(`
        UPDATE gateway_config
        SET proxy_url = ?, proxy_username = ?, proxy_password = ?
        WHERE id = 1
      `).run('http://proxy.example.com:8080', 'proxyuser', 'proxypass123');

      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.proxyUrl).toBe('http://proxy.example.com:8080');
      expect(response.body.data.proxyUsername).toBe('proxyuser');
      expect(response.body.data.proxyPassword).toBe('********');
    });

    it('should mask both gatewaySecret and proxyPassword when both present', async () => {
      // Update config with both secrets
      db.prepare(`
        UPDATE gateway_config
        SET gateway_url = ?, gateway_secret = ?, proxy_url = ?, proxy_username = ?, proxy_password = ?
        WHERE id = 1
      `).run(
        'https://gateway.example.com',
        'gateway-secret',
        'http://proxy.example.com:8080',
        'proxyuser',
        'proxypass'
      );

      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.gatewaySecret).toBe('********');
      expect(response.body.data.proxyPassword).toBe('********');
    });

    it('should return null for secrets when not set', async () => {
      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.gatewaySecret).toBe(null);
      expect(response.body.data.proxyPassword).toBe(null);
    });

    it('should handle database errors gracefully', async () => {
      db.close();

      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DATABASE_ERROR');
      expect(response.body.error.message).toBeDefined();
    });
  });

  describe('PUT /api/gateway/config', () => {
    it('should update gateway configuration successfully', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key',
          backendName: 'Test Backend'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        enabled: true,
        gatewayUrl: 'https://gateway.example.com',
        gatewaySecret: '********',
        backendName: 'Test Backend'
      });

      // Verify database was updated
      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.enabled).toBe(1);
      expect(config.gateway_url).toBe('https://gateway.example.com');
      expect(config.gateway_secret).toBe('my-secret-key');
      expect(config.backend_name).toBe('Test Backend');
    });

    it('should update proxy configuration successfully', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUrl: 'http://proxy.example.com:8080',
          proxyUsername: 'proxyuser',
          proxyPassword: 'proxypass123'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        proxyUrl: 'http://proxy.example.com:8080',
        proxyUsername: 'proxyuser',
        proxyPassword: '********'
      });

      // Verify database was updated
      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.proxy_url).toBe('http://proxy.example.com:8080');
      expect(config.proxy_username).toBe('proxyuser');
      expect(config.proxy_password).toBe('proxypass123');
    });

    it('should update both gateway and proxy settings together', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'gateway-secret',
          backendName: 'My Backend',
          proxyUrl: 'http://proxy.example.com:8080',
          proxyUsername: 'proxyuser',
          proxyPassword: 'proxypass123'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.gatewaySecret).toBe('********');
      expect(response.body.data.proxyPassword).toBe('********');

      // Verify all fields in database
      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.gateway_secret).toBe('gateway-secret');
      expect(config.proxy_password).toBe('proxypass123');
    });

    it('should call connectGateway when enabling with valid config', async () => {
      await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key'
        })
        .expect(200);

      expect(mockConnectGateway).toHaveBeenCalledTimes(1);
      expect(mockConnectGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key'
        })
      );
    });

    it('should call disconnectGateway when disabling', async () => {
      // First enable
      await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key'
        });

      mockConnectGateway.mockClear();

      // Then disable
      await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: false
        })
        .expect(200);

      expect(mockDisconnectGateway).toHaveBeenCalledTimes(1);
      expect(mockConnectGateway).not.toHaveBeenCalled();
    });

    it('should validate required fields when enabling', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true
          // Missing gatewayUrl and gatewaySecret
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
      expect(response.body.error.message).toContain('Gateway URL and Secret are required');
    });

    it('should validate gatewayUrl is required when enabling', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewaySecret: 'my-secret-key'
          // Missing gatewayUrl
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate gatewaySecret is required when enabling', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com'
          // Missing gatewaySecret
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should allow partial updates without enabling', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: 'New Backend Name'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.backendName).toBe('New Backend Name');
      expect(mockConnectGateway).not.toHaveBeenCalled();
    });

    it('should update only specified fields', async () => {
      // Set initial values
      db.prepare(`
        UPDATE gateway_config
        SET gateway_url = ?, gateway_secret = ?, backend_name = ?
        WHERE id = 1
      `).run('https://old.example.com', 'old-secret', 'Old Name');

      // Update only backend_name
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: 'New Name'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.backendName).toBe('New Name');
      expect(response.body.data.gatewayUrl).toBe('https://old.example.com');
      expect(response.body.data.gatewaySecret).toBe('********');
    });

    it('should allow clearing fields with null', async () => {
      // Set initial values
      db.prepare(`
        UPDATE gateway_config
        SET proxy_url = ?, proxy_username = ?, proxy_password = ?
        WHERE id = 1
      `).run('http://proxy.example.com', 'user', 'pass');

      // Clear proxy settings
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUrl: null,
          proxyUsername: null,
          proxyPassword: null
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.proxyUrl).toBe(null);
      expect(response.body.data.proxyUsername).toBe(null);
      expect(response.body.data.proxyPassword).toBe(null);
    });

    it('should update updatedAt timestamp', async () => {
      const before = Date.now();

      await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: 'Test'
        })
        .expect(200);

      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.updated_at).toBeGreaterThanOrEqual(before);
    });

    it('should handle connectGateway errors gracefully', async () => {
      mockConnectGateway.mockRejectedValueOnce(new Error('Connection failed'));

      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key'
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UPDATE_FAILED');
      expect(response.body.error.message).toContain('Connection failed');
    });

    it('should handle database errors gracefully', async () => {
      db.close();

      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key'
        })
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('UPDATE_FAILED');
    });

    it('should handle proxy credentials without proxy URL', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUsername: 'user',
          proxyPassword: 'pass'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.proxyUsername).toBe('user');
      expect(response.body.data.proxyPassword).toBe('********');
    });

    it('should handle proxy URL without credentials', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUrl: 'http://proxy.example.com:8080'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.proxyUrl).toBe('http://proxy.example.com:8080');
      expect(response.body.data.proxyUsername).toBe(null);
      expect(response.body.data.proxyPassword).toBe(null);
    });

    it('should pass proxy settings to connectGateway', async () => {
      await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'secret',
          proxyUrl: 'http://proxy.example.com:8080',
          proxyUsername: 'proxyuser',
          proxyPassword: 'proxypass'
        })
        .expect(200);

      expect(mockConnectGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          proxyUrl: 'http://proxy.example.com:8080',
          proxyUsername: 'proxyuser',
          proxyPassword: 'proxypass'
        })
      );
    });
  });

  describe('GET /api/gateway/status', () => {
    it('should return gateway status', async () => {
      mockGetGatewayStatus.mockReturnValue({
        enabled: true,
        connected: true,
        backendId: 'backend-123',
        gatewayUrl: 'https://gateway.example.com',
        backendName: 'Test Backend'
      });

      const response = await request(app)
        .get('/api/gateway/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        enabled: true,
        connected: true,
        backendId: 'backend-123',
        gatewayUrl: 'https://gateway.example.com',
        backendName: 'Test Backend'
      });
    });

    it('should return disconnected status', async () => {
      mockGetGatewayStatus.mockReturnValue({
        enabled: false,
        connected: false,
        backendId: null,
        gatewayUrl: null,
        backendName: null
      });

      const response = await request(app)
        .get('/api/gateway/status')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.connected).toBe(false);
    });

    it('should handle status errors gracefully', async () => {
      mockGetGatewayStatus.mockImplementation(() => {
        throw new Error('Status error');
      });

      const response = await request(app)
        .get('/api/gateway/status')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('STATUS_ERROR');
      expect(response.body.error.message).toContain('Status error');
    });
  });

  describe('POST /api/gateway/connect', () => {
    beforeEach(() => {
      // Setup enabled gateway config
      db.prepare(`
        UPDATE gateway_config
        SET enabled = 1, gateway_url = ?, gateway_secret = ?
        WHERE id = 1
      `).run('https://gateway.example.com', 'my-secret-key');
    });

    it('should connect to gateway successfully', async () => {
      const response = await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Connecting to gateway...');
      expect(mockConnectGateway).toHaveBeenCalledTimes(1);
    });

    it('should pass full config to connectGateway', async () => {
      // Add proxy settings
      db.prepare(`
        UPDATE gateway_config
        SET proxy_url = ?, proxy_username = ?, proxy_password = ?
        WHERE id = 1
      `).run('http://proxy.example.com', 'proxyuser', 'proxypass');

      await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(mockConnectGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret-key',
          proxyUrl: 'http://proxy.example.com',
          proxyUsername: 'proxyuser',
          proxyPassword: 'proxypass'
        })
      );
    });

    it('should fail if gateway is disabled', async () => {
      db.prepare('UPDATE gateway_config SET enabled = 0 WHERE id = 1').run();

      const response = await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DISABLED');
      expect(response.body.error.message).toBe('Gateway is disabled');
      expect(mockConnectGateway).not.toHaveBeenCalled();
    });

    it('should fail if gateway URL is not configured', async () => {
      db.prepare('UPDATE gateway_config SET gateway_url = NULL WHERE id = 1').run();

      const response = await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_CONFIGURED');
      expect(mockConnectGateway).not.toHaveBeenCalled();
    });

    it('should fail if gateway secret is not configured', async () => {
      db.prepare('UPDATE gateway_config SET gateway_secret = NULL WHERE id = 1').run();

      const response = await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_CONFIGURED');
      expect(mockConnectGateway).not.toHaveBeenCalled();
    });

    it('should handle connection errors gracefully', async () => {
      mockConnectGateway.mockRejectedValueOnce(new Error('Connection timeout'));

      const response = await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONNECT_FAILED');
      expect(response.body.error.message).toContain('Connection timeout');
    });

    it('should handle database errors gracefully', async () => {
      db.close();

      const response = await request(app)
        .post('/api/gateway/connect')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('CONNECT_FAILED');
    });
  });

  describe('POST /api/gateway/disconnect', () => {
    it('should disconnect from gateway successfully', async () => {
      const response = await request(app)
        .post('/api/gateway/disconnect')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Disconnected from gateway');
      expect(mockDisconnectGateway).toHaveBeenCalledTimes(1);
    });

    it('should handle disconnection errors gracefully', async () => {
      mockDisconnectGateway.mockRejectedValueOnce(new Error('Disconnect failed'));

      const response = await request(app)
        .post('/api/gateway/disconnect')
        .expect(200);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DISCONNECT_FAILED');
      expect(response.body.error.message).toContain('Disconnect failed');
    });
  });

  describe('Security Tests', () => {
    it('should never expose actual gateway secret in responses', async () => {
      const secret = 'super-secret-key-12345';
      db.prepare(`
        UPDATE gateway_config
        SET gateway_secret = ?
        WHERE id = 1
      `).run(secret);

      // GET config
      const getResponse = await request(app)
        .get('/api/gateway/config')
        .expect(200);
      expect(getResponse.body.data.gatewaySecret).toBe('********');
      expect(JSON.stringify(getResponse.body)).not.toContain(secret);

      // PUT config
      const putResponse = await request(app)
        .put('/api/gateway/config')
        .send({ backendName: 'Test' })
        .expect(200);
      expect(putResponse.body.data.gatewaySecret).toBe('********');
      expect(JSON.stringify(putResponse.body)).not.toContain(secret);
    });

    it('should never expose actual proxy password in responses', async () => {
      const password = 'super-proxy-password-12345';
      db.prepare(`
        UPDATE gateway_config
        SET proxy_password = ?
        WHERE id = 1
      `).run(password);

      // GET config
      const getResponse = await request(app)
        .get('/api/gateway/config')
        .expect(200);
      expect(getResponse.body.data.proxyPassword).toBe('********');
      expect(JSON.stringify(getResponse.body)).not.toContain(password);

      // PUT config
      const putResponse = await request(app)
        .put('/api/gateway/config')
        .send({ backendName: 'Test' })
        .expect(200);
      expect(putResponse.body.data.proxyPassword).toBe('********');
      expect(JSON.stringify(putResponse.body)).not.toContain(password);
    });

    it('should handle SQL injection attempts safely', async () => {
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: "'; DROP TABLE gateway_config; --",
          gatewayUrl: "https://evil.com' OR '1'='1"
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify table still exists and data is stored safely
      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config).toBeDefined();
      expect(config.backend_name).toBe("'; DROP TABLE gateway_config; --");
    });

    it('should handle special characters in proxy credentials', async () => {
      const specialChars = '!@#$%^&*()_+-=[]{}|;:,.<>?`~\'"\\';
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUsername: specialChars,
          proxyPassword: specialChars
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.proxy_username).toBe(specialChars);
      expect(config.proxy_password).toBe(specialChars);
    });

    it('should handle unicode characters in configuration', async () => {
      const unicodeText = '测试 🚀 Тест 🔒';
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: unicodeText,
          proxyUsername: unicodeText
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.backendName).toBe(unicodeText);
      expect(response.body.data.proxyUsername).toBe(unicodeText);
    });

    it('should handle very long input strings', async () => {
      const longString = 'a'.repeat(10000);
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: longString,
          gatewaySecret: longString
        })
        .expect(200);

      expect(response.body.success).toBe(true);

      const config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.backend_name).toBe(longString);
      expect(config.gateway_secret).toBe(longString);
    });

    it('should handle empty strings vs null values correctly', async () => {
      // Set with empty strings
      await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: '',
          proxyUsername: ''
        })
        .expect(200);

      let config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.backend_name).toBe('');
      expect(config.proxy_username).toBe('');

      // Set with null
      await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: null,
          proxyUsername: null
        })
        .expect(200);

      config = db.prepare('SELECT * FROM gateway_config WHERE id = 1').get() as any;
      expect(config.backend_name).toBe(null);
      expect(config.proxy_username).toBe(null);
    });
  });

  describe('URL Validation Tests', () => {
    it('should accept valid HTTPS gateway URLs', async () => {
      const validUrls = [
        'https://gateway.example.com',
        'https://gateway.example.com:8443',
        'https://sub.domain.example.com/path',
        'https://192.168.1.1:8443',
        'https://[::1]:8443'
      ];

      for (const url of validUrls) {
        const response = await request(app)
          .put('/api/gateway/config')
          .send({
            gatewayUrl: url
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.gatewayUrl).toBe(url);
      }
    });

    it('should accept valid HTTP/HTTPS proxy URLs', async () => {
      const validUrls = [
        'http://proxy.example.com:8080',
        'https://proxy.example.com:8443',
        'http://192.168.1.1:3128',
        'socks5://proxy.example.com:1080'
      ];

      for (const url of validUrls) {
        const response = await request(app)
          .put('/api/gateway/config')
          .send({
            proxyUrl: url
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        expect(response.body.data.proxyUrl).toBe(url);
      }
    });

    it('should store any URL format without validation', async () => {
      // Note: The current implementation doesn't validate URLs
      // These tests document the current behavior
      const urls = [
        'not-a-url',
        'ftp://example.com',
        'javascript:alert(1)',
        'data:text/html,<script>alert(1)</script>',
        '../../../etc/passwd'
      ];

      for (const url of urls) {
        const response = await request(app)
          .put('/api/gateway/config')
          .send({
            gatewayUrl: url
          })
          .expect(200);

        expect(response.body.success).toBe(true);
        // Currently no URL validation is performed
      }
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete gateway setup flow', async () => {
      // Step 1: Get initial config
      let response = await request(app)
        .get('/api/gateway/config')
        .expect(200);
      expect(response.body.data.enabled).toBe(false);

      // Step 2: Configure gateway
      response = await request(app)
        .put('/api/gateway/config')
        .send({
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret',
          backendName: 'My Backend',
          proxyUrl: 'http://proxy.example.com:8080',
          proxyUsername: 'proxyuser',
          proxyPassword: 'proxypass'
        })
        .expect(200);
      expect(response.body.success).toBe(true);

      // Step 3: Enable gateway (must include required gatewayUrl/gatewaySecret since validation checks req.body)
      response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'my-secret'
        })
        .expect(200);
      expect(response.body.success).toBe(true);
      expect(mockConnectGateway).toHaveBeenCalled();

      // Step 4: Verify status
      mockGetGatewayStatus.mockReturnValue({
        enabled: true,
        connected: true,
        backendId: 'backend-123',
        gatewayUrl: 'https://gateway.example.com',
        backendName: 'My Backend'
      });

      response = await request(app)
        .get('/api/gateway/status')
        .expect(200);
      expect(response.body.data.connected).toBe(true);
    });

    it('should handle gateway disable flow', async () => {
      // Setup enabled gateway
      await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'secret'
        });

      mockConnectGateway.mockClear();

      // Disable gateway
      const response = await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: false
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(mockDisconnectGateway).toHaveBeenCalled();
      expect(mockConnectGateway).not.toHaveBeenCalled();
    });

    it('should handle proxy update while gateway is enabled', async () => {
      // Setup enabled gateway
      await request(app)
        .put('/api/gateway/config')
        .send({
          enabled: true,
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'secret'
        });

      mockConnectGateway.mockClear();

      // Update proxy settings
      await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUrl: 'http://new-proxy.example.com:8080',
          proxyUsername: 'newuser',
          proxyPassword: 'newpass'
        })
        .expect(200);

      // Should reconnect with new proxy settings
      expect(mockConnectGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          proxyUrl: 'http://new-proxy.example.com:8080',
          proxyUsername: 'newuser',
          proxyPassword: 'newpass'
        })
      );
    });

    it('should maintain configuration integrity across multiple updates', async () => {
      // Update 1: Set gateway config
      await request(app)
        .put('/api/gateway/config')
        .send({
          gatewayUrl: 'https://gateway.example.com',
          gatewaySecret: 'secret1'
        });

      // Update 2: Add proxy config
      await request(app)
        .put('/api/gateway/config')
        .send({
          proxyUrl: 'http://proxy.example.com:8080',
          proxyPassword: 'proxypass'
        });

      // Update 3: Change backend name
      await request(app)
        .put('/api/gateway/config')
        .send({
          backendName: 'Final Name'
        });

      // Verify all values are preserved
      const response = await request(app)
        .get('/api/gateway/config')
        .expect(200);

      expect(response.body.data).toMatchObject({
        gatewayUrl: 'https://gateway.example.com',
        gatewaySecret: '********',
        backendName: 'Final Name',
        proxyUrl: 'http://proxy.example.com:8080',
        proxyPassword: '********'
      });
    });
  });
});

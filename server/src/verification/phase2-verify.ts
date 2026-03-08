/**
 * Phase 2 Verification Script
 *
 * Tests the router-based CRUD operations for all entities:
 * - Projects
 * - Sessions
 * - Servers
 * - Providers
 */

import { initDatabase } from '../storage/db.js';
import { createRouter } from '../router/index.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import { ServerRepository } from '../repositories/server.js';
import { ProviderRepository } from '../repositories/provider.js';
import { authMiddleware } from '../middleware/auth.js';
import { loggingMiddleware } from '../middleware/logging.js';
import { errorHandlingMiddleware } from '../middleware/error.js';
import { createRequest } from '@my-claudia/shared';
import type { MessageContext } from '../middleware/base.js';

// Test utilities
function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function log(section: string, message: string) {
  console.log(`\n✓ [${section}] ${message}`);
}

// ============================================
// Test Router CRUD Operations
// ============================================
async function testRouterCrud() {
  console.log('\n=== Test: Router CRUD Operations ===');

  const db = initDatabase();
  const router = createRouter(db);
  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);
  const serverRepo = new ServerRepository(db);
  const providerRepo = new ProviderRepository(db);

  // Apply middleware (without auth for testing)
  router.use(loggingMiddleware, errorHandlingMiddleware);

  // Register all CRUD routes
  router.crud('projects', projectRepo);
  router.crud('sessions', sessionRepo);
  router.crud('servers', serverRepo);
  router.crud('providers', providerRepo);

  // Verify routes are registered
  const routes = router.getRoutes();
  assert(routes.length === 16, `Should have 16 routes, got ${routes.length}`);
  assert(routes.includes('get_projects'), 'Should have get_projects route');
  assert(routes.includes('add_project'), 'Should have add_project route');
  assert(routes.includes('get_sessions'), 'Should have get_sessions route');
  assert(routes.includes('get_servers'), 'Should have get_servers route');
  assert(routes.includes('get_providers'), 'Should have get_providers route');
  log('Router', 'All 16 CRUD routes registered correctly');

  // Create test client
  const testClient = {
    id: 'test-client',
    ws: null as any,
    authenticated: true,
    isLocal: true
  };

  // Test Projects CRUD
  console.log('\n--- Testing Projects CRUD ---');

  // List projects
  const listProjectsReq = createRequest('get_projects', {});
  const listProjectsRes = await router.route(testClient, listProjectsReq);
  assert(listProjectsRes !== undefined, 'List projects should return response');
  assert(listProjectsRes?.metadata.success === true, 'List projects should succeed');
  log('Projects', 'List operation works');

  // Create project
  const createProjectReq = createRequest('add_project', {
    name: 'Test Project',
    type: 'code',
    rootPath: '/test/path'
  });
  const createProjectRes = await router.route(testClient, createProjectReq);
  assert(createProjectRes !== undefined, 'Create project should return response');
  assert(createProjectRes?.metadata.success === true, 'Create project should succeed');
  const createdProject = (createProjectRes?.payload as any).project;
  assert(createdProject.id !== undefined, 'Created project should have ID');
  log('Projects', `Create operation works (ID: ${createdProject.id})`);

  // Update project
  const updateProjectReq = createRequest('update_project', {
    id: createdProject.id,
    name: 'Updated Project'
  });
  const updateProjectRes = await router.route(testClient, updateProjectReq);
  assert(updateProjectRes !== undefined, 'Update project should return response');
  assert(updateProjectRes?.metadata.success === true, 'Update project should succeed');
  const updatedProject = (updateProjectRes?.payload as any).project;
  assert(updatedProject.name === 'Updated Project', 'Project name should be updated');
  log('Projects', 'Update operation works');

  // Delete project
  const deleteProjectReq = createRequest('delete_project', {
    id: createdProject.id
  });
  const deleteProjectRes = await router.route(testClient, deleteProjectReq);
  assert(deleteProjectRes !== undefined, 'Delete project should return response');
  assert(deleteProjectRes?.metadata.success === true, 'Delete project should succeed');
  log('Projects', 'Delete operation works');

  // Test Sessions CRUD
  console.log('\n--- Testing Sessions CRUD ---');

  // Need a project first
  const projectForSession = await projectRepo.create({
    name: 'Session Test Project',
    type: 'code',
  });

  // List sessions
  const listSessionsReq = createRequest('get_sessions', {});
  const listSessionsRes = await router.route(testClient, listSessionsReq);
  assert(listSessionsRes !== undefined, 'List sessions should return response');
  assert(listSessionsRes?.metadata.success === true, 'List sessions should succeed');
  log('Sessions', 'List operation works');

  // Create session
  const createSessionReq = createRequest('add_session', {
    projectId: projectForSession.id,
    name: 'Test Session'
  });
  const createSessionRes = await router.route(testClient, createSessionReq);
  assert(createSessionRes !== undefined, 'Create session should return response');
  assert(createSessionRes?.metadata.success === true, 'Create session should succeed');
  const createdSession = (createSessionRes?.payload as any).session;
  log('Sessions', `Create operation works (ID: ${createdSession.id})`);

  // Update session
  const updateSessionReq = createRequest('update_session', {
    id: createdSession.id,
    name: 'Updated Session'
  });
  const updateSessionRes = await router.route(testClient, updateSessionReq);
  assert(updateSessionRes !== undefined, 'Update session should return response');
  assert(updateSessionRes?.metadata.success === true, 'Update session should succeed');
  log('Sessions', 'Update operation works');

  // Delete session
  const deleteSessionReq = createRequest('delete_session', {
    id: createdSession.id
  });
  const deleteSessionRes = await router.route(testClient, deleteSessionReq);
  assert(deleteSessionRes !== undefined, 'Delete session should return response');
  assert(deleteSessionRes?.metadata.success === true, 'Delete session should succeed');
  log('Sessions', 'Delete operation works');

  // Clean up
  await projectRepo.delete(projectForSession.id);

  // Test Servers CRUD
  console.log('\n--- Testing Servers CRUD ---');

  const listServersReq = createRequest('get_servers', {});
  const listServersRes = await router.route(testClient, listServersReq);
  assert(listServersRes !== undefined, 'List servers should return response');
  assert(listServersRes?.metadata.success === true, 'List servers should succeed');
  log('Servers', 'List operation works');

  const createServerReq = createRequest('add_server', {
    name: 'Test Server',
    address: 'localhost:3100',
    isDefault: false
  });
  const createServerRes = await router.route(testClient, createServerReq);
  assert(createServerRes !== undefined, 'Create server should return response');
  assert(createServerRes?.metadata.success === true, 'Create server should succeed');
  const createdServer = (createServerRes?.payload as any).server;
  log('Servers', `Create operation works (ID: ${createdServer.id})`);

  const deleteServerReq = createRequest('delete_server', {
    id: createdServer.id
  });
  const deleteServerRes = await router.route(testClient, deleteServerReq);
  assert(deleteServerRes !== undefined, 'Delete server should return response');
  assert(deleteServerRes?.metadata.success === true, 'Delete server should succeed');
  log('Servers', 'Delete operation works');

  // Test Providers CRUD
  console.log('\n--- Testing Providers CRUD ---');

  const listProvidersReq = createRequest('get_providers', {});
  const listProvidersRes = await router.route(testClient, listProvidersReq);
  assert(listProvidersRes !== undefined, 'List providers should return response');
  assert(listProvidersRes?.metadata.success === true, 'List providers should succeed');
  log('Providers', 'List operation works');

  const createProviderReq = createRequest('add_provider', {
    name: 'Test Provider',
    type: 'claude' as any
  });
  const createProviderRes = await router.route(testClient, createProviderReq);
  assert(createProviderRes !== undefined, 'Create provider should return response');
  assert(createProviderRes?.metadata.success === true, 'Create provider should succeed');
  const createdProvider = (createProviderRes?.payload as any).provider;
  log('Providers', `Create operation works (ID: ${createdProvider.id})`);

  const deleteProviderReq = createRequest('delete_provider', {
    id: createdProvider.id
  });
  const deleteProviderRes = await router.route(testClient, deleteProviderReq);
  assert(deleteProviderRes !== undefined, 'Delete provider should return response');
  assert(deleteProviderRes?.metadata.success === true, 'Delete provider should succeed');
  log('Providers', 'Delete operation works');
}

// ============================================
// Run all tests
// ============================================
async function runVerification() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Phase 2 Verification Test Suite         ║');
  console.log('║   Testing Router CRUD Operations           ║');
  console.log('╚════════════════════════════════════════════╝');

  try {
    await testRouterCrud();

    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   ✓ All Phase 2 tests passed!              ║');
    console.log('╚════════════════════════════════════════════╝\n');
    console.log('Router-based CRUD operations work correctly for all entities.\n');
    console.log('Migrated entities:');
    console.log('  - Projects   (4 routes: get, add, update, delete)');
    console.log('  - Sessions   (4 routes: get, add, update, delete)');
    console.log('  - Servers    (4 routes: get, add, update, delete)');
    console.log('  - Providers  (4 routes: get, add, update, delete)');
    console.log('\nTotal: 16 routes migrated to new router architecture.\n');

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

// Run verification
runVerification().catch(console.error);

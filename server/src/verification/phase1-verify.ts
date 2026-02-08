/**
 * Phase 1 Verification Script
 *
 * Tests the foundation components created in Phase 1:
 * 1. Correlation protocol types and parsing
 * 2. Repository pattern (ProjectRepository)
 * 3. Middleware system (auth, logging, error handling)
 */

import { initDatabase } from '../storage/db.js';
import { ProjectRepository } from '../repositories/project.js';
import type { Request, Response } from '@my-claudia/shared';
import { isRequest, isResponse, createRequest, createResponse } from '@my-claudia/shared';
import {
  composeMiddleware,
  successResponse,
  errorResponse,
  type MessageContext,
  type Middleware
} from '../middleware/base.js';
import { authMiddleware } from '../middleware/auth.js';
import { loggingMiddleware } from '../middleware/logging.js';
import { errorHandlingMiddleware, AppError } from '../middleware/error.js';

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
// Test 1: Correlation Protocol
// ============================================
function testCorrelationProtocol() {
  console.log('\n=== Test 1: Correlation Protocol ===');

  // Test createRequest
  const request = createRequest('test.request', { foo: 'bar' }, { timeout: 5000 });
  assert(request.id !== undefined, 'Request should have ID');
  assert(request.type === 'test.request', 'Request type should match');
  assert(request.payload.foo === 'bar', 'Request payload should match');
  assert(request.metadata.timeout === 5000, 'Request timeout should match');
  log('Correlation', 'createRequest works correctly');

  // Test isRequest type guard
  assert(isRequest(request), 'isRequest should return true for valid request');
  assert(!isRequest({ type: 'test' }), 'isRequest should return false for invalid request');
  log('Correlation', 'isRequest type guard works correctly');

  // Test createResponse
  const response = createResponse(request, { result: 'success' }, { success: true });
  assert(response.id !== undefined, 'Response should have ID');
  assert(response.metadata.requestId === request.id, 'Response should have correlation ID');
  assert(response.metadata.success === true, 'Response success flag should match');
  assert(response.payload.result === 'success', 'Response payload should match');
  log('Correlation', 'createResponse works correctly');

  // Test isResponse type guard
  assert(isResponse(response), 'isResponse should return true for valid response');
  assert(!isResponse({ type: 'test' }), 'isResponse should return false for invalid response');
  log('Correlation', 'isResponse type guard works correctly');

  // Test old vs new message format
  const oldFormatMessage = { type: 'get_projects' };
  const wrappedRequest = {
    id: '123',
    type: 'get_projects',
    payload: oldFormatMessage,
    timestamp: Date.now(),
    metadata: { timeout: 30000, requiresAuth: false }
  };
  assert(isRequest(wrappedRequest), 'Wrapped old format should be valid Request');
  log('Correlation', 'Old message format can be wrapped in Request envelope');
}

// ============================================
// Test 2: Repository Pattern
// ============================================
async function testRepository() {
  console.log('\n=== Test 2: Repository Pattern ===');

  const db = initDatabase();
  const projectRepo = new ProjectRepository(db);

  // Test create
  const newProject = await projectRepo.create({
    name: 'Test Project',
    type: 'code',
    providerId: undefined,
    rootPath: '/test/path',
    systemPrompt: undefined,
    permissionPolicy: {
      allowedTools: [],
      disallowedTools: [],
      autoApprove: false,
      timeoutSeconds: 30
    }
  });

  assert(newProject.id !== undefined, 'Created project should have ID');
  assert(newProject.name === 'Test Project', 'Created project name should match');
  assert(newProject.rootPath === '/test/path', 'Created project rootPath should match');
  assert(newProject.permissionPolicy?.autoApprove === false, 'JSON serialization should work');
  log('Repository', 'ProjectRepository.create works correctly');

  // Test findById
  const found = await projectRepo.findById(newProject.id);
  assert(found !== null, 'Should find project by ID');
  assert(found?.id === newProject.id, 'Found project should have correct ID');
  assert(found?.name === 'Test Project', 'Found project should have correct name');
  log('Repository', 'ProjectRepository.findById works correctly');

  // Test findAll
  const allProjects = await projectRepo.findAll();
  assert(allProjects.length > 0, 'Should find at least one project');
  assert(allProjects.some(p => p.id === newProject.id), 'Should find created project in list');
  log('Repository', 'ProjectRepository.findAll works correctly');

  // Test update
  const updated = await projectRepo.update(newProject.id, {
    name: 'Updated Project',
    systemPrompt: 'Test prompt'
  });
  assert(updated.name === 'Updated Project', 'Updated project name should match');
  assert(updated.systemPrompt === 'Test prompt', 'Updated project systemPrompt should match');
  assert(updated.rootPath === '/test/path', 'Other fields should remain unchanged');
  log('Repository', 'ProjectRepository.update works correctly');

  // Test delete
  const deleted = await projectRepo.delete(newProject.id);
  assert(deleted === true, 'Delete should return true');
  const notFound = await projectRepo.findById(newProject.id);
  assert(notFound === null, 'Deleted project should not be found');
  log('Repository', 'ProjectRepository.delete works correctly');
}

// ============================================
// Test 3: Middleware System
// ============================================
async function testMiddleware() {
  console.log('\n=== Test 3: Middleware System ===');

  const db = initDatabase();

  // Create test context
  const createContext = (authenticated: boolean, isLocal: boolean): MessageContext => ({
    client: {
      id: 'test-client',
      ws: null,
      authenticated,
      isLocal
    },
    request: createRequest('test.request', { test: 'data' }),
    db,
    metadata: new Map()
  });

  // Test auth middleware - local client
  const localCtx = createContext(false, true);
  const localHandler = async (ctx: MessageContext) => {
    return successResponse(ctx.request, 'test.response', { result: 'ok' });
  };
  const localResponse = await authMiddleware(localCtx, localHandler);
  assert(localResponse !== undefined, 'Local client should be allowed');
  assert(localResponse?.metadata.success === true, 'Local client response should succeed');
  log('Middleware', 'Auth middleware allows local clients');

  // Test auth middleware - unauthenticated remote client
  const unauthCtx = createContext(false, false);
  const unauthResponse = await authMiddleware(unauthCtx, localHandler);
  assert(unauthResponse !== undefined, 'Should return error response');
  assert(unauthResponse?.metadata.success === false, 'Should return failed response');
  assert(unauthResponse?.metadata.error?.code === 'UNAUTHORIZED', 'Error code should be UNAUTHORIZED');
  log('Middleware', 'Auth middleware blocks unauthenticated remote clients');

  // Test auth middleware - authenticated remote client
  const authCtx = createContext(true, false);
  const authResponse = await authMiddleware(authCtx, localHandler);
  assert(authResponse !== undefined, 'Should return response');
  assert(authResponse?.metadata.success === true, 'Authenticated client should succeed');
  log('Middleware', 'Auth middleware allows authenticated remote clients');

  // Test error handling middleware
  const errorCtx = createContext(true, true);
  const errorHandler = async () => {
    throw new AppError('TEST_ERROR', 'Test error message', { detail: 'test' });
  };
  const errorResp = await errorHandlingMiddleware(errorCtx, errorHandler);
  assert(errorResp !== undefined, 'Should catch error and return response');
  assert(errorResp?.metadata.success === false, 'Error response should fail');
  assert(errorResp?.metadata.error?.code === 'TEST_ERROR', 'Error code should match');
  assert(errorResp?.metadata.error?.message === 'Test error message', 'Error message should match');
  log('Middleware', 'Error handling middleware catches AppError');

  // Test middleware composition
  const composedCtx = createContext(true, true);
  let logCalled = false;
  const testLoggingMiddleware: Middleware = async (ctx, next) => {
    logCalled = true;
    return next(ctx);
  };

  const composed = composeMiddleware(
    testLoggingMiddleware,
    authMiddleware,
    errorHandlingMiddleware
  );

  const composedResponse = await composed(composedCtx, localHandler);
  assert(logCalled, 'First middleware should be called');
  assert(composedResponse !== undefined, 'Composed middleware should return response');
  assert(composedResponse?.metadata.success === true, 'Composed middleware should succeed');
  log('Middleware', 'Middleware composition works correctly');

  // Test middleware short-circuit
  const shortCircuitCtx = createContext(false, false);
  let handlerCalled = false;
  const shortCircuitHandler = async () => {
    handlerCalled = true;
    return successResponse(shortCircuitCtx.request, 'test.response', {});
  };

  const shortCircuitComposed = composeMiddleware(
    authMiddleware,  // This should short-circuit
    errorHandlingMiddleware
  );

  const shortCircuitResp = await shortCircuitComposed(shortCircuitCtx, shortCircuitHandler);
  assert(!handlerCalled, 'Handler should not be called when middleware short-circuits');
  assert(shortCircuitResp?.metadata.success === false, 'Short-circuit response should fail');
  log('Middleware', 'Middleware short-circuit works correctly');
}

// ============================================
// Run all tests
// ============================================
async function runVerification() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║   Phase 1 Verification Test Suite         ║');
  console.log('╚════════════════════════════════════════════╝');

  try {
    testCorrelationProtocol();
    await testRepository();
    await testMiddleware();

    console.log('\n╔════════════════════════════════════════════╗');
    console.log('║   ✓ All Phase 1 tests passed!              ║');
    console.log('╚════════════════════════════════════════════╝\n');
    console.log('Phase 1 foundation is ready for Phase 2 (Server Refactoring).\n');

    process.exit(0);
  } catch (error) {
    console.error('\n✗ Test failed:', error);
    process.exit(1);
  }
}

// Run verification
runVerification().catch(console.error);

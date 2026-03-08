/**
 * Permission Manager
 *
 * Manages plugin permissions including:
 * - Checking permissions
 * - Granting/revoking permissions
 * - Requesting permissions from users
 * - Persisting granted permissions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Permission, PluginManifest } from '@my-claudia/shared';
import { pluginEvents } from '../events/index.js';

// ============================================
// Types
// ============================================

export interface PermissionState {
  granted: Permission[];
  denied: Permission[];
}

export interface PermissionStore {
  [pluginId: string]: PermissionState;
}

export interface PermissionRequest {
  pluginId: string;
  pluginName: string;
  permissions: Permission[];
  resolve: (granted: boolean) => void;
  reject: (error: Error) => void;
}

// Permission levels for sorting/risk assessment
const PERMISSION_LEVELS: Record<Permission, number> = {
  // Safe
  'session.read': 1,
  'project.read': 1,
  'storage': 1,
  // Medium
  'fs.read': 2,
  'network.fetch': 2,
  'timer': 2,
  'provider.call': 2,
  // Sensitive
  'fs.write': 3,
  'session.write': 3,
  'notification': 3,
  'clipboard.read': 3,
  'clipboard.write': 3,
  // Dangerous
  'shell.execute': 4,
};

// ============================================
// Permission Manager
// ============================================

class PermissionManager {
  private store: PermissionStore = {};
  private storePath: string;
  private pendingRequests: Map<string, PermissionRequest[]> = new Map();
  private requestHandlers: Set<(request: PermissionRequest) => void> = new Set();

  constructor() {
    this.storePath = path.join(os.homedir(), '.claudia', 'plugin-permissions.json');
    this.loadStore();
  }

  // ============================================
  // Store Management
  // ============================================

  /**
   * Load permission store from disk
   */
  private loadStore(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        const content = fs.readFileSync(this.storePath, 'utf-8');
        this.store = JSON.parse(content);
      }
    } catch (error) {
      console.error('[PermissionManager] Failed to load store:', error);
      this.store = {};
    }
  }

  /**
   * Save permission store to disk
   */
  private saveStore(): void {
    try {
      const dir = path.dirname(this.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storePath, JSON.stringify(this.store, null, 2), 'utf-8');
    } catch (error) {
      console.error('[PermissionManager] Failed to save store:', error);
    }
  }

  // ============================================
  // Permission Checking
  // ============================================

  /**
   * Check if a plugin has a specific permission
   */
  hasPermission(pluginId: string, permission: Permission): boolean {
    const state = this.store[pluginId];
    if (!state) return false;

    return state.granted.includes(permission) && !state.denied.includes(permission);
  }

  /**
   * Check if a plugin has all specified permissions
   */
  hasAllPermissions(pluginId: string, permissions: Permission[]): boolean {
    return permissions.every((p) => this.hasPermission(pluginId, p));
  }

  /**
   * Check if a plugin has any of the specified permissions
   */
  hasAnyPermission(pluginId: string, permissions: Permission[]): boolean {
    return permissions.some((p) => this.hasPermission(pluginId, p));
  }

  /**
   * Get all granted permissions for a plugin
   */
  getGrantedPermissions(pluginId: string): Permission[] {
    const state = this.store[pluginId];
    return state ? [...state.granted] : [];
  }

  /**
   * Get all denied permissions for a plugin
   */
  getDeniedPermissions(pluginId: string): Permission[] {
    const state = this.store[pluginId];
    return state ? [...state.denied] : [];
  }

  /**
   * Get permission state for a plugin
   */
  getPermissionState(pluginId: string): PermissionState {
    const state = this.store[pluginId];
    return state ? { granted: [...state.granted], denied: [...state.denied] } : { granted: [], denied: [] };
  }

  // ============================================
  // Permission Management
  // ============================================

  /**
   * Grant a permission to a plugin
   */
  grant(pluginId: string, permission: Permission): void {
    if (!this.store[pluginId]) {
      this.store[pluginId] = { granted: [], denied: [] };
    }

    const state = this.store[pluginId];

    // Add to granted if not already
    if (!state.granted.includes(permission)) {
      state.granted.push(permission);
    }

    // Remove from denied
    state.denied = state.denied.filter((p) => p !== permission);

    this.saveStore();

    // Emit event
    pluginEvents.emit('permission.granted', { pluginId, permission }).catch(() => {});
  }

  /**
   * Grant multiple permissions to a plugin
   */
  grantAll(pluginId: string, permissions: Permission[]): void {
    permissions.forEach((p) => this.grant(pluginId, p));
  }

  /**
   * Revoke a permission from a plugin
   */
  revoke(pluginId: string, permission: Permission): void {
    const state = this.store[pluginId];
    if (!state) return;

    state.granted = state.granted.filter((p) => p !== permission);
    this.saveStore();

    // Emit event
    pluginEvents.emit('permission.revoked', { pluginId, permission }).catch(() => {});
  }

  /**
   * Deny a permission to a plugin
   */
  deny(pluginId: string, permission: Permission): void {
    if (!this.store[pluginId]) {
      this.store[pluginId] = { granted: [], denied: [] };
    }

    const state = this.store[pluginId];

    // Add to denied if not already
    if (!state.denied.includes(permission)) {
      state.denied.push(permission);
    }

    // Remove from granted
    state.granted = state.granted.filter((p) => p !== permission);

    this.saveStore();

    // Emit event
    pluginEvents.emit('permission.denied', { pluginId, permission }).catch(() => {});
  }

  /**
   * Clear all permissions for a plugin
   */
  clearPluginPermissions(pluginId: string): void {
    delete this.store[pluginId];
    this.saveStore();

    // Emit event
    pluginEvents.emit('permission.cleared', { pluginId }).catch(() => {});
  }

  // ============================================
  // Permission Requests
  // ============================================

  /**
   * Request permissions from the user
   * Returns a promise that resolves to true if granted, false if denied
   */
  async request(pluginId: string, permissions: Permission[], manifest: PluginManifest): Promise<boolean> {
    // Check if all permissions are already granted
    if (this.hasAllPermissions(pluginId, permissions)) {
      return true;
    }

    // Check if any permissions are permanently denied
    const permanentlyDenied = permissions.filter((p) => {
      const state = this.store[pluginId];
      return state && state.denied.includes(p);
    });

    if (permanentlyDenied.length > 0) {
      console.warn(`[PermissionManager] Some permissions permanently denied for ${pluginId}:`, permanentlyDenied);
      return false;
    }

    // Create request
    return new Promise<boolean>((resolve, reject) => {
      const request: PermissionRequest = {
        pluginId,
        pluginName: manifest.name,
        permissions,
        resolve,
        reject,
      };

      // Add to pending
      if (!this.pendingRequests.has(pluginId)) {
        this.pendingRequests.set(pluginId, []);
      }
      this.pendingRequests.get(pluginId)!.push(request);

      // Notify handlers
      this.notifyHandlers(request);

      // Emit event for UI
      pluginEvents.emit('permission.request', {
        pluginId,
        pluginName: manifest.name,
        permissions,
      }).catch(() => {});
    });
  }

  /**
   * Respond to a permission request
   */
  respondToRequest(pluginId: string, granted: boolean, permanently?: boolean): void {
    const requests = this.pendingRequests.get(pluginId);
    if (!requests || requests.length === 0) return;

    // Resolve ALL pending requests for this plugin (not just the first)
    const allRequests = [...requests];
    this.pendingRequests.delete(pluginId);

    if (granted) {
      // Grant the union of all requested permissions
      const allPermissions = new Set<Permission>();
      for (const req of allRequests) {
        req.permissions.forEach((p) => allPermissions.add(p));
      }
      this.grantAll(pluginId, Array.from(allPermissions));
      for (const req of allRequests) {
        req.resolve(true);
      }
    } else {
      if (permanently) {
        const allPermissions = new Set<Permission>();
        for (const req of allRequests) {
          req.permissions.forEach((p) => allPermissions.add(p));
        }
        allPermissions.forEach((p) => this.deny(pluginId, p));
      }
      for (const req of allRequests) {
        req.resolve(false);
      }
    }
  }

  /**
   * Register a handler for permission requests
   */
  onRequest(handler: (request: PermissionRequest) => void): () => void {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  /**
   * Notify all handlers of a new request
   */
  private notifyHandlers(request: PermissionRequest): void {
    this.requestHandlers.forEach((handler) => {
      try {
        handler(request);
      } catch (error) {
        console.error('[PermissionManager] Handler error:', error);
      }
    });
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get the risk level of a permission (1-4)
   */
  getPermissionLevel(permission: Permission): number {
    return PERMISSION_LEVELS[permission] || 4;
  }

  /**
   * Sort permissions by risk level
   */
  sortPermissionsByRisk(permissions: Permission[]): Permission[] {
    return [...permissions].sort((a, b) => {
      const levelA = PERMISSION_LEVELS[a] || 4;
      const levelB = PERMISSION_LEVELS[b] || 4;
      return levelB - levelA; // Higher risk first
    });
  }

  /**
   * Get a summary of required vs granted permissions
   */
  getPermissionSummary(pluginId: string, required: Permission[]): {
    granted: Permission[];
    pending: Permission[];
    denied: Permission[];
  } {
    const state = this.store[pluginId] || { granted: [], denied: [] };

    return {
      granted: required.filter((p) => state.granted.includes(p)),
      pending: required.filter((p) => !state.granted.includes(p) && !state.denied.includes(p)),
      denied: required.filter((p) => state.denied.includes(p)),
    };
  }

  /**
   * Check if permissions are safe to auto-grant
   * (all level 1 permissions)
   */
  isSafeToAutoGrant(permissions: Permission[]): boolean {
    return permissions.every((p) => PERMISSION_LEVELS[p] === 1);
  }

  /**
   * Get all plugins with their permission states
   */
  getAllPluginPermissions(): PermissionStore {
    return { ...this.store };
  }

  /**
   * Set the store path (for testing)
   */
  setStorePath(storePath: string): void {
    this.storePath = storePath;
    this.loadStore();
  }
}

// ============================================
// Exports
// ============================================

export const permissionManager = new PermissionManager();
export { PermissionManager };

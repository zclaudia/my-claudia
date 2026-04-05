import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { Permission, PluginManifest } from '@my-claudia/shared';
import { pluginEvents } from '../../events/index.js';

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

const PERMISSION_LEVELS: Record<Permission, number> = {
  'session.read': 1,
  'project.read': 1,
  storage: 1,
  'fs.read': 2,
  'network.fetch': 2,
  timer: 2,
  'provider.call': 2,
  'fs.write': 3,
  'session.write': 3,
  notification: 3,
  'clipboard.read': 3,
  'clipboard.write': 3,
  'shell.execute': 4,
};

export class PermissionManager {
  private store: PermissionStore = {};
  private storePath: string;
  private pendingRequests: Map<string, PermissionRequest[]> = new Map();
  private requestHandlers: Set<(request: PermissionRequest) => void> = new Set();

  constructor() {
    this.storePath = path.join(os.homedir(), '.claudia', 'plugin-permissions.json');
    this.loadStore();
  }

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

  hasPermission(pluginId: string, permission: Permission): boolean {
    const state = this.store[pluginId];
    if (!state) return false;

    return state.granted.includes(permission) && !state.denied.includes(permission);
  }

  hasAllPermissions(pluginId: string, permissions: Permission[]): boolean {
    return permissions.every((permission) => this.hasPermission(pluginId, permission));
  }

  hasAnyPermission(pluginId: string, permissions: Permission[]): boolean {
    return permissions.some((permission) => this.hasPermission(pluginId, permission));
  }

  getGrantedPermissions(pluginId: string): Permission[] {
    const state = this.store[pluginId];
    return state ? [...state.granted] : [];
  }

  getDeniedPermissions(pluginId: string): Permission[] {
    const state = this.store[pluginId];
    return state ? [...state.denied] : [];
  }

  getPermissionState(pluginId: string): PermissionState {
    const state = this.store[pluginId];
    return state ? { granted: [...state.granted], denied: [...state.denied] } : { granted: [], denied: [] };
  }

  grant(pluginId: string, permission: Permission): void {
    if (!this.store[pluginId]) {
      this.store[pluginId] = { granted: [], denied: [] };
    }

    const state = this.store[pluginId];
    if (!state.granted.includes(permission)) {
      state.granted.push(permission);
    }

    state.denied = state.denied.filter((entry) => entry !== permission);
    this.saveStore();
    pluginEvents.emit('permission.granted', { pluginId, permission }).catch(() => {});
  }

  grantAll(pluginId: string, permissions: Permission[]): void {
    permissions.forEach((permission) => this.grant(pluginId, permission));
  }

  revoke(pluginId: string, permission: Permission): void {
    const state = this.store[pluginId];
    if (!state) return;

    state.granted = state.granted.filter((entry) => entry !== permission);
    this.saveStore();
    pluginEvents.emit('permission.revoked', { pluginId, permission }).catch(() => {});
  }

  deny(pluginId: string, permission: Permission): void {
    if (!this.store[pluginId]) {
      this.store[pluginId] = { granted: [], denied: [] };
    }

    const state = this.store[pluginId];
    if (!state.denied.includes(permission)) {
      state.denied.push(permission);
    }

    state.granted = state.granted.filter((entry) => entry !== permission);
    this.saveStore();
    pluginEvents.emit('permission.denied', { pluginId, permission }).catch(() => {});
  }

  clearPluginPermissions(pluginId: string): void {
    delete this.store[pluginId];
    this.saveStore();
    pluginEvents.emit('permission.cleared', { pluginId }).catch(() => {});
  }

  async request(pluginId: string, permissions: Permission[], manifest: PluginManifest): Promise<boolean> {
    if (this.hasAllPermissions(pluginId, permissions)) {
      return true;
    }

    const permanentlyDenied = permissions.filter((permission) => {
      const state = this.store[pluginId];
      return state && state.denied.includes(permission);
    });

    if (permanentlyDenied.length > 0) {
      console.warn(`[PermissionManager] Some permissions permanently denied for ${pluginId}:`, permanentlyDenied);
      return false;
    }

    return new Promise<boolean>((resolve, reject) => {
      const request: PermissionRequest = {
        pluginId,
        pluginName: manifest.name,
        permissions,
        resolve,
        reject,
      };

      if (!this.pendingRequests.has(pluginId)) {
        this.pendingRequests.set(pluginId, []);
      }
      this.pendingRequests.get(pluginId)!.push(request);

      this.notifyHandlers(request);

      pluginEvents.emit('permission.request', {
        pluginId,
        pluginName: manifest.name,
        permissions,
      }).catch(() => {});
    });
  }

  respondToRequest(pluginId: string, granted: boolean, permanently?: boolean): void {
    const requests = this.pendingRequests.get(pluginId);
    if (!requests || requests.length === 0) return;

    const allRequests = [...requests];
    this.pendingRequests.delete(pluginId);

    if (granted) {
      const allPermissions = new Set<Permission>();
      for (const request of allRequests) {
        request.permissions.forEach((permission) => allPermissions.add(permission));
      }
      this.grantAll(pluginId, Array.from(allPermissions));
      for (const request of allRequests) {
        request.resolve(true);
      }
      return;
    }

    if (permanently) {
      const allPermissions = new Set<Permission>();
      for (const request of allRequests) {
        request.permissions.forEach((permission) => allPermissions.add(permission));
      }
      allPermissions.forEach((permission) => this.deny(pluginId, permission));
    }
    for (const request of allRequests) {
      request.resolve(false);
    }
  }

  onRequest(handler: (request: PermissionRequest) => void): () => void {
    this.requestHandlers.add(handler);
    return () => this.requestHandlers.delete(handler);
  }

  private notifyHandlers(request: PermissionRequest): void {
    this.requestHandlers.forEach((handler) => {
      try {
        handler(request);
      } catch (error) {
        console.error('[PermissionManager] Handler error:', error);
      }
    });
  }

  getPermissionLevel(permission: Permission): number {
    return PERMISSION_LEVELS[permission] || 4;
  }

  sortPermissionsByRisk(permissions: Permission[]): Permission[] {
    return [...permissions].sort((a, b) => {
      const levelA = PERMISSION_LEVELS[a] || 4;
      const levelB = PERMISSION_LEVELS[b] || 4;
      return levelB - levelA;
    });
  }

  getPermissionSummary(pluginId: string, required: Permission[]): {
    granted: Permission[];
    pending: Permission[];
    denied: Permission[];
  } {
    const state = this.store[pluginId] || { granted: [], denied: [] };

    return {
      granted: required.filter((permission) => state.granted.includes(permission)),
      pending: required.filter((permission) => !state.granted.includes(permission) && !state.denied.includes(permission)),
      denied: required.filter((permission) => state.denied.includes(permission)),
    };
  }

  isSafeToAutoGrant(permissions: Permission[]): boolean {
    return permissions.every((permission) => PERMISSION_LEVELS[permission] === 1);
  }

  getAllPluginPermissions(): PermissionStore {
    return { ...this.store };
  }

  setStorePath(storePath: string): void {
    this.storePath = storePath;
    this.loadStore();
  }
}

export const permissionManager = new PermissionManager();

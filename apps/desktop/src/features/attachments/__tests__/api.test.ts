import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockServerStoreState = {
  activeServerId: 'local',
};
let mockControlPlaneMode = 'embedded-local';
let mockIsLocalBackendId = true;

vi.mock('../../../stores/serverStore', () => ({
  useServerStore: {
    getState: () => mockServerStoreState,
  },
}));

vi.mock('../../../utils/controlPlane', () => ({
  getControlPlaneMode: vi.fn(() => mockControlPlaneMode),
  isLocalBackendId: vi.fn(() => mockIsLocalBackendId),
}));

vi.mock('../../../services/api', () => ({
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer t' })),
}));

const apiCall = vi.fn();
vi.mock('../../../services/api/unwrap', () => ({
  apiCall: (...args: unknown[]) => apiCall(...args),
}));

class MockFileReader {
  result: string | null = null;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL = vi.fn(function (this: MockFileReader, file: File) {
    this.result = `data:${file.type};base64,dGVzdA==`;
    setTimeout(() => this.onload?.(), 0);
  });
}
vi.stubGlobal('FileReader', MockFileReader);

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];
  static nextStatus = 200;
  static nextResponse: unknown = { success: true, data: { id: 'a1' } };

  status = 0;
  responseText = '';
  upload: { addEventListener: ReturnType<typeof vi.fn> };
  addEventListener: ReturnType<typeof vi.fn>;
  setRequestHeader = vi.fn();
  open = vi.fn();
  send: ReturnType<typeof vi.fn>;
  abort = vi.fn();
  private listeners = new Map<string, () => void>();
  private progressHandler?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void;

  constructor() {
    this.upload = {
      addEventListener: vi.fn((event: string, h: any) => {
        if (event === 'progress') this.progressHandler = h;
      }),
    };
    this.addEventListener = vi.fn((event: string, h: () => void) => {
      this.listeners.set(event, h);
    });
    this.send = vi.fn(() => {
      setTimeout(() => {
        this.progressHandler?.({ lengthComputable: true, loaded: 50, total: 100 });
        this.status = MockXMLHttpRequest.nextStatus;
        this.responseText = JSON.stringify(MockXMLHttpRequest.nextResponse);
        this.listeners.get('load')?.();
      }, 0);
    });
    MockXMLHttpRequest.instances.push(this);
  }
}
vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as unknown as typeof XMLHttpRequest);

import {
  listAttachments,
  listAttachmentCounts,
  uploadAttachment,
  deleteAttachment,
  updateAttachment,
  fetchAttachmentBlobUrl,
} from '../api';

beforeEach(() => {
  apiCall.mockReset();
  mockControlPlaneMode = 'embedded-local';
  mockIsLocalBackendId = true;
  mockServerStoreState.activeServerId = 'local';
  MockXMLHttpRequest.instances = [];
  MockXMLHttpRequest.nextStatus = 200;
  MockXMLHttpRequest.nextResponse = { success: true, data: { id: 'a1' } };
});

describe('attachments api - simple wrappers', () => {
  it('listAttachments builds query string', async () => {
    apiCall.mockResolvedValue([{ id: 'x' }]);
    const result = await listAttachments('local_issue', 'issue 1');
    expect(apiCall).toHaveBeenCalledWith(
      '/api/attachments?ownerKind=local_issue&ownerId=issue+1',
    );
    expect(result).toEqual([{ id: 'x' }]);
  });

  it('listAttachmentCounts joins ownerIds with comma', async () => {
    apiCall.mockResolvedValue([]);
    await listAttachmentCounts('comment', ['a', 'b', 'c']);
    expect(apiCall).toHaveBeenCalledWith(
      '/api/attachments/counts?ownerKind=comment&ownerIds=a%2Cb%2Cc',
    );
  });

  it('listAttachmentCounts skips request when empty', async () => {
    const result = await listAttachmentCounts('comment', []);
    expect(apiCall).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('deleteAttachment uses DELETE', async () => {
    apiCall.mockResolvedValue(null);
    await deleteAttachment('a1');
    expect(apiCall).toHaveBeenCalledWith('/api/attachments/a1', { method: 'DELETE' });
  });

  it('updateAttachment patches body', async () => {
    apiCall.mockResolvedValue({ id: 'a1', name: 'n.png' });
    await updateAttachment('a1', { name: 'n.png', sortOrder: 3 });
    expect(apiCall).toHaveBeenCalledWith('/api/attachments/a1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'n.png', sortOrder: 3 }),
    });
  });
});

describe('attachments api - uploadAttachment transport selection', () => {
  it('uses multipart XHR for local backend', async () => {
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const onProgress = vi.fn();

    const result = await uploadAttachment('local_issue', 'issue-1', file, { onProgress });

    expect(result).toEqual({ id: 'a1' });
    expect(MockXMLHttpRequest.instances).toHaveLength(1);
    const xhr = MockXMLHttpRequest.instances[0];
    expect(xhr.open).toHaveBeenCalledWith('POST', 'http://localhost:3100/api/attachments');
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer t');
    expect(onProgress).toHaveBeenCalledWith({
      loaded: 50,
      total: 100,
      percentage: 50,
    });
  });

  it('falls back to JSON upload for gateway-routed backend', async () => {
    mockControlPlaneMode = 'gateway-direct';
    mockIsLocalBackendId = false;
    mockServerStoreState.activeServerId = 'remote-1';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { id: 'a1', name: 'x.png' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const onProgress = vi.fn();

    const result = await uploadAttachment('comment', 'cmt-1', file, { onProgress });

    expect(MockXMLHttpRequest.instances).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3100/api/attachments/json');
    expect((init as any).method).toBe('POST');
    const body = JSON.parse((init as any).body);
    expect(body).toMatchObject({
      ownerKind: 'comment',
      ownerId: 'cmt-1',
      name: 'x.png',
      mimeType: 'image/png',
      data: 'dGVzdA==',
    });
    expect(onProgress).toHaveBeenCalledWith({ loaded: 1, total: 1, percentage: 100 });
    expect(result).toEqual({ id: 'a1', name: 'x.png' });
  });

  it('rejects when XHR returns failure status', async () => {
    MockXMLHttpRequest.nextStatus = 500;
    MockXMLHttpRequest.nextResponse = { success: false, error: { message: 'oops' } };
    const file = new File(['x'], 'x.png');
    await expect(uploadAttachment('local_issue', 'issue-1', file)).rejects.toThrow(
      /Upload failed with status 500/,
    );
  });
});

describe('fetchAttachmentBlobUrl', () => {
  it('returns object URL on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(['bytes'])),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:abc'),
      revokeObjectURL: vi.fn(),
    });

    const url = await fetchAttachmentBlobUrl('a1');
    expect(url).toBe('blob:abc');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/api/attachments/a1/raw',
      expect.objectContaining({ headers: { Authorization: 'Bearer t' } }),
    );
  });

  it('throws on non-ok response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchAttachmentBlobUrl('a1')).rejects.toThrow(/status 404/);
  });
});

import { MemoryStore } from '../src/stores/memory.store';
import { ResponseRecord } from '../src/interfaces/idempotency-options.interface';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('should set in progress', async () => {
    const result = await store.setInProgress('test-key', 10);
    expect(result).toBe(true);
  });

  it('should not set in progress if key already exists', async () => {
    await store.setInProgress('test-key', 10);
    const result = await store.setInProgress('test-key', 10);
    expect(result).toBe(false);
  });

  it('should save and get response', async () => {
    const record: ResponseRecord = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { success: true },
      fingerprint: 'hash',
    };

    await store.saveResponse('test-key', record, 10);
    const result = await store.getResponse('test-key');
    expect(result).toEqual(record);
  });

  it('should return null for expired key', async () => {
    await store.setInProgress('test-key', -1); // Expired immediately
    const result = await store.getResponse('test-key');
    expect(result).toBe(null);
  });

  it('should clear key', async () => {
    await store.setInProgress('test-key', 10);
    await store.clear('test-key');
    const result = await store.getResponse('test-key');
    expect(result).toBe(null);
  });

  it('should enforce maxKeys limit', async () => {
    // Override maxKeys for testing
    (store as any).maxKeys = 5;
    for (let i = 0; i < 5; i++) {
      await store.setInProgress(`key-${i}`, 60);
    }
    const result = await store.setInProgress('key-5', 60);
    expect(result).toBe(false);
  });

  it('should cleanup interval on destroy', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    store.onModuleDestroy();
    expect(clearIntervalSpy).toHaveBeenCalled();
  });
});

import { MemoryStore } from '../src/stores/memory.store';
import { ResponseRecord } from '../src/interfaces/idempotency-options.interface';

describe('MemoryStore', () => {
  let store: MemoryStore;
  const token = 'test-token';

  beforeEach(() => {
    store = new MemoryStore();
  });

  it('should set in progress', async () => {
    const fingerprint = 'test-fp';
    const result = await store.setInProgress('test-key', 10, token, fingerprint);
    expect(result).toBe(true);
    const cached = await store.getResponse('test-key') as any;
    expect(cached.token).toBe(token);
    expect(cached.fingerprint).toBe(fingerprint);
  });

  it('should not set in progress if key already exists', async () => {
    await store.setInProgress('test-key', 10, token, 'fp1');
    const result = await store.setInProgress('test-key', 10, 'another-token', 'fp2');
    expect(result).toBe(false);
  });

  it('should save and get response only if token matches', async () => {
    const fingerprint = 'test-fp';
    const record: ResponseRecord = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: { success: true },
      fingerprint: 'hash',
    };

    await store.setInProgress('test-key', 10, token, fingerprint);
    
    // Wrong token should not save
    await store.saveResponse('test-key', record, 10, 'wrong-token');
    let result = await store.getResponse('test-key') as any;
    expect(result.token).toBe(token);

    // Correct token should save
    await store.saveResponse('test-key', record, 10, token);
    result = await store.getResponse('test-key');
    expect(result).toEqual(record);
  });

  it('should return null for expired key', async () => {
    await store.setInProgress('test-key', -1, token, 'fp'); // Expired immediately
    const result = await store.getResponse('test-key');
    expect(result).toBe(null);
  });

  it('should clear key only if token matches', async () => {
    const fingerprint = 'test-fp';
    await store.setInProgress('test-key', 10, token, fingerprint);
    
    // Wrong token should not clear
    await store.clear('test-key', 'wrong-token');
    let result = await store.getResponse('test-key') as any;
    expect(result.token).toBe(token);

    // Correct token should clear
    await store.clear('test-key', token);
    result = await store.getResponse('test-key');
    expect(result).toBe(null);
  });

  it('should clear key without token', async () => {
    await store.setInProgress('test-key', 10, token, 'fp');
    await store.clear('test-key');
    const result = await store.getResponse('test-key');
    expect(result).toBe(null);
  });

  it('should enforce maxKeys limit', async () => {
    (store as any).maxKeys = 5;
    for (let i = 0; i < 5; i++) {
      await store.setInProgress(`key-${i}`, 60, `token-${i}`, `fp-${i}`);
    }
    const result = await store.setInProgress('key-5', 60, 'token-5', 'fp-5');
    expect(result).toBe(true);
    // Oldest key should be evicted
    expect(await store.getResponse('key-0')).toBeNull();
  });
});

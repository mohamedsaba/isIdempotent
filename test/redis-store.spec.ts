import { RedisStore } from '../src/stores/redis.store';
import { ResponseRecord } from '../src/interfaces/idempotency-options.interface';

describe('RedisStore', () => {
  let store: RedisStore;
  let mockRedis: any;
  const token = 'test-token';
  const key = 'test-key';

  beforeEach(() => {
    mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      eval: jest.fn(),
      del: jest.fn(),
    };
    store = new RedisStore(mockRedis);
  });

  it('should set in progress with TOK: prefix and fingerprint', async () => {
    const fingerprint = 'test-fp';
    mockRedis.set.mockResolvedValue('OK');
    const result = await store.setInProgress(key, 60, token, fingerprint);
    
    expect(result).toBe(true);
    expect(mockRedis.set).toHaveBeenCalledWith(key, `TOK:${token}:${fingerprint}`, 'EX', 60, 'NX');
  });

  it('should save response with REC: prefix and check TOK: prefix pattern', async () => {
    const record: ResponseRecord = {
      statusCode: 200,
      headers: {},
      body: { data: 1 },
      fingerprint: 'fp',
    };
    
    await store.saveResponse(key, record, 3600, token);
    
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      key,
      `REC:${JSON.stringify(record)}`,
      3600,
      `TOK:${token}:`
    );
  });

  it('should return InProgressRecord from getResponse', async () => {
    const fingerprint = 'test-fp';
    mockRedis.get.mockResolvedValue(`TOK:${token}:${fingerprint}`);
    const result = await store.getResponse(key) as any;
    expect(result.token).toBe(token);
    expect(result.fingerprint).toBe(fingerprint);
  });

  it('should return record without REC: prefix from getResponse', async () => {
    const record: ResponseRecord = {
      statusCode: 200,
      headers: {},
      body: { data: 1 },
      fingerprint: 'fp',
    };
    mockRedis.get.mockResolvedValue(`REC:${JSON.stringify(record)}`);
    const result = await store.getResponse(key);
    expect(result).toEqual(record);
  });

  it('should clear with TOK: prefix pattern', async () => {
    await store.clear(key, token);
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      key,
      `TOK:${token}:`
    );
  });
});

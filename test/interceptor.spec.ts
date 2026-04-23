import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyInterceptor } from '../src/idempotency.interceptor';
import { IdempotencyStore } from '../src/stores/idempotency.store';
import { MemoryStore } from '../src/stores/memory.store';
import { IDEMPOTENCY_OPTIONS, IDEMPOTENT_METADATA_KEY } from '../src/constants';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ConflictException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let store: IdempotencyStore;
  let reflector: Reflector;

  const mockRequest = (headers: any = {}, body: any = {}) => ({
    headers,
    body,
  });

  const mockResponse = () => ({
    statusCode: 200,
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    getHeaders: jest.fn().mockReturnValue({ 'content-type': 'application/json' }),
  });

  const mockContext = (request: any, response: any, handler: any = () => {}) => ({
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => handler,
    getClass: () => ({}),
  } as unknown as ExecutionContext);

  const mockCallHandler = (data: any) => ({
    handle: () => of(data),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        Reflector,
        { provide: IdempotencyStore, useClass: MemoryStore },
        { provide: IDEMPOTENCY_OPTIONS, useValue: {} },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
    store = module.get<IdempotencyStore>(IdempotencyStore);
    reflector = module.get<Reflector>(Reflector);
  });

  it('should pass through if @Idempotent decorator is missing', async () => {
    const req = mockRequest();
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ success: true });

    jest.spyOn(reflector, 'get').mockReturnValue(undefined);

    const result = await interceptor.intercept(context, next);
    const data = await result.toPromise();

    expect(data).toEqual({ success: true });
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException if idempotency key is missing', async () => {
    const req = mockRequest(); // No headers
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({});

    jest.spyOn(reflector, 'get').mockReturnValue({});

    await expect(interceptor.intercept(context, next)).rejects.toThrow(BadRequestException);
  });

  it('should execute and cache the first request', async () => {
    const req = mockRequest({ 'idempotency-key': 'key-1' }, { amount: 100 });
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ processed: true });

    jest.spyOn(reflector, 'get').mockReturnValue({});

    const result = await interceptor.intercept(context, next);
    const data = await result.toPromise();

    expect(data).toEqual({ processed: true });
    
    // Verify it's in the store
    const cached = await store.getResponse('idempotency:key-1');
    expect(cached).toBeDefined();
    expect((cached as any).body).toEqual({ processed: true });
  });

  it('should replay the cached response on second request', async () => {
    const key = 'key-2';
    const body = { amount: 200 };
    const resultData = { processed: true, id: 123 };

    // Set up store manually
    const record = {
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: resultData,
      fingerprint: interceptor['generateFingerprint'](body),
    };
    await store.saveResponse(`idempotency:${key}`, record, 60);

    const req = mockRequest({ 'idempotency-key': key }, body);
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ should: 'not-be-called' });

    jest.spyOn(reflector, 'get').mockReturnValue({});

    const result = await interceptor.intercept(context, next);
    const data = await result.toPromise();

    expect(data).toEqual(resultData);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.setHeader).toHaveBeenCalledWith('x-idempotency-replayed', 'true');
  });

  it('should throw ConflictException if request is in progress', async () => {
    const key = 'key-3';
    await store.setInProgress(`idempotency:${key}`, 60);

    const req = mockRequest({ 'idempotency-key': key });
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({});

    jest.spyOn(reflector, 'get').mockReturnValue({});

    await expect(interceptor.intercept(context, next)).rejects.toThrow(ConflictException);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
  });

  it('should throw UnprocessableEntityException on fingerprint mismatch', async () => {
    const key = 'key-4';
    const originalBody = { amount: 100 };
    const differentBody = { amount: 200 };

    const record = {
      statusCode: 200,
      headers: {},
      body: { ok: true },
      fingerprint: interceptor['generateFingerprint'](originalBody),
    };
    await store.saveResponse(`idempotency:${key}`, record, 60);

    const req = mockRequest({ 'idempotency-key': key }, differentBody);
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({});

    jest.spyOn(reflector, 'get').mockReturnValue({});

    await expect(interceptor.intercept(context, next)).rejects.toThrow(UnprocessableEntityException);
  });

  it('should not cache if status code is not in cacheableStatuses', async () => {
    const key = 'key-5';
    const req = mockRequest({ 'idempotency-key': key });
    const res = mockResponse();
    res.statusCode = 404; // Not cacheable by default
    const context = mockContext(req, res);
    const next = mockCallHandler({ error: 'not found' });

    jest.spyOn(reflector, 'get').mockReturnValue({});

    const result = await interceptor.intercept(context, next);
    await result.toPromise();

    const cached = await store.getResponse(`idempotency:${key}`);
    expect(cached).toBeNull();
  });

  it('should not cache if body size exceeds maxBodySize', async () => {
    const key = 'key-6';
    const req = mockRequest({ 'idempotency-key': key });
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ large: 'x'.repeat(100) });

    jest.spyOn(reflector, 'get').mockReturnValue({ maxBodySize: 50 });

    const result = await interceptor.intercept(context, next);
    await result.toPromise();

    const cached = await store.getResponse(`idempotency:${key}`);
    expect(cached).toBeNull();
  });

  it('should handle store failure during save gracefully', async () => {
    const key = 'key-7';
    const req = mockRequest({ 'idempotency-key': key });
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ ok: true });

    jest.spyOn(reflector, 'get').mockReturnValue({});
    jest.spyOn(store, 'saveResponse').mockRejectedValue(new Error('Redis down'));
    const clearSpy = jest.spyOn(store, 'clear').mockResolvedValue(undefined);

    const result = await interceptor.intercept(context, next);
    const data = await result.toPromise();

    expect(data).toEqual({ ok: true });
    // Should clear the lock
    expect(clearSpy).toHaveBeenCalledWith('idempotency:key-7');
  });
});

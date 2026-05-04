import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyInterceptor } from '../src/idempotency.interceptor';
import { IdempotencyStore } from '../src/stores/idempotency.store';
import { MemoryStore } from '../src/stores/memory.store';
import { IdempotencyEventEmitter } from '../src/idempotency.events';
import { IDEMPOTENCY_OPTIONS } from '../src/constants';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ConflictException, UnprocessableEntityException, BadRequestException } from '@nestjs/common';
import { of } from 'rxjs';
import { SafeHash } from '../src/utils/safe-hash';

describe('IdempotencyInterceptor', () => {
  let interceptor: IdempotencyInterceptor;
  let store: IdempotencyStore;
  let reflector: Reflector;

  const mockRequest = (headers: any = {}, body: any = {}, query: any = undefined) => ({
    headers,
    body,
    query,
    method: 'POST',
    path: '/test-path',
    url: '/test-path',
  });

  const mockResponse = () => ({
    statusCode: 200,
    setHeader: jest.fn(),
    getHeader: jest.fn(),
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
        IdempotencyEventEmitter,
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

  it('should execute and cache the first request', async () => {
    const req = mockRequest({ 'idempotency-key': 'key-1' }, { amount: 100 });
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ processed: true });

    jest.spyOn(reflector, 'get').mockReturnValue({});

    const result = await interceptor.intercept(context, next);
    const data = await result.toPromise();

    expect(data).toEqual({ processed: true });
    
    const cached = await store.getResponse('idempotency:k:key-1:m:POST:p:/test-path');
    expect(cached).toBeDefined();
    expect((cached as any).body).toEqual({ processed: true });
  });

  it('should replay the cached response on second request', async () => {
    const key = 'key-2';
    const body = { amount: 200 };
    const resultData = { processed: true, id: 123 };

    const record = {
      statusCode: 201,
      headers: { 'content-type': 'application/json' },
      body: resultData,
      fingerprint: SafeHash.hash({ body, query: undefined }),
    };
    const storeKey = `idempotency:k:${key}:m:POST:p:/test-path`;
    // Save without token (simulating existing record)
    await store.clear(storeKey);
    (store as any).store.set(storeKey, {
      data: record,
      expiresAt: Date.now() + 60000,
    });

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
    const req = mockRequest({ 'idempotency-key': key });
    const fingerprint = SafeHash.hash({ body: req.body, query: undefined });
    await store.setInProgress(`idempotency:k:${key}:m:POST:p:/test-path`, 60, 'some-token', fingerprint);

    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({});

    jest.spyOn(reflector, 'get').mockReturnValue({});

    await expect(interceptor.intercept(context, next)).rejects.toThrow(ConflictException);
  });

  it('should throw UnprocessableEntityException on fingerprint mismatch', async () => {
    const key = 'key-4';
    const originalBody = { amount: 100 };
    const differentBody = { amount: 200 };

    const record = {
      statusCode: 200,
      headers: {},
      body: { ok: true },
      fingerprint: SafeHash.hash({ body: originalBody, query: undefined }),
    };
    (store as any).store.set(`idempotency:k:${key}:m:POST:p:/test-path`, {
      data: record,
      expiresAt: Date.now() + 60000,
    });

    const req = mockRequest({ 'idempotency-key': key }, differentBody);
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({});

    jest.spyOn(reflector, 'get').mockReturnValue({});

    await expect(interceptor.intercept(context, next)).rejects.toThrow(UnprocessableEntityException);
  });

  it('should throw UnprocessableEntityException if in-progress request has different body', async () => {
    const key = 'key-collision';
    const req1 = mockRequest({ 'idempotency-key': key }, { a: 1 });
    const fingerprint1 = SafeHash.hash({ body: req1.body, query: undefined });
    await store.setInProgress(`idempotency:k:${key}:m:POST:p:/test-path`, 60, 'some-token', fingerprint1);

    const req2 = mockRequest({ 'idempotency-key': key }, { a: 2 });
    const res = mockResponse();
    const context = mockContext(req2, res);
    const next = mockCallHandler({});

    jest.spyOn(reflector, 'get').mockReturnValue({});

    await expect(interceptor.intercept(context, next)).rejects.toThrow(UnprocessableEntityException);
  });

  it('should bypass cache for Buffers', async () => {
    const key = 'key-bypass';
    const bufferBody = Buffer.from('test');
    const req = mockRequest({ 'idempotency-key': key });
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler(bufferBody);

    jest.spyOn(reflector, 'get').mockReturnValue({});

    const result = await interceptor.intercept(context, next);
    const data = await result.toPromise();

    expect(data).toEqual(bufferBody);
    
    // Lock should be cleared
    const cached = await store.getResponse(`idempotency:k:${key}:m:POST:p:/test-path`);
    expect(cached).toBeNull();
  });

  it('should handle circular references in fingerprinting', async () => {
    const key = 'key-circular';
    const circularBody: any = { a: 1 };
    circularBody.self = circularBody;

    const req = mockRequest({ 'idempotency-key': key }, circularBody);
    const res = mockResponse();
    const context = mockContext(req, res);
    const next = mockCallHandler({ ok: true });

    jest.spyOn(reflector, 'get').mockReturnValue({});

    // Should not throw RangeError
    const result = await interceptor.intercept(context, next);
    await result.toPromise();
    
    expect(await store.getResponse(`idempotency:k:${key}:m:POST:p:/test-path`)).toBeDefined();
  });

  it('should isolate keys for different methods/paths', async () => {
    const key = 'shared-key';
    const next = mockCallHandler({ ok: true });
    jest.spyOn(reflector, 'get').mockReturnValue({});

    // Request 1: POST /path-1
    const req1 = mockRequest({ 'idempotency-key': key });
    req1.path = '/path-1';
    const res1 = mockResponse();
    await (await interceptor.intercept(mockContext(req1, res1), next)).toPromise();

    // Request 2: POST /path-2
    const req2 = mockRequest({ 'idempotency-key': key });
    req2.path = '/path-2';
    const res2 = mockResponse();
    await (await interceptor.intercept(mockContext(req2, res2), next)).toPromise();

    const cached1 = await store.getResponse(`idempotency:k:${key}:m:POST:p:/path-1`);
    const cached2 = await store.getResponse(`idempotency:k:${key}:m:POST:p:/path-2`);

    expect(cached1).toBeDefined();
    expect(cached2).toBeDefined();
    expect(cached1).not.toBe(cached2); // Different records for different paths
  });
});

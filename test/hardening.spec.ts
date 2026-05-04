import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyInterceptor } from '../src/idempotency.interceptor';
import { IdempotencyStore } from '../src/stores/idempotency.store';
import { MemoryStore } from '../src/stores/memory.store';
import { IdempotencyEventEmitter } from '../src/idempotency.events';
import { SafeHash } from '../src/utils/safe-hash';
import { IDEMPOTENCY_OPTIONS, IDEMPOTENT_METADATA_KEY } from '../src/constants';
import { Reflector } from '@nestjs/core';
import { of, throwError } from 'rxjs';
import { ConflictException } from '@nestjs/common';

describe('Idempotency Hardening', () => {
  let interceptor: IdempotencyInterceptor;
  let store: MemoryStore;
  let events: IdempotencyEventEmitter;
  let reflector: Reflector;

  beforeEach(async () => {
    store = new MemoryStore();
    events = new IdempotencyEventEmitter();
    reflector = new Reflector();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotencyInterceptor,
        { provide: IdempotencyStore, useValue: store },
        { provide: IdempotencyEventEmitter, useValue: events },
        { provide: Reflector, useValue: reflector },
        { provide: IDEMPOTENCY_OPTIONS, useValue: { ttl: 60 } },
      ],
    }).compile();

    interceptor = module.get<IdempotencyInterceptor>(IdempotencyInterceptor);
  });

  describe('MemoryStore LRU', () => {
    it('should evict oldest entry when maxKeys is reached', async () => {
      (store as any).maxKeys = 2;
      
      await store.setInProgress('key1', 60, 'tok1', 'fp1');
      await store.setInProgress('key2', 60, 'tok2', 'fp2');
      
      // Access key1 to make it "Recently Used"
      await store.getResponse('key1');
      
      // key2 is now the oldest. Adding key3 should evict key2.
      await store.setInProgress('key3', 60, 'tok3', 'fp3');
      
      expect(await store.getResponse('key1')).not.toBeNull();
      expect(await store.getResponse('key2')).toBeNull();
      expect(await store.getResponse('key3')).not.toBeNull();
    });
  });

  describe('MemoryStore Mutability', () => {
    it('should not allow mutation of cached responses', async () => {
      const body = { nested: { value: 1 } };
      const record = { statusCode: 200, headers: {}, body, fingerprint: 'fp' };
      
      await store.setInProgress('key', 60, 'tok', 'fp');
      await store.saveResponse('key', record as any, 60, 'tok');
      
      const retrieved = await store.getResponse('key');
      expect(retrieved).not.toBeNull();
      expect('body' in retrieved!).toBe(true);
      (retrieved as any).body.nested.value = 2; // Mutate retrieved object
      
      const secondRetrieval = await store.getResponse('key');
      expect(secondRetrieval).not.toBeNull();
      expect((secondRetrieval as any).body.nested.value).toBe(1); // Original should be intact
    });
  });

  describe('Key Isolation', () => {
    it('should prevent collision between tenant and raw key using robust namespacing', async () => {
      const mockRequest = (tenant: string, key: string) => ({
        headers: { 'idempotency-key': key },
        method: 'POST',
        path: '/test',
        body: {},
      });

      const options = { tenantExtractor: (req) => req.tenant };
      
      const key1 = (interceptor as any).buildFullKey('1:abc', 'user', mockRequest('', ''), options);
      const key2 = (interceptor as any).buildFullKey('abc', 'user:1', mockRequest('', ''), options);
      
      expect(key1).not.toBe(key2);
      expect(key1).toContain('t:user:k:1:abc');
      expect(key2).toContain('t:user:1:k:abc');
    });
  });

  describe('Metrics Emission', () => {
    it('should emit cache_hit event', async () => {
      const eventSpy = jest.fn();
      events.events$.subscribe(eventSpy);

      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'idempotency-key': 'test' }, method: 'POST', path: '/test', body: {} }),
          getResponse: () => ({ setHeader: jest.fn(), getHeader: jest.fn(), getHeaders: () => ({}) }),
        }),
        getHandler: () => ({}),
      } as any;

      jest.spyOn(reflector, 'get').mockReturnValue({});
      jest.spyOn(SafeHash, 'hash').mockReturnValue('mock-fp');
      
      // Mock a hit
      const record = { statusCode: 200, headers: {}, body: {}, fingerprint: 'mock-fp' };
      jest.spyOn(store, 'getResponse').mockResolvedValue(record);

      await interceptor.intercept(context, { handle: () => of({}) });
      
      expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({ type: 'cache_hit' }));
    });
  });

  describe('Race Condition Protection', () => {
    it('should await cleanup on failure to prevent race conditions', async () => {
      const cleanupSpy = jest.spyOn(store, 'clear');
      
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers: { 'idempotency-key': 'test' }, method: 'POST', path: '/test', body: {} }),
          getResponse: () => ({ setHeader: jest.fn(), getHeader: jest.fn(), getHeaders: () => ({}) }),
        }),
        getHandler: () => ({}),
      } as any;

      jest.spyOn(reflector, 'get').mockReturnValue({});
      jest.spyOn(store, 'getResponse').mockResolvedValue(null);
      jest.spyOn(store, 'setInProgress').mockResolvedValue(true);

      const handler = {
        handle: () => throwError(() => new Error('Controller failed')),
      };

      try {
        const obs = await interceptor.intercept(context, handler);
        await obs.toPromise();
      } catch (e) {
        // Expected
      }

      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});

import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, throwError, from } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import * as crypto from 'crypto';
import { Logger } from '@nestjs/common';
import {
  IDEMPOTENCY_OPTIONS,
  IDEMPOTENT_METADATA_KEY,
  DEFAULT_IDEMPOTENCY_HEADER,
  REPLAY_HEADER,
  HEADER_BLACKLIST,
} from './constants';
import {
  IdempotencyOptions,
  ResponseRecord,
} from './interfaces/idempotency-options.interface';
import { IdempotencyStore } from './stores/idempotency.store';
import { SafeHash } from './utils/safe-hash';
import { IdempotencyEventEmitter } from './idempotency.events';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
    @Inject(IDEMPOTENCY_OPTIONS)
    private readonly globalOptions: IdempotencyOptions,
    private readonly events: IdempotencyEventEmitter,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const metadata = this.reflector.get<IdempotencyOptions>(
      IDEMPOTENT_METADATA_KEY,
      context.getHandler(),
    );

    if (!metadata) {
      return next.handle();
    }

    const options: IdempotencyOptions = {
      ...this.globalOptions,
      ...metadata,
    };

    const rawKey = await this.resolveRawKey(request, options);
    const tenantId = await this.resolveTenantId(request, options);
    const key = this.buildFullKey(rawKey, tenantId, request, options);

    // Guard: Check body size BEFORE hashing to protect the event loop
    if (options.maxBodySize && request.body) {
      const approxSize = typeof request.body === 'string' 
        ? Buffer.byteLength(request.body) 
        : Buffer.byteLength(JSON.stringify(request.body));
      
      if (approxSize > options.maxBodySize) {
        this.events.emit({ type: 'request_too_large', key, size: approxSize });
        this.logger.warn(`Request body too large (${approxSize} bytes) for idempotency tracking. Key: ${key}`);
        return next.handle();
      }
    }

    const fencingToken = crypto.randomUUID();
    const fingerprint = SafeHash.hash({
      body: request.body,
      query: request.query,
    });

    try {
      const cached = await this.store.getResponse(key);

      if (cached && 'token' in cached && 'fingerprint' in cached) {
        if (cached.fingerprint !== fingerprint) {
          const msg = 'Request body or query does not match request in progress.';
          this.events.emit({ type: 'collision', key, message: msg });
          throw new UnprocessableEntityException(`Idempotency key collision: ${msg}`);
        }

        const retryAfter = options.retryAfter || 10;
        this.setHeader(response, 'Retry-After', retryAfter.toString());
        throw new ConflictException('Request is already being processed.');
      }

      if (cached) {
        const record = cached as ResponseRecord;
        if (record.fingerprint !== fingerprint) {
          const msg = 'Request body or query does not match cached response.';
          this.events.emit({ type: 'collision', key, message: msg });
          throw new UnprocessableEntityException(`Idempotency key collision: ${msg}`);
        }

        this.events.emit({ type: 'cache_hit', key });
        this.logger.verbose(`Cache hit: Replaying response for key: ${key}`);
        this.replayResponse(response, record, options);
        return of(record.body);
      }

      this.events.emit({ type: 'cache_miss', key });
      const lockTtl = options.lockTtl || 60;
      const acquired = await this.store.setInProgress(key, lockTtl, fencingToken, fingerprint);

      if (!acquired) {
        throw new ConflictException('Request is already being processed.');
      }

      this.events.emit({ type: 'lock_acquired', key });
      this.logger.debug(`Idempotency key resolved: ${key}`);

      return next.handle().pipe(
        mergeMap(async (body) => {
          const cacheableStatuses = options.cacheableStatuses || [200, 201, 202, 204];
          const statusCode = this.getStatusCode(response);

          if (!cacheableStatuses.includes(statusCode)) {
            await this.store.clear(key, fencingToken).catch(() => {});
            return body;
          }

          if (this.isStream(body)) {
            this.logger.verbose(`Response is a stream or buffer. Skipping cache for key: ${key}`);
            await this.store.clear(key, fencingToken).catch(() => {});
            return body;
          }

          // Check response body size if needed
          if (options.maxBodySize) {
            const serializedBody = typeof body === 'string' ? body : JSON.stringify(body);
            const bodySize = Buffer.byteLength(serializedBody);
            if (bodySize > options.maxBodySize) {
              this.logger.warn(`Response body size (${bodySize} bytes) exceeds maxBodySize. Skipping cache for key: ${key}`);
              await this.store.clear(key, fencingToken).catch(() => {});
              return body;
            }
          }

          const ttl = options.ttl || 86400;
          const record: ResponseRecord = {
            statusCode,
            headers: this.getFilteredHeaders(response),
            body: body,
            fingerprint,
          };

          try {
            await this.store.saveResponse(key, record, ttl, fencingToken);
          } catch (err) {
            this.events.emit({ type: 'store_error', key, error: err.message });
            this.logger.error(`Failed to save response for key ${key}: ${err.message}`);
            await this.store.clear(key, fencingToken).catch(() => {});
          }

          return body;
        }),
        catchError((err) => {
          this.logger.verbose(`Request failed for key ${key}. Clearing lock.`);
          // Await cleanup to prevent race conditions on immediate retries
          return from(this.store.clear(key, fencingToken)).pipe(
            catchError(() => of(null)), // Ignore cleanup errors to preserve original error
            mergeMap(() => throwError(() => err))
          );
        }),
      );
    } catch (err) {
      if (err instanceof ConflictException || err instanceof UnprocessableEntityException || err instanceof BadRequestException) {
        throw err;
      }

      this.events.emit({ type: 'store_error', key, error: err.message });
      this.logger.error(`Idempotency store error for key ${key}: ${err.message}`);

      if (options.storageFailureStrategy === 'fail-open') {
        this.logger.warn(`Store unavailable. Failing open for key: ${key}`);
        return next.handle();
      }

      throw new ServiceUnavailableException('Idempotency store unavailable.');
    }
  }

  private isStream(body: any): boolean {
    if (!body) return false;
    return (
      body instanceof StreamableFile ||
      Buffer.isBuffer(body) ||
      (typeof body.pipe === 'function' && typeof body.on === 'function')
    );
  }

  private async resolveRawKey(request: any, options: IdempotencyOptions): Promise<string> {
    let rawKey: string | undefined;

    if (options.keyExtractor) {
      rawKey = await options.keyExtractor(request);
    }

    if (!rawKey) {
      const headerName = options.headerName || DEFAULT_IDEMPOTENCY_HEADER;
      rawKey = request.headers[headerName.toLowerCase()];
    }

    if (!rawKey) {
      throw new BadRequestException(
        `Missing idempotency key. Provide it via header ${
          options.headerName || DEFAULT_IDEMPOTENCY_HEADER
        } or custom extractor.`,
      );
    }
    return String(rawKey);
  }

  private async resolveTenantId(request: any, options: IdempotencyOptions): Promise<string> {
    if (options.tenantExtractor) {
      return (await options.tenantExtractor(request)) || '';
    }
    return '';
  }

  private buildFullKey(rawKey: string, tenantId: string, request: any, options: IdempotencyOptions): string {
    // Robust namespacing to prevent collision: idempotency:t:{tenant}:k:{key}
    let fullKey = tenantId ? `idempotency:t:${tenantId}:k:${rawKey}` : `idempotency:k:${rawKey}`;

    if (options.enforceKeyIsolation !== false) {
      const method = request.method.toUpperCase();
      const path = request.path || request.url.split('?')[0];
      // Strip trailing slash for consistency
      const normalizedPath = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
      fullKey = `${fullKey}:m:${method}:p:${normalizedPath}`;
    }

    return fullKey;
  }

  private replayResponse(response: any, record: ResponseRecord, options?: IdempotencyOptions) {
    this.setStatusCode(response, record.statusCode);
    Object.entries(record.headers).forEach(([key, value]) => {
      this.setHeader(response, key, value);
    });
    this.setHeader(response, REPLAY_HEADER, 'true');

    const headerName = options?.headerName || DEFAULT_IDEMPOTENCY_HEADER;
    const existingVary = this.getHeader(response, 'Vary');

    if (!existingVary) {
      this.setHeader(response, 'Vary', headerName);
    } else {
      const varyArray = Array.isArray(existingVary)
        ? existingVary
        : String(existingVary).split(',').map((s) => s.trim());

      if (!varyArray.some((v) => v.toLowerCase() === headerName.toLowerCase())) {
        varyArray.push(headerName);
        this.setHeader(response, 'Vary', varyArray.join(', '));
      }
    }
  }

  private getFilteredHeaders(response: any): Record<string, string | string[]> {
    const headers = this.getAllHeaders(response);
    const filtered: Record<string, string | string[]> = {};

    Object.entries(headers).forEach(([key, value]) => {
      if (!HEADER_BLACKLIST.includes(key.toLowerCase()) && value !== undefined) {
        filtered[key] = value as string | string[];
      }
    });

    return filtered;
  }

  // Platform agnostic helpers
  private setHeader(response: any, name: string, value: any) {
    if (typeof response.setHeader === 'function') {
      response.setHeader(name, value);
    } else if (typeof response.header === 'function') {
      response.header(name, value);
    }
  }

  private getHeader(response: any, name: string) {
    if (typeof response.getHeader === 'function') {
      return response.getHeader(name);
    } else if (typeof response.getHeaders === 'function') {
      return response.getHeaders()[name.toLowerCase()];
    }
    return undefined;
  }

  private getAllHeaders(response: any) {
    if (typeof response.getHeaders === 'function') {
      return response.getHeaders();
    }
    return {};
  }

  private getStatusCode(response: any): number {
    return response.statusCode || response.status || 200;
  }

  private setStatusCode(response: any, code: number) {
    if (typeof response.status === 'function') {
      response.status(code);
    } else {
      response.statusCode = code;
    }
  }
}

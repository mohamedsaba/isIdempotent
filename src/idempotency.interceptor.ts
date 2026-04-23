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
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, throwError, firstValueFrom } from 'rxjs';
import { catchError, tap, mergeMap } from 'rxjs/operators';
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

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
    @Inject(IDEMPOTENCY_OPTIONS)
    private readonly globalOptions: IdempotencyOptions,
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

    const key = await this.resolveKey(request, options);
    const fingerprint = this.generateFingerprint(request.body);

    try {
      const cached = await this.store.getResponse(key);

      if (cached === 'IN_PROGRESS') {
        const retryAfter = options.retryAfter || 10;
        response.setHeader('Retry-After', retryAfter.toString());
        throw new ConflictException('Request is already being processed.');
      }

      if (cached) {
        const record = cached as ResponseRecord;
        if (record.fingerprint !== fingerprint) {
          throw new UnprocessableEntityException(
            'Idempotency key collision: Request body does not match cached response.',
          );
        }

        // Replay cached response
        this.logger.verbose(`Cache hit: Replaying response for key: ${key}`);
        this.replayResponse(response, record);
        return of(record.body);
      }

      // No cached response, try to acquire lock
      const lockTtl = options.lockTtl || 60;
      const acquired = await this.store.setInProgress(key, lockTtl);

      if (!acquired) {
        throw new ConflictException('Request is already being processed.');
      }

      this.logger.debug(`Idempotency key resolved: ${key}`);

      return next.handle().pipe(
        mergeMap(async (body) => {
          const cacheableStatuses = options.cacheableStatuses || [200, 201, 202, 204];

          if (!cacheableStatuses.includes(response.statusCode)) {
            this.logger.verbose(
              `Status code ${response.statusCode} is not cacheable. Clearing lock for key: ${key}`,
            );
            await this.store.clear(key).catch(() => {});
            return body;
          }

          // Check body size if limit is set
          if (options.maxBodySize && body) {
            const bodySize = Buffer.byteLength(
              typeof body === 'string' ? body : JSON.stringify(body),
            );
            if (bodySize > options.maxBodySize) {
              this.logger.warn(
                `Response body size (${bodySize} bytes) exceeds maxBodySize (${options.maxBodySize}). Skipping cache for key: ${key}`,
              );
              await this.store.clear(key).catch(() => {});
              return body;
            }
          }

          const ttl = options.ttl || 86400;
          const record: ResponseRecord = {
            statusCode: response.statusCode,
            headers: this.getFilteredHeaders(response),
            body,
            fingerprint,
          };

          try {
            await this.store.saveResponse(key, record, ttl);
            this.logger.verbose(`Response successfully cached for key: ${key}`);
          } catch (err) {
            this.logger.error(`Failed to save response for key ${key}: ${err.message}`);
            // If save fails, we clear the lock to allow retry, unless strategy is fail-closed
            await this.store.clear(key).catch(() => {});
          }

          return body;
        }),
        catchError((err) => {
          this.logger.verbose(`Request failed for key ${key}. Clearing lock.`);
          // Clear lock on error so client can retry
          this.store.clear(key).catch(() => {});
          return throwError(() => err);
        }),
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.warn(`Conflict: Request already in progress for key: ${key}`);
        throw err;
      }
      if (err instanceof UnprocessableEntityException) {
        this.logger.warn(`Fingerprint mismatch for key: ${key}`);
        throw err;
      }
      if (err instanceof BadRequestException) {
        throw err;
      }

      this.logger.error(`Idempotency store error for key ${key}: ${err.message}`);

      // Handle store unavailability
      if (options.storageFailureStrategy === 'fail-open') {
        this.logger.warn(`Store unavailable. Failing open for key: ${key}`);
        return next.handle();
      }

      throw new ServiceUnavailableException('Idempotency store unavailable.');
    }
  }

  private async resolveKey(request: any, options: IdempotencyOptions): Promise<string> {
    let rawKey: string | undefined;

    if (options.keyExtractor) {
      rawKey = await options.keyExtractor(request);
    }

    if (!rawKey) {
      const headerName = options.headerName || DEFAULT_IDEMPOTENCY_HEADER;
      rawKey = request.headers[headerName];
    }

    if (!rawKey) {
      throw new BadRequestException(
        `Missing idempotency key. Provide it via header ${
          options.headerName || DEFAULT_IDEMPOTENCY_HEADER
        } or custom extractor.`,
      );
    }

    let tenantId = '';
    if (options.tenantExtractor) {
      tenantId = await options.tenantExtractor(request);
    }

    return tenantId ? `idempotency:${tenantId}:${rawKey}` : `idempotency:${rawKey}`;
  }

  private generateFingerprint(body: any): string {
    if (!body) return 'empty';
    const canonicalBody = JSON.stringify(this.deepSort(body));
    return crypto.createHash('sha256').update(canonicalBody).digest('hex');
  }

  private deepSort(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.deepSort(item));
    }

    const sortedKeys = Object.keys(obj).sort();
    const result: any = {};
    sortedKeys.forEach((key) => {
      result[key] = this.deepSort(obj[key]);
    });
    return result;
  }

  private replayResponse(response: any, record: ResponseRecord) {
    response.status(record.statusCode);
    Object.entries(record.headers).forEach(([key, value]) => {
      response.setHeader(key, value);
    });
    response.setHeader(REPLAY_HEADER, 'true');
  }

  private getFilteredHeaders(response: any): Record<string, string | string[]> {
    const headers = response.getHeaders();
    const filtered: Record<string, string | string[]> = {};

    Object.entries(headers).forEach(([key, value]) => {
      if (!HEADER_BLACKLIST.includes(key.toLowerCase()) && value !== undefined) {
        filtered[key] = value as string | string[];
      }
    });

    return filtered;
  }
}

import { DynamicModule, Module, Global, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyOptions } from './interfaces/idempotency-options.interface';
import { IDEMPOTENCY_OPTIONS } from './constants';
import { IdempotencyStore } from './stores/idempotency.store';
import { MemoryStore } from './stores/memory.store';

import { IdempotencyEventEmitter } from './idempotency.events';

@Global()
@Module({})
export class IdempotencyModule {
  static forRoot(options: IdempotencyOptions & { store?: Provider }): DynamicModule {
    const optionsProvider: Provider = {
      provide: IDEMPOTENCY_OPTIONS,
      useValue: options,
    };

    const storeProvider: Provider = options.store || {
      provide: IdempotencyStore,
      useClass: MemoryStore,
    };

    return {
      module: IdempotencyModule,
      providers: [
        optionsProvider,
        storeProvider,
        IdempotencyInterceptor,
        IdempotencyEventEmitter,
        {
          provide: APP_INTERCEPTOR,
          useExisting: IdempotencyInterceptor,
        },
      ],
      exports: [IdempotencyStore, IdempotencyInterceptor, IDEMPOTENCY_OPTIONS, IdempotencyEventEmitter],
    };
  }

  static forRootAsync(options: {
    useFactory: (...args: any[]) => Promise<IdempotencyOptions> | IdempotencyOptions;
    inject?: any[];
    store?: Provider;
  }): DynamicModule {
    const optionsProvider: Provider = {
      provide: IDEMPOTENCY_OPTIONS,
      useFactory: options.useFactory,
      inject: options.inject || [],
    };

    const storeProvider: Provider = options.store || {
      provide: IdempotencyStore,
      useClass: MemoryStore,
    };

    return {
      module: IdempotencyModule,
      providers: [
        optionsProvider,
        storeProvider,
        IdempotencyInterceptor,
        IdempotencyEventEmitter,
        {
          provide: APP_INTERCEPTOR,
          useExisting: IdempotencyInterceptor,
        },
      ],
      exports: [IdempotencyStore, IdempotencyInterceptor, IDEMPOTENCY_OPTIONS, IdempotencyEventEmitter],
    };
  }
}

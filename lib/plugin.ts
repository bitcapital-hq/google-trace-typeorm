import { Plugin, Span, Tracer } from '@google-cloud/trace-agent/build/src/plugin-types';
import * as shimmer from 'shimmer';
import { InsertQueryBuilder, SelectQueryBuilder, UpdateQueryBuilder } from 'typeorm';
import * as InsertQbModule from 'typeorm/query-builder/InsertQueryBuilder';
import * as SelectQbModule from 'typeorm/query-builder/SelectQueryBuilder';
import * as UpdateQbModule from 'typeorm/query-builder/UpdateQueryBuilder';

type QbGetMethods = 'getOne' | 'getMany' | 'getRawOne' | 'getRawMany' | 'getManyAndCount';

const GET_METHODS: QbGetMethods[] = ['getOne', 'getMany', 'getRawOne', 'getRawMany', 'getManyAndCount'];

function patchPromise<T>(promise: Promise<T>, span: Span) {
  return promise.then(
    res => {
      span.endSpan();
      return res;
    },
    err => {
      span.endSpan();
      throw err;
    },
  );
}

function patchGetMethod<T>(qb: SelectQueryBuilder<T>, methodName: QbGetMethods, agent: Tracer) {
  shimmer.wrap(qb, methodName, original => {
    return function tracedGetMethod<T>(this: SelectQueryBuilder<T>) {
      const span = agent.createChildSpan({ name: `TypeORM.${methodName}` });

      if (!agent.isRealSpan(span)) {
        return original.apply(this, arguments);
      }

      const queryResult: Promise<any> = original.apply(this, arguments);
      return patchPromise(queryResult, span);
    };
  });
}

function patchSelectQueryBuilder(mod: typeof SelectQbModule, agent: Tracer) {
  GET_METHODS.forEach(method => {
    patchGetMethod(mod.SelectQueryBuilder.prototype, method, agent);
  });
}

function unpatchSelectQueryBuilder(mod: typeof SelectQbModule) {
  GET_METHODS.forEach(method => {
    shimmer.unwrap(mod.SelectQueryBuilder.prototype, method);
  });
}

function patchInsertOrUpdateQueryBuilder<T>(mod: typeof InsertQbModule | typeof UpdateQbModule, agent: Tracer) {
  const queryBuilder =
    (mod as typeof InsertQbModule).InsertQueryBuilder || (mod as typeof UpdateQbModule).UpdateQueryBuilder;
  const qbType = (mod as typeof InsertQbModule).InsertQueryBuilder ? 'insert' : 'update';

  shimmer.wrap(queryBuilder.prototype, 'execute', original => {
    return function tracedExecute<T>(this: InsertQueryBuilder<T> | UpdateQueryBuilder<T>) {
      const span = agent.createChildSpan({ name: `TypeORM.${qbType}` });

      if (!agent.isRealSpan(span)) {
        return original.apply(this, arguments);
      }

      const queryResult: Promise<any> = original.apply(this, arguments);
      return patchPromise(queryResult, span);
    };
  });
}

function unpatchInsertOrUpdateQueryBuilder(mod: typeof InsertQbModule | typeof UpdateQbModule) {
  const queryBuilder =
    (mod as typeof InsertQbModule).InsertQueryBuilder || (mod as typeof UpdateQbModule).UpdateQueryBuilder;
  shimmer.unwrap(queryBuilder.prototype, 'execute');
}

const plugin: Plugin = [
  {
    file: 'query-builder/SelectQueryBuilder.js',
    versions: '^0.2.19',
    patch: patchSelectQueryBuilder,
    unpatch: unpatchSelectQueryBuilder,
  },
  {
    file: 'query-builder/UpdateQueryBuilder.js',
    versions: '^0.2.19',
    patch: patchInsertOrUpdateQueryBuilder,
    unpatch: unpatchInsertOrUpdateQueryBuilder,
  },
  {
    file: 'query-builder/InsertQueryBuilder.js',
    versions: '^0.2.19',
    patch: patchInsertOrUpdateQueryBuilder,
    unpatch: unpatchInsertOrUpdateQueryBuilder,
  },
];

export = plugin;

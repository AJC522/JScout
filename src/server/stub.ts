import { ApiError } from './errors';

/**
 * Placeholder service used by the foundation until a feature is implemented:
 * every method call fails with HTTP 501. Replace the stub factory in the
 * feature's own file; do not edit app.ts to wire a feature in.
 */
export function stubService<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get: (_target, prop) => () => {
        throw new ApiError(501, 'not_implemented', `${name}.${String(prop)} is not implemented yet`);
      },
    },
  ) as T;
}

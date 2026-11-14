/** True only in `vite dev`. Simulated calls and other test affordances are
 *  compiled out of production builds. */
export const IS_DEV: boolean =
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

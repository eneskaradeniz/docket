// Machine-local key → JSON value store for operator settings. Deliberately untyped: each settings
// use case owns the shape of its own key and validates what it reads back.
export interface AppSettingsRepo {
  /** The stored value, or `undefined` when the key was never set. Callers get a copy. */
  get(key: string): Promise<unknown | undefined>;
  /** Upserts the key. The value must be JSON-serialisable (`undefined` is not); a violation
   *  rejects and leaves the stored value untouched. */
  set(key: string, value: unknown): Promise<void>;
}

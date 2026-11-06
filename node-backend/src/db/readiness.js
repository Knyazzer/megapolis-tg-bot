import { pingDb } from './mysql.js';
import { mysqlSchemaDiagnostics } from './schema-checks.js';

// Readiness only inspects dependencies; migrations belong to the explicit CLI.
export function createDatabaseReadiness({
  ping = pingDb,
  diagnose = mysqlSchemaDiagnostics,
  now = Date.now,
  schemaTtlMs = 30_000,
  resultTtlMs = 1000,
} = {}) {
  let cachedResult = null;
  let resultExpiresAt = 0;
  let cachedSchema = null;
  let schemaExpiresAt = 0;
  let inFlight = null;

  function invalidateSchema() {
    cachedSchema = null;
    schemaExpiresAt = 0;
  }

  async function inspect(forceSchema) {
    try {
      if (!(await ping())) throw new Error('Database ping failed');
    } catch (error) {
      invalidateSchema();
      return {
        ok: false,
        db: { ok: false, error: errorMessage(error) },
        error: 'database_unavailable',
      };
    }

    let schema;
    const useCachedSchema = !forceSchema && cachedSchema && now() < schemaExpiresAt;
    try {
      schema = useCachedSchema ? cachedSchema : await diagnose();
    } catch (error) {
      invalidateSchema();
      return {
        ok: false,
        db: { ok: true },
        schema: { ok: false, error: errorMessage(error) },
        error: 'schema_unavailable',
      };
    }

    if (!schema?.ok) {
      invalidateSchema();
      return { ok: false, db: { ok: true }, schema, error: 'schema_mismatch' };
    }

    // Reusing a cached schema must not extend its original lifetime.
    if (!useCachedSchema) {
      cachedSchema = schema;
      schemaExpiresAt = now() + schemaTtlMs;
    }
    return { ok: true, db: { ok: true }, schema };
  }

  return async function check({ forceSchema = false } = {}) {
    if (inFlight) return inFlight;
    if (!forceSchema && cachedResult && now() < resultExpiresAt) return cachedResult;

    inFlight = inspect(forceSchema)
      .then((result) => {
        cachedResult = result;
        // A repaired database/schema should become ready promptly.
        resultExpiresAt = now() + (result.ok ? resultTtlMs : Math.min(resultTtlMs, 1000));
        return result;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

export const checkDatabaseReadiness = createDatabaseReadiness();

function errorMessage(error) {
  return String(error?.message || error || 'Database check failed');
}

/**
 * Connection URL for the Prisma CLI and the migration scripts in this folder.
 *
 * Built from the same POSTGRES_* variables the application reads, so there is
 * no separate DATABASE_URL to keep in sync. These are the administrative
 * credentials: migrations change schemas, which the low-privilege tenant
 * logins must not be able to do.
 *
 * Returns undefined when a setting is missing. `prisma generate` needs no
 * connection and runs without any of them (as in the image build); commands
 * that do need one then report that the datasource URL is not configured.
 *
 * `port` overrides POSTGRES_PORT: a tenant's database may sit on another
 * PostgreSQL server port of POSTGRES_HOST (tenants.database_port).
 */
export function migrationDatabaseUrl(
  database: string | undefined,
  port?: string | number,
): string | undefined {
  const host = process.env.POSTGRES_HOST?.trim();
  const portOverride = port === undefined ? "" : String(port).trim();
  const resolvedPort = portOverride || process.env.POSTGRES_PORT?.trim() || "5432";
  const user = process.env.POSTGRES_USER?.trim();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  const name = database?.trim();
  if (!host || !user || !password || !name) return undefined;

  const encode = encodeURIComponent;
  return `postgresql://${encode(user)}:${encode(password)}@${host}:${resolvedPort}/${encode(name)}`;
}

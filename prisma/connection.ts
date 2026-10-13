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
 */
export function migrationDatabaseUrl(database: string | undefined): string | undefined {
  const host = process.env.POSTGRES_HOST?.trim();
  const port = process.env.POSTGRES_PORT?.trim() || "5432";
  const user = process.env.POSTGRES_USER?.trim();
  const password = process.env.POSTGRES_PASSWORD?.trim();
  const name = database?.trim();
  if (!host || !user || !password || !name) return undefined;

  const encode = encodeURIComponent;
  return `postgresql://${encode(user)}:${encode(password)}@${host}:${port}/${encode(name)}`;
}

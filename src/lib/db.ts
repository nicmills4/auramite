import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

// Prisma 7 talks to Postgres through a driver adapter rather than a bundled
// query engine, so the connection string is passed in explicitly.
// Reuse one client across hot reloads in dev — otherwise every reload opens a
// fresh pool and Postgres runs out of connection slots.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function getClient(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set — the database-backed routes cannot start.");
  }

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  globalForPrisma.prisma = client;
  return client;
}

/**
 * Lazy proxy. Importing this module must NOT construct a client: `next build`
 * imports every route to collect page data, and a Docker build has no runtime
 * env, so connecting at module scope fails the build rather than the request.
 * The client is created on first actual use instead.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getClient();
    const value = Reflect.get(client as object, prop);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";
// Imported for its side effect as much as for its value: src/env.ts is what
// loads the .env file and validates DATABASE_URL. Reading `process.env` directly
// meant this module only worked when something else happened to import env
// first — true for src/index.ts by luck of import order, and false for every
// test that reached Prisma without going through the API, which then died on
// "Invalid value undefined for datasource" rather than anything informative.
import { env } from "../env";

const dbUrl = env.DATABASE_URL;
let url = dbUrl;

if (dbUrl && dbUrl.includes("sslmode=verify-full") && !dbUrl.includes("sslrootcert")) {
  const certPath = path.resolve(__dirname, "../../root.crt");
  if (fs.existsSync(certPath)) {
    const separator = dbUrl.includes("?") ? "&" : "?";
    url = `${dbUrl}${separator}sslrootcert=${certPath}`;
  }
}

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url,
    },
  },
});


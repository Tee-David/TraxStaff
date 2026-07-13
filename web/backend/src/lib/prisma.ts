import { PrismaClient } from "@prisma/client";
import path from "node:path";
import fs from "node:fs";

const dbUrl = process.env.DATABASE_URL;
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


import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const ORG_NAME = "Trax Test Org";
const PASSWORD = "password123";

const SEED_USERS = [
  { email: "admin@trax.test", role: "owner" as const },
  { email: "staff1@trax.test", role: "member" as const },
  { email: "staff2@trax.test", role: "member" as const },
];

async function main() {
  const passwordHash = await bcrypt.hash(PASSWORD, 12);

  // Reuse an existing test org if the seed has run before, else create one.
  const org =
    (await prisma.organization.findFirst({ where: { name: ORG_NAME } })) ??
    (await prisma.organization.create({ data: { name: ORG_NAME } }));

  for (const u of SEED_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: { passwordHash, role: u.role, status: "active", orgId: org.id },
      create: {
        orgId: org.id,
        email: u.email,
        passwordHash,
        role: u.role,
        status: "active",
      },
    });
  }

  console.log(`Seeded org "${ORG_NAME}" (${org.id}) with users:`);
  for (const u of SEED_USERS) {
    console.log(`  ${u.role.padEnd(6)}  ${u.email}  /  ${PASSWORD}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

/**
 * Creates a stable dev tenant so NEXT_PUBLIC_DEV_TENANT_ID can match Postgres.
 * Run from repo: pnpm --filter api exec prisma db seed
 *   (or: cd apps/api && npx prisma db seed)
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/** Must match apps/web/.env.local NEXT_PUBLIC_DEV_TENANT_ID */
const DEV_TENANT_ID = '00000000-0000-4000-8000-000000000001';

async function main() {
  await prisma.tenant.upsert({
    where: { id: DEV_TENANT_ID },
    create: {
      id: DEV_TENANT_ID,
      name: 'Local development',
      activeTranslator: 'gemini',
      activeScorer: 'langdock',
    },
    update: {},
  });
  console.log(`Dev tenant upserted: ${DEV_TENANT_ID}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

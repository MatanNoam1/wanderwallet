// Runs once per server start (Node runtime only). Sets SQLite PRAGMAs and,
// later, boots the in-process job worker. Guarded so it never runs on the edge.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { prisma } = await import("@/lib/prisma");
  await prisma.$executeRawUnsafe("PRAGMA journal_mode=WAL;");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout=5000;");
  console.log("[instrumentation] SQLite ready (WAL, busy_timeout=5000)");

  // P2: boot the in-process worker here.
  // const { startWorker } = await import("@/lib/worker");
  // startWorker();
}

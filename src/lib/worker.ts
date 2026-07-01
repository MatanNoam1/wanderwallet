import { unlink } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { tripEmitter } from "@/lib/emitter";
import { ExpenseStatus, JobStatus, JobType } from "@prisma/client";
import { uploadAbsPath } from "@/lib/uploads";

const POLL_MS = 5_000;

// Exponential backoff per attempt (1-indexed): 30s, 120s, 480s
function backoffMs(attempt: number) {
  return Math.min(30_000 * 2 ** (attempt - 1), 480_000);
}

async function claimNext(): Promise<string | null> {
  const job = await prisma.job.findFirst({
    where: { status: JobStatus.QUEUED, runAfter: { lte: new Date() } },
    orderBy: { runAfter: "asc" },
  });
  if (!job) return null;

  // Atomic claim: only succeeds if still QUEUED (safe even if future multi-worker)
  const claimed = await prisma.job.updateMany({
    where: { id: job.id, status: JobStatus.QUEUED },
    data: { status: JobStatus.RUNNING, attempts: { increment: 1 } },
  });
  return claimed.count === 1 ? job.id : null;
}

async function execute(jobId: string) {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });

  try {
    switch (job.type) {
      case JobType.TEXT_PARSE: {
        const { handleTextParse } = await import("@/lib/parse-text");
        await handleTextParse(job);
        break;
      }
      case JobType.VISION_PARSE: {
        const { handleVisionParse } = await import("@/lib/parse-vision");
        await handleVisionParse(job);
        break;
      }
      case JobType.FX_REFRESH:
        throw new Error("FX_REFRESH not implemented");
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: JobStatus.DONE },
    });

    if (job.expenseId) {
      const exp = await prisma.expense.findUnique({
        where: { id: job.expenseId },
        select: { tripId: true },
      });
      if (exp) tripEmitter.emit(`expense:${exp.tripId}`, job.expenseId);
    }

    console.log(`[worker] ${job.type} ${jobId} DONE`);
  } catch (err) {
    const failed = job.attempts >= job.maxAttempts;
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: failed ? JobStatus.FAILED : JobStatus.QUEUED,
        lastError: String(err),
        ...(failed ? {} : { runAfter: new Date(Date.now() + backoffMs(job.attempts)) }),
      },
    });
    if (failed && job.expenseId) {
      const exp = await prisma.expense.update({
        where: { id: job.expenseId },
        data: { status: ExpenseStatus.FAILED },
        select: { imagePath: true },
      });
      if (exp.imagePath) {
        await unlink(uploadAbsPath(exp.imagePath)).catch((unlinkErr) => {
          console.error(`[worker] failed to delete upload for expense ${job.expenseId}:`, unlinkErr);
        });
      }
    }
    console.error(`[worker] ${job.type} ${jobId} ${failed ? "FAILED" : "retry in backoff"}:`, err);
  }
}

async function tick() {
  try {
    const jobId = await claimNext();
    if (jobId) await execute(jobId);
  } catch (err) {
    console.error("[worker] tick error:", err);
  }
}

export function startWorker() {
  console.log("[worker] started (poll interval: 5s)");
  // Drain any queued jobs left over from a previous run immediately
  void tick();
  setInterval(() => void tick(), POLL_MS);
}

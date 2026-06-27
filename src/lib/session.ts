import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./prisma";

/** Server-side: current user or redirect to /login. */
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user as { id: string; email: string; name?: string | null; image?: string | null };
}

/** Throws "FORBIDDEN" if the user is neither owner nor member of the trip. */
export async function requireMember(tripId: string) {
  const user = await requireUser();
  const allowed = await prisma.trip.findFirst({
    where: {
      id: tripId,
      OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true },
  });
  if (!allowed) throw new Error("FORBIDDEN");
  return user;
}

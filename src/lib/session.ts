import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "./prisma";

type AppUser = { id: string; email: string; name?: string | null; image?: string | null };

/**
 * Current user from the session, or null. In dev only, falls back to the user
 * named by WANDER_DEV_EMAIL so the dashboard is viewable before Google OAuth
 * creds are wired.
 * ponytail: dev-only shortcut, hard-gated to non-production. Remove once OAuth is live.
 */
export async function getCurrentUser(): Promise<AppUser | null> {
  const session = await auth();
  if (session?.user?.id) return session.user as AppUser;

  if (process.env.NODE_ENV !== "production" && process.env.WANDER_DEV_EMAIL) {
    const u = await prisma.user.findUnique({
      where: { email: process.env.WANDER_DEV_EMAIL },
      select: { id: true, email: true, name: true, image: true },
    });
    if (u) return u;
  }
  return null;
}

/** Server-side: current user or redirect to /login. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
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

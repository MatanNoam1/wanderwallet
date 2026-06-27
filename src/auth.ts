import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [Google],
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  callbacks: {
    // database strategy: surface the DB user id on the session
    session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
  events: {
    // When an invited partner signs in for the first time, bind their pending
    // TripMember rows (matched by email) to the freshly created user.
    async createUser({ user }) {
      if (!user.email) return;
      await prisma.tripMember.updateMany({
        where: { invitedEmail: user.email, userId: null },
        data: { userId: user.id },
      });
    },
  },
});

import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { NextResponse } from "next/server";

import { isAllowedEmail } from "@/server/auth/policy";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
  },
  providers: [Google],
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;

      if (pathname.startsWith("/api/auth/")) {
        return true;
      }

      const isAuthorized = isAllowedEmail(auth?.user?.email);

      if (pathname.startsWith("/api/")) {
        return isAuthorized
          ? true
          : Response.json(
              {
                error: "You must sign in to use this API.",
                code: "unauthorized",
              },
              { status: 401 },
            );
      }

      if (pathname.startsWith("/projects/")) {
        return isAuthorized ? true : NextResponse.redirect(new URL("/", request.url));
      }

      return true;
    },
    signIn({ user }) {
      return isAllowedEmail(user.email);
    },
  },
});

import type { Session } from "next-auth";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { UnauthorizedError } from "@/server/errors";
import { isAllowedEmail } from "@/server/auth/policy";

function getTestSession(): Session | null {
  if (process.env.NODE_ENV !== "test") {
    return null;
  }

  const email = process.env.TRAXLY_TEST_AUTH_EMAIL?.trim();

  if (!email) {
    return null;
  }

  return {
    user: {
      email,
      name: email,
      image: null,
    },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };
}

export async function getViewerSession() {
  const testSession = getTestSession();

  if (testSession) {
    return testSession;
  }

  if (process.env.NODE_ENV === "test") {
    return null;
  }

  const session = await auth();

  if (!isAllowedEmail(session?.user?.email)) {
    return null;
  }

  return session;
}

export async function requireApiSession() {
  const session = await getViewerSession();

  if (!session) {
    throw new UnauthorizedError("You must sign in to use this API.");
  }

  return session;
}

export async function requirePageSession() {
  const session = await getViewerSession();

  if (!session) {
    redirect("/");
  }

  return session;
}

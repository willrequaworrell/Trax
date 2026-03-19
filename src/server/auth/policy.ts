export function getAllowedEmail() {
  return process.env.ALLOWED_EMAIL?.trim().toLowerCase() ?? null;
}

export function isAllowedEmail(email: string | null | undefined) {
  const allowedEmail = getAllowedEmail();

  if (!allowedEmail || !email) {
    return false;
  }

  return email.trim().toLowerCase() === allowedEmail;
}

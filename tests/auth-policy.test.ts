import assert from "node:assert/strict";
import test from "node:test";

import { isAllowedEmail } from "@/server/auth/policy";

test("allowed email policy accepts only the configured address", () => {
  process.env.ALLOWED_EMAIL = "owner@example.com";

  assert.equal(isAllowedEmail("owner@example.com"), true);
  assert.equal(isAllowedEmail("OWNER@example.com"), true);
  assert.equal(isAllowedEmail("teammate@example.com"), false);
  assert.equal(isAllowedEmail(null), false);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveInternalRedirect } = require("./safe-redirect");

const origin = "https://adventures.example";

test("keeps safe same-origin paths, queries, and fragments", () => {
  assert.equal(resolveInternalRedirect("/settings?tab=account#profile", origin), "/settings?tab=account#profile");
});

test("rejects protocol-relative and backslash-based external redirects", () => {
  for (const value of ["//attacker.example", "/\\\\attacker.example", "/\\attacker.example"]) {
    assert.equal(resolveInternalRedirect(value, origin), "/");
  }
});

test("rejects absolute external URLs and malformed input", () => {
  for (const value of ["https://attacker.example", "javascript:alert(1)", null, "", "/path\nheader"]) {
    assert.equal(resolveInternalRedirect(value, origin), "/");
  }
  assert.equal(resolveInternalRedirect("/", origin), "/");
});

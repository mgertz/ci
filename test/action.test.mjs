import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared runtime does not hash action or consumer lockfiles for caching", async () => {
  const action = await readFile(new URL("../action.yml", import.meta.url), "utf8");
  assert.match(action, /^\s+package-manager-cache: false$/m);
  assert.doesNotMatch(action, /^\s+(?:cache|cache-dependency-path):/m);
});

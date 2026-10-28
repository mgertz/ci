import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function temporaryDirectory(t) {
  const root = process.env.RUNNER_TEMP || (existsSync("/tmp/opencode") ? "/tmp/opencode" : tmpdir());
  const directory = await mkdtemp(join(root, "mgertz-ci-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

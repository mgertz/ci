import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Writable } from "node:stream";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import semanticRelease from "semantic-release";
import { releaseOptions } from "../src/release.mjs";
import { temporaryDirectory } from "./helpers.mjs";

const execute = promisify(execFile);

async function repository(t) {
  const directory = await temporaryDirectory(t);
  const cwd = join(directory, "application");
  const remote = join(directory, "remote.git");
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "Release Test",
    GIT_AUTHOR_EMAIL: "release-test@example.com",
    GIT_COMMITTER_NAME: "Release Test",
    GIT_COMMITTER_EMAIL: "release-test@example.com",
  };
  await mkdir(cwd);
  const git = async (...args) => (await execute("git", args, { cwd, env })).stdout.trim();
  await git("init", "--bare", "--initial-branch=main", remote);
  await git("init", "--initial-branch=main");
  await git("remote", "add", "origin", pathToFileURL(remote).href);

  const commit = async (message) => {
    await git("commit", "--allow-empty", "-m", message);
    await git("push", "origin", "HEAD");
  };
  await commit("chore: initialize repository");

  const release = async (branch = "main") => {
    const options = releaseOptions({ branch, repositoryUrl: pathToFileURL(remote).href });
    // Exercise real commit analysis, versioning, release notes, tags, and pushes.
    // Only the GitHub API plugin is omitted; all pushes target this temporary remote.
    const discard = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    return semanticRelease({ ...options, ci: false, plugins: options.plugins.slice(0, 2) }, {
      cwd, env, stdout: discard, stderr: discard,
    });
  };

  const remoteTags = async () => (await git("ls-remote", "--tags", "origin"))
    .split("\n").filter(Boolean).map((line) => line.split("refs/tags/")[1]);

  const promote = () => execute("bash", [fileURLToPath(new URL("../scripts/update-major-tag.sh", import.meta.url))], {
    cwd, env,
  });

  return { cwd, git, commit, release, remoteTags, promote };
}

test("an untagged repository waits for a release-triggering commit", async (t) => {
  const repo = await repository(t);
  await repo.commit("docs: explain the application");
  assert.equal(await repo.release(), false);
  assert.deepEqual(await repo.remoteTags(), []);
});

test("first feature publishes v1.0.0 without project package.json or release configuration", async (t) => {
  const repo = await repository(t);
  await repo.commit("feat: add the first feature");
  const result = await repo.release();
  assert.equal(result.nextRelease.version, "1.0.0");
  assert.equal(result.nextRelease.gitTag, "v1.0.0");
  assert.match(result.nextRelease.notes, /add the first feature/);
  assert.deepEqual(await repo.remoteTags(), ["v1.0.0"]);
});

test("first fix also uses the semantic-release default of v1.0.0", async (t) => {
  const repo = await repository(t);
  await repo.commit("fix: handle an empty configuration");
  assert.equal((await repo.release()).nextRelease.version, "1.0.0");
  assert.deepEqual(await repo.remoteTags(), ["v1.0.0"]);
});

test("subsequent commits produce patch, minor, and major releases and ignore the v1 alias", async (t) => {
  const repo = await repository(t);
  await repo.commit("feat: initial feature");
  await repo.release();
  await repo.git("tag", "v1");
  await repo.git("push", "origin", "refs/tags/v1");

  for (const [message, version] of [
    ["fix: correct the configuration", "1.0.1"],
    ["perf: reduce memory usage", "1.0.2"],
    ["feat: add another feature", "1.1.0"],
    ["feat!: change the configuration format", "2.0.0"],
  ]) {
    await repo.commit(message);
    const result = await repo.release();
    assert.equal(result.nextRelease.version, version);
    assert.equal(result.nextRelease.gitTag, `v${version}`);
    assert.equal((await repo.remoteTags()).includes(`v${version}`), true);
  }

  await repo.commit("docs: explain the new configuration");
  assert.equal(await repo.release(), false);
  assert.equal(await repo.release(), false);
});

test("central core settings override an old project release configuration", async (t) => {
  const repo = await repository(t);
  await writeFile(join(repo.cwd, ".releaserc.json"), JSON.stringify({
    branches: ["obsolete"],
    tagFormat: "old-${version}",
    plugins: ["missing-project-plugin"],
    extends: ["missing-project-config"],
    dryRun: true,
  }));
  await repo.git("add", ".releaserc.json");
  await repo.commit("feat: move release configuration into the action");
  const result = await repo.release();
  assert.equal(result.nextRelease.gitTag, "v1.0.0");
  assert.deepEqual(await repo.remoteTags(), ["v1.0.0"]);
});

test("a custom release branch is supported", async (t) => {
  const repo = await repository(t);
  await repo.git("checkout", "-b", "stable");
  await repo.commit("feat: release from stable");
  assert.equal((await repo.release("stable")).nextRelease.gitTag, "v1.0.0");
});

test("commits on another branch do not publish a release", async (t) => {
  const repo = await repository(t);
  await repo.git("checkout", "-b", "feature/example");
  await repo.commit("feat: an unfinished feature");
  assert.equal(await repo.release(), false);
  assert.deepEqual(await repo.remoteTags(), []);
});

test("self-release alias promotion does not create a tag before the first release", async (t) => {
  const repo = await repository(t);
  await repo.promote();
  assert.deepEqual(await repo.remoteTags(), []);
});

test("self-release aliases can be retried, follow minor releases, and preserve previous majors", async (t) => {
  const repo = await repository(t);
  await repo.commit("feat: initial feature");
  await repo.release();
  await repo.promote();
  await repo.promote();
  assert.equal(await repo.git("rev-parse", "v1"), await repo.git("rev-parse", "v1.0.0"));

  await repo.commit("feat: another feature");
  await repo.release();
  await repo.promote();
  const lastV1 = await repo.git("rev-parse", "v1.1.0");
  assert.equal(await repo.git("rev-parse", "v1"), lastV1);

  await repo.commit("feat!: change the interface");
  await repo.release();
  await repo.promote();
  assert.equal(await repo.git("rev-parse", "v1"), lastV1);
  assert.equal(await repo.git("rev-parse", "v2"), await repo.git("rev-parse", "v2.0.0"));

  await repo.commit("docs: explain the interface");
  await repo.promote();
  assert.equal(await repo.git("rev-parse", "v2"), await repo.git("rev-parse", "v2.0.0"));

  // A retried older workflow must not roll v1 back to its earlier release.
  await repo.git("checkout", "--detach", "v1.0.0");
  await repo.promote();
  assert.equal(await repo.git("rev-parse", "v1"), lastV1);
  assert.equal(await repo.git("rev-parse", "v2"), await repo.git("rev-parse", "v2.0.0"));

  for (const tag of ["v1", "v2"]) {
    const expected = `${await repo.git("rev-parse", tag)}\trefs/tags/${tag}`;
    assert.equal(await repo.git("ls-remote", "origin", `refs/tags/${tag}`), expected);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { releaseOptions, runRelease } from "../src/release.mjs";
import { temporaryDirectory } from "./helpers.mjs";

const emptyOutputs = {
  new_release_published: "false",
  new_release_version: "",
  new_release_git_tag: "",
};

async function context(t, extra = {}) {
  const directory = await temporaryDirectory(t);
  return {
    GITHUB_OUTPUT: join(directory, "outputs"),
    GITHUB_WORKSPACE: directory,
    ...extra,
  };
}

async function outputs(env) {
  const text = await readFile(env.GITHUB_OUTPUT, "utf8");
  return Object.fromEntries(text.trim().split("\n").map((line) => line.split("=")));
}

test("central configuration resolves plugins from the action, not the calling project", () => {
  const options = releaseOptions();
  assert.deepEqual(options.branches, ["main"]);
  assert.equal(options.tagFormat, "v${version}");
  assert.equal(options.dryRun, false);
  assert.equal(options.ci, true);
  assert.deepEqual(options.extends, []);
  assert.equal(options.plugins.length, 3);
  for (const [plugin] of options.plugins) {
    assert.equal(isAbsolute(plugin), true);
    assert.doesNotMatch(plugin, /@semantic-release\/npm\//);
  }
  assert.equal(options.plugins[0][1].preset, "conventionalcommits");
  assert.equal(options.plugins[1][1].preset, "conventionalcommits");
  assert.deepEqual(options.plugins[2][1], {
    successCommentCondition: false,
    failCommentCondition: false,
    releasedLabels: false,
  });
});

test("published release provides its exact version and Git tag", async (t) => {
  const env = await context(t);
  const result = { nextRelease: { version: "1.2.3", gitTag: "v1.2.3" } };
  assert.equal(await runRelease({ env, release: async () => result }), result);
  assert.deepEqual(await outputs(env), {
    new_release_published: "true",
    new_release_version: "1.2.3",
    new_release_git_tag: "v1.2.3",
  });
});

test("no relevant commits produces false and empty version outputs", async (t) => {
  const env = await context(t);
  assert.equal(await runRelease({ env, release: async () => false }), false);
  assert.deepEqual(await outputs(env), emptyOutputs);
});

test("release errors fail the action without reporting a published release", async (t) => {
  const env = await context(t);
  const failure = new Error("GitHub release failed");
  await assert.rejects(runRelease({ env, release: async () => { throw failure; } }), failure);
  assert.deepEqual(await outputs(env), emptyOutputs);
});

test("invalid release metadata cannot be injected into action outputs", async (t) => {
  for (const nextRelease of [
    undefined,
    { version: "1.2.3", gitTag: "v9.9.9" },
    { version: "1.2.3\nother_output=true", gitTag: "v1.2.3" },
    { version: "1.2.3", gitTag: "v1.2.3\nother_output=true" },
    { version: "1.2.3-beta.1", gitTag: "v1.2.3-beta.1" },
    { version: "01.2.3", gitTag: "v01.2.3" },
    { version: 123, gitTag: "v123" },
  ]) {
    const env = await context(t);
    await assert.rejects(runRelease({
      env,
      release: async () => ({ nextRelease }),
    }), /invalid stable version or Git tag/);
    assert.deepEqual(await outputs(env), emptyOutputs);
  }
});

test("missing GitHub Actions context fails before running semantic-release", async () => {
  for (const env of [{}, { GITHUB_OUTPUT: "unused" }, { GITHUB_WORKSPACE: "unused" }]) {
    let called = false;
    await assert.rejects(runRelease({
      env,
      release: async () => { called = true; },
    }), /GITHUB_OUTPUT and GITHUB_WORKSPACE are required/);
    assert.equal(called, false);
  }
});

test("release runs in the calling workspace with the configured repository, branch, and token", async (t) => {
  const env = await context(t, {
    RELEASE_BRANCH: "stable",
    RELEASE_REPOSITORY_URL: "https://github.com/example/application.git",
    GITHUB_TOKEN: "test-token",
  });
  await runRelease({
    env,
    release: async (options, configuration) => {
      assert.deepEqual(options.branches, ["stable"]);
      assert.equal(options.repositoryUrl, env.RELEASE_REPOSITORY_URL);
      assert.equal(configuration.cwd, env.GITHUB_WORKSPACE);
      assert.equal(configuration.env, env);
      return false;
    },
  });
});

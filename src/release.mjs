import { appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import semanticRelease from "semantic-release";

const require = createRequire(import.meta.url);

export function releaseOptions({ branch = "main", repositoryUrl } = {}) {
  return {
    branches: [branch],
    tagFormat: "v${version}",
    ci: true,
    dryRun: false,
    extends: [],
    ...(repositoryUrl ? { repositoryUrl } : {}),
    plugins: [
      [require.resolve("@semantic-release/commit-analyzer"), { preset: "conventionalcommits" }],
      [require.resolve("@semantic-release/release-notes-generator"), { preset: "conventionalcommits" }],
      [require.resolve("@semantic-release/github"), {
        successCommentCondition: false,
        failCommentCondition: false,
        releasedLabels: false,
      }],
    ],
  };
}

export async function runRelease({ release = semanticRelease, env = process.env } = {}) {
  if (!env.GITHUB_OUTPUT || !env.GITHUB_WORKSPACE) {
    throw new Error("GITHUB_OUTPUT and GITHUB_WORKSPACE are required; run this action in GitHub Actions");
  }

  await appendFile(env.GITHUB_OUTPUT, [
    "new_release_published=false",
    "new_release_version=",
    "new_release_git_tag=",
    "",
  ].join("\n"));

  const result = await release(releaseOptions({
    branch: env.RELEASE_BRANCH || "main",
    repositoryUrl: env.RELEASE_REPOSITORY_URL,
  }), { cwd: env.GITHUB_WORKSPACE, env });

  if (!result) {
    return false;
  }

  const { version, gitTag } = result.nextRelease ?? {};
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (typeof version !== "string" || !stableVersion.test(version) || gitTag !== `v${version}`) {
    throw new Error("semantic-release returned an invalid stable version or Git tag");
  }

  await appendFile(env.GITHUB_OUTPUT, [
    "new_release_published=true",
    `new_release_version=${version}`,
    `new_release_git_tag=${gitTag}`,
    "",
  ].join("\n"));

  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runRelease();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

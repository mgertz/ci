# Semantic Release

A shared GitHub Action for semantic versioning and GitHub Releases. Call
`mgertz/ci@v1` without installing release tools or maintaining release configuration
in each project.

This action only handles releases. It does not build applications, run their
tests, publish npm packages or container images, or deploy anything.

## Usage

Create `.github/workflows/release.yaml` in your project:

```yaml
name: Release

on:
  push:
    branches: [main]

permissions:
  contents: write

concurrency:
  group: semantic-release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Semantic release
        id: release
        uses: mgertz/ci@v1
```

The action checks out the calling repository with its full history and tags,
sets up Node.js 24, and installs its locked dependencies in the action's own
directory. The calling project does not need Node.js, `package.json`, a package
lockfile, `.releaserc.json`, or a release script.

Use a dedicated release job on a Linux runner with Bash and Git. Checkout cleans
the workspace, so do not rely on uncommitted changes or generated files from
earlier steps. Trigger releases only from trusted release-branch commits, not
from pull requests or `pull_request_target`. Keep concurrency enabled to avoid
two runs racing to create the same release.

## Versioning

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

| Commit | Release |
| --- | --- |
| `fix: correct an error` | Patch |
| `perf: reduce memory usage` | Patch |
| `feat: add a feature` | Minor |
| `feat!: change an interface` or a `BREAKING CHANGE:` footer | Major |
| Only `docs:`, `chore:`, `ci:`, etc. | No release |

Without an existing matching release tag, the first release-triggering commit
produces **`1.0.0`**, with tag **`v1.0.0`**. A repository containing only
non-release commits does not get a bootstrap tag or release. Later versions are
calculated from matching `vX.Y.Z` tags and commits since the previous release.

Each release creates a Git tag and a GitHub Release with generated release notes.
The action does not modify or commit version numbers in project files. If you
squash-merge pull requests, use Conventional Commit messages for the resulting
squash commits, usually by formatting the PR titles accordingly.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `token` | `${{ github.token }}` | Token with `contents: write` on the calling repository. |
| `release-branch` | `main` | Branch from which stable releases are published. |

For a different release branch, change both the workflow trigger and the input:

```yaml
- uses: mgertz/ci@v1
  with:
    release-branch: stable
```

The workflow must grant `contents: write`; the action cannot grant itself
permissions. Issue/PR comments, release labels, and release-failure issues are
disabled, so `issues: write` and `pull-requests: write` are not required. Repository
rules must permit the token to create release tags.

GitHub normally does not start other workflows for tags or releases created with
`GITHUB_TOKEN`. Use the action's outputs in the current workflow if further work
depends on the release, or supply a suitable GitHub App/PAT token if triggering
another workflow is intentional.

## Outputs

| Output | Description |
| --- | --- |
| `new_release_published` | The string `true` when a release was published, otherwise `false`. |
| `new_release_version` | Version without `v`, such as `1.2.3`; empty when no release was published. |
| `new_release_git_tag` | Exact Git tag, such as `v1.2.3`; empty when no release was published. |

For example, a subsequent step can use:

```yaml
- name: Report release
  if: steps.release.outputs.new_release_published == 'true'
  env:
    RELEASE_VERSION: ${{ steps.release.outputs.new_release_version }}
  run: echo "Published $RELEASE_VERSION"
```

Release failures fail the action rather than reporting that nothing changed.
Outputs come from semantic-release's JavaScript API, not from parsing log text.

## Migrating an existing project

1. Keep existing release tags; they preserve the project's version history.
2. Replace the project's release setup/install/script steps with `mgertz/ci@v1`.
3. Remove the old `.releaserc.json` and release-only scripts and dependencies.
4. If `package.json` and its lockfile existed only for release tooling, remove
   them. Otherwise, keep the project's unrelated dependencies and scripts.
5. Keep workflow concurrency and grant the release job `contents: write`.

The default behavior matches the shared stable-release setup: `main`,
Conventional Commits, `v${version}` tags, and GitHub Releases. Prereleases,
monorepo package releases, custom plugins, and version-file updates are outside
the scope of this action.

## Releasing this action

This repository uses its own action. Its workflow checks out the source and
calls `uses: ./`, so no published tag is needed to bootstrap the first release.
It tests the release tooling itself before publishing; these tests are not run
by the action in calling projects.

Merge a release-triggering commit, for example
`feat: add shared semantic release action`, into `main`. The workflow creates
`v1.0.0` and its GitHub Release, then creates the moving **`v1`** alias at the same
commit. Subsequent `1.x` releases update `v1`; a `2.0.0` release creates `v2`
without moving `v1`. Alias promotion is retried on later successful main-branch
runs if a previous promotion failed. This repository's tag rules must allow the
workflow token to move the major-version aliases.

Major aliases are managed only by this repository's workflow, not by the action
in calling repositories. Consumers can follow `@v1`, use an exact version such
as `@v1.0.0`, or pin a commit SHA for immutable execution. `@v1` is available
only after the first release workflow has completed.

Git tags and GitHub Releases are the source of truth for this action's version.
The private `package.json` keeps a placeholder version; it is release tooling,
not an npm package, and does not need manual version updates.

## Dependency security

See [SECURITY.md](SECURITY.md) for the temporary, narrowly scoped acceptance of
known vulnerabilities in the unused npm publisher. CI and a weekly audit still
fail on new or changed findings. Dependabot checks for updates weekly and uses
`fix(deps)` commits so merged dependency updates trigger patch releases.

## Development

Requires Node.js 24.10 or newer:

```sh
npm ci --ignore-scripts
npm test
npm run audit:dependencies
```

The tests cover action outputs and real semantic-release runs against isolated
temporary Git repositories, including version calculation and tag publication.
They do not call the GitHub API or publish real releases.

# Dependency security

## Temporary risk acceptance

Accepted on **2026-10-28** for the two vulnerable packages bundled with the unused
npm publishing toolchain:

```text
semantic-release
└── @semantic-release/npm
    └── npm@11.21.1
        ├── ip-address@10.7.2 (moderate)
        └── undici@6.29.0 (high)
```

The exact advisory URLs, installation paths, versions, and severities are listed
in [security/audit-exceptions.json](security/audit-exceptions.json). This is not
a general exception for these package names or for future advisories.

### Rationale and limits

- The action explicitly loads only commit analysis, release-note generation,
  and the GitHub publisher. It does not load or execute `@semantic-release/npm`
  or its bundled npm CLI, and it never publishes npm packages.
- The active GitHub publisher uses a separate, updated `undici` installation;
  that installation is not covered by the exception.
- Dependencies are installed with lifecycle scripts disabled.
- `npm audit fix` cannot repair these bundled copies. Testing npm 12.2.1 and
  scoped dependency overrides did not remove the findings either.

These controls limit exposure; they do not fix the vulnerable code or establish
that all supply-chain risk is absent. A fork or repackaged dependency is not
currently justified for this unused publishing path.

### Monitoring and removal

`npm run audit:dependencies` runs a real `npm audit` and fails on any unaccepted
finding. Exceptions require the exact path, locked version, severity, and known
advisory URL. A new advisory, a finding in another installation, a version change,
or an increased severity requires review. Audit/network failures also fail the
check. Known accepted findings remain visible in its output.

The check runs on pull requests, pushes to `main`, and a weekly schedule.
Dependabot proposes npm and GitHub Actions updates weekly. Its `fix(deps)` commit
prefix ensures merged updates can produce a patch release of this action.

Review this acceptance whenever dependencies or publishing configuration change.
Remove an exception as soon as upstream removes the vulnerable package or ships
a patched bundled copy (`ip-address` 10.7.4+ and `undici` 6.29.1+ for the currently
listed advisories). Do not expand the allowlist automatically, disable audit,
or use forced dependency upgrades merely to obtain a clean report.

These checks belong to this repository's maintenance workflow. The release
action does not run audits or tests against calling projects.

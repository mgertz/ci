import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessAudit } from "../scripts/audit-dependencies.mjs";

const exceptions = JSON.parse(await readFile(new URL("../security/audit-exceptions.json", import.meta.url), "utf8"));

function fixture() {
  return {
    report: {
      auditReportVersion: 2,
      vulnerabilities: Object.fromEntries(exceptions.map((entry) => [entry.name, {
        severity: entry.severity,
        nodes: [entry.path],
        via: entry.advisories.map((url) => ({ url })),
      }])),
    },
    lockfile: {
      packages: Object.fromEntries(exceptions.map((entry) => [entry.path, { version: entry.version }])),
    },
  };
}

test("audit accepts only the documented findings in the unused npm publisher", () => {
  const { report, lockfile } = fixture();
  assert.deepEqual(assessAudit(report, lockfile, exceptions), {
    accepted: ["ip-address", "undici"],
    rejected: [],
  });
});

test("a clean audit needs no exceptions", () => {
  assert.deepEqual(assessAudit({ auditReportVersion: 2, vulnerabilities: {} }, {}, []), {
    accepted: [],
    rejected: [],
  });
});

test("a new advisory in an otherwise accepted package is rejected", () => {
  const { report, lockfile } = fixture();
  report.vulnerabilities.undici.via.push({ url: "https://github.com/advisories/GHSA-new-advisory" });
  assert.deepEqual(assessAudit(report, lockfile, exceptions).rejected, ["undici"]);
});

test("the exception cannot hide a finding in the active GitHub publisher", () => {
  const { report, lockfile } = fixture();
  const path = "node_modules/undici";
  lockfile.packages[path] = { version: "7.30.1" };
  report.vulnerabilities.undici.nodes.push(path);
  assert.deepEqual(assessAudit(report, lockfile, exceptions).rejected, ["undici"]);
});

test("different locked versions or increased severity require a new review", () => {
  for (const change of [
    ({ lockfile }) => { lockfile.packages[exceptions[1].path].version = "6.28.0"; },
    ({ report }) => { report.vulnerabilities.undici.severity = "critical"; },
    ({ lockfile }) => { delete lockfile.packages[exceptions[1].path]; },
  ]) {
    const data = fixture();
    change(data);
    assert.deepEqual(assessAudit(data.report, data.lockfile, exceptions).rejected, ["undici"]);
  }
});

test("a new vulnerable package or transitive advisory reference is rejected", () => {
  const { report, lockfile } = fixture();
  report.vulnerabilities.undici.via.push("another-dependency");
  report.vulnerabilities["another-dependency"] = {
    severity: "low",
    nodes: ["node_modules/another-dependency"],
    via: [{ url: "https://github.com/advisories/GHSA-another-advisory" }],
  };
  assert.deepEqual(assessAudit(report, lockfile, exceptions).rejected, ["undici", "another-dependency"]);
});

test("missing advisory or installation information cannot pass through an exception", () => {
  for (const change of [
    (vulnerability) => { vulnerability.nodes = []; },
    (vulnerability) => { vulnerability.via = []; },
    (vulnerability) => { vulnerability.via = [null]; },
    (vulnerability) => { delete vulnerability.nodes; },
  ]) {
    const { report, lockfile } = fixture();
    change(report.vulnerabilities.undici);
    assert.deepEqual(assessAudit(report, lockfile, exceptions).rejected, ["undici"]);
  }
});

test("audit errors and unsupported report formats fail closed", () => {
  for (const report of [
    null,
    {},
    { auditReportVersion: 1, vulnerabilities: {} },
    { auditReportVersion: 2, vulnerabilities: [] },
    { auditReportVersion: 2, vulnerabilities: {}, error: { code: "ENOTFOUND" } },
  ]) {
    assert.throws(() => assessAudit(report, {}, exceptions), /supported vulnerability report/);
  }
});

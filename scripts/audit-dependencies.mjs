import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export function assessAudit(report, lockfile, exceptions) {
  if (!report || report.error || report.auditReportVersion !== 2 || !report.vulnerabilities ||
      typeof report.vulnerabilities !== "object" || Array.isArray(report.vulnerabilities)) {
    throw new Error("npm audit did not return a supported vulnerability report");
  }

  const accepted = [];
  const rejected = [];

  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    const exception = exceptions.find((entry) => entry.name === name);
    const matches = exception &&
      vulnerability.severity === exception.severity &&
      Array.isArray(vulnerability.nodes) && vulnerability.nodes.length > 0 &&
      vulnerability.nodes.every((path) => path === exception.path &&
        lockfile.packages?.[path]?.version === exception.version) &&
      Array.isArray(vulnerability.via) && vulnerability.via.length > 0 &&
      vulnerability.via.every((advisory) => typeof advisory === "object" && advisory !== null &&
        exception.advisories.includes(advisory.url));

    (matches ? accepted : rejected).push(name);
  }

  return { accepted, rejected };
}

export async function auditDependencies() {
  const root = new URL("../", import.meta.url);
  const lockfile = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
  const exceptions = JSON.parse(await readFile(new URL("security/audit-exceptions.json", root), "utf8"));
  const result = spawnSync("npm", ["audit", "--json"], {
    cwd: fileURLToPath(root),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`npm audit failed (exit ${result.status}): ${result.stderr || result.stdout}`);
  }

  const report = JSON.parse(result.stdout);
  const assessment = assessAudit(report, lockfile, exceptions);
  if (result.status === 1 && assessment.accepted.length + assessment.rejected.length === 0) {
    throw new Error("npm audit failed without reporting any vulnerabilities");
  }
  for (const name of assessment.accepted) {
    console.warn(`Accepted known risk in unused npm publisher: ${name}; see SECURITY.md`);
  }
  if (assessment.rejected.length > 0) {
    throw new Error(`Unaccepted dependency vulnerabilities: ${assessment.rejected.join(", ")}`);
  }
  console.log("Dependency audit passed; no unaccepted vulnerabilities.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await auditDependencies();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

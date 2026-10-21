import path from "node:path";
import ExcelJS from "exceljs";
import { prisma, j } from "./db";
import { paths, ensureDirs } from "./paths";

const HEADERS = [
  { header: "Applied on", key: "date", width: 18 },
  { header: "Company", key: "company", width: 26 },
  { header: "Role", key: "title", width: 34 },
  { header: "Location", key: "location", width: 20 },
  { header: "Source", key: "portal", width: 14 },
  { header: "Match", key: "score", width: 8 },
  { header: "Status", key: "status", width: 14 },
  { header: "Salary listed", key: "salary", width: 18 },
  { header: "Submitted by", key: "by", width: 13 },
  { header: "Resume used", key: "resume", width: 38 },
  { header: "Link", key: "url", width: 52 },
  { header: "Notes", key: "notes", width: 60 },
];

const STATUS_FILL: Record<string, string> = {
  submitted: "FFD6F5E3",
  prepared: "FFFFF3CD",
  needs_human: "FFFFE0CC",
  failed: "FFF8D7DA",
};

/**
 * Write the application tracker. Regenerated from the database each time, so it
 * is always a faithful snapshot rather than an append-only log that can drift.
 */
export async function exportSpreadsheet(): Promise<string> {
  ensureDirs();

  const applications = await prisma.application.findMany({
    include: { job: { include: { resumeVariant: true } } },
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "Job Autopilot";
  wb.created = new Date();

  const ws = wb.addWorksheet("Applications", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = HEADERS;
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };

  for (const app of applications) {
    const notes = [app.error, app.confirmation].filter(Boolean).join(" | ");
    const row = ws.addRow({
      date: (app.submittedAt ?? app.createdAt).toISOString().slice(0, 16).replace("T", " "),
      company: app.job.company,
      title: app.job.title,
      location: app.job.location,
      portal: app.job.portal,
      score: app.job.matchScore ?? "",
      status: app.status,
      salary: app.job.salaryText,
      by: app.submittedBy,
      resume: app.job.resumeVariant ? path.basename(app.job.resumeVariant.pdfPath || "") : "",
      url: app.job.url,
      notes: notes.slice(0, 500),
    });

    const fill = STATUS_FILL[app.status];
    if (fill) row.getCell("status").fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    if (app.job.url) {
      row.getCell("url").value = { text: app.job.url, hyperlink: app.job.url };
      row.getCell("url").font = { color: { argb: "FF0563C1" }, underline: true };
    }
  }

  ws.autoFilter = { from: "A1", to: { row: 1, column: HEADERS.length } };

  // A second sheet with the jobs we found but did not apply to, and why.
  const skipped = await prisma.job.findMany({
    where: { status: { in: ["rejected", "skipped"] } },
    orderBy: { discoveredAt: "desc" },
    take: 1000,
  });
  const ws2 = wb.addWorksheet("Not applied");
  ws2.columns = [
    { header: "Found", key: "date", width: 18 },
    { header: "Company", key: "company", width: 26 },
    { header: "Role", key: "title", width: 34 },
    { header: "Source", key: "portal", width: 14 },
    { header: "Match", key: "score", width: 8 },
    { header: "Why not", key: "why", width: 70 },
    { header: "Link", key: "url", width: 52 },
  ];
  ws2.getRow(1).font = { bold: true };
  for (const job of skipped) {
    ws2.addRow({
      date: job.discoveredAt.toISOString().slice(0, 16).replace("T", " "),
      company: job.company,
      title: job.title,
      portal: job.portal,
      score: job.matchScore ?? "",
      why: job.skipReason || job.matchReason,
      url: job.url,
    });
  }

  // Summary.
  const ws3 = wb.addWorksheet("Summary");
  const byStatus = applications.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1;
    return acc;
  }, {});
  const byPortal = applications.reduce<Record<string, number>>((acc, a) => {
    acc[a.job.portal] = (acc[a.job.portal] ?? 0) + 1;
    return acc;
  }, {});
  ws3.columns = [
    { header: "Metric", key: "k", width: 32 },
    { header: "Value", key: "v", width: 14 },
  ];
  ws3.getRow(1).font = { bold: true };
  ws3.addRow({ k: "Total applications", v: applications.length });
  for (const [k, v] of Object.entries(byStatus)) ws3.addRow({ k: `Status: ${k}`, v });
  for (const [k, v] of Object.entries(byPortal)) ws3.addRow({ k: `Source: ${k}`, v });
  ws3.addRow({ k: "Jobs seen but skipped", v: skipped.length });
  ws3.addRow({ k: "Generated", v: new Date().toISOString().slice(0, 16).replace("T", " ") });

  const file = path.join(paths.exports, `job-applications-${new Date().toISOString().slice(0, 10)}.xlsx`);
  await wb.xlsx.writeFile(file);
  return file;
}

/** CSV for people who would rather pipe it somewhere else. */
export async function exportCsv(): Promise<string> {
  ensureDirs();
  const applications = await prisma.application.findMany({
    include: { job: true },
    orderBy: [{ submittedAt: "desc" }],
  });
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [HEADERS.map((h) => q(h.header)).join(",")];
  for (const a of applications) {
    lines.push(
      [
        (a.submittedAt ?? a.createdAt).toISOString(),
        a.job.company,
        a.job.title,
        a.job.location,
        a.job.portal,
        a.job.matchScore ?? "",
        a.status,
        a.job.salaryText,
        a.submittedBy,
        "",
        a.job.url,
        [a.error, a.confirmation].filter(Boolean).join(" | "),
      ]
        .map(q)
        .join(","),
    );
  }
  const file = path.join(paths.exports, `job-applications-${new Date().toISOString().slice(0, 10)}.csv`);
  await (await import("node:fs/promises")).writeFile(file, lines.join("\n"), "utf8");
  return file;
}

export { j };

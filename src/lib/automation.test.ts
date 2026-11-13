import { describe, expect, it } from "vitest";
import { makeFile, makeScan, MB } from "../../tests/factories";
import { DEMO_SITES, generateDemoScan } from "./demo";
import { dueJobs, newJob, nextRunAfter, type CleanupJob } from "./jobs";
import { decisions, expire, fromApproval, summarize, type ReviewRequest, type ReviewRound } from "./reviews";
import { BUILTIN_RULES } from "./rules";
import { crossSiteDuplicates, inactiveSites, summarizeScan } from "./tenant";

const site = { id: "s1", name: "Marketing", webUrl: "https://contoso.sharepoint.com/sites/m" };

describe("review rounds", () => {
  const request = (state: ReviewRequest["state"], ownerEmail: string): ReviewRequest => ({
    ownerName: ownerEmail,
    ownerEmail,
    channel: "teams",
    files: [makeFile()],
    bytes: MB,
    state,
  });
  const round = (requests: ReviewRequest[], onTimeout: ReviewRound["onTimeout"] = "delete"): ReviewRound => ({
    id: "r",
    createdAt: "2026-11-01T00:00:00Z",
    deadline: "2026-11-15T00:00:00Z",
    site,
    onTimeout,
    demo: true,
    requests,
  });

  it("maps Teams approval results", () => {
    expect(fromApproval({ state: "completed", result: "Approved" })).toBe("approved");
    expect(fromApproval({ state: "completed", result: "Rejected" })).toBe("rejected");
    expect(fromApproval({ state: "pending" })).toBeNull();
    expect(fromApproval({ state: "canceled" })).toBe("kept");
  });

  it("lets open requests expire after the deadline only", () => {
    const r = round([request("pending", "a"), request("approved", "b")]);
    expect(expire(r, Date.parse("2026-11-10T00:00:00Z"))).toBe(r);
    expect(expire(r, Date.parse("2026-11-16T00:00:00Z")).requests.map((q) => q.state)).toEqual(["expired", "approved"]);
  });

  it("deletes approved files and, depending on the setting, unanswered ones", () => {
    const requests = [request("approved", "a"), request("rejected", "b"), request("expired", "c"), request("pending", "d")];
    const del = decisions(round(requests, "delete"));
    expect(del.toDelete.map((r) => r.ownerEmail)).toEqual(["a", "c"]);
    expect(del.toKeep.map((r) => r.ownerEmail)).toEqual(["b"]);
    const keep = decisions(round(requests, "keep"));
    expect(keep.toDelete.map((r) => r.ownerEmail)).toEqual(["a"]);
    expect(keep.toKeep.map((r) => r.ownerEmail)).toEqual(["b", "c"]);
    expect(summarize(round([request("deleted", "a"), request("kept", "b"), request("pending", "c")]))).toMatchObject({
      approved: 1,
      rejected: 1,
      pending: 1,
      deletedBytes: MB,
    });
  });
});

describe("cleanup jobs", () => {
  it("schedules the next run at night", () => {
    const next = new Date(nextRunAfter("daily", new Date("2026-11-01T15:30:00")));
    expect(next.getDate()).toBe(2);
    expect(next.getHours()).toBe(2);
    expect(new Date(nextRunAfter("weekly", new Date("2026-11-01T15:30:00"))).getDate()).toBe(8);
  });

  it("only runs enabled jobs that are due", () => {
    const base = newJob(BUILTIN_RULES[0], site, true);
    const jobs: CleanupJob[] = [
      { ...base, id: "due", nextRunAt: "2026-11-01T00:00:00Z" },
      { ...base, id: "later", nextRunAt: "2026-12-01T00:00:00Z" },
      { ...base, id: "paused", nextRunAt: "2026-11-01T00:00:00Z", enabled: false },
    ];
    expect(dueJobs(jobs, Date.parse("2026-11-02T00:00:00Z")).map((j) => j.id)).toEqual(["due"]);
  });
});

describe("overall analysis", () => {
  it("summarises a site and indexes its large files", () => {
    const big = makeFile({ size: 50 * MB, hash: "h1" });
    const { summary, index } = summarizeScan(makeScan([big, makeFile({ size: 1 * MB })]));
    expect(summary.files).toBe(2);
    expect(index.map((i) => i.key)).toEqual([`h1:${50 * MB}`]);
  });

  it("finds the same file in several sites and the inactive sites", () => {
    const scans = DEMO_SITES.map((s) => generateDemoScan(s));
    const results = scans.map((s) => summarizeScan(s));
    const summaries = results.map((r) => r.summary);
    const duplicates = crossSiteDuplicates(
      results.flatMap((r) => r.index),
      summaries,
    );
    const film = duplicates.find((d) => d.name === "Imagefilm 2024 final.mp4");
    expect(film?.copies).toHaveLength(6);
    expect(film?.savings).toBe(film!.size * 5);
    const inactive = inactiveSites(summaries, 12, Date.parse("2026-11-01T00:00:00Z")).map((s) => s.site.id);
    expect(inactive.toSorted()).toEqual(["demo-gf", "demo-qm"]);
  });
});

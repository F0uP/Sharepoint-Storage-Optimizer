import { describe, expect, it } from "vitest";
import { deletedItem, deltaServer, fileItem, folderItem, rootItem } from "../../tests/graph-fakes";
import { cachedDrive, finishDrive, initialLink, newDrive, runRound, snapshotDrive, type DriveState } from "./delta";
import type { SpFile } from "./types";

const library = { id: "d1", name: "Dokumente", webUrl: "https://contoso.sharepoint.com/Dokumente" };

const byName = (files: SpFile[]) => Object.fromEntries(files.map((f) => [f.name, f]));

/** First round over the given pages, finished like a scan does it. */
async function fullRound(pages: Parameters<ReturnType<typeof deltaServer>["chain"]>[1]) {
  const server = deltaServer();
  server.chain(initialLink(library.id), pages, "delta-1");
  const state = newDrive(library);
  await runRound(state, (url) => server.fetchPage(url));
  const files = finishDrive(state);
  return { state, files, server };
}

/** Next round from the cached result (like opening the site again). */
async function nextRound(previous: { state: DriveState; files: SpFile[] }, changes: Parameters<ReturnType<typeof deltaServer>["chain"]>[1], lib = library) {
  const server = deltaServer();
  server.chain(previous.state.link, changes, "delta-2");
  const state = cachedDrive(lib, previous.state.link, [...previous.state.folders.values()], previous.files);
  await runRound(state, (url) => server.fetchPage(url));
  return { state, files: finishDrive(state), server };
}

describe("first round", () => {
  it("lists all files with paths – also when files arrive before their folders", async () => {
    const { state, files } = await fullRound([
      [fileItem("a", "Plan.pdf", "f2"), folderItem("f2", "2021", "f1")],
      [folderItem("f1", "Projekte"), rootItem(), fileItem("b", "Liesmich.txt")],
    ]);
    expect(byName(files)["Plan.pdf"]).toMatchObject({ path: "Dokumente/Projekte/2021", parentId: "f2", driveId: "d1", size: 100, hash: "h-a" });
    expect(byName(files)["Liesmich.txt"].path).toBe("Dokumente");
    expect(state).toMatchObject({ link: "delta-1", complete: true });
    expect(state.folders.size).toBe(3);
  });

  it("treats OneNote notebooks as folders and skips items without facets", async () => {
    const { files } = await fullRound([
      [rootItem(), { id: "nb", name: "Notizbuch", package: { type: "oneNote" }, parentReference: { id: "root" } }, fileItem("s", "Abschnitt.one", "nb"), { id: "x", name: "?" }],
    ]);
    expect(files.map((f) => f.path)).toEqual(["Dokumente/Notizbuch"]);
  });

  it("throws when Graph ends a page without any continuation", async () => {
    const state = newDrive(library);
    await expect(runRound(state, async () => ({ value: [] }))).rejects.toThrow(/ohne Fortsetzung/);
  });

  it("stops between pages when the scan is cancelled", async () => {
    const controller = new AbortController();
    const server = deltaServer();
    server.chain(initialLink(library.id), [[rootItem()], [fileItem("a", "a.pdf")]], "delta-1");
    const fetchPage = async (url: string) => {
      const page = await server.fetchPage(url);
      controller.abort();
      return page;
    };
    await expect(runRound(newDrive(library), fetchPage, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(server.requested).toHaveLength(1);
  });
});

describe("interim lists while a round runs", () => {
  it("never changes a file object once it was handed out", async () => {
    const server = deltaServer();
    server.chain(
      initialLink(library.id),
      [[rootItem(), fileItem("a", "Plan.pdf", "f1"), fileItem("b", "Logo.png")], [folderItem("f1", "Projekte"), folderItem("gone", "Alt")], [deletedItem("gone")]],
      "delta-1",
    );
    const state = newDrive(library);
    const interim: SpFile[][] = [];
    await runRound(state, (url) => server.fetchPage(url), { onPage: (_, s) => void interim.push(snapshotDrive(s)) });
    const final = byName(finishDrive(state));

    // the folder was not known yet after page 1 – the file showed up in the library root
    expect(byName(interim[0])["Plan.pdf"].path).toBe("Dokumente");
    expect(final["Plan.pdf"].path).toBe("Dokumente/Projekte");
    expect(final["Plan.pdf"]).not.toBe(byName(interim[0])["Plan.pdf"]);
    // unchanged files are the same objects in every list
    expect(final["Logo.png"]).toBe(byName(interim[0])["Logo.png"]);
    expect(byName(interim[2])["Plan.pdf"]).toBe(final["Plan.pdf"]);
    // interim lists do not tidy up – removing happens when the round is finished
    expect(state.folders.has("gone")).toBe(false);
  });
});

describe("later rounds (only changes)", () => {
  const initial = () =>
    fullRound([
      [
        rootItem(),
        folderItem("f1", "Projekte"),
        folderItem("f2", "2021", "f1"),
        fileItem("a", "Plan.pdf", "f2"),
        fileItem("b", "Budget.xlsx", "f1"),
        fileItem("c", "Logo.png"),
      ],
    ]);

  it("renames and moves folders, moves, changes, adds and deletes files", async () => {
    const first = await initial();
    const logo = byName(first.files)["Logo.png"];
    const next = await nextRound(first, [
      [
        folderItem("f1", "Archiv"),
        fileItem("b", "Budget.xlsx", "root", { size: 999, lastModifiedDateTime: "2026-11-01T00:00:00Z" }),
        deletedItem("c"),
        fileItem("d", "Neu.docx", "f2"),
      ],
    ]);
    const files = byName(next.files);
    expect(Object.keys(files).sort()).toEqual(["Budget.xlsx", "Neu.docx", "Plan.pdf"]);
    // the folder was renamed – the file inside was not reported, its path follows anyway
    expect(files["Plan.pdf"].path).toBe("Dokumente/Archiv/2021");
    expect(files["Budget.xlsx"]).toMatchObject({ path: "Dokumente", size: 999 });
    expect(files["Neu.docx"].path).toBe("Dokumente/Archiv/2021");
    expect(next.state.link).toBe("delta-2");
    expect(logo.path).toBe("Dokumente");
  });

  it("keeps unchanged files as the same objects", async () => {
    const first = await initial();
    const next = await nextRound(first, [[fileItem("d", "Neu.docx")]]);
    expect(byName(next.files)["Plan.pdf"]).toBe(byName(first.files)["Plan.pdf"]);
  });

  it("drops the content of a deleted folder even when Graph reports only the folder", async () => {
    const first = await initial();
    const next = await nextRound(first, [[deletedItem("f1")]]);
    expect(next.files.map((f) => f.name)).toEqual(["Logo.png"]);
    expect([...next.state.folders.keys()]).toEqual(["root"]);
  });

  it("keeps a file that was moved out of a folder before the folder was deleted", async () => {
    const first = await initial();
    const next = await nextRound(first, [[fileItem("a", "Plan.pdf", "root"), deletedItem("f1")]]);
    expect(next.files.map((f) => f.name).sort()).toEqual(["Logo.png", "Plan.pdf"]);
  });

  it("keeps the content of a folder that was deleted and restored in the same round", async () => {
    const first = await initial();
    const next = await nextRound(first, [[deletedItem("f1")], [folderItem("f1", "Projekte")]]);
    expect(next.files).toHaveLength(3);
  });

  it("keeps version figures only for unchanged files", async () => {
    const first = await initial();
    const withVersions = first.files.map((f) => ({ ...f, versionCount: 5, versionBytes: 400 }));
    const next = await nextRound({ state: first.state, files: withVersions }, [
      [fileItem("a", "Plan.pdf", "f2"), fileItem("b", "Budget.xlsx", "f1", { size: 1 })],
    ]);
    expect(byName(next.files)["Plan.pdf"]).toMatchObject({ versionCount: 5, versionBytes: 400 });
    expect(byName(next.files)["Budget.xlsx"].versionCount).toBeUndefined();
  });

  it("follows a renamed library", async () => {
    const first = await initial();
    const next = await nextRound(first, [[]], { ...library, name: "Freigegebene Dokumente" });
    expect(byName(next.files)["Plan.pdf"]).toMatchObject({ path: "Freigegebene Dokumente/Projekte/2021", driveName: "Freigegebene Dokumente" });
  });

  it("keeps the stored path of files cached before folders were tracked", async () => {
    const first = await initial();
    const legacy = first.files.map((f) => ({ ...f, parentId: undefined, path: "Dokumente/Alt" }));
    const next = await nextRound({ state: first.state, files: legacy }, [[]]);
    expect(next.files.map((f) => f.path)).toEqual(["Dokumente/Alt", "Dokumente/Alt", "Dokumente/Alt"]);
  });
});

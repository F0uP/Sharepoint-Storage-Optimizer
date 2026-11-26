import { describe, expect, it } from "vitest";
import { graphError } from "../../tests/graph-fakes";
import { listAllLibraries, type GetJson } from "./libraries";

const DRIVES = "?$select=id,name,webUrl,driveType";
const SITES = "?$select=id,name,displayName,webUrl";
const site = { id: "root", webUrl: "https://contoso.sharepoint.com/sites/marketing" };

/** Fake Graph: URL → response, or an error to throw. */
function fakeGraph(responses: Record<string, unknown>) {
  const requested: string[] = [];
  const get: GetJson = async <T,>(url: string) => {
    requested.push(url);
    const response = responses[url];
    if (response instanceof Error) throw response;
    if (response === undefined) throw graphError(404);
    return response as T;
  };
  return { get, requested };
}

const lib = (id: string, name: string, driveType = "documentLibrary") => ({ id, name, driveType, webUrl: `https://x/${name}` });

describe("listAllLibraries", () => {
  it("reads the libraries of the site and of all subsites, following every page", async () => {
    const { get } = fakeGraph({
      [`/sites/root/drives${DRIVES}`]: { value: [lib("d1", "Dokumente")], "@odata.nextLink": "next-drives" },
      "next-drives": { value: [lib("d2", "Archiv"), lib("x", "Persönlich", "business")] },
      [`/sites/root/sites${SITES}`]: {
        value: [{ id: "sub", displayName: "Projekte / Kunden", webUrl: `${site.webUrl}/projekte` }],
      },
      [`/sites/sub/drives${DRIVES}`]: { value: [lib("d3", "Dokumente")] },
      [`/sites/sub/sites${SITES}`]: { value: [{ id: "deep", name: "alt", webUrl: `${site.webUrl}/projekte/alt` }] },
      [`/sites/deep/drives${DRIVES}`]: { value: [lib("d4", "Ablage"), lib("d1", "Dokumente")] },
      [`/sites/deep/sites${SITES}`]: { value: [] },
    });

    expect(await listAllLibraries(site, get)).toEqual([
      { id: "d1", name: "Dokumente", webUrl: "https://x/Dokumente", siteUrl: site.webUrl },
      { id: "d2", name: "Archiv", webUrl: "https://x/Archiv", siteUrl: site.webUrl },
      // subsite libraries carry the subsite in their name – a "/" in its title is no extra level
      { id: "d3", name: "Projekte - Kunden/Dokumente", webUrl: "https://x/Dokumente", siteUrl: `${site.webUrl}/projekte` },
      { id: "d4", name: "Projekte - Kunden/alt/Ablage", webUrl: "https://x/Ablage", siteUrl: `${site.webUrl}/projekte/alt` },
    ]);
  });

  it("skips subsites the account may not read", async () => {
    const { get } = fakeGraph({
      [`/sites/root/drives${DRIVES}`]: { value: [lib("d1", "Dokumente")] },
      [`/sites/root/sites${SITES}`]: { value: [{ id: "secret", name: "Geheim", webUrl: "u" }] },
      [`/sites/secret/drives${DRIVES}`]: graphError(403),
    });
    expect((await listAllLibraries(site, get)).map((l) => l.id)).toEqual(["d1"]);
  });

  it("does not hide other errors – a scan must not silently miss libraries", async () => {
    const { get } = fakeGraph({
      [`/sites/root/drives${DRIVES}`]: { value: [lib("d1", "Dokumente")] },
      [`/sites/root/sites${SITES}`]: graphError(503),
    });
    await expect(listAllLibraries(site, get)).rejects.toMatchObject({ statusCode: 503 });
  });

  it("fails when the site's own libraries cannot be read", async () => {
    const { get } = fakeGraph({ [`/sites/root/drives${DRIVES}`]: graphError(403) });
    await expect(listAllLibraries(site, get)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("works for sites without subsites (listing them is not allowed everywhere)", async () => {
    const { get, requested } = fakeGraph({ [`/sites/root/drives${DRIVES}`]: { value: [lib("d1", "Dokumente")] } });
    expect((await listAllLibraries(site, get)).map((l) => l.name)).toEqual(["Dokumente"]);
    expect(requested).toEqual([`/sites/root/drives${DRIVES}`, `/sites/root/sites${SITES}`]);
  });
});

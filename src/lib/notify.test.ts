import { describe, expect, it } from "vitest";
import { makeFile, MB } from "../../tests/factories";
import { buildOwnerMail, groupByOwner } from "./notify";

describe("groupByOwner", () => {
  it("groups by e-mail (case-insensitive), biggest owner first, unknown owners separately", () => {
    const files = [
      makeFile({ modifiedBy: "Anna Weber", modifiedByEmail: "Anna.Weber@contoso.com", size: 1 * MB }),
      makeFile({ modifiedBy: "Anna Weber", modifiedByEmail: "anna.weber@contoso.com", size: 1 * MB }),
      makeFile({ modifiedBy: "Max Braun", modifiedByEmail: "max.braun@contoso.com", size: 5 * MB }),
      makeFile({ modifiedBy: "System" }),
    ];
    const { groups, unknown } = groupByOwner(files);
    expect(groups.map((g) => [g.email, g.files.length])).toEqual([
      ["max.braun@contoso.com", 1],
      ["anna.weber@contoso.com", 2],
    ]);
    expect(unknown).toHaveLength(1);
  });
});

describe("buildOwnerMail", () => {
  it("lists the files with links and escapes everything", () => {
    const file = makeFile({ name: "<script>.mp4", webUrl: "https://contoso.sharepoint.com/a?b=1&c=2", size: 2 * MB });
    const [group] = groupByOwner([{ ...file, modifiedBy: "Lea Hoffmann", modifiedByEmail: "lea@contoso.com" }]).groups;
    const mail = buildOwnerMail(group, { siteName: "Marketing", message: "Bitte prüfen.\n\nDanke!", deadline: new Date("2026-11-15T12:00:00Z") });
    expect(mail.to).toEqual({ name: "Lea Hoffmann", email: "lea@contoso.com" });
    expect(mail.subject).toContain("1 Datei");
    expect(mail.subject).toContain("Marketing");
    expect(mail.html).toContain("Hallo Lea,");
    expect(mail.html).toContain("&lt;script&gt;.mp4");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("a?b=1&amp;c=2");
    expect(mail.html).toContain("<p>Bitte prüfen.</p><p>Danke!</p>");
    expect(mail.html).toContain("15.11.2026");
  });
});

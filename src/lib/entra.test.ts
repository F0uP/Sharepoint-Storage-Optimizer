import { describe, expect, it } from "vitest";
import { assessAppAccess, classifyLoginError, isTokenResource, tokenClaims } from "./entra";

function fakeJwt(claims: object) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.sig`;
}

describe("isTokenResource", () => {
  it("allows Graph and SharePoint origins only", () => {
    expect(isTokenResource("https://graph.microsoft.com")).toBe(true);
    expect(isTokenResource("00000003-0000-0ff1-ce00-000000000000")).toBe(true);
    expect(isTokenResource("00000003-0000-0000-c000-000000000000")).toBe(false);
    expect(isTokenResource("https://contoso.sharepoint.com")).toBe(true);
    expect(isTokenResource("https://contoso.sharepoint.com/")).toBe(false);
    expect(isTokenResource("https://contoso.sharepoint.com.evil.io")).toBe(false);
    expect(isTokenResource("http://contoso.sharepoint.com")).toBe(false);
    expect(isTokenResource("https://login.microsoftonline.com")).toBe(false);
    expect(isTokenResource("nonsense")).toBe(false);
  });
});

describe("tokenClaims", () => {
  it("reads the payload including non-ASCII names", () => {
    expect(tokenClaims(fakeJwt({ roles: ["Sites.Read.All"], app_displayname: "Speicher-Optimierer Ü" }))).toEqual({
      roles: ["Sites.Read.All"],
      app_displayname: "Speicher-Optimierer Ü",
    });
    expect(tokenClaims("not-a-token")).toEqual({});
    expect(tokenClaims("a.!!!.c")).toEqual({});
  });
});

describe("assessAppAccess", () => {
  const states = (checks: ReturnType<typeof assessAppAccess>) => Object.fromEntries(checks.map((c) => [c.id, c.state]));

  it("flags missing consent", () => {
    expect(states(assessAppAccess({ graphRoles: [], sharePoint: null, mailSender: "" }))).toEqual({
      token: "missing",
      read: "missing",
      write: "missing",
      sharepoint: "off",
      mail: "off",
      archive: "off",
    });
  });

  it("recognizes a complete setup with certificate", () => {
    const checks = assessAppAccess({
      graphRoles: ["Sites.Read.All", "Files.ReadWrite.All", "Mail.Send", "Sites.Archive.All"],
      sharePoint: { roles: ["Sites.FullControl.All"] },
      mailSender: "speicher@contoso.com",
    });
    expect(Object.values(states(checks))).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  it("reports a rejected SharePoint call and a read-only app", () => {
    const checks = assessAppAccess({
      graphRoles: ["Sites.Read.All"],
      sharePoint: { error: "Unsupported app only token." },
      mailSender: "",
    });
    expect(states(checks)).toMatchObject({ read: "ok", write: "missing", sharepoint: "missing" });
    expect(checks.find((c) => c.id === "sharepoint")?.hint).toBe("Unsupported app only token.");
  });

  it("explains permissions that Entra ID left out of the app token", () => {
    const checks = assessAppAccess({
      graphRoles: ["Mail.Send"],
      graphError: "Zugriff verweigert",
      sharePoint: { roles: ["Sites.FullControl.All"], tested: false },
      mailSender: "speicher@contoso.com",
    });
    expect(states(checks)).toMatchObject({ token: "ok", read: "missing", write: "missing", sharepoint: "ok", mail: "ok" });
    expect(checks.find((c) => c.id === "read")?.hint).toMatch(/Sites\.Read\.All fehlt im App-Token.*„Delegiert“/);
    expect(checks.find((c) => c.id === "write")?.hint).toMatch(/Files\.ReadWrite\.All fehlt im App-Token/);
    expect(checks.find((c) => c.id === "sharepoint")?.hint).toBe("Zertifikat gültig, Sites.FullControl.All erteilt");
  });

  it("spots site permissions added to the SharePoint API instead of Graph", () => {
    const checks = assessAppAccess({ graphRoles: ["Mail.Send"], sharePoint: { roles: ["Sites.Read.All"], tested: false }, mailSender: "" });
    expect(checks.find((c) => c.id === "read")?.hint).toMatch(/nur für die SharePoint-API/);
    expect(checks.find((c) => c.id === "sharepoint")).toMatchObject({ state: "missing", hint: expect.stringMatching(/^Zertifikat gültig – es fehlt/) });
  });

  it("shows a failed site call on the read check", () => {
    const checks = assessAppAccess({ graphRoles: ["Sites.Read.All"], graphError: "Zugriff verweigert", sharePoint: null, mailSender: "" });
    expect(checks.find((c) => c.id === "read")).toMatchObject({ state: "missing", hint: "Zugriff verweigert" });
  });
});

describe("classifyLoginError", () => {
  it.each([
    [{ errorCode: "invalid_grant", errorMessage: "AADSTS90094: Admin consent is required." }, "admin-consent"],
    [{ errorCode: "consent_required", errorMessage: "AADSTS65001: The user has not consented." }, "admin-consent"],
    [{ errorCode: "access_denied", errorMessage: "AADSTS65004: User declined to consent." }, "admin-consent"],
    [{ errorCode: "user_cancelled", message: "user_cancelled: User cancelled the flow." }, "cancelled"],
    [new Error("popup_window_error: Popup blocked"), "other"],
    [null, "other"],
  ])("%o → %s", (error, expected) => {
    expect(classifyLoginError(error)).toBe(expected);
  });
});

// Packaging for Windows (.exe installer) and macOS (.dmg). Paths are relative to the repo root.
// Signing is optional: without certificates Windows builds are unsigned and macOS builds are
// signed ad hoc. See README → "Desktop-App".

// GitHub passes missing secrets as empty strings – drop them so electron-builder ignores them.
const SECRETS = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];
for (const name of SECRETS) if (!process.env[name]) delete process.env[name];

const macCertificate = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

// Auto-update feed: an own server (DESKTOP_UPDATE_URL) or the GitHub Releases of the repository
// (GITHUB_REPOSITORY is set automatically in GitHub Actions). Without either, updates are off.
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
const updateUrl = process.env.DESKTOP_UPDATE_URL;
const publish = updateUrl
  ? { provider: "generic", url: updateUrl }
  : owner && repo
    ? { provider: "github", owner, repo, releaseType: "release" }
    : null;
const releasesPage = updateUrl ?? (owner && repo ? `https://github.com/${owner}/${repo}/releases/latest` : undefined);

/** @type {import("electron-builder").Configuration} */
const config = {
  appId: "app.storage-optimizer.desktop",
  productName: "SharePoint Storage Optimizer",
  copyright: `© ${new Date().getFullYear()} SharePoint Storage Optimizer`,
  directories: {
    app: "dist-desktop/app",
    output: "dist-desktop/release",
    buildResources: "desktop/resources",
  },
  // electron-builder always drops a node_modules directly below `from` – so copy from the parent
  // folder and select server/** (the standalone server needs its traced node_modules).
  extraResources: [{ from: "dist-desktop", to: ".", filter: ["server/**/*"] }],
  asar: true,
  // The app has no runtime dependencies – the server brings its own traced node_modules.
  // Returning false skips electron-builder's install/rebuild and node_modules collection.
  beforeBuild: async () => false,
  electronLanguages: ["de", "en-US"],
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
  },
  publish,
  // read by desktop/updater.mts – where ad-hoc signed macOS builds send users for new versions
  extraMetadata: releasesPage ? { updateReleasesUrl: releasesPage } : {},

  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "desktop/resources/icon-win.png",
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    deleteAppDataOnUninstall: false,
    artifactName: "SharePoint-Storage-Optimizer-Setup-${version}.${ext}",
  },

  mac: {
    // Squirrel.Mac needs the zip and a real signature for auto-updates
    target: [
      { target: "dmg", arch: ["arm64", "x64"] },
      ...(macCertificate && publish ? [{ target: "zip", arch: ["arm64", "x64"] }] : []),
    ],
    category: "public.app-category.productivity",
    icon: "desktop/resources/icon.png",
    hardenedRuntime: true,
    // "-" = ad-hoc signature, so Apple Silicon starts the app without a Developer ID
    identity: macCertificate ? undefined : "-",
    notarize,
  },
  dmg: {
    artifactName: "SharePoint-Storage-Optimizer-${version}-${arch}.${ext}",
  },
};

export default config;

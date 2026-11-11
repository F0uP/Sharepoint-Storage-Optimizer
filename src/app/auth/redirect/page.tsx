import { RedirectBridge } from "./redirect-bridge";

/** Redirect URI for the Microsoft sign-in popup – hands the auth response back to the main window. */
export default function AuthRedirectPage() {
  return <RedirectBridge />;
}

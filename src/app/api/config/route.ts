import { connection } from "next/server";
import { serverProviders } from "@/lib/server/ai-providers";

/**
 * Optional presets of a server deployment. Everything can be configured in the app's settings;
 * environment variables only pre-fill it for all users (e.g. a shared Docker deployment).
 * API keys never leave the server – only which providers are available.
 */
export async function GET() {
  await connection();
  return Response.json({
    azureClientId: process.env.AZURE_CLIENT_ID ?? "",
    azureTenantId: process.env.AZURE_TENANT_ID ?? "",
    aiProviders: serverProviders(),
  });
}

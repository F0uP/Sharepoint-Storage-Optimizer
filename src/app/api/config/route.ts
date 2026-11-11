import { connection } from "next/server";

/**
 * Public runtime configuration for the browser. Read at request time so a single build
 * (e.g. a Docker image) can be pointed at any tenant via environment variables.
 */
export async function GET() {
  await connection();
  return Response.json({
    azureClientId: process.env.AZURE_CLIENT_ID ?? "",
    azureTenantId: process.env.AZURE_TENANT_ID ?? "",
  });
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.APP_BASE_URL ?? "https://localhost:53000";
const manifestAppId = process.env.MICROSOFT_APP_ID ?? "00000000-0000-0000-0000-000000000000";
const appDomain = new URL(baseUrl).host;
const appResource = process.env.MICROSOFT_APP_RESOURCE ?? `api://${appDomain}/${manifestAppId}`;

const templatePath = path.resolve("apps/teams-tab/appPackage/manifest.template.json");
const outputDir = path.resolve("apps/teams-tab/appPackage/dist");
const outputPath = path.join(outputDir, "manifest.json");

const template = await readFile(templatePath, "utf8");
const rendered = template
  .replaceAll("{{APP_BASE_URL}}", baseUrl)
  .replaceAll("{{APP_DOMAIN}}", appDomain)
  .replaceAll("{{MICROSOFT_APP_ID}}", manifestAppId)
  .replaceAll("{{MICROSOFT_APP_RESOURCE}}", appResource);

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, rendered, "utf8");

console.log(`manifest written to ${outputPath}`);

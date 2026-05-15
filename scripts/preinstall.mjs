import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function safeUnlink(relativePath) {
  const p = path.join(root, relativePath);
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && e.code === "ENOENT") return;
    throw e;
  }
}

safeUnlink("package-lock.json");
safeUnlink("yarn.lock");

const ua = process.env.npm_config_user_agent ?? "";
// Some environments (including certain IDE shells) don't populate
// `npm_config_user_agent` for lifecycle scripts. If it's missing, don't block.
if (ua && !ua.startsWith("pnpm/")) {
  console.error("Use pnpm instead (detected user agent: " + ua + ")");
  process.exit(1);
}


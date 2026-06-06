import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function copyStaticHtml(...files: string[]) {
  return {
    name: "copy-static-html",
    closeBundle() {
      const root = process.cwd();
      for (const file of files) {
        copyFileSync(resolve(root, file), resolve(root, "dist", file));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyStaticHtml("garmin-auth.html", "privacy-policy.html")],
});

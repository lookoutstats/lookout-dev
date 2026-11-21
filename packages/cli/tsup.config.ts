import { defineConfig } from "tsup";

// One file with the shared core inside: the package has no dependencies to install.
export default defineConfig({ entry: ["src/cli.ts"], format: ["esm"], target: "node20", platform: "node", clean: true, noExternal: ["@lookout-dev/core"], tsconfig: "tsconfig.json" });

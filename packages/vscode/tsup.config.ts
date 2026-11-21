import { defineConfig } from "tsup";

// One CommonJS file for VS Code, with the shared core inside; `vscode` is the editor's own.
export default defineConfig({ entry: { extension: "src/extension.ts" }, format: ["cjs"], outExtension: () => ({ js: ".cjs" }), target: "node20", platform: "node", clean: true, external: ["vscode"], noExternal: ["@lookout-dev/core"], tsconfig: "tsconfig.json" });

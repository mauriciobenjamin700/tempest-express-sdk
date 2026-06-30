import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const srcDir = fileURLToPath(new URL("./src", import.meta.url));

export default defineConfig({
  entry: { index: "src/index.ts", cli: "src/cli/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "es2022",
  // Resolve the `@` → `src` alias at build time (esbuild does not read tsconfig
  // `paths`). The matcher hits `@` and any `@/...` subpath import.
  esbuildOptions(options) {
    options.alias = { "@": srcDir };
  },
});

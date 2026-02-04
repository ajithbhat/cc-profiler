import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts", "src/index.ts"],
  format: ["cjs"],
  target: "node22",
  sourcemap: true,
  dts: true,
  clean: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

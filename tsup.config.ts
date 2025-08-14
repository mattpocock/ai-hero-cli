import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  clean: true,
  publicDir: true,
  treeshake: "smallest",
  bundle: true,
  format: "cjs",
  external: [
    "@parcel/watcher",
    "node:readline/promises",
    "node:process",
    "process",
  ],
});

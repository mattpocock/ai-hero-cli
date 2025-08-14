import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/bin.ts"],
  clean: true,
  publicDir: true,
  treeshake: "smallest",
  format: "esm",
  external: ["@parcel/watcher"],
});

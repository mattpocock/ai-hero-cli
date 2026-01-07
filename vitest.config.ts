import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["./test/**/*.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    exclude: [],
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/bin.ts",
        "src/Cli.ts",
        "src/layer.ts",
        "src/git-service.ts",
        "src/prompt-service.ts",
        "src/internal/internal.ts",
        "src/internal/init.ts",
        "src/internal/get-diffs.ts",
        "src/internal/diffs-to-repo.ts",
        "src/internal/edit-commit.ts",
        "src/internal/rebase-to-main.ts",
        "src/internal/upload-to-cloudinary.ts",
        "src/internal/walk-through.ts"
      ]
    }
  }
})

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
        "src/internal/edit-commit/command.ts",
        "src/internal/add-commit/command.ts",
        "src/internal/rename-commit/command.ts",
        "src/internal/delete-commit/command.ts",
        "src/internal/stack/ceremony.ts",
        "src/internal/stack/options.ts",
        "src/internal/stack/target.ts"
      ]
    }
  }
})

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://localhost:5432/careerpilot_test",
      EMBEDDINGS: "off",
      ANTHROPIC_API_KEY: "",
      SESSION_SECRET: "test-secret-test-secret-test-secret",
    },
    fileParallelism: false,
    testTimeout: 30_000,
  },
});

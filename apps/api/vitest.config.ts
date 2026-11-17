import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

// SWC compiles NestJS decorators + emitDecoratorMetadata (esbuild cannot).
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    pool: "forks",
  },
});

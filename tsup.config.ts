import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "./src/main.ts",
  ],
  splitting: false,
  sourcemap: true,
  minify: true,
  clean: true,
  dts: true,
  format: ["cjs", "esm"],
});

import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "./src/main.ts",
    "./src/channels/broadcast/broadcastPublishingChannel.ts",
    "./src/channels/worker/worker.client.ts",
    "./src/channels/worker/worker.server.ts",
    "./src/channels/worker/sharedWorker.server.ts",
  ],
  splitting: false,
  sourcemap: true,
  minify: true,
  clean: true,
  dts: true,
  format: ["cjs", "esm"],
});

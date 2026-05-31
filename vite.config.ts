import { fileURLToPath } from "node:url"
import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// atproto's loopback OAuth client requires the app to run on a loopback IP
// (127.0.0.1), not "localhost" — BrowserOAuthClient redirects there automatically.
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
  test: {
    // Most tests run in node; component tests opt into jsdom per-file with a
    // `// @vitest-environment jsdom` docblock. globals: true gives Testing
    // Library its automatic per-test cleanup.
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    alias: {
      "@plausible-analytics/tracker": fileURLToPath(
        new URL("./src/test/plausible-stub.ts", import.meta.url),
      ),
    },
  },
})

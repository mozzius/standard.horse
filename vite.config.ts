import babel from "@rolldown/plugin-babel"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// atproto's loopback OAuth client requires the app to run on a loopback IP
// (127.0.0.1), not "localhost" — BrowserOAuthClient redirects there automatically.
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: {
    host: "127.0.0.1",
    port: 3000,
  },
})

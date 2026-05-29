// @ts-check

/** @type {import("prettier").Config} */
const config = {
  semi: false,
  plugins: ["@ianvs/prettier-plugin-sort-imports"],
  importOrderParserPlugins: ["typescript", "jsx"],
  importOrderTypeScriptVersion: "6.0.3",
}

export default config

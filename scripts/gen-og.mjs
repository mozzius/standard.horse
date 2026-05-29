// Renders the OpenGraph image (public/og.png) with Satori → resvg.
// Static for now — just the "standard.horse" wordmark on broadsheet paper.
// Run with: pnpm gen:og
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Resvg } from "@resvg/resvg-js"
import satori from "satori"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const font = (p) => readFileSync(resolve(root, "node_modules", p))

const WIDTH = 1200
const HEIGHT = 630
const PAPER = "#f6f2e9"
const INK = "#1a1714"
const ACCENT = "#8a1c1c"
const FAINT = "#8a8175"

// Satori takes a React-element-shaped object tree (no JSX needed here).
const h = (type, props, ...children) => ({
  type,
  props: { ...props, children: children.length <= 1 ? children[0] : children },
})

const rule = (width) =>
  h("div", { style: { width, height: 2, backgroundColor: INK } })

const element = h(
  "div",
  {
    style: {
      width: WIDTH,
      height: HEIGHT,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: PAPER,
      color: INK,
      fontFamily: "IBM Plex Sans",
    },
  },
  // h(
  //   "div",
  //   {
  //     style: {
  //       fontSize: 26,
  //       letterSpacing: 8,
  //       textTransform: "uppercase",
  //       color: FAINT,
  //       marginBottom: 30,
  //     },
  //   },
  //   "An editor for standard.site",
  // ),
  // rule(560),
  h(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "row",
        alignItems: "baseline",
        fontFamily: "Newsreader",
        fontWeight: 700,
        fontSize: 140,
        margin: "28px 0",
      },
    },
    h("span", {}, "standard"),
    h("span", { style: { color: ACCENT } }, "."),
    h("span", {}, "horse"),
  ),
  rule(560),
)

const svg = await satori(element, {
  width: WIDTH,
  height: HEIGHT,
  fonts: [
    {
      name: "Newsreader",
      data: font(
        "@fontsource/newsreader/files/newsreader-latin-700-normal.woff",
      ),
      weight: 700,
      style: "normal",
    },
    {
      name: "IBM Plex Sans",
      data: font(
        "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff",
      ),
      weight: 400,
      style: "normal",
    },
  ],
})

const png = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } })
  .render()
  .asPng()

const out = resolve(root, "public/og.png")
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(
  `Wrote ${out} (${WIDTH}×${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB)`,
)

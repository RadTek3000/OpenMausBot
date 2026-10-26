import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const source = readFileSync(new URL("../public/hitek-app-icon.svg", import.meta.url));
for (const [name, size] of [["app-icon-192.png", 192], ["app-icon-512.png", 512], ["apple-touch-icon.png", 180]]) {
  const path = fileURLToPath(new URL(`../public/${name}`, import.meta.url));
  writeFileSync(path, new Resvg(source, { fitTo: { mode: "width", value: size } }).render().asPng());
  console.log(`${name}: ${size}x${size}`);
}

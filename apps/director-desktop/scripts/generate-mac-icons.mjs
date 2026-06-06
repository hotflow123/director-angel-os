import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(scriptDir, "..");
const logoPath = join(appDir, "assets", "logo", "director-angel-operator-logo.png");
const generatedDir = join(appDir, "assets", "generated");
const iconsetDir = join(appDir, "assets", "DirectorAngel.iconset");
const iconPath = join(appDir, "assets", "DirectorAngel.icns");
const png1024Path = join(generatedDir, "director-angel-operator-logo-1024.png");

if (!existsSync(logoPath)) {
  throw new Error(`Logo source missing: ${logoPath}`);
}

mkdirSync(generatedDir, { recursive: true });
rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });

renderPng(logoPath, png1024Path, 1024);

const iconEntries = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

for (const [filename, size] of iconEntries) {
  renderPng(logoPath, join(iconsetDir, filename), size);
}

execFileSync("/usr/bin/iconutil", ["-c", "icns", iconsetDir, "-o", iconPath], {
  stdio: "inherit",
});

copyFileSync(png1024Path, join(appDir, "assets", "director-angel-operator-logo.png"));

console.log(`Generated ${png1024Path}`);
console.log(`Generated ${iconPath}`);

function renderPng(inputSvg, outputPng, size) {
  rmSync(outputPng, { force: true });
  execFileSync("/usr/bin/sips", ["-z", String(size), String(size), inputSvg, "--out", outputPng], {
    stdio: "ignore",
  });
  if (!existsSync(outputPng)) {
    throw new Error(`sips did not create ${outputPng}`);
  }
}

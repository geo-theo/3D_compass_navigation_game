import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import { PNG } from "pngjs";

const url = process.argv[2] ?? "http://127.0.0.1:5173";
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const browser = await chromium.launch();
const results = [];

try {
  for (const viewport of viewports) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);

    const canvases = await page.evaluate(() =>
      Promise.all([...document.querySelectorAll("canvas")].map(async (canvas) => {
        const box = canvas.getBoundingClientRect();
        if (canvas.id === "world") {
          return {
            id: canvas.id,
            width: Math.round(box.width),
            height: Math.round(box.height),
            nonBlank: false,
            varied: false,
          };
        }

        const context = canvas.getContext("2d");
        if (!context) {
          return {
            id: canvas.id,
            width: Math.round(box.width),
            height: Math.round(box.height),
            nonBlank: false,
            varied: false,
          };
        }

        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const first = `${data[0]},${data[1]},${data[2]},${data[3]}`;
        let nonBlank = 0;
        let varied = 0;

        for (let i = 0; i < data.length; i += 400) {
          if (data[i + 3] > 0) {
            nonBlank += 1;
          }
          if (`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}` !== first) {
            varied += 1;
          }
        }

        return {
          id: canvas.id,
          width: Math.round(box.width),
          height: Math.round(box.height),
          nonBlank: nonBlank > 50,
          varied: varied > 50,
        };
      })),
    );

    const screenshot = await page.screenshot();
    if (process.env.SAVE_RENDER_ARTIFACTS) {
      await writeFile(`artifacts-world-${viewport.name}.png`, screenshot);
    }
    const worldPixels = samplePngArea(PNG.sync.read(screenshot), {
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    const worldCanvas = canvases.find((canvas) => canvas.id === "world");
    if (worldCanvas) {
      worldCanvas.nonBlank = worldPixels.nonBlank;
      worldCanvas.varied = worldPixels.varied;
    }

    results.push({ viewport: viewport.name, canvases });
    await page.close();
  }
} finally {
  await browser.close();
}

const failures = results.flatMap(({ viewport, canvases }) =>
  canvases
    .filter((canvas) => canvas.width > 0 && canvas.height > 0)
    .filter((canvas) => !canvas.nonBlank || !canvas.varied)
    .map((canvas) => `${viewport}:${canvas.id}`),
);

console.log(JSON.stringify(results, null, 2));

if (failures.length) {
  throw new Error(`Render check failed for ${failures.join(", ")}`);
}

function samplePngArea(png, area) {
  const minX = Math.max(0, Math.floor(area.x));
  const minY = Math.max(0, Math.floor(area.y));
  const maxX = Math.min(png.width, Math.ceil(area.x + area.width));
  const maxY = Math.min(png.height, Math.ceil(area.y + area.height));
  const stepX = Math.max(1, Math.floor((maxX - minX) / 96));
  const stepY = Math.max(1, Math.floor((maxY - minY) / 96));
  const firstIndex = (minY * png.width + minX) * 4;
  const first = `${png.data[firstIndex]},${png.data[firstIndex + 1]},${png.data[firstIndex + 2]},${png.data[firstIndex + 3]}`;
  let nonBlank = 0;
  let varied = 0;

  for (let y = minY; y < maxY; y += stepY) {
    for (let x = minX; x < maxX; x += stepX) {
      const index = (y * png.width + x) * 4;
      if (png.data[index] || png.data[index + 1] || png.data[index + 2]) {
        nonBlank += 1;
      }
      if (`${png.data[index]},${png.data[index + 1]},${png.data[index + 2]},${png.data[index + 3]}` !== first) {
        varied += 1;
      }
    }
  }

  return {
    nonBlank: nonBlank > 50,
    varied: varied > 5,
  };
}

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";

const app = express();

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(",") || ["*"];
app.use(cors({
  origin: allowedOrigins.length === 1 && allowedOrigins[0] === "*"
    ? "*"
    : allowedOrigins
}));
app.use(express.json({ limit: "50mb" }));

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Screenshot endpoint for HTML content
app.post("/screenshot", async (req, res) => {
  const { html, width = 1200, height = 900, mode, canvasData, background } = req.body;

  if (!html) {
    return res.status(400).json({ error: "HTML content required" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu",
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({
      width: width,
      height: height,
      deviceScaleFactor: 2
    });

    // Set content and wait for load
    await page.setContent(html, {
      waitUntil: ["load", "networkidle0"],
      timeout: 30000
    });

    // Wait a bit for any animations/renders
    await new Promise(r => setTimeout(r, 1000));

    // Capture screenshot
    const screenshot = await page.screenshot({
      type: "jpeg",
      quality: 90,
      fullPage: false
    });

    await browser.close();

    const base64 = Buffer.from(screenshot).toString("base64");
    res.json({
      success: true,
      screenshot: `data:image/jpeg;base64,${base64}`
    });

  } catch (error) {
    console.error("Screenshot error:", error);
    if (browser) await browser.close();
    res.status(500).json({
      error: error instanceof Error ? error.message : "Screenshot failed"
    });
  }
});

// Iframe screenshot endpoint (for Unicorn Studio, Spline, etc.)
app.post("/iframe", async (req, res) => {
  const { urls } = req.body;

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: "URLs array required" });
  }

  // Validate allowed domains
  const allowedDomains = [
    "unicorn.studio",
    "spline.design",
    "my.spline.design",
    "prod.spline.design",
  ];

  const validUrls = urls.filter((url: string) => {
    try {
      const parsed = new URL(url);
      return allowedDomains.some(domain => parsed.hostname.includes(domain));
    } catch {
      return false;
    }
  });

  if (validUrls.length === 0) {
    return res.status(400).json({ error: "No valid URLs provided" });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--enable-webgl2",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--ignore-gpu-blocklist",
      ],
    });

    const screenshots: Record<string, string> = {};

    for (const url of validUrls) {
      try {
        const page = await browser.newPage();
        await page.setViewport({
          width: 1920,
          height: 1080,
          deviceScaleFactor: 2
        });

        // Navigate to the URL
        await page.goto(url, {
          waitUntil: ["load", "networkidle0"],
          timeout: 45000
        });

        // Wait for WebGL content to render
        await new Promise(r => setTimeout(r, 5000));

        // Capture screenshot
        const buffer = await page.screenshot({ type: "png" });
        screenshots[url] = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;

        await page.close();
      } catch (error) {
        console.error(`Error capturing ${url}:`, error);
        screenshots[url] = ""; // Empty string for failed captures
      }
    }

    await browser.close();
    res.json({ success: true, screenshots });

  } catch (error) {
    console.error("Iframe screenshot error:", error);
    if (browser) await browser.close();
    res.status(500).json({
      error: error instanceof Error ? error.message : "Iframe screenshot failed"
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Screenshot service running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

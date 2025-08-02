import express from "express";
import puppeteer from "puppeteer";
import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(express.json());

const VIEWPORT = { width: 1600, height: 800 }; // 1194px x 716x
const CLIP_WIDTH = VIEWPORT.width * 0.8;

app.post("/webhook", async (req, res) => {
  const { symbol = "", price = "", open = "", time = "" } = req.body;

  let success = false;
  let attempts = 3;
  while (attempts-- > 0) {
    try {
      await captureAndSendChart(symbol, price, open, time);
      success = true;
      break;
    } catch (err) {
      console.warn(`⚠️  第 ${3 - attempts} 次尝试失败:`, err.message);
    }
  }

  if (success) {
    res.send("图表已发送到 Discord");
  } else {
    res.status(500).send("截图失败，已重试多次");
  }
});

app.listen(process.env.PORT, () =>
  console.log(`Listening on http://localhost:${process.env.PORT}`)
);

async function captureAndSendChart(symbol, price, open, time) {
  const priceNum = parseFloat(price);
  const openNum = parseFloat(open);
  const isUp = priceNum > openNum;
  const icon = isUp ? "📈" : priceNum < openNum ? "📉" : "⚪️";

  const date = new Date(time);
  const formattedTime = date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });

  const chartUrl = `https://www.tradingview.com/chart/?symbol=NASDAQ:${symbol}`;
  const screenshotPath = path.resolve(`chart-${symbol}.png`);

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      defaultViewport: VIEWPORT,
    });

    const page = await browser.newPage();
    page.on("framenavigated", (frame) => {
      if (frame.url() !== chartUrl) {
        console.log("⚠️  Second navigation detected:", frame.url());
      }
    });

    await page.goto(chartUrl, { waitUntil: "domcontentloaded" });

    const canvasSel = 'canvas[data-name="pane-top-canvas"]';
    await page.waitForSelector(canvasSel, { timeout: 15000 });
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel);
        return el && el.width > 100 && el.height > 100;
      },
      { timeout: 15000 },
      canvasSel
    );

    await page.waitForSelector('div[data-name="legend-source-description"]', {
      timeout: 15000,
    });

    await page.screenshot({
      path: screenshotPath,
      clip: {
        x: 52,
        y: 42,
        width: 1200,
        height: 720,
      },
    });

    const form = new FormData();
    form.append("file", fs.createReadStream(screenshotPath));
    form.append(
      "content",
      `${icon} ${symbol} 图表（${formattedTime}）已更新！`
    );

    await axios.post(process.env.DISCORD_WEBHOOK_URL, form, {
      headers: form.getHeaders(),
    });

    // 清理临时文件
    await fs.promises
      .unlink(screenshotPath)
      .catch((err) => console.warn("⚠️ 删除截图失败：", err.message));
  } finally {
    if (browser) await browser.close();
  }
}

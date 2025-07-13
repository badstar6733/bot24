import puppeteer from "puppeteer-core";
import sharp from "sharp";
import fs from "fs/promises";
import axios from "axios";
import FormData from "form-data";
import dotenv from "dotenv";
import crypto from "crypto";
import http from "http";
import fetch from "node-fetch";

dotenv.config();

const browserlessWs = process.env.BROWSERLESS_WS;
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
const chatIdMap = {
  "SA gaming": process.env.CHAT_ID_SA,
  "WM casino": process.env.CHAT_ID_WM,
};
const targetUrl = "https://bng55.enterprises/baccarat-formula/";
const logoPath = "logo.png";
const TARGET_CAMPS = ["SA gaming", "WM casino"];
const roomHashes = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function calculateHash(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function cropSquareAddLogo(inputPath, outputPath) {
  const image = sharp(inputPath);
  const metadata = await image.metadata();
  const size = Math.min(metadata.width, metadata.height);
  const logoBuffer = await sharp(logoPath).resize(120).toBuffer();

  await image
    .extract({
      width: size,
      height: size,
      left: Math.floor((metadata.width - size) / 2),
      top: Math.floor((metadata.height - size) / 2),
    })
    .resize(800, 800)
    .composite([{ input: logoBuffer, gravity: "southeast" }])
    .toFile(outputPath);
}

async function sendToTelegram(filePath, roomNumber, campName, extraCaption) {
  const roomStr = roomNumber.toString().padStart(2, "0");
  const chatId = chatIdMap[campName];
  if (!chatId) return;

  const caption = `🎲 ${campName} | ห้อง ${roomStr}\n\n${extraCaption}`;
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("photo", await fs.readFile(filePath), {
    filename: `room_${roomStr}.jpg`,
    contentType: "image/jpeg",
  });

  await axios.post(`https://api.telegram.org/bot${telegramToken}/sendPhoto`, form, {
    headers: form.getHeaders(),
  });
  console.log(`✅ ส่งห้อง ${roomStr} (${campName}) เรียบร้อย`);
}

async function processCamp(campName) {
  let browser;
  try {
    browser = await puppeteer.connect({ browserWSEndpoint: browserlessWs });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".heng99-baccarat-provider-item__link", { timeout: 10000 });

    const providerLinks = await page.$$(".heng99-baccarat-provider-item__link");
    for (const link of providerLinks) {
      const img = await link.$("img");
      const name = await page.evaluate((el) => el.alt, img);
      if (name !== campName) continue;

      console.log(`🚪 เข้าแคมป์: ${campName}`);
      await link.click();
      await delay(1000);

      const roomButtons = await page.$$(".heng99-baccarat-content-room__name");
      for (let i = 0; i < roomButtons.length; i++) {
        try {
          await roomButtons[i].click();
          await page.waitForSelector(".heng99-baccarat-content", { timeout: 5000 });
          await delay(800);

          const content = await page.$(".heng99-baccarat-content");
          const tempPath = `temp_${campName}_${i + 1}.jpg`;
          const finalPath = `final_${campName}_${i + 1}.jpg`;
          await content.screenshot({ path: tempPath });

          const hash = await calculateHash(tempPath);
          const roomKey = `${campName}_${i + 1}`;
          if (roomHashes.get(roomKey) === hash) {
            await fs.unlink(tempPath);
            continue;
          }
          roomHashes.set(roomKey, hash);

          const imgs = await content.$$eval("img", (els) =>
            els
              .map((el) => el.getAttribute("src"))
              .filter((src) => src && (src.includes("icon-banker") || src.includes("icon-player") || src.includes("icon-tie")))
              .slice(-10)
              .map((src) => (src.includes("banker") ? "B" : src.includes("player") ? "P" : "T"))
          );

          const count = (val) => imgs.filter((x) => x === val).length;
          const percent = (val) => Math.round((count(val) / imgs.length) * 100);
          const emojis = { B: "🟥", P: "🔵", T: "🟩" };

          const winrate = `📊 สถิติ 10 ตาหลังสุด\n🟥 Banker: ${percent("B")}%\n🔵 Player: ${percent("P")}%\n🟩 Tie: ${percent("T")}%`;
          const last10 = `${imgs.map((x) => emojis[x]).slice(0, 5).join(" ")}\n${imgs.map((x) => emojis[x]).slice(5).join(" ")}`;

          const suggestion =
            percent("B") > percent("P") ? "✅ คำแนะนำ: แทง 🟥 Banker" : "✅ คำแนะนำ: แทง 🔵 Player";

          const extra = `${winrate}\n\n🎴 เค้าไพ่ล่าสุด\n${last10}\n\n📈 วิเคราะห์ไพ่\n${suggestion}`;

          await cropSquareAddLogo(tempPath, finalPath);
          await sendToTelegram(finalPath, i + 1, campName, extra);
          await fs.unlink(tempPath);
          await fs.unlink(finalPath);
          break;
        } catch (e) {
          console.warn(`⚠️ ห้อง ${i + 1} มีปัญหา: ${e.message}`);
        }
      }
      break;
    }
    await browser.close();
  } catch (err) {
    console.error(`❌ ${campName}: ${err.message}`);
    if (browser) await browser.close().catch(() => {});
  }
}

async function runOnce() {
  console.log("🕒 เริ่มรอบ:", new Date().toLocaleString("th-TH"));
  for (const camp of TARGET_CAMPS) {
    await processCamp(camp);
  }
  console.log("✅ เสร็จสิ้นรอบ\n");
}

async function loop() {
  while (true) {
    const start = Date.now();
    await runOnce();
    const delayMs = Math.max(35000 - (Date.now() - start), 1000);
    await delay(delayMs);
  }
}
loop();

// 🌐 Self-ping server
http
  .createServer((req, res) => {
    res.writeHead(200);
    res.end("Bot is running ✅");
  })
  .listen(3000);

setInterval(() => {
  fetch("https://your-render-url.onrender.com").then(() =>
    console.log("📡 Self-ping success")
  );
}, 1000 * 60 * 5);

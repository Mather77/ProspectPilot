import express from "express";
import path from "path";
import axios from "axios";
import * as cheerio from "cheerio";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", environment: process.env.NODE_ENV || 'development' });
});

const gemini = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Helper for junk email filtering
const JUNK_EMAILS = ['noreply', 'sentry', 'wix', 'godaddy', 'support@', 'no-reply'];
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '@2x', '@3x'];

function isLikelyPersonal(email: string) {
  const [local] = email.split('@');
  return local.includes('.');
}

function scoreEmail(email: string) {
  if (isLikelyPersonal(email)) return 100;
  if (['info', 'contact', 'hello', 'hi'].some(word => email.startsWith(word))) return 50;
  return 10;
}

// 1. Geocoding helper
async function getPlaceId(city: string, state: string, country: string = "USA") {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey || apiKey === "YOUR_GEOAPIFY_API_KEY") {
    console.error("[Geocoding] Missing or default API Key. Please set GEOAPIFY_API_KEY in Secrets.");
    return null;
  }
  
  const url = `https://api.geoapify.com/v1/geocode/search?city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&country=${encodeURIComponent(country)}&apiKey=${apiKey}`;
  console.log(`[Geocoding] Searching for ${city}, ${state}`);
  try {
    const response = await axios.get(url, { timeout: 10000 });
    if (!response.data.features || response.data.features.length === 0) {
      console.warn(`[Geocoding] No coordinates found for ${city}, ${state}`);
      return null;
    }
    const feature = response.data.features[0];
    console.log(`[Geocoding] Found location: ${feature.properties.formatted}`);
    return feature;
  } catch (err: any) {
    console.error(`[Geocoding] API Error:`, err.response?.data || err.message);
    throw new Error(`Geocoding failed: ${err.response?.data?.message || err.message}`);
  }
}

// 2. Places helper
async function getLeads(place_id: string, lat: number, lon: number, category: string) {
  const apiKey = process.env.GEOAPIFY_API_KEY;
  if (!apiKey || apiKey === "YOUR_GEOAPIFY_API_KEY") {
    console.error("[Places] Missing or default API Key.");
    return [];
  }
  
  // Strategy 1: Search by Place ID (Specific)
  console.log(`[Places] Searching in ${place_id} for ${category}`);
  const strategy1Url = `https://api.geoapify.com/v2/places?categories=${category}&filter=place:${place_id}&limit=50&apiKey=${apiKey}`;
  const strategy2Url = `https://api.geoapify.com/v2/places?categories=${category}&filter=circle:${lon},${lat},15000&bias=proximity:${lon},${lat}&limit=50&apiKey=${apiKey}`;
  
  try {
    let response = await axios.get(strategy1Url, { timeout: 10000 });
    let results = response.data.features || [];
    
    if (results.length === 0) {
      console.log(`[Places] No results in Place ID bounds. Trying 15km radius...`);
      response = await axios.get(strategy2Url, { timeout: 10000 });
      results = response.data.features || [];
    }

    console.log(`[Places] Found ${results.length} raw business results.`);
    const processed = results
      .map((f: any) => f.properties)
      .filter((p: any) => p.website); 
    
    console.log(`[Places] ${processed.length} leads with websites found.`);
    return processed;
  } catch (err: any) {
    console.error(`[Places] API Error:`, err.response?.data || err.message);
    throw new Error(`Lead search failed: ${err.response?.data?.message || err.message}`);
  }
}

// 3. Simplified robust scraper
async function scrapeLeadData(website: string) {
  const visited = new Set<string>();
  const priorityPaths = ['/contact', '/contact-us', '/about', '/about-us'];
  const baseDomain = new URL(website).origin;
  let combinedText = "";

  async function fetchPage(url: string) {
    if (visited.has(url) || visited.size > 3) return; // Limit depth to 3 priority pages
    visited.add(url);
    try {
      console.log(`[Scraper] Fetching: ${url}`);
      const res = await axios.get(url, { 
        timeout: 8000,
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        },
        validateStatus: (s) => s < 500 
      });
      if (res.status !== 200) return;
      const $ = cheerio.load(res.data);
      $('script, style, nav, footer, iframe').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      combinedText += `\n--- Page: ${url} ---\n${text.substring(0, 5000)}`;
    } catch (e: any) {
      console.warn(`[Scraper] Failed ${url}: ${e.message}`);
    }
  }

  await fetchPage(website);
  for (const path of priorityPaths) {
    if (combinedText.length > 15000) break;
    try {
      await fetchPage(new URL(path, website).href);
    } catch {}
  }
  return combinedText;
}

// 4. Combined Gemini Enrichment
async function enrichLead(website: string, businessName: string) {
  try {
    const screenshotUrl = `https://api.microlink.io/?url=${encodeURIComponent(website)}&screenshot=true&embed=screenshot.url`;
    const pageText = await scrapeLeadData(website);

    const prompt = `
      You are a Sales Intelligence AI. 
      Analyze this business data for ${businessName} (${website}).
      
      DATA FROM WEBSITE:
      ${pageText.substring(0, 10000)}
      
      TASKS:
      1. AUDIT: Score 0-100, identify ONE "Gap" (technical/design) and ONE "Insight" (business impact).
      2. EMAILS: Extract any legitimate business emails found in the text.
      3. COLD EMAIL: Write a short, high-conversion cold email. 
         Framework: Observation -> Gap -> Impact -> Offer Video Audit. 
         Rules: No flattery, subject is 2-4 words lowercase.
      
      OUTPUT JSON ONLY:
      {
        "audit": {
          "score": number,
          "gap": "string",
          "insight": "string",
          "findings": ["string"]
        },
        "emails": ["string"],
        "email": {
          "subject": "string",
          "body": "string"
        }
      }
    `;

    console.log(`[Gemini] Processing enrichment for ${businessName}`);
    const response = await gemini.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ text: prompt }],
      config: { responseMimeType: "application/json" }
    });

    const result = JSON.parse(response.text || '{}');
    return { ...result, screenshotUrl };

  } catch (e: any) {
    if (e.message?.includes('RESOURCE_EXHAUSTED')) {
      throw new Error("AI_QUOTA_EXCEEDED");
    }
    console.error('[Enrichment Error]', e.message);
    throw e;
  }
}

// API Routes
app.post("/api/leads/search", async (req, res) => {
  const { city, state, nicheCategory } = req.body;
  try {
    const location = await getPlaceId(city, state);
    if (!location) {
      return res.status(404).json({ error: `Location "${city}, ${state}" could not be geocoded by Geoapify.` });
    }

    const { place_id, lat, lon } = location.properties;
    const leads = await getLeads(place_id, lat, lon, nicheCategory);
    res.json({ leads });
  } catch (e: any) {
    console.error('[Search Route Error]', e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/leads/enrich", async (req, res) => {
  const { website, name } = req.body;
  if (!website) return res.status(400).json({ error: "Website required" });
  
  try {
    const result = await enrichLead(website, name);
    res.json(result);
  } catch (e: any) {
    if (e.message === "AI_QUOTA_EXCEEDED") {
      return res.status(429).json({ error: "Daily AI request limit reached. Please try again tomorrow or upgrade your API key." });
    }
    res.status(500).json({ error: e.message });
  }
});

import serverless from "serverless-http";

const isServerless = process.env.SERVERLESS === "true" || !!process.env.LAMBDA_TASK_ROOT;

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (!isServerless) {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`ProspectPilot server running on http://localhost:${PORT}`);
      console.log(`Geoapify Key Status: ${process.env.GEOAPIFY_API_KEY ? 'LOADED (' + process.env.GEOAPIFY_API_KEY.substring(0,4) + '...)' : 'MISSING'}`);
    });
  }
}

startServer();

export const handler = serverless(app);


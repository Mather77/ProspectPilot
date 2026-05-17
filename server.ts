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

// 3. Email scraper
async function extractEmails(website: string) {
  const emails = new Set<string>();
  const visited = new Set<string>();
  const priorityPaths = ['/contact', '/contact-us', '/locations', '/location', '/team', '/about', '/about-us'];
  const baseDomain = new URL(website).origin;

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

  async function scrapePage(url: string) {
    if (visited.has(url) || visited.size > 8) return;
    visited.add(url);

    try {
      const res = await axios.get(url, { 
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
        validateStatus: (s) => s < 500 
      });
      if (res.status !== 200) return;

      const $ = cheerio.load(res.data);
      const html = $('body').html() || '';
      const matches = html.match(emailRegex);
      
      if (matches) {
        matches.forEach(email => {
          const lower = email.toLowerCase();
          if (JUNK_EMAILS.some(j => lower.includes(j))) return;
          if (IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))) return;
          emails.add(lower);
        });
      }

      // Also look for links to priority paths if we are on homepage
      if (url === website) {
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          if (!href) return;
          try {
            const absoluteUrl = new URL(href, baseDomain).href;
            if (absoluteUrl.startsWith(baseDomain) && priorityPaths.some(path => absoluteUrl.includes(path))) {
              // Priority fetch later
            }
          } catch {}
        });
      }
    } catch (e) {
      console.error(`Error scraping ${url}:`, (e as Error).message);
    }
  }

  // Scrape homepage first
  await scrapePage(website);
  
  // Try priority paths
  for (const path of priorityPaths) {
    if (emails.size > 2) break;
    await scrapePage(new URL(path, website).href);
  }

  const sortedEmails = Array.from(emails).sort((a, b) => scoreEmail(b) - scoreEmail(a));
  return sortedEmails;
}

// 4. Gemini Audit & Copywriting
async function auditLead(website: string, businessName: string, screenshotUrl: string) {
  try {
    // Audit with Vision
    const imageRes = await axios.get(screenshotUrl, { responseType: 'arraybuffer' });
    const imageBase64 = Buffer.from(imageRes.data).toString('base64');

    const auditPrompt = `
      You are a specialized Web Audit Expert for a marketing agency.
      Look at this screenshot of ${businessName}'s website (${website}).
      
      Tasks:
      1. Give an Audit Score (0-100) based on conversion optimization, design modernness, and mobile focus.
      2. Identify ONE specific "Gap" (e.g., poor hero section, missing CTA, slow-looking layout).
      3. Identify ONE "Insight" (How this gap hurts their specific business niche).
      
      Return JSON:
      {
        "score": number,
        "gap": string,
        "insight": string,
        "findings": string[]
      }
    `;

    const auditResponse = await gemini.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        { text: auditPrompt },
        { inlineData: { mimeType: "image/png", data: imageBase64 } }
      ],
      config: { responseMimeType: "application/json" }
    });

    const auditData = JSON.parse(auditResponse.text || '{}');

    // Drafting Cold Email
    const emailPrompt = `
      Write a hyper-personalized cold email for ${businessName}.
      Context: ${auditData.gap}. Insight: ${auditData.insight}.
      
      Framework: "Observation -> Insight -> Gap".
      Rules:
      - NO flattery.
      - NO "I hope you're well".
      - NO "I noticed your website".
      - Subject: 2-4 words, lowercase, very specific (e.g., "your hero section layout").
      - Body: "I was looking at your site and the [Specific Detail] is [Problem]. Usually, this makes it harder for customers to [Action]. I recorded a 2-min video on how to fix this. Worth a look?"
      - Signature: Animesh, ProspectPilot
      
      Return JSON:
      {
        "subject": string,
        "body": string
      }
    `;

    const emailResponse = await gemini.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: emailPrompt,
      config: { responseMimeType: "application/json" }
    });

    const emailData = JSON.parse(emailResponse.text || '{}');

    return { audit: auditData, email: emailData };

  } catch (e) {
    console.error('Gemini Audit Error:', e);
    return null;
  }
}

// API Routes
app.post("/api/leads/search", async (req, res) => {
  const { city, state, nicheCategory } = req.body;
  try {
    const location = await getPlaceId(city, state);
    if (!location) {
      return res.status(404).json({ error: `Location "${city}, ${state}" could not be geocoded by Geoapify. Check if the city name is correct.` });
    }

    const { place_id, lat, lon } = location.properties;
    const leads = await getLeads(place_id, lat, lon, nicheCategory);
    
    if (leads.length === 0) {
      console.warn(`[API] Zero leads found for ${nicheCategory} in ${city}`);
    }

    res.json({ leads });
  } catch (e: any) {
    console.error('[Search Route Error]', e);
    const status = e.response?.status || 500;
    const message = e.response?.data?.message || e.message;
    res.status(status).json({ error: `Geoapify Error: ${message}` });
  }
});

app.post("/api/leads/enrich", async (req, res) => {
  const { website, name } = req.body;
  try {
    const screenshotUrl = `https://api.microlink.io/?url=${encodeURIComponent(website)}&screenshot=true&embed=screenshot.url`;
    
    // Run enrichment in parallel
    const [emails, auditResult] = await Promise.all([
      extractEmails(website),
      auditLead(website, name, screenshotUrl)
    ]);

    res.json({ emails, auditResult, screenshotUrl });
  } catch (e) {
    res.status(500).json({ error: (e as Error).message });
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


/**
 * magicedenSync.js — Magic Eden Active Listings → Supabase
 * Cloudflare-safe + free API limit safe (1 req/sec)
 */

import fetch from "node-fetch";
import https from "https";
import dotenv from "dotenv";
import { nanoid } from "nanoid";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// -----------------------
// 🔌 Supabase Connect
// -----------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// -----------------------
// 🔧 ENV
// -----------------------
const NFT_SYMBOL = process.env.MAGICEDEN_SYMBOL || "KAU";
const LIMIT = 5;
const MAX_RETRIES = 3;
const BASE_DELAY = 1500; // 1.5 sec → Cloudflare & FREE API safe
const DECIMALS = 9; // ApeChain decimals

// -----------------------
// 🌐 Keep-Alive Agent
// -----------------------
const agent = new https.Agent({
  keepAlive: true,
  maxSockets: 5,
  timeout: 15000
});

// -----------------------
// 🟢 Fetch Listings + Retry + Backoff
// -----------------------
async function fetchListings(offset = 0, retry = 0) {
  try {
    const url = `https://api-mainnet.magiceden.io/rpc/getListedNFTsByQuery`;

    const body = {
      query: { symbol: NFT_SYMBOL },
      sortBy: "price",
      sortDirection: "asc",
      offset,
      limit: LIMIT
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",

        // ⭐ Cloudflare bypass headers
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
        "Origin": "https://magiceden.io",
        "Referer": "https://magiceden.io/"
      },
      body: JSON.stringify(body),
      agent,
      timeout: 15000
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`ME API error ${res.status}: ${txt}`);
    }

    return await res.json();

  } catch (err) {
    if (retry < MAX_RETRIES) {
      const delay = BASE_DELAY * (retry + 1);

      console.warn(
        `⚠️ Retry #${retry + 1}/${MAX_RETRIES} after ${delay}ms | Error: ${err.message}`
      );

      await new Promise(r => setTimeout(r, delay));
      return fetchListings(offset, retry + 1);
    }

    throw new Error(`Magic Eden fatal: ${err.message}`);
  }
}

// -----------------------
// 📤 Save to Supabase
// -----------------------
async function saveOrder(order) {
  const id = nanoid();
  const now = new Date().toISOString();

  const tokenId = order.tokenMint;
  const price = order.price ? Number(order.price) / Math.pow(10, DECIMALS) : null;
  const seller = order.seller?.toLowerCase() || null;

  const orderHash = `${tokenId}_${seller}_${price}`;

  const { error } = await supabase.from("orders").upsert(
    {
      id,
      tokenId,
      price,
      nftContract: process.env.NFT_CONTRACT_ADDRESS,
      marketplaceContract: "magiceden",
      seller,
      buyerAddress: null,
      seaportOrder: order,
      orderHash,
      onChain: false,
      status: "active",
      image: order.image || null,
      createdAt: now,
      updatedAt: now
    },
    { onConflict: "orderHash" }
  );

  if (error) console.error("❌ Supabase upsert error:", error);
  else console.log(`✅ Saved tokenId: ${tokenId}`);
}

// -----------------------
// 🔄 Main Sync Loop
// -----------------------
async function main() {
  console.log(`🚀 Magic Eden Sync başladı... Symbol: ${NFT_SYMBOL}`);

  let offset = 0;
  let total = 0;

  try {
    while (true) {
      console.log(`🌐 Fetching offset ${offset}...`);

      const data = await fetchListings(offset);
      const listings = data.results || [];

      if (listings.length === 0) {
        console.log("⛔ No more listings.");
        break;
      }

      for (const nft of listings) {
        await saveOrder(nft);

        // ⭐ Rate limit: 1 API request per second (safe)
        await new Promise(r => setTimeout(r, 1200));
        total++;
      }

      offset += listings.length;
      console.log(`➡️ Next offset: ${offset}`);
    }

    console.log(`🎉 Sync Bitdi! Total saved: ${total}`);

  } catch (err) {
    console.error(`💀 Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();

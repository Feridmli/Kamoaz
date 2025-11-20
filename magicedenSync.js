/**
 * magicedenSync.js — Magic Eden Active Listings → Supabase
 */

import fetch from "node-fetch";
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
// 🔑 Environment
// -----------------------
const BACKEND_URL = process.env.BACKEND_URL;
const NFT_SYMBOL = process.env.MAGICEDEN_SYMBOL || "KAU";
const LIMIT = 50;
const RETRY_DELAY = 2000; 
const MAX_RETRIES = 3;

// ApeChain decimals
const DECIMALS = 9; // ApeChain APE decimals

// -----------------------
// 🟢 Fetch Listings w/ Retry
// -----------------------
async function fetchListings(offset = 0, retries = MAX_RETRIES) {
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Magic Eden API error: ${res.status} ${text}`);
    }

    return await res.json();
  } catch (err) {
    if (retries > 0) {
      console.warn(`⚠️ Retry fetchListings, remaining: ${retries}, error: ${err.message}`);
      await new Promise(r => setTimeout(r, RETRY_DELAY));
      return fetchListings(offset, retries - 1);
    }
    throw err;
  }
}

// -----------------------
// 📤 Save to Supabase
// -----------------------
async function saveOrder(order) {
  const id = nanoid();
  const now = new Date().toISOString();

  const tokenId = order.tokenMint;
  const price = order.price ? parseFloat(order.price) / Math.pow(10, DECIMALS) : null;
  const sellerAddress = order.seller?.toLowerCase() || null;
  const image = order.image || null;

  // Unikal orderHash: token + seller + price
  const orderHash = `${tokenId}_${sellerAddress}_${price}`;

  const { error } = await supabase.from("orders").upsert(
    {
      id,
      tokenId,
      price,
      nftContract: process.env.NFT_CONTRACT_ADDRESS,
      marketplaceContract: "magiceden",
      seller: sellerAddress,
      buyerAddress: null,
      seaportOrder: order,
      orderHash,
      onChain: false,
      status: "active",
      image,
      createdAt: now,
      updatedAt: now
    },
    { onConflict: "orderHash" }
  );

  if (error) console.error("❌ Supabase upsert error:", error);
  else console.log(`✅ Saved: tokenId ${tokenId}`);
}

// -----------------------
// 🔄 Main Sync Loop
// -----------------------
async function main() {
  console.log("🚀 Magic Eden Active Listings Sync başladı...");
  let offset = 0;
  let total = 0;

  try {
    while (true) {
      const data = await fetchListings(offset);
      const listings = data.results || [];

      if (listings.length === 0) break;

      for (const order of listings) {
        await saveOrder(order);
        total++;
      }

      offset += listings.length;
      console.log(`ℹ️ Fetched ${listings.length} listings, offset: ${offset}`);
    }

    console.log(`🎉 Sync tamamlandı! Total listings saved: ${total}`);
  } catch (err) {
    console.error("💀 Fatal error:", err.message);
    process.exit(1);
  }
}

main();

/**
 * openseaSync.js — Opensea Active Listings → Supabase
 * API-Key safe + retry + rate limit
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
// 🔧 ENV
// -----------------------
const NFT_CONTRACT = process.env.NFT_CONTRACT_ADDRESS;
const LIMIT = 5;
const MAX_RETRIES = 3;
const BASE_DELAY = 1200; // ms → 1 req/sec safe
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;

// -----------------------
// 🟢 Fetch Listings + Retry
// -----------------------
async function fetchListings(cursor = null, retry = 0) {
  try {
    const url = new URL(`https://api.opensea.io/v2/orders/ethereum/seaport/listings`);
    url.searchParams.append("asset_contract_address", NFT_CONTRACT);
    url.searchParams.append("order_by", "created_date");
    url.searchParams.append("order_direction", "asc");
    url.searchParams.append("limit", LIMIT);
    if (cursor) url.searchParams.append("cursor", cursor);

    const res = await fetch(url.toString(), {
      headers: { "X-API-KEY": OPENSEA_API_KEY }
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Opensea API error ${res.status}: ${txt}`);
    }

    return await res.json();

  } catch (err) {
    if (retry < MAX_RETRIES) {
      const delay = BASE_DELAY * (retry + 1);
      console.warn(`⚠️ Retry #${retry + 1}/${MAX_RETRIES} after ${delay}ms | Error: ${err.message}`);
      await new Promise(r => setTimeout(r, delay));
      return fetchListings(cursor, retry + 1);
    }
    throw new Error(`Opensea fatal: ${err.message}`);
  }
}

// -----------------------
// 📤 Save to Supabase
// -----------------------
async function saveOrder(order) {
  const id = nanoid();
  const now = new Date().toISOString();

  const tokenId = order.asset?.token_id;
  const price = order.current_price ? Number(order.current_price) / 1e18 : null; // ETH to number
  const seller = order.maker?.address?.toLowerCase() || null;
  const orderHash = order.order_hash;

  const { error } = await supabase.from("orders").upsert(
    {
      id,
      tokenId,
      price,
      nftContract: NFT_CONTRACT,
      marketplaceContract: "opensea",
      seller,
      buyerAddress: null,
      seaportOrder: order,
      orderHash,
      onChain: false,
      status: "active",
      image: order.asset?.image_url || null,
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
  console.log(`🚀 Opensea Sync başladı... NFT: ${NFT_CONTRACT}`);

  let total = 0;
  let cursor = null;

  try {
    while (true) {
      console.log(`🌐 Fetching cursor: ${cursor || "start"}...`);
      const data = await fetchListings(cursor);
      const listings = data.orders || [];

      if (listings.length === 0) {
        console.log("⛔ No more listings.");
        break;
      }

      for (const nft of listings) {
        await saveOrder(nft);
        await new Promise(r => setTimeout(r, BASE_DELAY));
        total++;
      }

      cursor = data.next; // Opensea pagination
      if (!cursor) break;
    }

    console.log(`🎉 Sync Bitdi! Total saved: ${total}`);

  } catch (err) {
    console.error(`💀 Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();

/**
 * openseaSync.js — Opensea Active Listings → Supabase
 * Manual sync, API-based, On-chain event-lərlə birləşdirilə bilər
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
const OPENSEA_API_KEY = process.env.OPENSEA_API_KEY;
const BACKEND_URL = process.env.BACKEND_URL;
const NFT_CONTRACT_ADDRESS = process.env.NFT_CONTRACT_ADDRESS;
const CHAIN = "ethereum"; // polygon / arbitrum varsa dəyişdir

// -----------------------
// 🟢 Fetch Listings
// -----------------------
async function fetchListings(cursor = null) {
  let url = `https://api.opensea.io/v2/orders/${CHAIN}/seaport/listings?asset_contract_address=${NFT_CONTRACT_ADDRESS}&order_direction=asc&limit=50`;
  if (cursor) url += `&cursor=${cursor}`;

  const res = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-API-KEY": OPENSEA_API_KEY,
    },
  });

  if (!res.ok) {
    throw new Error(`Opensea API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data;
}

// -----------------------
// 📤 Save to Supabase
// -----------------------
async function saveOrder(order) {
  const id = nanoid();
  const now = new Date().toISOString();

  const tokenId = order.asset?.token_id || null;
  const price = order.current_price ? parseFloat(order.current_price) / 1e18 : null; // Ether
  const sellerAddress = order.maker?.address?.toLowerCase() || null;

  const { error } = await supabase.from("orders").upsert(
    {
      id,
      tokenId,
      price,
      nftContract: NFT_CONTRACT_ADDRESS,
      marketplaceContract: order.exchange || null,
      seller: sellerAddress,
      buyerAddress: null,
      seaportOrder: order,
      orderHash: order.order_hash,
      onChain: false,
      status: "active",
      image: order.asset?.image_url || null,
      createdAt: now,
      updatedAt: now,
    },
    { onConflict: "orderHash" }
  );

  if (error) {
    console.error("❌ Supabase upsert error:", error);
  } else {
    console.log(`✅ Saved: tokenId ${tokenId} orderHash ${order.order_hash}`);
  }
}

// -----------------------
// 🔄 Main Sync Loop
// -----------------------
async function main() {
  console.log("🚀 Opensea Active Listings Sync başladı...");

  let cursor = null;
  let total = 0;

  do {
    const data = await fetchListings(cursor);
    const orders = data.orders || [];

    for (const order of orders) {
      await saveOrder(order);
      total++;
    }

    cursor = data.next || null;
    console.log(`ℹ️ Fetched ${orders.length} listings, next cursor: ${cursor}`);
  } while (cursor);

  console.log(`🎉 Sync tamamlandı! Total listings saved: ${total}`);
}

// -----------------------
// 🔥 Run
// -----------------------
main().catch((err) => {
  console.error("💀 Fatal error:", err);
  process.exit(1);
});
import admin from "firebase-admin";
import fs from "fs";
import path from "path";

// 1. Try to load from Environment Variable first (Render, Vercel, etc.)
let serviceAccount: any = null;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    console.log("[Firebase] Loaded credentials from FIREBASE_SERVICE_ACCOUNT env var.");
  } catch (error) {
    console.error("[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT env var. Ensure it is valid JSON.");
  }
} 
// 2. Fall back to local file if no env var exists
else {
  const serviceAccountPath = path.resolve(process.cwd(), "firebase-adminsdk.json");
  if (fs.existsSync(serviceAccountPath)) {
    try {
      serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, "utf-8"));
      console.log("[Firebase] Loaded credentials from local JSON file.");
    } catch (error) {
      console.error("[Firebase] Failed to parse local firebase-adminsdk.json.");
    }
  }
}

if (serviceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("[Firebase] Admin SDK initialized successfully.");
  }
} else {
  console.warn("[Firebase] WARNING: No Firebase credentials found. VoIP Calling push notifications will fail.");
}

export { admin };

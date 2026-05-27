import express from "express";
import ImageKit from "imagekit";
import { requireAuth } from "@clerk/express";

const router = express.Router();

const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "public_HWdcHmVK9g78x8J7uB8QyxcyBpg=",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "private_8JNllzdYAey0Q1LfrsIRPonI+40=",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "https://ik.imagekit.io/dx7pzaqkc",
});

router.get("/auth", requireAuth(), (req, res) => {
  try {
    const result = imagekit.getAuthenticationParameters();
    res.json(result);
  } catch (error) {
    console.error("[ImageKit Auth Error]", error);
    res.status(500).json({ error: "Failed to generate auth signature" });
  }
});

export default router;

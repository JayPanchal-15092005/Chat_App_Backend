import { Router } from "express";

const router = Router();

router.get("/credentials", async (req, res) => {
  try {
    const response = await fetch(
      `https://jay.metered.live/api/v1/turn/credentials?apiKey=${process.env.METERED_SECRET_KEY}`
    );
    const iceServers = await response.json();
    res.json(iceServers);
  } catch (error) {
    console.error("Failed to fetch TURN credentials:", error);
    res.status(500).json({ error: "Failed to fetch TURN credentials" });
  }
});

export default router;

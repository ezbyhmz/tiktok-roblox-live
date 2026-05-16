const express = require("express");
const { WebcastPushConnection } = require("tiktok-live-connector");
const axios = require("axios");

const app = express();
app.use(express.json());

// ==========================
// CONFIG - MODIFIE ICI
// ==========================
const TIKTOK_USERNAME = "runningboy36"; // ex: "tribilinbotello"
const MAX_AVATARS = 45;
const POLL_INTERVAL_MS = 2000; // Roblox poll toutes les 2s
// ==========================

// Queue des avatars à spawner (userId, username)
let avatarQueue = [];
// Avatars actuellement sur la map { slot: { userId, username, timestamp } }
let activeAvatars = {};
let slotCounter = 0;

// Regex simple pour détecter un pseudo Roblox valide
const ROBLOX_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

// Cache pour éviter de respawner le même pseudo trop souvent (cooldown 60s)
let recentlySpawned = {};

// ─── API Roblox : récupère le userId depuis un username ───────────────────────
async function getRobloxUserId(username) {
  try {
    const res = await axios.post(
      "https://users.roblox.com/v1/usernames/users",
      { usernames: [username], excludeBannedUsers: true },
      { timeout: 5000 }
    );
    if (res.data.data && res.data.data.length > 0) {
      return { userId: res.data.data[0].id, displayName: res.data.data[0].displayName };
    }
    return null;
  } catch (e) {
    console.error("Erreur API Roblox:", e.message);
    return null;
  }
}

// ─── Démarre le bot TikTok ───────────────────────────────────────────────────
async function startTikTokBot() {
  const tiktok = new WebcastPushConnection(TIKTOK_USERNAME, {
    processInitialData: false,
    enableExtendedGiftInfo: false,
    enableWebsocketUpgrade: true,
    requestPollingIntervalMs: 2000,
  });

  tiktok.on("chat", async (data) => {
    const comment = data.comment?.trim();
    const sender = data.uniqueId;
    if (!comment) return;

    // Extrait le premier "mot" du commentaire comme pseudo potentiel
    const candidate = comment.split(/\s+/)[0];

    if (!ROBLOX_REGEX.test(candidate)) return;

    // Cooldown : même pseudo pas respawnable avant 60s
    const now = Date.now();
    if (recentlySpawned[candidate] && now - recentlySpawned[candidate] < 60000) return;

    console.log(`[TikTok] ${sender} a mentionné: ${candidate}`);

    const result = await getRobloxUserId(candidate);
    if (!result) {
      console.log(`[Roblox] Pseudo introuvable: ${candidate}`);
      return;
    }

    recentlySpawned[candidate] = now;
    const slot = slotCounter++ % MAX_AVATARS;

    avatarQueue.push({
      slot,
      userId: result.userId,
      username: candidate,
      displayName: result.displayName,
      queuedAt: now,
    });

    console.log(`[Queue] Ajouté slot ${slot} → ${candidate} (userId: ${result.userId})`);
  });

  tiktok.on("connected", (state) => {
    console.log(`✅ Connecté au live TikTok de @${TIKTOK_USERNAME}`);
  });

  tiktok.on("disconnected", () => {
    console.log("❌ Déconnecté du live TikTok. Reconnexion dans 10s...");
    setTimeout(startTikTokBot, 10000);
  });

  tiktok.on("error", (err) => {
    console.error("[TikTok Error]", err.message);
  });

  try {
    await tiktok.connect();
  } catch (e) {
    console.error("Impossible de se connecter au live:", e.message);
    console.log("Reconnexion dans 15s...");
    setTimeout(startTikTokBot, 15000);
  }
}

// ─── Routes Express (Roblox poll ces routes) ────────────────────────────────

// Roblox appelle cette route toutes les 2s pour récupérer la queue
app.get("/poll", (req, res) => {
  const pending = [...avatarQueue];
  avatarQueue = []; // vide la queue après lecture
  res.json({ avatars: pending });
});

// Roblox confirme qu'un avatar est bien spawné
app.post("/confirm", (req, res) => {
  const { slot, userId, username } = req.body;
  activeAvatars[slot] = { userId, username, timestamp: Date.now() };
  res.json({ ok: true });
});

// Status général (debug)
app.get("/status", (req, res) => {
  res.json({
    connected: true,
    queueLength: avatarQueue.length,
    activeAvatars: Object.keys(activeAvatars).length,
    maxAvatars: MAX_AVATARS,
  });
});

// ─── Démarrage ───────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  startTikTokBot();
});

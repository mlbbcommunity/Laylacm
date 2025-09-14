import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@adiwajshing/baileys";
import pino from "pino";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import pkg from "pg"; // PostgreSQL client

dotenv.config();

// 🔧 Config
const BOT_NUMBER = process.env.BOT_NUMBER || "27813419702";
const PREFIX = process.env.PREFIX || "!";
const DATABASE_URL = process.env.DATABASE_URL || null;

let dbClient = null;

// Database connection
async function connectDB() {
  if (!DATABASE_URL) {
    console.log("⚠️ No DATABASE_URL provided, skipping DB connection.");
    return;
  }
  try {
    dbClient = new pkg.Client({ connectionString: DATABASE_URL });
    await dbClient.connect();
    console.log("✅ Connected to database.");
  } catch (err) {
    console.error("❌ Failed to connect to database:", err);
  }
}

// 🔌 Load plugins dynamically
function loadPlugins() {
  const plugins = new Map();
  const pluginsPath = path.join(process.cwd(), "plugins");

  if (!fs.existsSync(pluginsPath)) {
    console.log("⚠️ No plugins folder found.");
    return plugins;
  }

  const files = fs.readdirSync(pluginsPath).filter((f) => f.endsWith(".js"));
  for (const file of files) {
    try {
      const plugin = require(path.join(pluginsPath, file));
      const data = plugin.default || plugin; // handle ES module export default
      if (data.name && typeof data.execute === "function") {
        plugins.set(data.name.toLowerCase(), data);
        console.log(`✅ Loaded plugin: ${data.name}`);
      } else {
        console.log(`⚠️ Skipped invalid plugin: ${file}`);
      }
    } catch (err) {
      console.error(`❌ Failed to load plugin ${file}:`, err);
    }
  }
  return plugins;
}

// Start bot
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  if (!sock.authState.creds.registered) {
    try {
      const code = await sock.requestPairingCode(BOT_NUMBER);
      console.log("🔗 Pair this bot using code:", code);
    } catch (err) {
      console.error("❌ Failed to get pairing code:", err);
    }
  }

  const plugins = loadPlugins();

  // Message listener
  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      "";

    if (!text.startsWith(PREFIX)) return;

    const [command, ...args] = text.slice(PREFIX.length).trim().split(/\s+/);
    const plugin = plugins.get(command.toLowerCase());

    if (plugin) {
      try {
        await plugin.execute({ sock, msg, args, from, dbClient });
      } catch (err) {
        console.error(`❌ Error in plugin ${plugin.name}:`, err);
        await sock.sendMessage(from, {
          text: `⚠️ Error in plugin ${plugin.name}`,
        });
      }
    } else {
      await sock.sendMessage(from, {
        text: `❓ Unknown command: ${command}`,
      });
    }
  });
}

// Boot
(async () => {
  await connectDB();
  await startBot();
})();

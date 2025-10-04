const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdf = require("pdf-parse");
const upload = multer({ dest: "uploads/" });
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// In-memory store
const conversations = {}; // id -> messages array
const meta = {}; // id -> { title }

// Helper to auto-generate title
// Helper to auto-generate title
function autoTitleFromMessages(msgs) {
  const firstUser = msgs.find((m) => m.role === "user");
  if (!firstUser || !firstUser.content.trim()) return "New Chat";

  const text = firstUser.content.toLowerCase();

  // Keyword-based auto title generator
  if (text.includes("hello") || text.includes("hi") || text.includes("hey"))
    return "Casual Greeting";

  if (text.includes("joke") || text.includes("funny")) return "Fun Chat";

  if (text.includes("react") || text.includes(".net") || text.includes("api"))
    return "Technical Discussion";

  if (text.includes("travel") || text.includes("trip") || text.includes("goa"))
    return "Trip Planning";

  if (text.includes("movie") || text.includes("music") || text.includes("song"))
    return "Entertainment Talk";

  if (
    text.includes("plan") ||
    text.includes("project") ||
    text.includes("task")
  )
    return "Work Planning";

  if (text.includes("weather")) return "Weather Chat";

  // Default fallback — make it generic but nicer
  const capitalized = text.split(" ").slice(0, 3).join(" ");
  return capitalized.charAt(0).toUpperCase() + capitalized.slice(1) + " Chat";
}

// POST /api/chat: start/continue
// POST /api/chat: start/continue
// POST /api/chat: start/continue
// POST /api/chat: start/continue
app.post("/api/chat", (req, res) => {
  const {
    conversationId,
    messages: incoming,
    attachments,
    systemPrompt,
  } = req.body;
  const id = conversationId || "c_" + Date.now();

  conversations[id] = conversations[id] || [];
  if (Array.isArray(incoming) && incoming.length)
    conversations[id].push(...incoming);

  // Apply tone based on systemPrompt
  let toneSuffix = "";
  if (systemPrompt === "Be concise and professional") {
    toneSuffix = " (Concise tone)";
  } else if (systemPrompt === "Be friendly and casual") {
    toneSuffix = " 😊 (Friendly tone)";
  }

  // Create mock reply only if user message exists
  const lastUserMsg =
    incoming && incoming.length ? incoming[incoming.length - 1].content : "";
  if (lastUserMsg.trim()) {
    const reply = {
      id: "a" + Date.now(),
      role: "assistant",
      content: `Mock reply for "${lastUserMsg}"${toneSuffix}`,
      ts: Date.now(),
    };
    conversations[id].push(reply);
  }

  // Auto-generate meaningful title
  meta[id] = meta[id] || {};
  meta[id].systemPrompt = systemPrompt;
  const titleBefore = meta[id].title;
  const newTitle = autoTitleFromMessages(conversations[id]);

  // Only set or update if it's a "New Chat" or still generic
  if (
    !titleBefore ||
    titleBefore === "New Chat" ||
    titleBefore.startsWith("Conversation")
  ) {
    meta[id].title = newTitle;
  }

  res.json({
    conversationId: id,
    messages: conversations[id],
  });
});

// SSE streaming endpoint: token-by-token mock using words split
// SSE streaming endpoint: token-by-token mock using words split
// app.get("/api/chat/sse", (req, res) => {
//   res.set({
//     "Content-Type": "text/event-stream",
//     "Cache-Control": "no-cache",
//     Connection: "keep-alive",
//   });
//   res.flushHeaders && res.flushHeaders();

//   const convId = req.query.conversationId;
//   const prompt = req.query.prompt || "";

//   // Get tone from conversation meta if available
//   const systemPrompt =
//     meta[convId]?.systemPrompt || "Default assistant behavior";
//   let toneSuffix = "";
//   if (systemPrompt === "Be concise and professional") {
//     toneSuffix = " (Concise tone)";
//   } else if (systemPrompt === "Be friendly and casual") {
//     toneSuffix = " 😊 (Friendly tone)";
//   }

//   // Decide reply text based on tone and prompt
//   const replyText = prompt
//     ? `Mocked streaming reply to: "${prompt}"${toneSuffix}`
//     : `Hello! 👋 This is your new chat — how can I help?${toneSuffix}`;

//   const content = replyText.split(" ");

//   let i = 0;
//   const iv = setInterval(() => {
//     if (i >= content.length) {
//       res.write("data: [DONE]\n\n");
//       clearInterval(iv);
//       res.end();
//       return;
//     }
//     res.write("data: " + content[i] + "\n\n");
//     i++;
//   }, 140);

//   req.on("close", () => clearInterval(iv));
// });
// SSE streaming endpoint: token-by-token mock using words split
app.get("/api/chat/sse", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders && res.flushHeaders();

  const convId = req.query.conversationId;
  const prompt = req.query.prompt || "";
  const systemPrompt = req.query.systemPrompt || "Default assistant behavior";

  // Add tone suffix
  let toneSuffix = "";
  if (systemPrompt === "Be concise and professional") {
    toneSuffix = " (Concise tone)";
  } else if (systemPrompt === "Be friendly and casual") {
    toneSuffix = " 😊 (Friendly tone)";
  }

  const replyText = prompt
    ? `Mocked streaming reply to: "${prompt}"${toneSuffix}`
    : "Hello! 👋 This is your new chat — how can I help?";

  const content = replyText.split(" ");
  let i = 0;
  const iv = setInterval(() => {
    if (i >= content.length) {
      res.write("data: [DONE]\n\n");
      clearInterval(iv);
      res.end();
      return;
    }
    res.write("data: " + content[i] + "\n\n");
    i++;
  }, 140);

  req.on("close", () => clearInterval(iv));
});

// Conversations list
app.get("/api/conversations", (req, res) => {
  const list = Object.keys(conversations)
    .map((id) => {
      const msgs = conversations[id] || [];
      const last = msgs.slice(-1)[0];
      return {
        id,
        title: meta[id]?.title || "Conversation " + id,
        last: last ? last.content.slice(0, 60) : "",
        ts: last ? last.ts : null,
      };
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  res.json(list);
});

// Fetch conversation
app.get("/api/conversations/:id", (req, res) => {
  res.json(conversations[req.params.id] || []);
});

// Set/generate title
app.post("/api/conversations/:id/title", (req, res) => {
  const id = req.params.id;
  meta[id] = meta[id] || {};
  meta[id].title =
    req.body.title || autoTitleFromMessages(conversations[id] || []);
  res.json({ title: meta[id].title });
});

// Upload endpoint - .txt extraction and pdf via pdf-parse
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  const path = req.file.path;
  const filename = req.file.originalname;
  try {
    if (filename.endsWith(".txt") || req.file.mimetype === "text/plain") {
      const txt = fs.readFileSync(path, "utf8");
      return res.json({ attachmentId: req.file.filename, text: txt, filename });
    } else if (
      filename.endsWith(".pdf") ||
      req.file.mimetype === "application/pdf"
    ) {
      const data = fs.readFileSync(path);
      try {
        const parsed = await pdf(data);
        return res.json({
          attachmentId: req.file.filename,
          text: parsed.text || "",
          filename,
        });
      } catch (err) {
        return res.json({
          attachmentId: req.file.filename,
          text: "[PDF extraction failed: " + err.message + "]",
          filename,
        });
      }
    } else {
      return res.json({ attachmentId: req.file.filename, text: "", filename });
    }
  } finally {
    // clean up uploaded file
    setTimeout(() => {
      try {
        fs.unlinkSync(path);
      } catch {}
    }, 20000);
  }
});

app.listen(PORT, () => console.log("Server listening on", PORT));

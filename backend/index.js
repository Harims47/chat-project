const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const pdf = require("pdf-parse");

const app = express();
const upload = multer({ dest: "uploads/" });

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ✅ In-memory store structured per user
// conversations[userId] = { conversationId: [messages] }
const conversations = {};
const meta = {}; // meta[userId][conversationId] = { title, systemPrompt }

// ✅ Helper: Generate smart auto-title from messages
function autoTitleFromMessages(msgs) {
  const firstUser = msgs.find((m) => m.role === "user");
  if (!firstUser || !firstUser.content.trim()) return "New Chat";

  const text = firstUser.content.toLowerCase();

  if (text.includes("hello") || text.includes("hi") || text.includes("hey"))
    return "Casual Greeting";
  if (text.includes("react") || text.includes(".net") || text.includes("api"))
    return "Technical Discussion";
  if (text.includes("travel") || text.includes("trip"))
    return "Travel Planning";
  if (text.includes("music") || text.includes("movie"))
    return "Entertainment Chat";
  if (text.includes("plan") || text.includes("task")) return "Work Planning";

  const capitalized = text.split(" ").slice(0, 3).join(" ");
  return capitalized.charAt(0).toUpperCase() + capitalized.slice(1) + " Chat";
}

/* =====================================================
   📩 POST /api/chat → Create or Continue Conversation
===================================================== */
app.post("/api/chat", (req, res) => {
  const {
    userId,
    conversationId,
    messages: incoming = [],
    systemPrompt,
  } = req.body;

  if (!userId) return res.status(400).json({ error: "Missing userId" });

  // ensure user store exists
  if (!conversations[userId]) {
    conversations[userId] = {};
    meta[userId] = {};
  }

  const id = conversationId || "c_" + Date.now();
  conversations[userId][id] = conversations[userId][id] || [];

  if (Array.isArray(incoming) && incoming.length)
    conversations[userId][id].push(...incoming);

  // apply tone to mock reply
  let toneSuffix = "";
  if (systemPrompt === "Be concise and professional")
    toneSuffix = " (Concise tone)";
  else if (systemPrompt === "Be friendly and casual")
    toneSuffix = " 😊 (Friendly tone)";

  // mock assistant reply
  const lastUserMsg = incoming.at(-1)?.content || "";
  // if (lastUserMsg.trim()) {
  //   const reply = {
  //     id: "a" + Date.now(),
  //     role: "assistant",
  //     content: `Mocked streaming reply to: "${lastUserMsg}"${toneSuffix}`,
  //     ts: Date.now(),
  //   };
  //   conversations[userId][id].push(reply);
  // }

  // store meta info
  meta[userId][id] = meta[userId][id] || {};
  meta[userId][id].systemPrompt = systemPrompt;
  const newTitle = autoTitleFromMessages(conversations[userId][id]);
  if (!meta[userId][id].title || meta[userId][id].title.startsWith("New"))
    meta[userId][id].title = newTitle;

  res.json({
    conversationId: id,
    messages: conversations[userId][id],
  });
});

/* =====================================================
   🔄 SSE: Stream Mock Reply (token-by-token)
===================================================== */
// app.get("/api/chat/sse", (req, res) => {
//   res.set({
//     "Content-Type": "text/event-stream",
//     "Cache-Control": "no-cache",
//     Connection: "keep-alive",
//   });
//   res.flushHeaders?.();

//   const convId = req.query.conversationId;
//   const prompt = req.query.prompt || "";
//   const systemPrompt = req.query.systemPrompt || "Default assistant behavior";

//   let toneSuffix = "";
//   if (systemPrompt === "Be concise and professional")
//     toneSuffix = " (Concise tone)";
//   else if (systemPrompt === "Be friendly and casual")
//     toneSuffix = " 😊 (Friendly tone)";

//   const replyText = prompt
//     ? `Mocked streaming reply to: "${prompt}"${toneSuffix}`
//     : "Hello! 👋 This is your new chat — how can I help?";

//   const tokens = replyText.split(" ");
//   let i = 0;
//   const stream = setInterval(() => {
//     if (i >= tokens.length) {
//       res.write("data: [DONE]\n\n");
//       clearInterval(stream);
//       res.end();
//       return;
//     }
//     res.write(`data: ${tokens[i]}\n\n`);
//     i++;
//   }, 120);

//   req.on("close", () => clearInterval(stream));
// });

app.get("/api/chat/sse", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  const { conversationId, userId, prompt = "", systemPrompt } = req.query;
  if (!userId || !conversationId) {
    res.write("data: [ERROR] Missing userId or conversationId\n\n");
    return res.end();
  }

  const toneSuffix =
    systemPrompt === "Be concise and professional"
      ? " (Concise tone)"
      : systemPrompt === "Be friendly and casual"
      ? " 😊 (Friendly tone)"
      : "";

  const replyText = prompt
    ? `Mocked streaming reply to: "${prompt}"${toneSuffix}`
    : "Hello! 👋 This is your new chat — how can I help?";

  const words = replyText.split(" ");
  let streamed = "";
  let i = 0;

  const interval = setInterval(() => {
    if (i >= words.length) {
      // ✅ when stream ends, persist full assistant message
      // const reply = {
      //   id: "a" + Date.now(),
      //   role: "assistant",
      //   content: streamed.trim(),
      //   ts: Date.now(),
      // };
      // conversations[userId] = conversations[userId] || {};
      // conversations[userId][conversationId] =
      //   conversations[userId][conversationId] || [];
      // conversations[userId][conversationId].push(reply);

      // console.log(`💾 Saved assistant reply for ${userId}/${conversationId}`);
      conversations[userId] = conversations[userId] || {};
      conversations[userId][conversationId] =
        conversations[userId][conversationId] || [];

      // ✅ If last assistant message already exists for same user prompt, replace it
      const lastMsg =
        conversations[userId][conversationId][
          conversations[userId][conversationId].length - 1
        ];

      if (lastMsg && lastMsg.role === "assistant") {
        lastMsg.content = streamed.trim();
        lastMsg.ts = Date.now();
      } else {
        conversations[userId][conversationId].push({
          id: "a" + Date.now(),
          role: "assistant",
          content: streamed.trim(),
          ts: Date.now(),
        });
      }

      console.log(
        `💾 Saved/Updated assistant reply for ${userId}/${conversationId}`
      );

      res.write("data: [DONE]\n\n");
      clearInterval(interval);
      res.end();
      return;
    }

    streamed += " " + words[i];
    res.write(`data: ${words[i]}\n\n`);
    i++;
  }, 120);

  req.on("close", () => clearInterval(interval));
});

/* =====================================================
   📜 GET /api/conversations → List User Conversations
===================================================== */
app.get("/api/conversations", (req, res) => {
  const userId = req.query.userId;
  if (!userId || !conversations[userId]) return res.json([]);

  const list = Object.keys(conversations[userId])
    .map((id) => {
      const msgs = conversations[userId][id] || [];
      const last = msgs.at(-1);
      return {
        id,
        title: meta[userId][id]?.title || "Conversation",
        last: last ? last.content.slice(0, 60) : "",
        ts: last ? last.ts : null,
      };
    })
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  res.json(list);
});

/* =====================================================
   💬 GET /api/conversations/:id → Fetch Messages
===================================================== */
app.get("/api/conversations/:id", (req, res) => {
  const { userId } = req.query;
  const { id } = req.params;

  if (!userId || !conversations[userId]) return res.json([]);
  res.json(conversations[userId][id] || []);
});

/* =====================================================
   🏷️ POST /api/conversations/:id/title → Update Title
===================================================== */
app.post("/api/conversations/:id/title", (req, res) => {
  const { userId } = req.body;
  const id = req.params.id;
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  meta[userId][id] = meta[userId][id] || {};
  meta[userId][id].title =
    req.body.title || autoTitleFromMessages(conversations[userId][id] || []);
  res.json({ title: meta[userId][id].title });
});

/* =====================================================
   📎 POST /api/upload → Handle .txt and .pdf Uploads
===================================================== */
app.post("/api/upload", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const filePath = req.file.path;
  const filename = req.file.originalname;
  try {
    if (filename.endsWith(".txt")) {
      const text = fs.readFileSync(filePath, "utf8");
      return res.json({ attachmentId: req.file.filename, text, filename });
    }

    if (filename.endsWith(".pdf")) {
      const buffer = fs.readFileSync(filePath);
      const parsed = await pdf(buffer);
      return res.json({
        attachmentId: req.file.filename,
        text: parsed.text || "",
        filename,
      });
    }

    return res.json({
      attachmentId: req.file.filename,
      text: "",
      filename,
    });
  } finally {
    setTimeout(() => fs.unlink(filePath, () => {}), 10000);
  }
});

/* =====================================================
   🧹 POST /api/clear → Clear All Conversations (dev)
===================================================== */
app.post("/api/clear", (req, res) => {
  Object.keys(conversations).forEach((u) => delete conversations[u]);
  Object.keys(meta).forEach((u) => delete meta[u]);
  res.json({ status: "✅ All user conversations cleared." });
});

app.listen(PORT, () =>
  console.log(`🚀 Backend running on http://localhost:${PORT}`)
);

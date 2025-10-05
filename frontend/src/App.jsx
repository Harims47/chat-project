import React, { useState, useEffect, useRef } from "react";
import { Copy, RefreshCcw } from "lucide-react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";

// ✅ Generate unique user ID once per browser
if (!localStorage.getItem("userId")) {
  localStorage.setItem(
    "userId",
    "u_" + Date.now() + "_" + Math.random().toString(36).slice(2)
  );
}
const USER_ID = localStorage.getItem("userId");

// ✅ Mock replies fallback
const MOCK_REPLIES = [
  "Hello! 👋 This is a mock assistant reply.",
  "Sure, here’s a predefined answer from mock data.",
  "This chat is stored locally per conversation.",
  "That's interesting — tell me more!",
  "Mock reply: your system is working fine locally!",
];

// ✅ Welcome prompts for new chats
const WELCOME_MESSAGES = [
  "What’s on your mind today?",
  "Hey there 👋, what can I help you with today?",
  "Ready to brainstorm something awesome?",
  "Got a question or idea? Let’s talk!",
  "Welcome back! What shall we explore this time?",
  "Let’s dive into something new 💡",
  "Your thoughts, my responses — what’s next?",
  "Start typing to begin a new conversation 📝",
  "Need help or just exploring? I’m all ears 👂",
  "What would you like to discuss today?",
];

function useLocal(key, initial) {
  const [state, setState] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState];
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString();
}

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useLocal("activeConv", null);
  const [messages, setMessages] = useLocal("msgs-" + (active || "none"), []);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [theme, setTheme] = useLocal("theme", "light");
  const [showPalette, setShowPalette] = useState(false);
  const [systemPrompt, setSystemPrompt] = useLocal(
    "sysPrompt",
    "Default assistant behavior"
  );
  const [welcomeMsg, setWelcomeMsg] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredConversations = conversations
    .filter(
      (c) =>
        c.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.last.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const scrollRef = useRef();
  const sseRef = useRef(null);
  const manualScrollRef = useRef(false);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 768);

  useEffect(() => {
    const setVh = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty("--vh", `${vh}px`);
    };
    setVh();
    window.addEventListener("resize", setVh);
    return () => window.removeEventListener("resize", setVh);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setSidebarOpen(window.innerWidth >= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // ✅ Fetch conversations for this user
  useEffect(() => {
    fetch(API + "/api/conversations?userId=" + USER_ID)
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => setConversations([]));
  }, []);

  // ✅ Load messages when conversation changes
  useEffect(() => {
    if (!active) return;
    const stored = JSON.parse(localStorage.getItem("msgs-" + active));
    if (stored) setMessages(stored);
    else setMessages([]);

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

    fetch(API + "/api/conversations/" + active + "?userId=" + USER_ID)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data);
        localStorage.setItem("msgs-" + active, JSON.stringify(data));
      })
      .catch(() => setMessages([]));
  }, [active]);

  // ✅ Scroll persistence
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = () => {
      manualScrollRef.current =
        Math.abs(el.scrollHeight - (el.scrollTop + el.clientHeight)) > 200;
      localStorage.setItem("scroll-" + (active || "none"), el.scrollTop);
    };
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, [active]);

  // ✅ Keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette((prev) => {
          const newVal = !prev;
          if (!prev) setSearchTerm("");
          return newVal;
        });
      }
      if (e.key === "Escape") {
        setShowPalette(false);
        document.activeElement.blur();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  function retry(msg) {
    const idx = messages.findIndex((m) => m.id === msg.id);
    if (idx > 0) {
      // Find previous user message before this assistant reply
      const prevUserMsg = [...messages]
        .slice(0, idx)
        .reverse()
        .find((m) => m.role === "user");

      if (prevUserMsg) {
        // Remove only the assistant message being retried
        const updatedMsgs = messages.filter((m) => m.id !== msg.id);
        setMessages(updatedMsgs);
        localStorage.setItem(
          "msgs-" + (active || "none"),
          JSON.stringify(updatedMsgs)
        );

        // Start retry streaming immediately (no stuck text)
        setStreaming(true);
        connectSSE(prevUserMsg.content || systemPrompt);
      }
    }
  }

  // ✅ SSE connection
  // function connectSSE(prompt, convId = active) {
  //   if (sseRef.current) {
  //     sseRef.current.close();
  //     sseRef.current = null;
  //     setStreaming(false);
  //   }
  //   setStreaming(true);
  //   try {
  //     const url = new URL(API + "/api/chat/sse");
  //     //url.searchParams.set("conversationId", active || "");
  //     url.searchParams.set("prompt", prompt);
  //     url.searchParams.set("systemPrompt", systemPrompt);
  //     // url.searchParams.set("userId", USER_ID);

  //     url.searchParams.set("conversationId", convId || "");
  //     url.searchParams.set("userId", USER_ID);

  //     const es = new EventSource(url.toString());
  //     sseRef.current = es;

  //     const assistantId = "a" + Date.now();
  //     setMessages((prev) => {
  //       const next = [
  //         ...prev,
  //         { id: assistantId, role: "assistant", content: "", ts: Date.now() },
  //       ];
  //       localStorage.setItem(
  //         "msgs-" + (active || "none"),
  //         JSON.stringify(next)
  //       );
  //       return next;
  //     });

  //     es.onmessage = (ev) => {
  //       if (ev.data === "[DONE]") {
  //         setStreaming(false);
  //         es.close();
  //         sseRef.current = null;
  //         return;
  //       }
  //       setMessages((prev) => {
  //         const last = prev[prev.length - 1];
  //         if (last && last.role === "assistant") {
  //           const updated = { ...last, content: last.content + " " + ev.data };
  //           const next = [...prev.slice(0, -1), updated];
  //           localStorage.setItem(
  //             "msgs-" + (active || "none"),
  //             JSON.stringify(next)
  //           );
  //           return next;
  //         }
  //         return prev;
  //       });
  //       const el = scrollRef.current;
  //       if (el && !manualScrollRef.current) el.scrollTop = el.scrollHeight;
  //     };

  //     es.onerror = () => {
  //       setStreaming(false);
  //       try {
  //         es.close();
  //       } catch {}
  //       sseRef.current = null;
  //     };
  //   } catch {
  //     const reply =
  //       MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)];
  //     const mockMsg = {
  //       id: "a" + Date.now(),
  //       role: "assistant",
  //       content: reply,
  //       ts: Date.now(),
  //     };
  //     setMessages((prev) => {
  //       const next = [...prev, mockMsg];
  //       localStorage.setItem(
  //         "msgs-" + (active || "none"),
  //         JSON.stringify(next)
  //       );
  //       return next;
  //     });
  //     setStreaming(false);
  //   }
  // }
  function connectSSE(prompt, convId) {
    const conversationId = convId || active;
    const userId = USER_ID;

    if (!conversationId || !userId) {
      console.warn("Missing conversationId or userId for SSE", {
        conversationId,
        userId,
      });
      return;
    }

    // Close existing SSE if any
    if (sseRef.current) {
      try {
        sseRef.current.close();
      } catch {}
      sseRef.current = null;
      setStreaming(false);
    }

    setStreaming(true);

    try {
      const url = new URL(API + "/api/chat/sse");
      url.searchParams.set("conversationId", conversationId);
      url.searchParams.set("userId", userId);
      url.searchParams.set("prompt", prompt || "");
      url.searchParams.set("systemPrompt", systemPrompt || "");

      const es = new EventSource(url.toString());
      sseRef.current = es;

      // placeholder assistant bubble
      const assistantId = "a" + Date.now();
      setMessages((prev) => {
        const next = [
          ...prev,
          { id: assistantId, role: "assistant", content: "", ts: Date.now() },
        ];
        localStorage.setItem("msgs-" + conversationId, JSON.stringify(next));
        return next;
      });

      es.onmessage = (ev) => {
        if (ev.data === "[DONE]") {
          setStreaming(false);
          try {
            es.close();
          } catch {}
          sseRef.current = null;
          return;
        }

        setMessages((prev) => {
          if (!prev.length) return prev;
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant") return prev;
          const updated = {
            ...last,
            content: (last.content ? last.content + " " : "") + ev.data,
          };
          const next = [...prev.slice(0, -1), updated];
          localStorage.setItem("msgs-" + conversationId, JSON.stringify(next));
          return next;
        });

        const el = scrollRef.current;
        if (el && !manualScrollRef.current) el.scrollTop = el.scrollHeight;
      };

      es.onerror = () => {
        setStreaming(false);
        try {
          es.close();
        } catch {}
        sseRef.current = null;
      };
    } catch (err) {
      // fallback if SSE fails
      const reply =
        MOCK_REPLIES[Math.floor(Math.random() * MOCK_REPLIES.length)];
      const mockMsg = {
        id: "a" + Date.now(),
        role: "assistant",
        content: reply,
        ts: Date.now(),
      };
      setMessages((prev) => {
        const next = [...prev, mockMsg];
        localStorage.setItem(
          "msgs-" + (convId || active || "none"),
          JSON.stringify(next)
        );
        return next;
      });
      setStreaming(false);
    }
  }

  function stopStreaming() {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
    setStreaming(false);
  }

  // ✅ Send message
  // async function send(manualRetry = false) {
  //   const hasText = !!input.trim();
  //   const hasAttachments = attachments.length > 0;
  //   if (!hasText && !hasAttachments && !manualRetry) return;

  //   let content = input.trim();
  //   if (!content && hasAttachments) {
  //     content = `Uploaded file: ${attachments
  //       .map((a) => a.filename || a.attachmentId)
  //       .join(", ")}`;
  //   }

  //   const userMsg = {
  //     id: "u" + Date.now(),
  //     role: "user",
  //     content,
  //     ts: Date.now(),
  //     attachments: attachments.map((a) => a.attachmentId),
  //   };

  //   const nextMsgs = [...messages, userMsg];
  //   setMessages(nextMsgs);

  //   if (active)
  //     localStorage.setItem("msgs-" + active, JSON.stringify(nextMsgs));

  //   setInput("");
  //   setAttachments([]);

  //   // if (!active) {
  //   //   try {
  //   //     const r = await fetch(API + "/api/chat", {
  //   //       method: "POST",
  //   //       headers: { "Content-Type": "application/json" },
  //   //       body: JSON.stringify({
  //   //         userId: USER_ID,
  //   //         messages: [userMsg],
  //   //         systemPrompt,
  //   //       }),
  //   //     });
  //   //     const data = await r.json();
  //   //     if (data.conversationId) {
  //   //       setActive(data.conversationId);
  //   //       localStorage.setItem(
  //   //         "msgs-" + data.conversationId,
  //   //         JSON.stringify(nextMsgs)
  //   //       );
  //   //       connectSSE(content || systemPrompt);
  //   //     }
  //   //   } catch (err) {
  //   //     console.error("Failed to create conversation:", err);
  //   //   }
  //   //   return;
  //   // }
  //   if (!active) {
  //     try {
  //       const r = await fetch(API + "/api/chat", {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({
  //           userId: USER_ID,
  //           conversationId: null,
  //           messages: [userMsg],
  //           attachments: userMsg.attachments,
  //           systemPrompt,
  //         }),
  //       });
  //       const data = await r.json();

  //       if (data.conversationId) {
  //         setActive(data.conversationId);

  //         // ✅ Save locally
  //         localStorage.setItem(
  //           "msgs-" + data.conversationId,
  //           JSON.stringify(nextMsgs)
  //         );

  //         // ✅ Start streaming reply only *after* we got valid conversationId
  //         connectSSE(userMsg.content || systemPrompt);
  //       }
  //     } catch (err) {
  //       console.error("Failed to create conversation:", err);
  //     }
  //     return;
  //   }

  //   try {
  //     await fetch(API + "/api/chat", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({
  //         userId: USER_ID,
  //         conversationId: active,
  //         messages: [userMsg],
  //         systemPrompt,
  //       }),
  //     });
  //   } catch (err) {
  //     console.error("Failed to send chat:", err);
  //   }

  //   connectSSE(content || systemPrompt);
  // }

  async function send(manualRetry = false) {
    const hasText = !!input.trim();
    const hasAttachments = attachments.length > 0;
    if (!hasText && !hasAttachments && !manualRetry) return;

    let content = input.trim();
    if (!content && hasAttachments) {
      content = `Uploaded file: ${attachments
        .map((a) => a.filename || a.attachmentId)
        .join(", ")}`;
    }

    const userMsg = {
      id: "u" + Date.now(),
      role: "user",
      content,
      ts: Date.now(),
      attachments: attachments.map((a) => a.attachmentId),
    };

    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);
    setInput("");
    setAttachments([]);

    // ✅ Case 1: Continue existing conversation
    if (active) {
      localStorage.setItem("msgs-" + active, JSON.stringify(nextMsgs));
      try {
        await fetch(API + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: USER_ID,
            conversationId: active,
            messages: [userMsg],
            attachments: userMsg.attachments,
            systemPrompt,
          }),
        });
        connectSSE(userMsg.content || systemPrompt, active);
      } catch (err) {
        console.error("Send failed:", err);
      }
      return;
    }

    // ✅ Case 2: Start a new conversation
    try {
      const r = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: USER_ID,
          messages: [userMsg],
          attachments: userMsg.attachments,
          systemPrompt,
        }),
      });
      const data = await r.json();

      if (data?.conversationId) {
        const newId = data.conversationId;
        setActive(newId);
        localStorage.setItem("msgs-" + newId, JSON.stringify(nextMsgs));

        // ✅ Important: Wait a moment before streaming
        setTimeout(() => {
          connectSSE(userMsg.content || systemPrompt, newId);
        }, 150); // short delay ensures backend setup complete
      }
    } catch (err) {
      console.error("Failed to create conversation:", err);
    }
  }

  // ✅ File upload handler (.txt/.pdf only)
  function onFileChange(e) {
    const f = e.target.files[0];
    if (!f) return;

    const validTypes = ["text/plain", "application/pdf"];
    const validExts = [".txt", ".pdf"];
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    if (!validTypes.includes(f.type) && !validExts.includes(ext)) {
      alert("Only .txt and .pdf files are allowed.");
      e.target.value = "";
      return;
    }

    const form = new FormData();
    form.append("file", f);
    fetch(API + "/api/upload", { method: "POST", body: form })
      .then((r) => r.json())
      .then((data) => {
        if (data.attachmentId) {
          setAttachments((prev) => [...prev, data]);
        }
      })
      .catch(() => {});
    e.target.value = "";
  }

  // ✅ Create new chat
  const handleNewConversation = async () => {
    try {
      const res = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: USER_ID,
          messages: [],
        }),
      });
      const data = await res.json();
      if (data.conversationId) {
        setMessages([]);
        setWelcomeMsg(
          WELCOME_MESSAGES[Math.floor(Math.random() * WELCOME_MESSAGES.length)]
        );
        setActive(data.conversationId);
        localStorage.setItem("msgs-" + data.conversationId, JSON.stringify([]));
        const updated = await fetch(
          API + "/api/conversations?userId=" + USER_ID
        ).then((r) => r.json());
        setConversations(updated);
      }
    } catch (err) {
      console.error("Error creating new conversation:", err);
    } finally {
      setShowPalette(false);
      if (window.innerWidth < 768) setSidebarOpen(false);
    }
  };

  // ✅ UI rendering
  return (
    <div className="h-screen flex flex-col md:flex-row bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* SIDEBAR */}
      {sidebarOpen && (
        <aside className="w-full md:w-80 border-r p-2 bg-white dark:bg-gray-800 absolute md:relative h-full md:h-auto z-20">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Chats</h2>
            <div className="flex items-center gap-2">
              <select
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                className="text-sm p-1 rounded bg-gray-100 dark:bg-gray-700">
                <option value="Default assistant behavior">Default</option>
                <option value="Be concise and professional">Concise</option>
                <option value="Be friendly and casual">Friendly</option>
              </select>
              <button
                onClick={() =>
                  setTheme((t) => (t === "light" ? "dark" : "light"))
                }
                title="Toggle theme"
                className="px-2 py-1 rounded bg-gray-200 dark:bg-gray-700">
                {theme === "light" ? "🌙" : "☀️"}
              </button>
            </div>
            <button
              className="md:hidden px-2 py-1 text-gray-500 dark:text-gray-300"
              onClick={() => setSidebarOpen(false)}>
              ✕
            </button>
          </div>

          <button
            className="block w-full text-left p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded mb-2"
            onClick={handleNewConversation}>
            ➕ Create new conversation
          </button>

          <div
            className="space-y-2 overflow-auto"
            style={{ maxHeight: "calc(100vh - 140px)" }}>
            {conversations.map((c) => (
              <div
                key={c.id}
                onClick={() => {
                  setActive(c.id);
                  if (window.innerWidth < 768) setSidebarOpen(false);
                }}
                className={`p-2 rounded cursor-pointer ${
                  active === c.id
                    ? "bg-gray-200 dark:bg-gray-700"
                    : "hover:bg-gray-100 dark:hover:bg-gray-700"
                }`}>
                <div className="flex justify-between">
                  <div className="font-semibold">{c.title}</div>
                  <div className="text-xs text-gray-500">
                    {c.ts ? new Date(c.ts).toLocaleTimeString() : ""}
                  </div>
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {c.last}
                </div>
              </div>
            ))}
          </div>
        </aside>
      )}
      {!sidebarOpen && (
        <button
          className="md:hidden fixed top-3 left-3 z-30 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-100 px-3 py-1 rounded"
          onClick={() => setSidebarOpen(true)}>
          ☰
        </button>
      )}

      {/* MAIN CHAT AREA */}
      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 dark:text-gray-400">
              <div className="text-lg font-medium mb-2">
                {welcomeMsg || "What’s on your mind today?"}
              </div>
              <div className="text-sm">
                Start typing below to begin a new chat 💬
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`max-w-[70%] my-2 p-3 rounded ${
                  m.role === "user"
                    ? "ml-auto bg-blue-600 text-white"
                    : "bg-gray-200 dark:bg-gray-800"
                }`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                <div className="flex justify-between items-center mt-2 text-xs text-white-500">
                  <div>{formatTime(m.ts)}</div>
                  <div className="flex gap-3 items-center">
                    <button
                      onClick={() => navigator.clipboard.writeText(m.content)}
                      title="Copy message"
                      className="text-white hover:text-blue-500 transition-colors">
                      <Copy size={14} />
                    </button>
                    {m.role === "assistant" && (
                      <button
                        onClick={() => retry(m)}
                        title="Retry"
                        className="text-white hover:text-green-500 transition-colors">
                        <RefreshCcw size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}

          {streaming && (
            <div className="italic text-sm">
              Assistant is typing...{" "}
              <button onClick={stopStreaming} className="ml-2 underline">
                Stop
              </button>
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="p-4 border-t bg-white dark:bg-gray-800">
          <div className="flex flex-wrap gap-2 items-center mb-2">
            {attachments.map((a) => (
              <div
                key={a.attachmentId}
                className="flex items-center gap-2 px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded-full">
                <span className="text-sm">{a.filename || a.attachmentId}</span>
                <button
                  onClick={() =>
                    setAttachments((prev) =>
                      prev.filter((x) => x.attachmentId !== a.attachmentId)
                    )
                  }
                  className="text-gray-500 hover:text-red-500 transition-colors"
                  title="Remove file">
                  ✕
                </button>
              </div>
            ))}
          </div>

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={3}
            className="w-full p-2 rounded resize-none bg-gray-50 dark:bg-gray-900"
            placeholder="Type a message (Enter to send, Shift+Enter newline)"
          />

          <div className="mt-2 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <label className="px-2 py-1 border rounded cursor-pointer bg-gray-100 dark:bg-gray-700">
                Attach
                <input
                  type="file"
                  accept=".txt,.pdf"
                  onChange={onFileChange}
                  style={{ display: "none" }}
                />
              </label>
              <button
                onClick={() => send()}
                className="px-4 py-2 rounded bg-blue-600 text-white">
                Send
              </button>
            </div>
            <div className="text-sm text-gray-500">
              Press <kbd>Ctrl/Cmd</kbd>+<kbd>K</kbd> for commands
            </div>
          </div>
        </div>
      </main>

      {showPalette && (
        <div
          className="fixed inset-0 flex items-start justify-center pt-24 bg-black/40"
          onClick={() => setShowPalette(false)}>
          <div
            className="bg-white dark:bg-gray-800 border rounded w-96 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm font-semibold">Command Palette</div>
              <button
                onClick={() => setShowPalette(false)}
                className="text-gray-500 hover:text-gray-300 text-lg">
                ✕
              </button>
            </div>

            {/* 🔍 Search input */}
            <input
              type="text"
              placeholder="Search conversations or type a command..."
              className="w-full mb-3 p-2 rounded bg-gray-100 dark:bg-gray-700 text-sm"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />

            {/* 💬 Filtered chat list */}
            <div className="max-h-60 overflow-auto mb-3">
              {filteredConversations.length > 0 ? (
                filteredConversations.map((c) => (
                  <div
                    key={c.id}
                    onClick={() => {
                      setActive(c.id);
                      setMessages(
                        JSON.parse(localStorage.getItem("msgs-" + c.id)) || []
                      );
                      setShowPalette(false);
                    }}
                    className={`p-2 rounded cursor-pointer ${
                      active === c.id
                        ? "bg-gray-200 dark:bg-gray-700"
                        : "hover:bg-gray-100 dark:hover:bg-gray-700"
                    }`}>
                    <div className="font-semibold">{c.title}</div>
                    <div className="text-xs text-gray-500">{c.last}</div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-gray-500 text-center">
                  No conversations found
                </div>
              )}
            </div>

            {/* ⚙️ Commands */}
            <button
              className="block w-full text-left p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded mb-2"
              onClick={handleNewConversation}>
              ➕ Create new conversation
            </button>

            <button
              className="block w-full text-left p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              onClick={() => {
                setTheme((t) => (t === "light" ? "dark" : "light"));
                setShowPalette(false);
              }}>
              🌗 Toggle theme
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from "react";
import { Copy, RefreshCcw } from "lucide-react";

const API = import.meta.env.VITE_API_BASE || "http://localhost:4000";

const MOCK_REPLIES = [
  "Hello! 👋 This is a mock assistant reply.",
  "Sure, here’s a predefined answer from mock data.",
  "This chat is stored locally per conversation.",
  "That's interesting — tell me more!",
  "Mock reply: your system is working fine locally!",
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
  const [search, setSearch] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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

  // Fetch conversations on load
  useEffect(() => {
    fetch(API + "/api/conversations")
      .then((r) => r.json())
      .then(setConversations)
      .catch(() => setConversations([]));
  }, []);

  // Load active messages if active set changed
  // Load active messages from backend when a conversation is opened
  useEffect(() => {
    if (!active) return;
    const stored = JSON.parse(localStorage.getItem("msgs-" + active));
    if (stored) setMessages(stored);
    else setMessages([]);

    // ✅ Auto-scroll to bottom always on chat switch
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });

    fetch(API + "/api/conversations/" + active)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data);
        // persist locally for quick reload
        localStorage.setItem("msgs-" + active, JSON.stringify(data));
      })
      .catch((err) => {
        console.error("Error loading chat:", err);
        setMessages([]);
      });
  }, [active]);

  // persist scroll position per conversation
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

  // keyboard shortcuts
  useEffect(() => {
    const h = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette((prev) => {
          const newVal = !prev;
          if (!prev) setSearchTerm(""); // ✅ Clear search every time palette opens
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

  function connectSSE(prompt) {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
      setStreaming(false);
    }
    setStreaming(true);
    try {
      const url = new URL(API + "/api/chat/sse");
      url.searchParams.set("conversationId", active || "");
      url.searchParams.set("prompt", prompt);
      url.searchParams.set("systemPrompt", systemPrompt);

      const es = new EventSource(url.toString());
      sseRef.current = es;

      // placeholder assistant message
      const assistantId = "a" + Date.now();
      setMessages((prev) => {
        const next = [
          ...prev,
          { id: assistantId, role: "assistant", content: "", ts: Date.now() },
        ];
        localStorage.setItem(
          "msgs-" + (active || "none"),
          JSON.stringify(next)
        );
        return next;
      });

      es.onmessage = (ev) => {
        if (ev.data === "[DONE]") {
          setStreaming(false);
          es.close();
          sseRef.current = null;
          return;
        }
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant") {
            const updated = { ...last, content: last.content + " " + ev.data };
            const next = [...prev.slice(0, -1), updated];
            localStorage.setItem(
              "msgs-" + (active || "none"),
              JSON.stringify(next)
            );
            return next;
          }
          return prev;
        });
        const el = scrollRef.current;
        if (el && !manualScrollRef.current) {
          el.scrollTop = el.scrollHeight;
        }
      };

      es.onerror = () => {
        setStreaming(false);
        try {
          es.close();
        } catch {}
        sseRef.current = null;
      };
    } catch (err) {
      // 🔹 If backend SSE fails, fallback mock reply
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
          "msgs-" + (active || "none"),
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

  // Replace your existing send(...) with this
  async function send(manualRetry = false) {
    const hasText = !!input.trim();
    const hasAttachments = attachments.length > 0;

    // nothing to send
    if (!hasText && !hasAttachments && !manualRetry) return;

    // Always fallback for files — don't extract text
    let content = input.trim();
    if (!content && hasAttachments) {
      content = `Uploaded file: ${attachments
        .map((a) => a.filename || a.attachmentId)
        .join(", ")}`;
    }

    // Create user message object
    const userMsg = {
      id: "u" + Date.now(),
      role: "user",
      content,
      ts: Date.now(),
      attachments: attachments.map((a) => a.attachmentId),
    };

    // Add message locally and persist
    const nextMsgs = [...messages, userMsg];
    setMessages(nextMsgs);

    if (active) {
      localStorage.setItem("msgs-" + active, JSON.stringify(nextMsgs));
    }

    // Clear UI input and attachments after message created
    setInput("");
    setAttachments([]);

    // If there's no active conversation, create one first
    if (!active) {
      try {
        const r = await fetch(API + "/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: active,
            messages: [userMsg],
            attachments: userMsg.attachments,
            systemPrompt,
          }),
        });
        const data = await r.json();
        if (data.conversationId) {
          setActive(data.conversationId);
          localStorage.setItem(
            "msgs-" + data.conversationId,
            JSON.stringify(nextMsgs)
          );
        }
      } catch (err) {
        console.error("Failed to create conversation:", err);
      }
      connectSSE(content || systemPrompt);
      return;
    }

    // Continue existing chat
    try {
      const r = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: active,
          messages: [userMsg],
          attachments: userMsg.attachments,
          systemPrompt,
        }),
      });
      const data = await r.json();
      if (data.conversationId && !active) {
        setActive(data.conversationId);
      }
    } catch (err) {
      console.error("Failed to send chat:", err);
    }

    // Stream mock reply
    connectSSE(content || systemPrompt);
  }

 function onFileChange(e) {
   const f = e.target.files[0];
   if (!f) return;

   const validTypes = ["text/plain", "application/pdf"];
   const validExts = [".txt", ".pdf"];

   // Client-side validation
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


  function copyText(text) {
    navigator.clipboard.writeText(text);
  }

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

  async function setTitleManual(id, title) {
    await fetch(API + "/api/conversations/" + id + "/title", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    // refresh list
    fetch(API + "/api/conversations")
      .then((r) => r.json())
      .then(setConversations);
  }

  // when messages change, update conversations list preview
  useEffect(() => {
    if (!active) return;
    const last = messages[messages.length - 1];
    setConversations((prev) => {
      const idx = prev.findIndex((c) => c.id === active);
      const entry = {
        id: active,
        title: prev[idx]?.title || "Conversation",
        last: last?.content?.slice(0, 60),
        ts: last?.ts || Date.now(),
      };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = entry;
        return copy;
      }
      return [entry, ...prev];
    });
  }, [messages, active]);

  const handleNewConversation = async () => {
    try {
      const res = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      });
      const data = await res.json();

      if (data.conversationId) {
        // ✅ Clear any previous active chat
        setMessages([]);
        setActive(data.conversationId);

        // ✅ Store clean state locally
        localStorage.setItem("msgs-" + data.conversationId, JSON.stringify([]));

        // ✅ Fetch fresh list (so it appears instantly)
        const updated = await fetch(API + "/api/conversations").then((r) =>
          r.json()
        );
        setConversations(updated);
      }
    } catch (err) {
      console.error("Error creating new conversation:", err);
    } finally {
      setShowPalette(false);
      if (window.innerWidth < 768) setSidebarOpen(false); // close sidebar on mobile
    }
  };

  return (
    <div className="h-screen flex flex-col md:flex-row bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
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
                  if (window.innerWidth < 768) setSidebarOpen(false); // close sidebar after selecting chat
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

      <main className="flex-1 flex flex-col">
        <div className="flex-1 overflow-auto p-4" ref={scrollRef}>
          {messages.map((m) => (
            <div
              key={m.id}
              className={`max-w-[70%] my-2 p-3 rounded ${
                m.role === "user"
                  ? "ml-auto bg-blue-600 text-white"
                  : "bg-gray-200 dark:bg-gray-800"
              }`}>
              <div className="whitespace-pre-wrap">{m.content}</div>
              {/* <div className="flex justify-between items-center mt-2 text-xs text-white-500">
                <div>{formatTime(m.ts)}</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => copyText(m.content)}
                    className="underline">
                    Copy
                  </button>
                  {m.role === "assistant" && (
                    <button onClick={() => retry(m)} className="underline">
                      Retry
                    </button>
                  )}
                </div>
              </div> */}
              <div className="flex justify-between items-center mt-2 text-xs text-white-500">
                <div>{formatTime(m.ts)}</div>
                <div className="flex gap-3 items-center">
                  <button
                    onClick={() => copyText(m.content)}
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
          ))}
          {streaming && (
            <div className="italic text-sm">
              Assistant is typing...{" "}
              <button onClick={stopStreaming} className="ml-2 underline">
                Stop
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t bg-white dark:bg-gray-800">
          {/* <div className="flex gap-2 items-center mb-2">
            {attachments.map((a) => (
              <div
                key={a.attachmentId}
                className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded">
                {a.filename || a.attachmentId}
              </div>
            ))}
          </div> */}
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

      {/* {showPalette && (
        <div className="fixed inset-0 flex items-start justify-center pt-24">
          <div className="bg-white dark:bg-gray-800 border rounded w-96 p-4 shadow-2xl">
            <div className="flex justify-between items-center mb-3">
              <div className="text-sm font-semibold">Command Palette</div>
              <button
                onClick={() => setShowPalette(false)}
                className="text-gray-500 hover:text-gray-800 dark:hover:text-white text-lg font-bold"
                title="Close">
                ×
              </button>
            </div>
            <button
              className="block w-full text-left p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              onClick={() => {
                localStorage.removeItem("msgs-none"); // ✅ clear old temp chat
                fetch(API + "/api/chat", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ messages: [] }),
                })
                  .then((r) => r.json())
                  .then((d) => {
                    if (d.conversationId) {
                      setActive(d.conversationId);
                      localStorage.setItem(
                        "msgs-" + d.conversationId,
                        JSON.stringify([])
                      );
                      setMessages([]);
                    }
                    fetch(API + "/api/conversations")
                      .then((r) => r.json())
                      .then(setConversations);
                  });
                setShowPalette(false);
              }}>
              Create new conversation
            </button>
            <button
              className="block w-full text-left p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded mt-2"
              onClick={() => {
                // toggle theme
                setTheme((t) => (t === "light" ? "dark" : "light"));
                setShowPalette(false);
              }}>
              Toggle theme
            </button>
          </div>
        </div>
      )} */}
    </div>
  );
}

import { useEffect, useState } from "react";
import { apiRequest, loginUser, registerUser } from "./api";
import "./App.css";
import Analytics from "./Analytics";


// Converts a backend conversation record into the shape the UI uses.
function mapConversation(item) {
  return {
    id: item.id,
    name: item.customer_name || "Unknown Customer",
    subject: item.subject || "Customer inquiry",
    preview: item.customer_email || "No messages yet",
    time: "",
    status: item.status?.toLowerCase() === "resolved" ? "Resolved" : "Open",
    initials: (item.customer_name || "UC")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
    color: "violet",
  };
}

export default function App() {
  // ---- Auth state ----
  const [token, setToken] = useState(
    () => sessionStorage.getItem("resolveai_token") || ""
  );
  const [businessId, setBusinessId] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [retryMessage, setRetryMessage] = useState("");

  // ---- Conversation state ----
  const [apiError, setApiError] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [showNewConversation, setShowNewConversation] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerEmail, setNewCustomerEmail] = useState("");
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("All");
  const [activeId, setActiveId] = useState(null);
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState({});

  // ---- Page / analytics state ----
  const [currentPage, setCurrentPage] = useState("conversations");
  const [analyticsData, setAnalyticsData] = useState(null);
  const [workspaceName, setWorkspaceName] = useState("ResolveAI Workspace");
  const [workspaceEmail, setWorkspaceEmail] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");


   // ---- Page / knowledge state ----
   
const [knowledgeEntries, setKnowledgeEntries] = useState([]);
const [knowledgeLoading, setKnowledgeLoading] = useState(false);
const [knowledgeError, setKnowledgeError] = useState("");
const [knowledgeTitle, setKnowledgeTitle] = useState("");

const [knowledgeContent, setKnowledgeContent] = useState("");



  

  // ---------------------------------------------------------------------
  // Auth handlers
  // ---------------------------------------------------------------------
  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthError("");
    setAuthLoading(true);

    try {
      if (authMode === "register") {
        await registerUser(email.trim(), password);
      }

      const result = await loginUser(email.trim(), password);

      if (!result.access_token) {
        throw new Error("Login succeeded, but no access token was returned.");
      }

      sessionStorage.setItem("resolveai_token", result.access_token);
      setToken(result.access_token);
      setPassword("");
    } catch (error) {
      setAuthError(error.message || "Authentication failed. Please try again.");
    } finally {
      setAuthLoading(false);
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("resolveai_token");
    setToken("");
    setPassword("");
    setAuthError("");
    setAuthMode("login");

    // Clear workspace data so it can't flash for the next signed-in user.
    setConversations([]);
    setMessages({});
    setActiveId(null);
    setAnalyticsData(null);
    setAnalyticsError("");
    setApiError("");
    setCurrentPage("conversations");
  }



async function loadWorkspaceName() {
  if (!token) return;

  try {
    const businesses = await apiRequest(
      "/businesses/",
      {},
      token
    );

    if (!Array.isArray(businesses) || businesses.length === 0) {
      setBusinessId("");
      setWorkspaceName("ResolveAI Workspace");
      setWorkspaceEmail("");
      setConversations([]);
      setMessages({});
      setActiveId(null);
      setApiError("No business found. Please create a business first.");
      return;
    }

    // Automatically select the first business accessible to this account.
    const business = businesses[0];

    setBusinessId(String(business.id));
    setWorkspaceName(business.name || "ResolveAI Workspace");
    setWorkspaceEmail(business.email || "");
    setApiError("");
  } catch (error) {
    console.error("Failed to load business:", error);
    setApiError(error.message || "Could not load your business.");
  }
}


  // ---------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------

  // Loads the conversation list. Keeps the current selection if it still
  // exists, otherwise selects the first conversation. Messages for the
  // selected conversation are loaded by the activeId effect below.
  async function loadRealConversations(preferredId) {
    if (!token || !businessId) return;

    setLoadingConversations(true);
    setApiError("");

    try {
      const data = await apiRequest(
        `/businesses/${businessId}/conversations/`,
        {},
        token
      );

      const list = data.map(mapConversation);
      setConversations(list);

      setActiveId((current) => {
        const wanted = preferredId || current;
        if (wanted && list.some((item) => item.id === wanted)) return wanted;
        return list.length > 0 ? list[0].id : null;
      });
    } catch (error) {
      console.error("Failed to load conversations:", error);
      setApiError(error.message || "Could not load conversations.");
    } finally {
      setLoadingConversations(false);
    }
  }

  async function loadRealMessages(conversationId) {
    if (!token || !businessId || !conversationId) return;

    try {
      const data = await apiRequest(
        `/businesses/${businessId}/conversations/${conversationId}/messages`,
        {},
        token
      );

      const realMessages = data.map((item) => ({
        role: item.role === "assistant" ? "assistant" : "customer",
        content: item.content,
        time: item.created_at
          ? new Date(item.created_at).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })
          : "",
      }));

      // Stored under the conversation's own id, so a late response for a
      // previously selected conversation cannot overwrite the current one.
      setMessages((previous) => ({
        ...previous,
        [conversationId]: realMessages,
      }));
    } catch (error) {
      console.error("Failed to load messages:", error);
      setApiError(error.message || "Could not load messages.");
    }
  }

  async function loadAnalytics() {
    if (!token || !businessId) return;

    setAnalyticsLoading(true);
    setAnalyticsError("");

    try {
      const data = await apiRequest(
        `/businesses/${businessId}/conversations/analytics`,
        {},
        token
      );

      setAnalyticsData(data);
    } catch (error) {
      console.error("Failed to load analytics:", error);
      setAnalyticsError(error.message || "Could not load analytics.");
    } finally {
      setAnalyticsLoading(false);
    }
  }


  
async function loadKnowledgeEntries() {
  if (!token || !businessId) return;

  setKnowledgeLoading(true);
  setKnowledgeError("");

  try {
    const data = await apiRequest(
      `/businesses/${businessId}/knowledge/`,
      {},
      token
    );

    setKnowledgeEntries(data);
  } catch (error) {
    console.error("Failed to load knowledge entries:", error);
    setKnowledgeError(
      error.message || "Could not load Knowledge Base entries."
    );
  } finally {
    setKnowledgeLoading(false);
  }
}


async function addKnowledgeEntry(event) {
  event.preventDefault();

  if (!token || !businessId) return;

  const title = knowledgeTitle.trim();
  const content = knowledgeContent.trim();

  if (!title || !content) {
    setKnowledgeError("Please enter both a title and content.");
    return;
  }

  setKnowledgeError("");

  try {
    await apiRequest(
      `/businesses/${businessId}/knowledge/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, content }),
      },
      token
    );

    setKnowledgeTitle("");
    setKnowledgeContent("");
    await loadKnowledgeEntries();
  } catch (error) {
    console.error("Failed to add knowledge entry:", error);
    setKnowledgeError(
      error.message || "Could not save the knowledge entry."
    );
  }
}


async function deleteKnowledgeEntry(entryId) {
  if (!token || !businessId) return;

  const confirmed = window.confirm(
    "Are you sure you want to delete this knowledge entry?"
  );

  if (!confirmed) return;

  setKnowledgeError("");

  try {
    await apiRequest(
      `/businesses/${businessId}/knowledge/${entryId}`,
      { method: "DELETE" },
      token
    );

    await loadKnowledgeEntries();
  } catch (error) {
    console.error("Failed to delete knowledge entry:", error);
    setKnowledgeError(
      error.message || "Could not delete the knowledge entry."
    );
  }
}




  // ---------------------------------------------------------------------
  // Conversation actions
  // ---------------------------------------------------------------------
  async function createNewConversation(event) {
    event.preventDefault();

    if (!token || !businessId) {
      setApiError("Please sign in before creating a conversation.");
      return;
    }

    if (!newSubject.trim() || !newCustomerName.trim()) {
      setApiError("Subject and customer name are required.");
      return;
    }

    setCreatingConversation(true);
    setApiError("");

    try {
      const created = await apiRequest(
        `/businesses/${businessId}/conversations/`,
        {
          method: "POST",
          body: JSON.stringify({
            subject: newSubject.trim(),
            customer_name: newCustomerName.trim(),
            customer_email: newCustomerEmail.trim() || null,
          }),
        },
        token
      );

      setShowNewConversation(false);
      setNewSubject("");
      setNewCustomerName("");
      setNewCustomerEmail("");

      // Reload the list and select the new conversation.
      
      // Reload the list and select the new conversation.
      await loadRealConversations(created?.id);

      // Refresh analytics after creating the conversation.
      await loadAnalytics();

    } catch (error) {
      console.error("Failed to create conversation:", error);
      setApiError(error.message || "Could not create conversation.");
    } finally {
      setCreatingConversation(false);
    }
  }

  async function updateConversationStatus(conversationId, newStatus) {
    if (!token || !businessId || !conversationId) return;

    setApiError("");

    try {
      await apiRequest(
        `/businesses/${businessId}/conversations/${conversationId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status: newStatus }),
        },
        token
      );

      setConversations((previous) =>
        previous.map((conversation) =>
          conversation.id === conversationId
            ? {
                ...conversation,
                status: newStatus === "resolved" ? "Resolved" : "Open",
              }
            : conversation
        )
      );

      await loadAnalytics();

    } catch (error) {
      setApiError(error.message || "Could not update conversation status.");
    }
  }

  
async function sendMessage(event) {
  event.preventDefault();

  const content = message.trim();

  if (!content || !token || !businessId || !activeId || sending) {
    return;
  }

  const conversationId = activeId;

  setSending(true);
  setApiError("");

  // Add the customer's message immediately for responsive feedback.
  setMessages((previous) => ({
    ...previous,
    [conversationId]: [
      ...(previous[conversationId] || []),
      {
        role: "customer",
        content,
        time: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ],
  }));

  // Clear the input after preserving the draft in `content`.
  setMessage("");

  try {
    await apiRequest(
      `/businesses/${businessId}/conversations/${conversationId}/reply`,
      {
        method: "POST",
        body: JSON.stringify({ message: content }),
      },
      token
    );

    await loadRealMessages(conversationId);
    await loadAnalytics();
  } catch (error) {
    console.error("Failed to send message:", error);

    const errorMessage = String(error?.message || "");

    if (
      error instanceof TypeError ||
      /failed to fetch|networkerror|fetch failed|network request failed/i.test(
        errorMessage
      )
    ) {
      setApiError(
        "Unable to connect to ResolveAI. Please check that the backend is running and try again."
      );
    } else {
      setApiError(
        errorMessage || "We couldn't generate your AI reply. Please try again."
      );
    }

    setMessage(content);
    setRetryMessage(content);

    try {
      await loadRealMessages(conversationId);
      setRetryMessage("");
    } catch (historyError) {
      console.error("Failed to reload conversation history:", historyError);
    }
  } finally {
    setSending(false);
  }
}


  // ---------------------------------------------------------------------
  // Derived values
  // ---------------------------------------------------------------------
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeId
  );

  const activeMessages = messages[activeId] || [];

  const filteredConversations = conversations.filter(
    (conversation) =>
      `${conversation.name} ${conversation.subject} ${conversation.preview}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (filter === "All" || conversation.status === filter)
  );

  // Round the backend resolution rate for display only.
  const rawRate = Number(analyticsData?.resolution_rate ?? 0);
  const displayRate = Number.isFinite(rawRate)
    ? Math.round(rawRate * 10) / 10
    : 0;

  // ---------------------------------------------------------------------
  // Effects (all hooks run before the early return below)
  // ---------------------------------------------------------------------

  // Load the conversation list once a token is available.
  
useEffect(() => {
  if (token) {
    loadWorkspaceName();
  } else {
    setBusinessId("");
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [token]);

useEffect(() => {
  if (token && businessId) {
    loadRealConversations();
    loadKnowledgeEntries();

    if (currentPage === "analytics") {
      loadAnalytics();
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [token, businessId]);


  // Load messages whenever the selected conversation changes.
  useEffect(() => {
    if (token && activeId) {
      loadRealMessages(activeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeId]);

  // Load analytics whenever the Analytics page is opened.
  useEffect(() => {
    if (token && currentPage === "analytics") {
      loadAnalytics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, currentPage]);

  // ---------------------------------------------------------------------
  // Signed-out view
  // ---------------------------------------------------------------------
  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-logo">R</div>
            <div>
              <h1>ResolveAI</h1>
              <p>Customer intelligence platform</p>
            </div>
          </div>

          <div className="auth-heading">
            <span className="auth-eyebrow">AI-POWERED CUSTOMER SUPPORT</span>
            <h2>
              {authMode === "login" ? "Welcome back" : "Create your account"}
            </h2>
            <p>
              {authMode === "login"
                ? "Sign in to continue to your workspace."
                : "Register to get started with ResolveAI."}
            </p>
          </div>

          <form className="auth-form" onSubmit={handleAuthSubmit}>
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />

            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              autoComplete={
                authMode === "login" ? "current-password" : "new-password"
              }
              minLength={8}
              required
            />

            {authError && (
              <div className="auth-error" role="alert">
                {authError}
              </div>
            )}

            <button
              className="auth-submit"
              type="submit"
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>

          <div className="auth-switch">
            {authMode === "login"
              ? "Don't have an account?"
              : "Already have an account?"}{" "}
            <button
              type="button"
              onClick={() => {
                setAuthMode(authMode === "login" ? "register" : "login");
                setAuthError("");
              }}
            >
              {authMode === "login" ? "Register" : "Sign in"}
            </button>
          </div>

          <p className="auth-footer">
            Secure access to your customer support workspace.
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // Signed-in view
  // ---------------------------------------------------------------------
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">ResolveAI</div>
            <div className="brand-caption">CUSTOMER INTELLIGENCE</div>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switch">
          <span className="workspace-avatar">R</span>
          <span className="workspace-text">
            <strong>ResolveAI Workspace</strong>
            <small>Support workspace</small>
          </span>
          <span className="chevron">⌄</span>
        </button>

        <div className="nav-label">MENU</div>
        
<button
  type="button"
  className={`nav-item ${currentPage === "overview" ? "active" : ""}`}
  onClick={() => setCurrentPage("overview")}
>
  <span>◫</span> Overview
</button>


        <button
          type="button"
          className={`nav-item ${currentPage === "conversations" ? "active" : ""}`}
          onClick={() => setCurrentPage("conversations")}
        >
          <span>▤</span> Conversations
          <span className="nav-count">{conversations.length}</span>
        </button>

       
<button
  type="button"
  className={`nav-item ${currentPage === "activity" ? "active" : ""}`}
  onClick={() => setCurrentPage("activity")}
>
  <span>◷</span> Activity
</button>


        <div className="nav-label tools-label">WORKSPACE TOOLS</div>
        
<button
  type="button"
  className={`nav-item ${currentPage === "assistant" ? "active" : ""}`}
  onClick={() => setCurrentPage("assistant")}
>
  <span>✧</span> AI assistant
  <span className="online-dot" />
</button>


        <button
          type="button"
          className={`nav-item ${currentPage === "analytics" ? "active" : ""}`}
          onClick={() => setCurrentPage("analytics")}
        >
          <span>▥</span> Analytics
        </button>


        
<button
  type="button"
  className={`nav-item ${currentPage === "knowledge" ? "active" : ""}`}
  onClick={() => setCurrentPage("knowledge")}
>
  <span>▤</span> Knowledge Base
</button>




        
<button
  type="button"
  className={`nav-item ${currentPage === "settings" ? "active" : ""}`}
  onClick={() => setCurrentPage("settings")}
>
  <span>⚙</span> Settings
</button>


        <div className="sidebar-bottom">
          <div className="plan-card">
            <div className="plan-icon">✦</div>
            <strong>AI-powered support</strong>
            <p>Your workspace is ready for smarter customer conversations.</p>
          </div>
          <div className="profile">
            <div className="profile-avatar">SR</div>
            <div className="profile-info">
              <strong>Workspace admin</strong>
              <small>Administrator</small>
            </div>
            <span className="profile-menu">···</span>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            
<strong>
  {{
    overview: "Overview",
    conversations: "Conversations",
    activity: "Activity",
    assistant: "AI Assistant",
    analytics: "Analytics",
    knowledge: "Knowledge Base",
    settings: "Settings",
  }[currentPage] || "ResolveAI"}
</strong>

          </div>
          <div className="topbar-actions">
            <div className="system-status">
              <span className="online-dot" /> AI system online
            </div>
            <button className="icon-button" aria-label="Notifications">
              ♧
            </button>
            <div className="top-avatar">SR</div>
            <button
              type="button"
              className="outline-button"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </header>

       
{currentPage === "overview" ? (
  <div className="analytics-page">
    <section className="page-heading">
      <div>
        <div className="eyebrow">WORKSPACE DASHBOARD</div>
        <h1>Overview</h1>
        <p>Welcome to your ResolveAI support workspace.</p>
      </div>
      <button
        type="button"
        className="outline-button"
        onClick={() => setCurrentPage("conversations")}
      >
        View conversations
      </button>
    </section>

    <section className="stats-grid">
      <div className="stat-card">
        <div className="stat-top">
          <span>Total conversations</span>
          <span className="stat-icon violet">▤</span>
        </div>
        <div className="stat-number">{conversations.length}</div>
        <div className="stat-foot">Across your workspace</div>
      </div>

      <div className="stat-card">
        <div className="stat-top">
          <span>Open conversations</span>
          <span className="stat-icon amber">◷</span>
        </div>
        <div className="stat-number">
          {conversations.filter((item) => item.status === "Open").length}
        </div>
        <div className="stat-foot">Awaiting resolution</div>
      </div>

      <div className="stat-card">
        <div className="stat-top">
          <span>Resolved conversations</span>
          <span className="stat-icon green">✓</span>
        </div>
        <div className="stat-number">
          {conversations.filter((item) => item.status === "Resolved").length}
        </div>
        <div className="stat-foot">Successfully resolved</div>
      </div>
    </section>

    <section className="analytics-card">
      <h3>Workspace overview</h3>
      <p className="analytics-note">
        Manage customer conversations and review support performance.
      </p>
      <button
        type="button"
        className="outline-button"
        onClick={() => setCurrentPage("analytics")}
      >
        View analytics
      </button>
    </section>
  </div>
) : currentPage === "analytics" ? (

          <div className="analytics-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">CUSTOMER INSIGHTS</div>
                <h1>Analytics</h1>
                <p>Understand your customer support performance.</p>
              </div>

              <button
                type="button"
                className="outline-button"
                onClick={loadAnalytics}
                disabled={analyticsLoading}
              >
                {analyticsLoading ? "Refreshing..." : "↻ Refresh data"}
              </button>
            </section>

            {analyticsError && (
              <p style={{ color: "#ff7777" }} role="alert">
                {analyticsError}
              </p>
            )}

            <section className="stats-grid">
              <div className="stat-card">
                <div className="stat-top">
                  <span>Total conversations</span>
                  <span className="stat-icon violet">▤</span>
                </div>
                <div className="stat-number">
                  {analyticsLoading
                    ? "..."
                    : (analyticsData?.total_conversations ?? 0)}
                </div>
                <div className="stat-foot">All conversations</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Open conversations</span>
                  <span className="stat-icon amber">◷</span>
                </div>
                <div className="stat-number">
                  {analyticsLoading
                    ? "..."
                    : (analyticsData?.open_conversations ?? 0)}
                </div>
                <div className="stat-foot">Awaiting resolution</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Resolved conversations</span>
                  <span className="stat-icon green">✓</span>
                </div>
                <div className="stat-number">
                  {analyticsLoading
                    ? "..."
                    : (analyticsData?.resolved_conversations ?? 0)}
                </div>
                <div className="stat-foot">Marked resolved</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Resolution rate</span>
                  <span className="stat-icon violet">%</span>
                </div>
                <div className="stat-number">
                  {analyticsLoading ? "..." : `${displayRate}%`}
                </div>
                <div className="stat-foot">Resolved ÷ total</div>
              </div>
            </section>

            <Analytics
  analyticsData={analyticsData}
  analyticsLoading={analyticsLoading}
/>
          </div>
        
        ) : currentPage === "activity" ? (
          <div className="analytics-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">WORKSPACE TIMELINE</div>
                <h1>Activity</h1>
                <p>Review recent customer conversations and their status.</p>
              </div>
              <button
                type="button"
                className="outline-button"
                onClick={() => loadRealConversations()}
                disabled={loadingConversations}
              >
                {loadingConversations ? "Refreshing..." : "↻ Refresh activity"}
              </button>
            </section>

            <section className="analytics-card">
              <h3>Recent conversations</h3>
              <p className="analytics-note">
                Select a conversation to view its messages.
              </p>

              {conversations.length === 0 ? (
                <p className="analytics-note">No conversations yet.</p>
              ) : (
                <div className="activity-list">
                  {conversations.slice().reverse().map((conversation) => (
                    <button
                      type="button"
                      key={conversation.id}
                      className="activity-item"
                      onClick={() => {
                        setActiveId(conversation.id);
                        setCurrentPage("conversations");
                      }}
                    >
                      <span className="activity-icon">◷</span>
                      <span className="activity-details">
                        <strong>{conversation.subject}</strong>
                        <small>
                          Customer: {conversation.name || conversation.customer_name || "Customer"}
                        </small>
                      </span>
                      <span className="status-pill">{conversation.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        
          
        ) : currentPage === "assistant" ? (
          <div className="analytics-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">AI CUSTOMER SUPPORT</div>
                <h1>AI Assistant</h1>
                <p>Use your Gemini-powered assistant to respond to customers.</p>
              </div>
              <button
                type="button"
                className="outline-button"
                onClick={() => setCurrentPage("conversations")}
              >
                Open conversations
              </button>
            </section>

            <section className="analytics-card">
              <h3>How to use the AI assistant</h3>
              <p className="analytics-note">
                Select a customer conversation to use the existing AI-powered
                reply workflow.
              </p>
              <button
                type="button"
                className="new-conversation"
                onClick={() => setCurrentPage("conversations")}
              >
                Go to conversations
              </button>
            </section>
          </div>

          
) : currentPage === "knowledge" ? (
  <div className="analytics-page">
    <section className="page-heading">
      <div>
        <div className="eyebrow">BUSINESS KNOWLEDGE</div>
        <h1>Knowledge Base</h1>
        <p>Manage FAQs, policies, and information for your AI assistant.</p>
      </div>

      <button
        type="button"
        className="outline-button"
        onClick={loadKnowledgeEntries}
        disabled={knowledgeLoading}
      >
        {knowledgeLoading ? "Refreshing..." : "↻ Refresh"}
      </button>
    </section>

    {knowledgeError && (
      <p style={{ color: "#ff7777" }} role="alert">
        {knowledgeError}
      </p>
    )}

    <section className="analytics-card">
      <h3>Add knowledge</h3>
      <p className="analytics-note">
        Add FAQs, return policies, product details, and business information.
      </p>

      <form onSubmit={addKnowledgeEntry} className="knowledge-form">
        <label htmlFor="knowledge-title">Title</label>
        <input
          id="knowledge-title"
          type="text"
          value={knowledgeTitle}
          onChange={(event) => setKnowledgeTitle(event.target.value)}
          placeholder="e.g. Return Policy"
          minLength={2}
          maxLength={200}
          required
        />

        <label htmlFor="knowledge-content">Content</label>
        <textarea
          id="knowledge-content"
          value={knowledgeContent}
          onChange={(event) => setKnowledgeContent(event.target.value)}
          placeholder="Write your FAQ or policy..."
          rows={5}
          maxLength={20000}
          required
        />

        <button type="submit" className="new-conversation">
          + Add knowledge
        </button>
      </form>
    </section>

    <section className="analytics-card">
      <h3>Saved knowledge</h3>

      {knowledgeLoading ? (
        <p className="analytics-note">Loading entries...</p>
      ) : knowledgeEntries.length === 0 ? (
        <p className="analytics-note">
          No entries found. Add your first FAQ or policy above.
        </p>
      ) : (
        <div className="knowledge-list">
          {knowledgeEntries.map((entry) => (
            <article className="knowledge-entry" key={entry.id}>
              <div>
                <h4>{entry.title}</h4>
                <p>{entry.content}</p>
                {entry.created_at && (
                  <small>
                    Added: {new Date(entry.created_at).toLocaleDateString()}
                  </small>
                )}
              </div>

              <button
                type="button"
                className="outline-button"
                onClick={() => deleteKnowledgeEntry(entry.id)}
              >
                Delete
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  </div>

        
        ) : currentPage === "settings" ? (
          <div className="analytics-page">
            <section className="page-heading">
              <div>
                <div className="eyebrow">WORKSPACE PREFERENCES</div>
                <h1>Settings</h1>
                <p>View your ResolveAI workspace and AI configuration.</p>
              </div>
            </section>

            



            

<section className="analytics-card">
  <h3>Workspace settings</h3>

  <label htmlFor="workspaceName">Workspace name</label>
  <input
  className="workspace-input"
  id="workspaceName"
  type="text"
  value={workspaceName}
  onChange={(event) => setWorkspaceName(event.target.value)}
  placeholder="Enter workspace name"
/>

  <label htmlFor="workspaceEmail">Workspace email</label>
  <input
  className="workspace-input"
  id="workspaceEmail"
  type="email"
  value={workspaceEmail}
  onChange={(event) => setWorkspaceEmail(event.target.value)}
  placeholder="support@example.com"
/>

  <p className="analytics-note">
    Current conversations: {conversations.length}
  </p>

  
<button
  type="button"
  className="new-conversation"
  onClick={async () => {
    if (!workspaceName.trim()) {
      alert("Please enter a workspace name.");
      return;
    }

    try {
      const token = sessionStorage.getItem("resolveai_token");

      const updatedBusiness = await apiRequest(
        `/businesses/${businessId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
  name: workspaceName.trim(),
  email: workspaceEmail.trim() || null,
}),
        },
        token
      );

      setWorkspaceName(updatedBusiness.name);
      setWorkspaceEmail(updatedBusiness.email || "");
      alert("Workspace name saved successfully!");
    } catch (error) {
      alert(`Failed to save settings: ${error.message}`);
    }
  }}
>
  Save settings
</button>

</section>



            <section className="analytics-card" style={{ marginTop: "16px" }}>
              <h3>AI assistant</h3>
              <p className="analytics-note">
                Your existing customer-support reply workflow uses the
                configured backend and Gemini integration.
              </p>
              <button
                type="button"
                className="outline-button"
                onClick={() => setCurrentPage("assistant")}
              >
                Open AI Assistant
              </button>
            </section>

            <section className="analytics-card" style={{ marginTop: "16px" }}>
              <h3>Manage conversations</h3>
              <p className="analytics-note">
                View customer messages and manage open or resolved requests.
              </p>
              <button
                type="button"
                className="outline-button"
                onClick={() => setCurrentPage("conversations")}
              >
                Open conversations
              </button>
            </section>
          </div>
        ) : (
          <>



            <section className="page-heading">
              <div>
                <div className="eyebrow">CUSTOMER SUPPORT CENTER</div>
                <h1>Conversations</h1>
                <p>Manage customer requests with your AI support assistant.</p>
              </div>

              <button
                className="new-conversation"
                onClick={() => {
                  setApiError("");
                  setShowNewConversation(true);
                }}
              >
                <span>＋</span> New conversation
              </button>
            </section>

            {showNewConversation && (
              <div className="conversation-form-panel"
                style={{
                  marginBottom: "20px",
                  padding: "24px",
                  background: "#171923",
                  border: "1px solid #303447",
                  borderRadius: "14px",
                }}
              >
                <h2 style={{ marginTop: 0 }}>Create a conversation</h2>

                <form
  className="conversation-create-form"
  onSubmit={createNewConversation}
>
  <div className="form-field">
    <label htmlFor="new-customer-name">Customer name</label>
    <input
      id="new-customer-name"
      type="text"
      value={newCustomerName}
      onChange={(event) => setNewCustomerName(event.target.value)}
      placeholder="e.g. Rahul Sharma"
      required
    />
  </div>

  <div className="form-field">
    <label htmlFor="new-conversation-subject">
      Conversation subject
    </label>
    <input
      id="new-conversation-subject"
      type="text"
      value={newSubject}
      onChange={(event) => setNewSubject(event.target.value)}
      placeholder="e.g. Order delivery inquiry"
      required
    />
  </div>

  <div className="form-actions">
    <button type="submit">Create conversation</button>

    <button
      type="button"
      onClick={() => setShowNewConversation(false)}
    >
      Cancel
    </button>
  </div>
</form>
              </div>
            )}

            <div style={{ marginBottom: "16px" }}>
              <button
                type="button"
                className="outline-button"
                onClick={() => loadRealConversations()}
                disabled={loadingConversations}
              >
                {loadingConversations
                  ? "Refreshing..."
                  : "↻ Refresh conversations"}
              </button>

              {apiError && !showNewConversation && (
                <p style={{ color: "red" }}>{apiError}</p>
              )}
            </div>

            <section className="stats-grid">
              <div className="stat-card">
                <div className="stat-top">
                  <span>Total conversations</span>
                  <span className="stat-icon violet">▤</span>
                </div>
                <div className="stat-number">{conversations.length}</div>
                <div className="stat-foot">Across your workspace</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Open conversations</span>
                  <span className="stat-icon amber">◷</span>
                </div>
                <div className="stat-number">
                  {conversations.filter((item) => item.status === "Open").length}
                </div>
                <div className="stat-foot">Awaiting resolution</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Resolved conversations</span>
                  <span className="stat-icon green">✓</span>
                </div>
                <div className="stat-number">
                  {
                    conversations.filter((item) => item.status === "Resolved")
                      .length
                  }
                </div>
                <div className="stat-foot">Successfully marked resolved</div>
              </div>

              <div className="stat-card">
                <div className="stat-top">
                  <span>Resolution rate</span>
                  <span className="stat-icon violet">%</span>
                </div>
                <div className="stat-number">
                  {conversations.length === 0
                    ? 0
                    : Math.round(
                        (conversations.filter(
                          (item) => item.status === "Resolved"
                        ).length /
                          conversations.length) *
                          100
                      )}
                  %
                </div>
                <div className="stat-foot">Percentage of all conversations</div>
              </div>
            </section>

            <section className="inbox">
              <div className="conversation-panel">
                <div className="panel-heading">
                  <div>
                    <h2>
                      Inbox <span>{conversations.length}</span>
                    </h2>
                    <p>Your recent customer conversations</p>
                  </div>

                  <button
                    className="icon-button small"
                    aria-label="Inbox options"
                  >
                    ···
                  </button>
                </div>

                <div className="search-box">
                  <span>⌕</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search conversations..."
                  />
                  <kbd>/</kbd>
                </div>

                <div className="filter-row">
                  <button
                    type="button"
                    className={filter === "All" ? "filter-active" : ""}
                    onClick={() => setFilter("All")}
                  >
                    All messages
                  </button>

                  <button
                    type="button"
                    className={filter === "Open" ? "filter-active" : ""}
                    onClick={() => setFilter("Open")}
                  >
                    Open
                  </button>

                  <button
                    type="button"
                    className={filter === "Resolved" ? "filter-active" : ""}
                    onClick={() => setFilter("Resolved")}
                  >
                    Resolved
                  </button>
                </div>

                <div className="conversation-list">
                  {filteredConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      className={`conversation-item ${
                        activeId === conversation.id ? "selected" : ""
                      }`}
                      onClick={() => setActiveId(conversation.id)}
                    >
                      <div className={`contact-avatar ${conversation.color}`}>
                        {conversation.initials}
                      </div>
                      <div className="conversation-info">
                        <div className="conversation-first-line">
                          <strong>{conversation.name}</strong>
                          <time>{conversation.time}</time>
                        </div>
                        <div className="conversation-subject">
                          {conversation.subject}
                        </div>
                        <div className="conversation-preview">
                          {conversation.preview}
                        </div>
                        <span
                          className={`status-pill ${
                            conversation.status === "Resolved" ? "resolved" : ""
                          }`}
                        >
                          {conversation.status}
                        </span>
                      </div>
                    </button>
                  ))}

                  {filteredConversations.length === 0 && (
                    <div className="empty-search">
                      No matching conversations.
                    </div>
                  )}
                </div>
              </div>

              <div className="chat-panel">
                {activeConversation ? (
                  <>
                    <div className="chat-header">
                      <div
                        className={`contact-avatar ${activeConversation.color}`}
                      >
                        {activeConversation.initials}
                      </div>

                      <div className="chat-contact">
                        <strong>{activeConversation.name}</strong>
                        <span>
                          <span className="online-dot" /> Customer conversation
                        </span>
                      </div>

                      <div className="chat-header-actions">
                        <button
                          type="button"
                          className="outline-button"
                          onClick={() =>
                            updateConversationStatus(
                              activeConversation.id,
                              activeConversation.status === "Resolved"
                                ? "open"
                                : "resolved"
                            )
                          }
                        >
                          {activeConversation.status === "Resolved"
                            ? "↻ Reopen"
                            : "✓ Resolve"}
                        </button>

                        <button className="outline-button">☆ Follow</button>

                        <button
                          className="icon-button small"
                          aria-label="More options"
                        >
                          ···
                        </button>
                      </div>
                    </div>

                    <div className="conversation-subheader">
                      <div>
                        <span className="subject-label">SUBJECT</span>
                        <strong>{activeConversation.subject}</strong>
                      </div>

                      <span className="status-pill">
                        {activeConversation.status}
                      </span>
                    </div>

                    <div className="chat-messages">
                      <div className="date-divider">
                        <span>Today</span>
                      </div>

                      {activeMessages.map((item, index) => (
                        <div
                          className={`message-row ${
                            item.role === "assistant" ? "assistant-row" : ""
                          }`}
                          key={`${activeId}-${index}`}
                        >
                          <div
                            className={`message-avatar ${
                              item.role === "assistant"
                                ? "ai-avatar"
                                : "customer-avatar"
                            }`}
                          >
                            {item.role === "assistant"
                              ? "✦"
                              : activeConversation.initials}
                          </div>

                          <div className="message-body">
                            <div className="message-meta">
                              <strong>
                                {item.role === "assistant"
                                  ? "ResolveAI Assistant"
                                  : activeConversation.name}
                              </strong>
                              <time>{item.time}</time>
                            </div>

                            <div className={`message-bubble ${item.role}`}>
                              {item.content}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="ai-suggestion">
                      <div className="suggestion-icon">✧</div>
                      <div>
                        <strong>ResolveAI assistant</strong>
                        <p>AI-powered customer support with Gemini.</p>
                      </div>
                      <span className="suggestion-badge">AI POWERED</span>
                    </div>

                    {apiError && (
  <div className="error-message" role="alert">
    <span>⚠</span> {apiError}

    {retryMessage && (
      <button
        type="button"
        className="retry-button"
        disabled={sending}
        onClick={() => {
          setMessage(retryMessage);
          setApiError("");
        }}
      >
        Retry
      </button>
    )}
  </div>
)}

                    <form className="composer" onSubmit={sendMessage}>
                      {sending && (
                      <p className="ai-generating" role="status" aria-live="polite">
                     ✧ ResolveAI is generating a reply... This may take a little while.
                       </p>
                   )}
                      <textarea
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        placeholder="Write a reply..."
                        rows={2}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            event.currentTarget.form.requestSubmit();
                          }
                        }}
                      />
                      <div className="composer-footer">
                        <div className="composer-tools">
                          <span>↗</span>
                          <span>☺</span>
                          <span className="composer-hint">
                            Enter to send · Shift + Enter for a new line
                          </span>
                        </div>
                        <button
                          className="send-button"
                          type="submit"
                          disabled={sending || !message.trim()}
                        >
                          {sending ? "Generating..." : "Send"} <span>↑</span>
                        </button>
                      </div>
                    </form>
                  </>
                ) : (
                  <div className="empty-chat">
                    Select a conversation to view messages.
                  </div>
                )}
              </div>
            </section>

            <footer className="footer">
              <span>© 2026 ResolveAI</span>
              <span>
                <span className="online-dot" /> Connected to your support
                workspace
              </span>
            </footer>
          </>
        )}
      </main>
    </div>
  );
}

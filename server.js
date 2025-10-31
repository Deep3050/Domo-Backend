require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const Papa = require("papaparse");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const {
  DOMO_CLIENT_ID,
  DOMO_CLIENT_SECRET,
  DOMO_API_BASE = "https://api.domo.com",
  DOMO_INSTANCE = "https://lionbridge.domo.com",
  PORT = 4000,
} = process.env;

let domoAccessToken = "";

// ✅ User Sessions Storage (in production, use Redis or database)
const userSessions = new Map();

// ✅ Clean up expired sessions every hour
setInterval(() => {
  const now = Date.now();
  const oneHourAgo = now - (60 * 60 * 1000);
  
  for (const [sessionId, sessionData] of userSessions.entries()) {
    if (sessionData.timestamp < oneHourAgo) {
      userSessions.delete(sessionId);
      console.log(`🧹 Cleaned up expired session: ${sessionId}`);
    }
  }
}, 60 * 60 * 1000);

// ✅ Store user data in session
app.post("/api/user-session", (req, res) => {
  try {
    const { sessionId, userId, userName } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const sessionData = {
      userId: userId || "123",
      userName: userName || "Deepak Yadav",
      timestamp: Date.now()
    };

    userSessions.set(sessionId, sessionData);
    
    console.log('💾 User session stored:', { sessionId, ...sessionData });
    
    res.json({ 
      success: true, 
      sessionId,
      message: "User data stored successfully" 
    });
  } catch (error) {
    console.error('❌ Error storing user session:', error);
    res.status(500).json({ 
      error: "Failed to store user session",
      details: error.message 
    });
  }
});

// ✅ Get user data from session
app.get("/api/user-session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const sessionData = userSessions.get(sessionId);
    
    if (sessionData) {
      console.log('📥 User session retrieved:', { sessionId, ...sessionData });
      res.json(sessionData);
    } else {
      console.log('❌ Session not found:', sessionId);
      res.status(404).json({ 
        error: "Session not found",
        message: "Session expired or does not exist" 
      });
    }
  } catch (error) {
    console.error('❌ Error retrieving user session:', error);
    res.status(500).json({ 
      error: "Failed to retrieve user session",
      details: error.message 
    });
  }
});

// ✅ Update user session (alternative to POST)
app.put("/api/user-session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { userId, userName } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const sessionData = {
      userId: userId || "123",
      userName: userName || "Deepak Yadav",
      timestamp: Date.now()
    };

    userSessions.set(sessionId, sessionData);
    
    console.log('🔄 User session updated:', { sessionId, ...sessionData });
    
    res.json({ 
      success: true, 
      sessionId,
      message: "User data updated successfully" 
    });
  } catch (error) {
    console.error('❌ Error updating user session:', error);
    res.status(500).json({ 
      error: "Failed to update user session",
      details: error.message 
    });
  }
});

// ✅ Delete user session
app.delete("/api/user-session/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const deleted = userSessions.delete(sessionId);
    
    if (deleted) {
      console.log('🗑️ User session deleted:', sessionId);
      res.json({ 
        success: true, 
        message: "Session deleted successfully" 
      });
    } else {
      res.status(404).json({ 
        error: "Session not found",
        message: "Session already expired or does not exist" 
      });
    }
  } catch (error) {
    console.error('❌ Error deleting user session:', error);
    res.status(500).json({ 
      error: "Failed to delete user session",
      details: error.message 
    });
  }
});

// ✅ Get all active sessions (for debugging)
app.get("/api/user-sessions", (req, res) => {
  try {
    const sessions = Array.from(userSessions.entries()).map(([sessionId, data]) => ({
      sessionId,
      ...data,
      age: Date.now() - data.timestamp
    }));
    
    res.json({
      total: sessions.length,
      sessions
    });
  } catch (error) {
    console.error('❌ Error retrieving sessions:', error);
    res.status(500).json({ 
      error: "Failed to retrieve sessions",
      details: error.message 
    });
  }
});

// 🔹 Existing Domo token endpoint
app.get("/domo/token/:datasetId", async (req, res) => {
  try {
    const tokenResponse = await axios.post(
      `${DOMO_API_BASE}/oauth/token`,
      null,
      {
        params: {
          grant_type: "client_credentials",
          scope: "data user",
          client_id: DOMO_CLIENT_ID,
          client_secret: DOMO_CLIENT_SECRET,
        },
      }
    );

    res.json({ access_token: tokenResponse.data.access_token });
  } catch (error) {
    console.error(
      "Error generating embed token:",
      error.response?.data || error.message
    );
    res.status(400).json({
      message: "Failed to generate embed token",
      details: error.response?.data || error.message,
    });
  }
});

/** 🔹 Step 1: Get Domo Access Token */
async function getDomoAccessToken() {
  try {
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("scope", "data dashboard user");

    const response = await axios.post(`${DOMO_API_BASE}/oauth/token`, params, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      auth: {
        username: DOMO_CLIENT_ID,
        password: DOMO_CLIENT_SECRET,
      },
    });

    domoAccessToken = response.data.access_token;
    console.log("✅ Domo Access Token Generated Successfully");
    return domoAccessToken;
  } catch (err) {
    console.error(
      "❌ Error getting Domo token:",
      err.response?.data || err.message
    );
    throw new Error("Failed to obtain Domo token");
  }
}

/** 🔹 Ensure valid token before requests */
async function ensureAccessToken() {
  if (!domoAccessToken) {
    await getDomoAccessToken();
  }
  return domoAccessToken;
}

/** 🔹 Fetch Dataset */
app.get("/dataset/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await ensureAccessToken();

    const metaRes = await axios.get(`${DOMO_API_BASE}/v1/datasets/${id}`, {
      headers: { Authorization: `Bearer ${domoAccessToken}` },
    });

    const schemaCols = metaRes.data.schema.columns
      .map((col) => col.name)
      .filter((name) => !["_BATCH_ID_", "_BATCH_LAST_RUN_"].includes(name));

    const response = await axios.get(
      `${DOMO_API_BASE}/v1/datasets/${id}/data`,
      {
        headers: {
          Authorization: `Bearer ${domoAccessToken}`,
          Accept: "text/csv",
        },
      }
    );

    const csv = response.data;
    const parsed = Papa.parse(csv, { header: false, skipEmptyLines: true });

    const records = parsed.data.map((row) => {
      const obj = {};
      schemaCols.forEach((col, i) => (obj[col] = row[i] ?? ""));
      return obj;
    });

    res.json({ datasetId: id, columns: schemaCols, records });
  } catch (err) {
    console.error(
      "❌ Error fetching dataset:",
      err.response?.data || err.message
    );
    if (err.response?.status === 401) {
      console.log("🔄 Token expired. Refreshing...");
      await getDomoAccessToken();
      return res.redirect(`/dataset/${req.params.id}`);
    }
    res
      .status(500)
      .json({ error: "Failed to fetch dataset", details: err.message });
  }
});

/** 🔹 Update Dataset */
app.put("/dataset/:datasetId", async (req, res) => {
  try {
    const { datasetId } = req.params;
    const { records } = req.body;
    if (!records || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ error: "No records provided" });
    }

    console.log(`🟢 Saving dataset with ${records.length} rows`);
    await ensureAccessToken();

    const meta = await axios.get(`${DOMO_API_BASE}/v1/datasets/${datasetId}`, {
      headers: { Authorization: `Bearer ${domoAccessToken}` },
    });
    const schemaCols = meta.data.schema.columns.map((c) => c.name);

    const escapeCell = (val) => {
      if (val == null) return "";
      let str = String(val).trim();
      if (str.startsWith("'")) str = str.slice(1);
      str = str.replace(/"/g, '""');
      if (/[",\n]/.test(str)) str = `"${str}"`;
      return str;
    };

    const rows = records.map((r) =>
      schemaCols.map((col) => escapeCell(r[col]))
    );
    const csv = rows.map((r) => r.join(",")).join("\n");

    const resp = await axios.put(
      `${DOMO_API_BASE}/v1/datasets/${datasetId}/data`,
      csv,
      {
        headers: {
          Authorization: `Bearer ${domoAccessToken}`,
          "Content-Type": "text/csv; charset=utf-8",
        },
        maxBodyLength: Infinity,
        timeout: 120000,
      }
    );

    console.log("✅ Domo dataset updated:", resp.status);
    res.json({ success: true });
  } catch (err) {
    console.error(
      "❌ Error updating dataset:",
      err.response?.data || err.message
    );
    res.status(err.response?.status || 500).json({
      error: "Failed to update dataset",
      domoError: err.response?.data || err.message,
    });
  }
});

/** ✅ CORRECT: Generate Private Embed Token for Domo Card */
app.get("/domo/token/:cardId", async (req, res) => {
  const { cardId } = req.params;

  try {
    console.log(`🔑 Generating embed token for card: ${cardId}`);

    const tokenResponse = await axios.post(
      "https://api.domo.com/oauth/token",
      `grant_type=client_credentials&scope=data%20user%20dashboard`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        auth: {
          username: DOMO_CLIENT_ID,
          password: DOMO_CLIENT_SECRET,
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;
    console.log("✅ Got OAuth token");

    res.json({
      token: accessToken,
      expires_in: tokenResponse.data.expires_in,
      token_type: tokenResponse.data.token_type,
      scope: tokenResponse.data.scope,
      note: "Use this token as 'access_token' parameter in embed URL",
    });
  } catch (err) {
    console.error(
      "❌ Error generating token:",
      err.response?.data || err.message
    );

    if (err.response?.data?.error === "invalid_client") {
      return res.status(400).json({
        message: "Invalid Domo Client ID or Secret",
        details:
          "Please check your DOMO_CLIENT_ID and DOMO_CLIENT_SECRET environment variables",
      });
    }

    res.status(err.response?.status || 500).json({
      message: "Failed to generate token",
      details: err.response?.data || err.message,
    });
  }
});

/** 🔹 Alternative: Direct embed token generation using Domo's approach */
app.get("/domo/embed-token/:cardId", async (req, res) => {
  const { cardId } = req.params;

  try {
    const tokenResponse = await axios.post(
      "https://api.domo.com/oauth/token",
      `grant_type=client_credentials&scope=data%20user%20dashboard`,
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        auth: {
          username: DOMO_CLIENT_ID,
          password: DOMO_CLIENT_SECRET,
        },
      }
    );

    const accessToken = tokenResponse.data.access_token;

    res.json({
      success: true,
      access_token: accessToken,
      embed_url: `https://embed.domo.com/embed/cards/${cardId}?access_token=${accessToken}&domoapps=true&embed_domain=localhost`,
    });
  } catch (err) {
    console.error("Error:", err.response?.data || err.message);
    res.status(500).json({
      error: "Failed to generate embed token",
      details: err.response?.data || err.message,
    });
  }
});



// ✅ Simple user data storage (in production, use database)
let currentUserData = {
  userId: "123",
  userName: "Deepak Yadav",
  lastUpdated: Date.now()
};

// ✅ Store current user data
app.post("/api/user-data", (req, res) => {
  try {
    const { userId, userName } = req.body;
    
    currentUserData = {
      userId: userId || "123",
      userName: userName || "Deepak Yadav",
      lastUpdated: Date.now()
    };

    console.log('💾 User data stored:', currentUserData);
    
    res.json({ 
      success: true, 
      message: "User data stored successfully",
      data: currentUserData
    });
  } catch (error) {
    console.error('❌ Error storing user data:', error);
    res.status(500).json({ 
      error: "Failed to store user data",
      details: error.message 
    });
  }
});

// ✅ Get current user data
app.get("/api/user-data", (req, res) => {
  try {
    console.log('📥 User data retrieved:', currentUserData);
    res.json(currentUserData);
  } catch (error) {
    console.error('❌ Error retrieving user data:', error);
    res.status(500).json({ 
      error: "Failed to retrieve user data",
      details: error.message 
    });
  }
});

/** 🔹 Health Check */
app.get("/", (req, res) => res.send("✅ Domo Node App is running"));

/** 🔹 Start Server */
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📝 User session endpoints available at /api/user-session`);
  await getDomoAccessToken();
});

app.use(
  express.static("dist", {
    setHeaders: (res, path) => {
      if (path.endsWith(".js")) {
        res.setHeader("Content-Type", "application/javascript");
      }
    },
  })
);

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
  DOMO_INSTANCE = "https://lionbridge.domo.com", // ✅ Add your instance base here
  PORT = 4000,
} = process.env;

let domoAccessToken = "";

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

    // 1️⃣ Get OAuth token using client credentials
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

    // 2️⃣ Domo doesn't have a separate embed token API
    // For private embeds, we use the OAuth token directly as the access_token
    // OR we need to use Domo's official embed SDK approach

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

    // Handle specific Domo API errors
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
    // Get OAuth token
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

    // For Domo, the OAuth token can often be used directly for embeds
    // But the proper way is to use it with specific embed parameters

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

/** 🔹 Health Check */
app.get("/", (req, res) => res.send("✅ Domo Node App is running"));

/** 🔹 Start Server */
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await getDomoAccessToken();
});

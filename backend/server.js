const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = process.env.PORT || 3000;

const FRONTEND_URL = process.env.FRONTEND_URL || "https://s3-retail-solutions.onrender.com";
const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://admin:ZSYVyCmQynPYV8NJWBCLVea3YxkW630y@dpg-d3182cbuibrs73aajh5g-a/inventory_db_4al1";

app.use(
  cors({
    origin: FRONTEND_URL,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

const pool = new Pool(
  DATABASE_URL
    ? {
        connectionString: DATABASE_URL,
        ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
      }
    : {
        user: process.env.PGUSER || "postgres",
        host: process.env.PGHOST || "localhost",
        database: process.env.PGDATABASE || "postgres",
        password: process.env.PGPASSWORD || "admin",
        port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : 5432,
      }
);

function formatDateMMDDYYYY(d) {
  if (!d) return "";
  const dt = new Date(d);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

const CSV_HEADERS = [
  "Date",
  "Marketid",
  "custno",
  "company",
  "Item",
  "Status",
  "Itmdesc",
  "In_Stock",
  "In_Transit",
  "Total_Stock",
  "cost",
  "Allocations",
  "W1",
  "W2",
  "W3",
  "30_days",
  "OVERNIGHT",
  "To_Order_Cost_Overnight",
  "2_DAY_SHIP",
  "To_Order_Cost_2DAY",
  "GROUND",
  "To_Order_Cost_GROUND",
  "Recommended Quntitty",
  "Recommended Shipping",
];

// Health check endpoint
app.get("/health", async (req, res) => {
  try {
    const now = await pool.query("SELECT NOW()");
    res.json({ ok: true, db_time: now.rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Data range endpoint for inventory_data
app.post("/api/get-data-for-range", async (req, res) => {
  const { startDate, endDate } = req.body;
  if (!startDate || !endDate) {
    return res.status(400).json({ message: "Start and end dates are required." });
  }
  try {
    const start = startDate;
    // Append time to include whole day endDate until 23:59:59
    const end = `${endDate} 23:59:59`;
    const q = `SELECT * FROM public.inventory_data WHERE date BETWEEN $1 AND $2 ORDER BY date ASC`;
    const result = await pool.query(q, [start, end]);
    if (!result.rows || result.rows.length === 0) {
      return res.json({ headers: CSV_HEADERS, data: [] });
    }
    const mapped = result.rows.map((r) => ({
      Date: formatDateMMDDYYYY(r.date),
      Marketid: r.marketid || "",
      custno: r.custno || "",
      company: r.company || "",
      Item: r.item || "",
      Status: r.status || "",
      Itmdesc: r.itmdesc || "",
      In_Stock: r.in_stock != null ? r.in_stock : 0,
      In_Transit: r.in_transit != null ? r.in_transit : 0,
      Total_Stock: r.total_stock != null ? r.total_stock : 0,
      cost: r.cost != null ? Number(r.cost) : 0,
      Allocations: r.allocations != null ? r.allocations : 0,
      W1: r.w1 != null ? r.w1 : 0,
      W2: r.w2 != null ? r.w2 : 0,
      W3: r.w3 != null ? r.w3 : 0,
      "30_days": r.days_30 != null ? r.days_30 : 0,
      OVERNIGHT: r.overnight != null ? r.overnight : 0,
      To_Order_Cost_Overnight: r.to_order_cost_overnight != null ? Number(r.to_order_cost_overnight) : 0,
      "2_DAY_SHIP": r.two_day_ship != null ? r.two_day_ship : 0,
      To_Order_Cost_2DAY: r.to_order_cost_2day != null ? Number(r.to_order_cost_2day) : 0,
      GROUND: r.ground != null ? r.ground : 0,
      To_Order_Cost_GROUND: r.to_order_cost_ground != null ? Number(r.to_order_cost_ground) : 0,
      "Recommended Quntitty": r.recommended_quantity != null ? String(r.recommended_quantity) : "",
      "Recommended Shipping": r.recommended_shipping != null ? String(r.recommended_shipping) : "",
    }));
    res.json({ headers: CSV_HEADERS, data: mapped });
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ message: "Failed to query database." });
  }
});

// Existing approve endpoint for writing to CSV
app.post("/api/approve", (req, res) => {
  const { headers, data } = req.body;
  const csvFilePath = path.join(__dirname, "approved_suggestion.csv");
  const timestamp = new Date().toISOString();
  const headersWithTimestamp = ["Timestamp", ...headers];
  const dataWithTimestamp = [timestamp, ...data];
  const fileExists = fs.existsSync(csvFilePath);
  const csvRow = dataWithTimestamp.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(",");
  const contentToAppend = (fileExists ? "\n" : headersWithTimestamp.join(",") + "\n") + csvRow;
  fs.appendFile(csvFilePath, contentToAppend, "utf8", (err) => {
    if (err) {
      console.error("Failed to save approval:", err);
      return res.status(500).json({ message: "Failed to save approval." });
    }
    res.status(200).json({ message: "Approval saved successfully!" });
  });
});

// Serve CSV file
app.get("/approved_suggestion.csv", (req, res) => {
  const csvFilePath = path.join(__dirname, "approved_suggestion.csv");
  res.sendFile(csvFilePath, (err) => {
    if (err) {
      res.status(404).send("File not found");
    }
  });
});

// Markets endpoint
app.get("/api/get-all-markets", async (req, res) => {
  try {
    const q = `SELECT DISTINCT marketid FROM public.inventory_data WHERE marketid IS NOT NULL ORDER BY marketid ASC`;
    const result = await pool.query(q);
    const markets = result.rows.map((r) => r.marketid);
    res.json({ data: markets });
  } catch (err) {
    console.error("DB error (get-all-markets):", err);
    res.status(500).json({ message: "Failed to fetch markets." });
  }
});

// Add approved data to history_data table with correct quoting
app.post("/api/add-history", async (req, res) => {
  const {
    Marketid,
    company,
    Itmdesc,
    cost,
    Total_Stock,
    Original_Recommended_Qty,
    Order_Qty,
    Total_Cost,
    Recommended_Shipping,
    Approved_By,
  } = req.body;
  const Approved_At = new Date().toISOString();
  try {
    const sql = `
      INSERT INTO history_data (
        marketid, company, itmdesc, cost, "Total_Stock",
        "Original_Recommended_Qty", "Order_Qty", "Total_Cost",
        "Recommended_Shipping", "Approved_By", approved_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `;
    await pool.query(sql, [
      Marketid,
      company,
      Itmdesc,
      cost,
      Total_Stock,
      Original_Recommended_Qty,
      Order_Qty,
      Total_Cost,
      Recommended_Shipping,
      Approved_By,
      Approved_At,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("Add history error:", err);
    res.status(500).json({ message: "Failed to save history record.", error: err.message });
  }
});

// Get history data filtered by date range and optional filters with endDate inclusive to whole day
app.post("/api/get-history-for-range", async (req, res) => {
  try {
    const { startDate, endDate, marketid } = req.body;
    const inclusiveEndDate = `${endDate} 23:59:59`;

    let sql = `
      SELECT
        marketid,
        company,
        itmdesc,
        cost,
        "Total_Stock" AS total_stock,
        "Original_Recommended_Qty" AS original_recommended_qty,
        "Order_Qty" AS order_qty,
        "Total_Cost" AS total_cost,
        "Recommended_Shipping" AS recommended_shipping,
        "Approved_By" AS approved_by,
        approved_at
      FROM history_data
      WHERE approved_at BETWEEN $1 AND $2
    `;

    const params = [startDate, inclusiveEndDate];
    let idx = 3;

    // Filter by marketid only if not admin
    if (marketid && marketid.trim() !== "" && marketid !== "admin") {
      sql += ` AND marketid = $${idx++}`;
      params.push(marketid.trim());
    }

    sql += ` ORDER BY approved_at DESC`;

    const result = await pool.query(sql, params);
    res.json({ data: result.rows });
  } catch (err) {
    console.error("Get history error:", err);
    res.status(500).json({ message: "Failed to fetch history.", error: err.message });
  }
});


// Root
app.get("/", (req, res) => res.send("OK - server up"));

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const mysql = require("mysql2");

const app = express();
app.use(express.urlencoded({ extended: true }));

const config = JSON.parse(
  fs.readFileSync("./config/rpc.json")
);
const db = mysql.createConnection({
    host: 'localhost',
    user: 'validity_explorer',
    password: 'testnet',
    database: 'validity_testnet_explorer'
});

db.connect(err => {
    if(err) {
        console.error('DB connection failed:', err);
    } else {
        console.log('Connected to MariaDB successfully.');
    }
});

async function rpcCall(method, params = []) {
  const response = await axios.post(
    `http://${config.rpchost}:${config.rpcport}`,
    {
      jsonrpc: "1.0",
      id: "explorer",
      method,
      params
    },
    {
      auth: {
        username: config.rpcuser,
        password: config.rpcpassword
      }
    }
  );

  return response.data.result;
}

async function syncBlocks() {
  try {
    const [rows] = await db.promise().query(
      "SELECT MAX(height) as height FROM blocks"
    );

    let lastHeight = rows[0].height || 0;
    const chainHeight = await rpcCall("getblockcount");

    console.log(`Syncing from ${lastHeight + 1} to ${chainHeight}`);

    for (let height = lastHeight + 1; height <= chainHeight; height++) {
      const blockHash = await rpcCall("getblockhash", [height]);
      const block = await rpcCall("getblock", [blockHash, true]);

      // Insert block
      await db.promise().query(
        "INSERT IGNORE INTO blocks (height, hash, time) VALUES (?, ?, ?)",
        [block.height, block.hash, new Date(block.time * 1000)]
      );

      // Insert transactions
      for (const txid of block.tx) {
        await db.promise().query(
          "INSERT IGNORE INTO transactions (txid, blockheight, time) VALUES (?, ?, ?)",
          [txid, block.height, new Date(block.time * 1000)]
        );
      }

      console.log("Synced block", height);
    }

    console.log("Sync complete");
  } catch (err) {
    console.error("Sync error:", err.message);
  }
}

// Run sync every 10 seconds
setInterval(syncBlocks, 10000);

// Homepage
app.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = 1000;
    const offset = (page - 1) * limit;

    // Get blocks and transaction counts + total outputs
    const [blocks] = await db.promise().query(
      `SELECT b.*, COUNT(t.txid) as txcount, COALESCE(SUM(t.num_outputs), 0) as outputcount
       FROM blocks b
       LEFT JOIN transactions t ON b.height = t.blockheight
       GROUP BY b.height
       ORDER BY b.height DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    // Total blocks for pagination
    const [countRows] = await db.promise().query(
      "SELECT COUNT(*) as count FROM blocks"
    );
    const totalBlocks = countRows[0].count;
    const totalPages = Math.ceil(totalBlocks / limit);

    // Build table rows
    let rowsHtml = "";
    for (const block of blocks) {
      rowsHtml += `
        <tr>
          <td><a href="/block/${block.height}">${block.height}</a></td>
          <td>${block.hash}</td>
          <td>${block.txcount}</td>
          <td>${block.outputcount}</td>
          <td>${new Date(block.time).toLocaleString()}</td>
        </tr>
      `;
    }

    // Render HTML
    res.send(`
      <html>
      <head>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Validity Testnet Explorer</h1>

        <form action="/search" method="post">
          <input name="query" placeholder="txid or block height">
          <button>Search</button>
        </form>

        <h2>Blocks (Page ${page} of ${totalPages})</h2>

        <table border="1" cellpadding="5">
          <tr>
            <th>Height</th>
            <th>Hash</th>
            <th>Transactions</th>
            <th>Outputs</th>
            <th>Time</th>
          </tr>
          ${rowsHtml}
        </table>

        <div style="margin-top:20px;">
          ${page > 1 ? `<a href="/?page=${page - 1}">⬅ Previous</a>` : ""}
          &nbsp;&nbsp;
          ${page < totalPages ? `<a href="/?page=${page + 1}">Next ➡</a>` : ""}
        </div>

        <div style="margin-top:20px;">
          <form method="get" action="/">
            Jump to page: <input name="page" type="number" min="1" max="${totalPages}">
            <button>Go</button>
          </form>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("Homepage error:", err);
    res.send("Error loading homepage");
  }
});
// Search
app.post("/search", (req, res) => {
  res.redirect("/tx/" + req.body.query);
});

// Block page
app.get("/block/:height", async (req, res) => {
  try {
    const height = parseInt(req.params.height);

    const hash = await rpcCall("getblockhash", [height]);
    const block = await rpcCall("getblock", [hash]);

    res.send(`
      <h1>Block ${height}</h1>
      <p>Hash: ${block.hash}</p>
      <p>Previous: ${block.previousblockhash}</p>

      <h3>Transactions</h3>
      <ul>
        ${block.tx.map(tx => `<li><a href="/tx/${tx}">${tx}</a></li>`).join("")}
      </ul>

      <a href="/">Back</a>
    `);
  } catch (err) {
    console.error(err);
    res.send("Error loading block");
  }
});

app.get("/tx/:txid", async (req, res) => {
  const txid = req.params.txid;

  try {
    // Get block height
    const [rows] = await db.promise().query(
      "SELECT blockheight FROM transactions WHERE txid = ?",
      [txid]
    );

    if (!rows.length) {
      return res.send("Transaction not found");
    }

    const blockHeight = rows[0].blockheight;

    // Get current height → confirmations
    const currentHeight = await rpcCall("getblockcount");
    const confirmations = currentHeight - blockHeight + 1;

    // Get tx details
    const tx = await rpcCall("getrawtransaction", [txid, 1]);

    // Total output
    let totalOut = 0;
    for (const vout of tx.vout) {
      totalOut += vout.value;
    }

    // Coinbase check
    const isCoinbase = tx.vin[0].coinbase !== undefined;

    // Basic stake detection (may vary)
    const isStake = tx.vin.length > 0 && !tx.vin[0].txid;

    // Time (fallback if not in tx)
    const blockHash = tx.blockhash;
    const block = await rpcCall("getblock", [blockHash]);
    const time = new Date(block.time * 1000).toLocaleString();

    res.send(`
      <h1>Transaction</h1>

      <p><b>TXID:</b> ${tx.txid}</p>
      <p><b>Amount:</b> ${totalOut}</p>
      <p><b>Confirmations:</b> ${confirmations}</p>
      <p><b>Date:</b> ${time}</p>
      <p><b>Type:</b> ${
        isCoinbase ? "Mined (Coinbase)" :
        isStake ? "Staked" :
        "Normal Transaction"
      }</p>

      <h3>Outputs</h3>
      <ul>
        ${tx.vout.map(v => `
          <li>${v.value} → ${v.scriptPubKey.addresses ? v.scriptPubKey.addresses.join(", ") : "N/A"}</li>
        `).join("")}
      </ul>

      <a href="/">Back</a>
    `);

  } catch (err) {
    console.error("TX ERROR:", err.response ? err.response.data : err.message);
    res.send("Error fetching transaction");
  }
});

// Static files
app.use(express.static("public"));

// Start server
app.listen(3000, () => {
  console.log("Explorer running on http://localhost:3000");
});

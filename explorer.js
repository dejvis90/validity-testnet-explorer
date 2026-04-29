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

    // Optional: force full resync
    let lastHeight = 0;  // Uncomment to resync from genesis
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

    for (const txid of block.tx) {
  const txData = await rpcCall("getrawtransaction", [txid, 1]);

  // 🔴 STEP 1: process inputs (read + store vins + mark spent)
  for (const vin of txData.vin) {
    if (vin.txid && vin.vout !== undefined) {

      // 1️⃣ Read previous output BEFORE marking spent
      const [rows] = await db.promise().query(
        "SELECT address, value FROM vouts WHERE txid = ? AND n = ?",
        [vin.txid, vin.vout]
      );

      if (rows.length) {
        const { address, value } = rows[0];

        // 2️⃣ Store vin (who spent what)
        await db.promise().query(
          "INSERT INTO vins (txid, prev_txid, prev_n, address, value) VALUES (?, ?, ?, ?, ?)",
          [txid, vin.txid, vin.vout, address, value]
        );
      }

      // 3️⃣ Mark as spent
      await db.promise().query(
        "UPDATE vouts SET spent = 1 WHERE txid = ? AND n = ?",
        [vin.txid, vin.vout]
      );
    }
  }

  // 🔴 STEP 2: detect type
  const isCoinbase = txData.vin[0].coinbase !== undefined;

  const isStake =
    !isCoinbase &&
    txData.vout.length > 0 &&
    (
      txData.vout[0].value === 0 ||
      !txData.vout[0].scriptPubKey.addresses
    );

  const type =
    isCoinbase ? 1 :
    isStake ? 2 :
    0;

  // 🔴 STEP 3: insert transaction
  await db.promise().query(
    "INSERT IGNORE INTO transactions (txid, blockheight, time, num_outputs, type) VALUES (?, ?, ?, ?, ?)",
    [
      txid,
      block.height,
      new Date(block.time * 1000),
      txData.vout.length,
      type
    ]
  );

  // 🔴 STEP 4: insert outputs
  for (let i = 0; i < txData.vout.length; i++) {
    const v = txData.vout[i];
    if (v.scriptPubKey && v.scriptPubKey.addresses) {
      for (const addr of v.scriptPubKey.addresses) {
        await db.promise().query(
          "INSERT IGNORE INTO vouts (txid, n, address, value) VALUES (?, ?, ?, ?)",
          [txid, i, addr, v.value]
        );
      }
    }
  }
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

app.get("/block/:height", async (req, res) => {
  try {
    const height = parseInt(req.params.height);

    const hash = await rpcCall("getblockhash", [height]);
    const block = await rpcCall("getblock", [hash]);

    // Fetch tx types from DB instead of RPC
    const [txRows] = await db.promise().query(
      "SELECT txid, type FROM transactions WHERE blockheight = ?",
      [height]
    );

    const txMap = new Map();
    txRows.forEach(t => txMap.set(t.txid, t.type));

    const txList = block.tx.map(txid => {
      const type = txMap.get(txid);

      const icon =
        type === 1 ? "⛏️" :
        type === 2 ? "💰" :
        "➡️";

      return `<li>${icon} <a href="/tx/${txid}">${txid}</a></li>`;
    });

    res.send(`
      <h1>Block ${height}</h1>
      <p>Hash: ${block.hash}</p>
      <p>Previous: ${block.previousblockhash}</p>

      <h3>Transactions</h3>
      <ul>
        ${txList.join("")}
      </ul>

      <a href="/">Back</a>
    `);

  } catch (err) {
    console.error(err);
    res.send("Error loading block");
  }
});

app.get("/address/:address", async (req, res) => {
  const address = req.params.address;

  try {
    // 1️⃣ Get all UTXOs for this address
    const utxos = await rpcCall("listunspent", [0, 9999999, [address]]);

    // Calculate balance
    const balance = utxos.reduce((sum, utxo) => sum + utxo.amount, 0);

    // 2️⃣ Optionally, get all transactions involving this address from your DB
    // This requires storing vouts/inputs in your DB during sync
    const [txRows] = await db.promise().query(
      `SELECT t.txid, t.blockheight, t.time
       FROM transactions t
       JOIN vouts v ON t.txid = v.txid
       WHERE v.address = ?
       ORDER BY t.time DESC`,
      [address]
    );

    // 3️⃣ Build HTML table for transactions
    let txHtml = "";
    for (const tx of txRows) {
      txHtml += `
        <tr>
          <td><a href="/tx/${tx.txid}">${tx.txid}</a></td>
          <td>${tx.blockheight}</td>
          <td>${new Date(tx.time).toLocaleString()}</td>
        </tr>
      `;
    }

    // 4️⃣ Render page
    res.send(`
      <html>
      <head>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Address: ${address}</h1>
        <p>Balance: ${balance} COIN</p>

        <h2>Transactions</h2>
        <table border="1" cellpadding="5">
          <tr>
            <th>TxID</th>
            <th>Block Height</th>
            <th>Time</th>
          </tr>
          ${txHtml || "<tr><td colspan='3'>No transactions found</td></tr>"}
        </table>

        <a href="/">Back</a>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("Address error:", err.response ? err.response.data : err.message);
    res.send("Error fetching address info");
  }
});

app.get("/richlist", async (req, res) => {
  try {
    // Aggregate balances per address
    const [rows] = await db.promise().query(`
      SELECT address, SUM(value) as balance
      FROM vouts
      WHERE spent = 0
      GROUP BY address
      ORDER BY balance DESC;

    // Build table HTML
    let html = "";
    rows.forEach((row, index) => {
      html += `
        <tr>
          <td>${index + 1}</td>
          <td><a href="/address/${row.address}">${row.address}</a></td>
          <td>${row.balance}</td>
        </tr>
      `;
    });

    // Render page
    res.send(`
      <html>
      <head>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Rich List (Top 100)</h1>
        <table border="1" cellpadding="5">
          <tr>
            <th>Rank</th>
            <th>Address</th>
            <th>Balance</th>
          </tr>
          ${html}
        </table>
        <a href="/">Back</a>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("Richlist error:", err.message);
    res.send("Error fetching rich list");
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

    const isCoinbase = tx.vin[0].coinbase !== undefined;

    const isStake =
      !isCoinbase &&
      tx.vout.length > 0 &&
      (
        tx.vout[0].value === 0 ||
        !tx.vout[0].scriptPubKey.addresses
      );

    // Time (fallback if not in tx)
    const blockHash = tx.blockhash;
    const block = await rpcCall("getblock", [blockHash]);
    const time = new Date(block.time * 1000).toLocaleString();
    const typeLabel =
      isCoinbase ? "⛏️ Mined (Coinbase)" :
      isStake ? "💰 Staked" :
      "➡️ Transfer";
    res.send(`
      <h1>Transaction</h1>

      <p><b>TXID:</b> ${tx.txid}</p>
      <p><b>Amount:</b> ${totalOut}</p>
      <p><b>Confirmations:</b> ${confirmations}</p>
      <p><b>Date:</b> ${time}</p>
      <p><b>Type:</b> ${typeLabel}</p>
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

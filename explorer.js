const express = require("express");
const axios = require("axios");
const fs = require("fs");
const mysql = require("mysql2");

const app = express();
app.use(express.urlencoded({ extended: true }));

const config = JSON.parse(
  fs.readFileSync("./config/rpc.json")
);
const mysql = require('mysql2');

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
    const height = await rpcCall("getblockcount");

    let blocks = "";

    for (let i = height; i > height - 20 && i >= 0; i--) {
      const hash = await rpcCall("getblockhash", [i]);
      const block = await rpcCall("getblock", [hash]);

      blocks += `
        <tr>
          <td>${i}</td>
          <td><a href="/block/${i}">${block.hash}</a></td>
          <td>${block.tx.length}</td>
        </tr>
      `;
    }

    res.send(`
      <html>
      <head>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Validity Testnet Explorer</h1>

        <form action="/search" method="post">
          <input name="query" placeholder="txid">
          <button>Search</button>
        </form>

        <h2>Latest Blocks</h2>

        <table>
          <tr>
            <th>Height</th>
            <th>Hash</th>
            <th>Transactions</th>
          </tr>
          ${blocks}
        </table>
      </body>
      </html>
    `);
  } catch (err) {
    console.error(err);
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
    console.log("Looking up TX:", txid);

    // 1️⃣ Get block height from DB
    const [rows] = await db.promise().query(
      "SELECT blockheight FROM transactions WHERE txid = ?",
      [txid]
    );

    if (!rows.length) {
      console.log("TX not found in DB");
      return res.send("Transaction not found in database");
    }

    const blockHeight = rows[0].blockheight;
    console.log("Block height:", blockHeight);

    // 2️⃣ Get block hash from DB
    const [blockRows] = await db.promise().query(
      "SELECT hash FROM blocks WHERE height = ?",
      [blockHeight]
    );

    if (!blockRows.length) {
      console.log("Block not found for height:", blockHeight);
      return res.send("Block not found in database");
    }

    const blockHash = blockRows[0].hash;
    console.log("Block hash:", blockHash);

    // 3️⃣ Fetch transaction from daemon
    let tx;

    try {
      tx = await rpcCall("getrawtransaction", [
        txid,
        1,
        blockHash
      ]);
    } catch (rpcErr) {
      console.error("RPC ERROR:", rpcErr.response ? rpcErr.response.data : rpcErr.message);

      return res.send(`
        <h1>Transaction</h1>
        <p>${txid}</p>
        <p>Transaction exists in DB but RPC fetch failed.</p>
        <a href="/">Back</a>
      `);
    }

    // 4️⃣ Render result
    res.send(`
      <h1>Transaction</h1>
      <p><b>TXID:</b> ${tx.txid}</p>

      <pre>${JSON.stringify(tx, null, 2)}</pre>

      <a href="/">Back</a>
    `);

  } catch (err) {
    console.error("TX ROUTE ERROR:", err);
    res.send("Error fetching transaction");
  }
});
// Static files
app.use(express.static("public"));

// Start server
app.listen(3000, () => {
  console.log("Explorer running on http://localhost:3000");
});

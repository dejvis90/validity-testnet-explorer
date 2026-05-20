const express = require("express");
const axios = require("axios");
const fs = require("fs");
const mysql = require("mysql2");

const app = express();
app.use(express.urlencoded({ extended: true }));

const config = JSON.parse(
  fs.readFileSync("./config/rpc.json")
);
const requiredConfig = [
  "rpcuser",
  "rpcpassword",
  "rpchost",
  "rpcport",
  "dbhost",
  "dbuser",
  "dbpassword",
  "dbname",
  "dbport"
];

for (const key of requiredConfig) {
  if (config[key] === undefined || config[key] === "") {
    throw new Error(`Missing required config value: ${key}`);
  }
}

const coinbaseMaturity = config.coinbaseMaturity || 120;
const db = mysql.createPool({
    host: config.dbhost,
    user: config.dbuser,
    password: config.dbpassword,
    database: config.dbname,
    port: config.dbport,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, connection) => {
    if(err) {
        console.error('DB connection failed:', err);
    } else {
        connection.release();
        console.log('Connected to MariaDB successfully.');
    }
});
let utxoCache = {
  height: null,
  addresses: null,
  utxos: null
};

async function rpcCall(method, params = []) {
  const response = await axios.post(
async function rpc(method, params = []) {
  const res = await axios.post(
    `http://${config.rpchost}:${config.rpcport}`,
    {
      jsonrpc: "1.0",
@@ -65,684 +32,317 @@ async function rpcCall(method, params = []) {
    }
  );

  return response.data.result;
}
  if (res.data.error) {
    throw new Error(res.data.error.message || JSON.stringify(res.data.error));
  }

async function getIndexedHeight() {
  const [rows] = await db.promise().query(
    "SELECT COALESCE(MAX(height), 0) as height FROM blocks"
  );
  return res.data.result;
}

  return rows[0].height;
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

async function updateAddressBalance(address, amount, conn = db.promise()) {
  await conn.query(
    `INSERT INTO addresses (address, balance) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
    [address, amount]
  );
function toSatoshis(amount) {
  const normalized = typeof amount === "number" ? amount.toFixed(8) : String(amount);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0").slice(0, 8));
}

function formatCoin(value) {
  return Number(value || 0).toFixed(8);
function formatCoins(satoshis) {
  const sign = satoshis < 0n ? "-" : "";
  const value = satoshis < 0n ? -satoshis : satoshis;
  const whole = value / 100000000n;
  const fraction = (value % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? "." + fraction : ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
function outputAddress(vout) {
  const script = vout.scriptPubKey || {};

  if (script.address) {
    return script.address;
  }

  if (Array.isArray(script.addresses) && script.addresses.length === 1) {
    return script.addresses[0];
  }

  return null;
}

let isSyncing = false;
async function getDecodedTransaction(txid, txOrId) {
  if (txOrId && typeof txOrId === "object") {
    return txOrId;
  }

async function rollbackBlock(height) {
  const conn = await db.promise().getConnection();
  return rpc("getrawtransaction", [txid, true]);
}

async function getBlockWithTransactions(hash) {
  try {
    await conn.beginTransaction();

    const [txRows] = await conn.query(
      "SELECT txid FROM transactions WHERE blockheight = ?",
      [height]
    );
    const txids = txRows.map(row => row.txid);

    if (txids.length) {
      const [unspentOutputs] = await conn.query(
        "SELECT address, value FROM vouts WHERE txid IN (?) AND spent = 0",
        [txids]
      );

      for (const output of unspentOutputs) {
        await updateAddressBalance(output.address, `-${output.value}`, conn);
      }
    const block = await rpc("getblock", [hash, 2]);

      const [restoredInputs] = await conn.query(
        `SELECT vin.address, vin.value
         FROM vins vin
         JOIN transactions prev_t ON vin.prev_txid = prev_t.txid
         WHERE vin.txid IN (?) AND prev_t.blockheight < ?`,
        [txids, height]
      );

      await conn.query(
        `UPDATE vouts prev_vout
         JOIN vins vin
           ON prev_vout.txid = vin.prev_txid
          AND prev_vout.n = vin.prev_n
         JOIN transactions prev_t ON vin.prev_txid = prev_t.txid
         SET prev_vout.spent = 0
         WHERE vin.txid IN (?) AND prev_t.blockheight < ?`,
        [txids, height]
      );

      for (const input of restoredInputs) {
        await updateAddressBalance(input.address, input.value, conn);
      }

      await conn.query("DELETE FROM vouts WHERE txid IN (?)", [txids]);
      await conn.query("DELETE FROM vins WHERE txid IN (?)", [txids]);
      await conn.query("DELETE FROM transactions WHERE txid IN (?)", [txids]);
    if (Array.isArray(block.tx) && block.tx.every(tx => typeof tx === "object")) {
      return block;
    }

    await conn.query("DELETE FROM blocks WHERE height = ?", [height]);
    await conn.commit();
    console.log("Rolled back block", height);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
    // Older daemons may only support txid blocks; fall back below.
  }

  const block = await rpc("getblock", [hash]);
  const txids = block.tx || [];
  block.tx = await Promise.all(txids.map(txid => rpc("getrawtransaction", [txid, true])));
  return block;
}

async function rollbackReorgedTip() {
  while (true) {
    const [rows] = await db.promise().query(
      "SELECT height, hash FROM blocks ORDER BY height DESC LIMIT 1"
    );
async function getUtxoSnapshot() {
  const height = await rpc("getblockcount");

    if (!rows.length) return 0;
  if (utxoCache.height === height && utxoCache.addresses && utxoCache.utxos) {
    return utxoCache;
  }

    const { height, hash } = rows[0];
    const chainHeight = await rpcCall("getblockcount");
  const utxos = new Map();
  const addresses = new Map();

    if (height > chainHeight) {
      await rollbackBlock(height);
      continue;
    }
  for (let blockHeight = 0; blockHeight <= height; blockHeight++) {
    const hash = await rpc("getblockhash", [blockHeight]);
    const block = await getBlockWithTransactions(hash);
    const transactions = block.tx || [];

    const chainHash = await rpcCall("getblockhash", [height]);
    if (chainHash === hash) return height;
    for (const txOrId of transactions) {
      const txid = typeof txOrId === "string" ? txOrId : txOrId.txid;
      const tx = await getDecodedTransaction(txid, txOrId);

    await rollbackBlock(height);
  }
}
      for (const vin of tx.vin || []) {
        if (!vin.txid || vin.vout === undefined) {
          continue;
        }

async function indexBlock(block, txList) {
  const conn = await db.promise().getConnection();
        const spentKey = `${vin.txid}:${vin.vout}`;
        const spent = utxos.get(spentKey);

  try {
    await conn.beginTransaction();

    for (const txData of txList) {
      for (const vin of txData.vin) {
        if (vin.txid && vin.vout !== undefined) {
          const [rows] = await conn.query(
            "SELECT address, value FROM vouts WHERE txid = ? AND n = ? AND spent = 0",
            [vin.txid, vin.vout]
          );

          if (rows.length) {
            const [spentResult] = await conn.query(
              "UPDATE vouts SET spent = 1 WHERE txid = ? AND n = ? AND spent = 0",
              [vin.txid, vin.vout]
            );

            if (spentResult.affectedRows) {
              for (const row of rows) {
                await conn.query(
                  "INSERT INTO vins (txid, prev_txid, prev_n, address, value) VALUES (?, ?, ?, ?, ?)",
                  [txData.txid, vin.txid, vin.vout, row.address, row.value]
                );
                await updateAddressBalance(row.address, `-${row.value}`, conn);
              }
            }
          }
        if (spent) {
          addresses.set(spent.address, (addresses.get(spent.address) || 0n) - spent.amount);
          utxos.delete(spentKey);
        }
      }

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

      await conn.query(
        "INSERT INTO transactions (txid, blockheight, time, num_outputs, type) VALUES (?, ?, ?, ?, ?)",
        [
          txData.txid,
          block.height,
          new Date(block.time * 1000),
          txData.vout.length,
          type
        ]
      );

      for (let i = 0; i < txData.vout.length; i++) {
        const v = txData.vout[i];
        if (v.scriptPubKey && v.scriptPubKey.addresses) {
          for (const addr of v.scriptPubKey.addresses) {
            const [insertResult] = await conn.query(
              "INSERT INTO vouts (txid, n, address, value) VALUES (?, ?, ?, ?)",
              [txData.txid, i, addr, v.value]
            );

            if (insertResult.affectedRows) {
              await updateAddressBalance(addr, v.value, conn);
            }
          }
      for (const vout of tx.vout || []) {
        const address = outputAddress(vout);

        if (!address) {
          continue;
        }

        const amount = toSatoshis(vout.value);
        const key = `${tx.txid}:${vout.n}`;
        const utxo = {
          txid: tx.txid,
          vout: vout.n,
          address,
          amount,
          height: blockHeight
        };

        utxos.set(key, utxo);
        addresses.set(address, (addresses.get(address) || 0n) + amount);
      }
    }

    await conn.query(
      "INSERT INTO blocks (height, hash, time) VALUES (?, ?, ?)",
      [block.height, block.hash, new Date(block.time * 1000)]
    );

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  utxoCache = { height, addresses, utxos };
  return utxoCache;
}

async function syncBlocks() {
  if (isSyncing) return;
  isSyncing = true;
app.get("/", async (req, res) => {
  const height = await rpc("getblockcount");

  try {
    const lastHeight = await rollbackReorgedTip();
    const chainHeight = await rpcCall("getblockcount");
  let blocks = "";

    console.log(`Syncing from ${lastHeight + 1} to ${chainHeight}`);
  for (let i = height; i > height - 10 && i >= 0; i--) {
    const hash = await rpc("getblockhash", [i]);
    const block = await rpc("getblock", [hash]);

    for (let height = lastHeight + 1; height <= chainHeight; height++) {
      const blockHash = await rpcCall("getblockhash", [height]);
      const block = await rpcCall("getblock", [blockHash, true]);
      const txList = [];
    blocks += `
      <tr>
        <td>${i}</td>
        <td><a href="/block/${i}">${block.hash}</a></td>
        <td>${block.tx.length}</td>
      </tr>
    `;
  }

      for (const txid of block.tx) {
        txList.push(await rpcCall("getrawtransaction", [txid, 1]));
      }
  res.send(`
    <html>
    <head>
      <link rel="stylesheet" href="/style.css">
    </head>

      await indexBlock(block, txList);
      console.log("Synced block", height);
    }
    <body>
      <h1>Validity Testnet Explorer</h1>

    console.log("Sync complete");
  } catch (err) {
  console.error("Sync error:", err.message);
  } finally {
    isSyncing = false;
  }
}
      <form action="/search" method="post">
        <input name="query" placeholder="txid or address">
        <button>Search</button>
      </form>

// Run sync every 10 seconds
setInterval(syncBlocks, 10000);
      <p><a href="/richlist">Richlist</a></p>

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
      <h2>Latest Blocks</h2>

      <table>
        <tr>
          <td><a href="/block/${block.height}">${block.height}</a></td>
          <td>${block.hash}</td>
          <td>${block.txcount}</td>
          <td>${block.outputcount}</td>
          <td>${new Date(block.time).toLocaleString()}</td>
          <th>Height</th>
          <th>Hash</th>
          <th>Transactions</th>
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
        ${blocks}

  } catch (err) {
    console.error("Homepage error:", err);
    res.send("Error loading homepage");
  }
      </table>
    </body>
    </html>
  `);
});
// Search

app.post("/search", (req, res) => {
  res.redirect("/tx/" + req.body.query);
  const query = String(req.body.query || "").trim();

  if (/^[0-9a-fA-F]{64}$/.test(query)) {
    res.redirect("/tx/" + query);
    return;
  }

  res.redirect("/address/" + encodeURIComponent(query));
});

app.get("/block/:height", async (req, res) => {
  try {
    const height = parseInt(req.params.height);
  const height = parseInt(req.params.height);

    const hash = await rpcCall("getblockhash", [height]);
    const block = await rpcCall("getblock", [hash]);
  const hash = await rpc("getblockhash", [height]);
  const block = await rpc("getblock", [hash]);

    // Fetch tx types from DB instead of RPC
    const [txRows] = await db.promise().query(
      "SELECT txid, type FROM transactions WHERE blockheight = ?",
      [height]
    );
  res.send(`
    <h1>Block ${height}</h1>
    <p>Hash: ${block.hash}</p>
    <p>Previous: ${block.previousblockhash}</p>
    <p>Transactions:</p>

    const txMap = new Map();
    txRows.forEach(t => txMap.set(t.txid, t.type));
    <ul>
      ${block.tx.map(tx => `<li><a href="/tx/${tx}">${tx}</a></li>`).join("")}
    </ul>

    const txList = block.tx.map(txid => {
      const type = txMap.get(txid);

      const icon =
        type === 1 ? "⛏️" :
        type === 2 ? "💰" :
        "➡️";
    <a href="/">Back</a>
  `);
});

      return `<li>${icon} <a href="/tx/${txid}">${txid}</a></li>`;
    });
app.get("/tx/:txid", async (req, res) => {
  const tx = await rpc("getrawtransaction", [req.params.txid, true]);

    res.send(`
      <h1>Block ${height}</h1>
      <p>Hash: ${block.hash}</p>
      <p>Previous: ${block.previousblockhash}</p>
  res.send(`
    <h1>Transaction</h1>

      <h3>Transactions</h3>
      <ul>
        ${txList.join("")}
      </ul>
    <p>${tx.txid}</p>

      <a href="/">Back</a>
    `);
    <pre>${JSON.stringify(tx, null, 2)}</pre>

  } catch (err) {
    console.error(err);
    res.send("Error loading block");
  }
    <a href="/">Back</a>
  `);
});

app.get("/address/:address", async (req, res) => {
  const address = req.params.address;

  try {
    const escapedAddress = escapeHtml(address);

    const [[summary]] = await db.promise().query(
      `SELECT
         COALESCE(a.balance, 0) as balance,
         COALESCE(received.total, 0) as received,
         COALESCE(sent.total, 0) as sent,
         COALESCE(tx_counts.txcount, 0) as txcount
       FROM (SELECT ? as address) requested
       LEFT JOIN addresses a ON a.address = requested.address
       LEFT JOIN (
         SELECT address, SUM(value) as total
         FROM vouts
         WHERE address = ?
         GROUP BY address
       ) received ON received.address = requested.address
       LEFT JOIN (
         SELECT address, SUM(value) as total
         FROM vins
         WHERE address = ?
         GROUP BY address
       ) sent ON sent.address = requested.address
       LEFT JOIN (
         SELECT address, COUNT(DISTINCT txid) as txcount
         FROM (
           SELECT address, txid FROM vouts WHERE address = ?
           UNION
           SELECT address, txid FROM vins WHERE address = ?
         ) address_txs
         GROUP BY address
       ) tx_counts ON tx_counts.address = requested.address`,
      [address, address, address, address, address]
    );

    const [[rankRow]] = await db.promise().query(
      `SELECT COUNT(*) + 1 as rank
       FROM addresses
       WHERE balance > ?`,
      [summary.balance]
    );

    const [txRows] = await db.promise().query(
      `SELECT
         t.txid,
         t.blockheight,
         t.time,
         t.type,
         COALESCE(received.total, 0) as received,
         COALESCE(sent.total, 0) as sent,
         COALESCE(received.total, 0) - COALESCE(sent.total, 0) as amount
       FROM transactions t
       JOIN (
         SELECT txid FROM vouts WHERE address = ?
         UNION
         SELECT txid FROM vins WHERE address = ?
       ) address_txs ON address_txs.txid = t.txid
       LEFT JOIN (
         SELECT txid, SUM(value) as total
         FROM vouts
         WHERE address = ?
         GROUP BY txid
       ) received ON received.txid = t.txid
       LEFT JOIN (
         SELECT txid, SUM(value) as total
         FROM vins
         WHERE address = ?
         GROUP BY txid
       ) sent ON sent.txid = t.txid
       ORDER BY t.time DESC`,
      [address, address, address, address]
    );

    let txHtml = "";
    for (const tx of txRows) {
      const amount = Number(tx.amount || 0);
      const typeLabel =
        tx.type === 1 ? "Mined" :
        tx.type === 2 ? "Staked" :
        amount < 0 ? "Sent" :
        "Received";

      txHtml += `
app.get("/richlist", async (req, res) => {
  const snapshot = await getUtxoSnapshot();
  const rows = [...snapshot.addresses.entries()]
    .filter(([, balance]) => balance > 0n)
    .sort((a, b) => (a[1] === b[1] ? 0 : a[1] > b[1] ? -1 : 1))
    .slice(0, 100)
    .map(([address, balance], index) => `
      <tr>
        <td>${index + 1}</td>
        <td><a href="/address/${encodeURIComponent(address)}">${escapeHtml(address)}</a></td>
        <td>${formatCoins(balance)}</td>
      </tr>
    `)
    .join("");

  res.send(`
    <html>
    <head>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <h1>Richlist</h1>
      <p>Calculated from unspent transaction outputs through block ${snapshot.height}.</p>

      <table>
        <tr>
          <td><a href="/tx/${escapeHtml(tx.txid)}">${escapeHtml(tx.txid)}</a></td>
          <td>${tx.blockheight}</td>
          <td>${new Date(tx.time).toLocaleString()}</td>
          <td>${typeLabel}</td>
          <td class="coin">${formatCoin(tx.received)}</td>
          <td class="coin">${formatCoin(tx.sent)}</td>
          <td class="coin ${amount < 0 ? "negative" : "positive"}">${formatCoin(amount)}</td>
          <th>Rank</th>
          <th>Address</th>
          <th>Balance</th>
        </tr>
      `;
    }
        ${rows}
      </table>

    res.send(`
      <html>
      <head>
        <link rel="stylesheet" href="/style.css">
      </head>
      <body>
        <h1>Address ${escapedAddress}</h1>

        <div class="summary-grid">
          <div class="summary-item">
            <span>Balance</span>
            <strong>${formatCoin(summary.balance)} VAL</strong>
          </div>
          <div class="summary-item">
            <span>Rich List</span>
            <strong>#${rankRow.rank}</strong>
          </div>
          <div class="summary-item">
            <span>Transactions</span>
            <strong>${summary.txcount}</strong>
          </div>
          <div class="summary-item">
            <span>Received</span>
            <strong>${formatCoin(summary.received)} VAL</strong>
          </div>
          <div class="summary-item">
            <span>Sent</span>
            <strong>${formatCoin(summary.sent)} VAL</strong>
          </div>
        </div>

        <h2>Transactions</h2>
        <table>
          <tr>
            <th>TxID</th>
            <th>Block</th>
            <th>Time</th>
            <th>Type</th>
            <th>Received</th>
            <th>Sent</th>
            <th>Amount</th>
          </tr>
          ${txHtml || "<tr><td colspan='7'>No transactions found</td></tr>"}
        </table>

        <a href="/">Back</a>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("Address error:", err.response ? err.response.data : err.message);
    res.send("Error fetching address info");
  }
      <a href="/">Back</a>
    </body>
    </html>
  `);
});

app.get("/richlist", async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT address, balance
      FROM addresses
      WHERE balance > 0
      ORDER BY balance DESC
      LIMIT 100
    `);

    const [[summary]] = await db.promise().query(`
      SELECT
        COUNT(*) as addressCount,
        COALESCE(SUM(balance), 0) as totalBalance
      FROM addresses
      WHERE balance > 0
    `);

    // Build table HTML
    let html = "";
    rows.forEach((row, index) => {
      html += `
app.get("/address/:address", async (req, res) => {
  const address = req.params.address;
  const snapshot = await getUtxoSnapshot();
  const balance = snapshot.addresses.get(address) || 0n;
  const rows = [...snapshot.utxos.values()]
    .filter(utxo => utxo.address === address)
    .sort((a, b) => b.height - a.height)
    .map(utxo => `
      <tr>
        <td>${utxo.height}</td>
        <td><a href="/tx/${utxo.txid}">${utxo.txid}</a></td>
        <td>${utxo.vout}</td>
        <td>${formatCoins(utxo.amount)}</td>
      </tr>
    `)
    .join("");

  res.send(`
    <html>
    <head>
      <link rel="stylesheet" href="/style.css">
    </head>
    <body>
      <h1>Address</h1>
      <p>${escapeHtml(address)}</p>
      <p>Balance: ${formatCoins(balance)}</p>

      <h2>Unspent Outputs</h2>
      <table>
        <tr>
          <td>${index + 1}</td>
          <td><a href="/address/${escapeHtml(row.address)}">${escapeHtml(row.address)}</a></td>
          <td class="coin">${formatCoin(row.balance)}</td>
          <th>Block</th>
          <th>Transaction</th>
          <th>Output</th>
          <th>Amount</th>
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
        <div class="summary-grid">
          <div class="summary-item">
            <span>Total Balance</span>
            <strong>${formatCoin(summary.totalBalance)} VAL</strong>
          </div>
          <div class="summary-item">
            <span>Addresses</span>
            <strong>${summary.addressCount}</strong>
          </div>
        </div>

        <table>
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
      "SELECT blockheight, type FROM transactions WHERE txid = ?",
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
    const type = rows[0].type;

    const typeLabel =
      type === 1 ? "⛏️ Mined (Coinbase)" :
      type === 2 ? "💰 Staked" :
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
        ${rows}
      </table>

      <a href="/">Back</a>
    `);

  } catch (err) {
    console.error("TX ERROR:", err.response ? err.response.data : err.message);
    res.send("Error fetching transaction");
  }
    </body>
    </html>
  `);
});

// Static files
app.use(express.static("public"));

// Start server
app.listen(3000, () => {
  console.log("Explorer running on http://localhost:3000");
});

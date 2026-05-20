const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.urlencoded({ extended: true }));

const config = JSON.parse(
  fs.readFileSync("./config/rpc.json")
);

let utxoCache = {
  height: null,
  addresses: null,
  utxos: null
};

async function rpc(method, params = []) {
  const res = await axios.post(
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

  return res.data.result;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function toSatoshis(amount) {
  const normalized = typeof amount === "number" ? amount.toFixed(8) : String(amount);
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0").slice(0, 8));
}

function formatCoins(satoshis) {
  const sign = satoshis < 0n ? "-" : "";
  const value = satoshis < 0n ? -satoshis : satoshis;
  const whole = value / 100000000n;
  const fraction = (value % 100000000n).toString().padStart(8, "0").replace(/0+$/, "");
  return `${sign}${whole}${fraction ? "." + fraction : ""}`;
}

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

async function getDecodedTransaction(txid, txOrId) {
  if (txOrId && typeof txOrId === "object") {
    return txOrId;
  }

  return rpc("getrawtransaction", [txid, true]);
}

async function getBlockWithTransactions(hash) {
  try {
    const block = await rpc("getblock", [hash, 2]);

    if (Array.isArray(block.tx) && block.tx.every(tx => typeof tx === "object")) {
      return block;
    }
  } catch (err) {
    // Older daemons may only support txid blocks; fall back below.
  }

  const block = await rpc("getblock", [hash]);
  const txids = block.tx || [];
  block.tx = await Promise.all(txids.map(txid => rpc("getrawtransaction", [txid, true])));
  return block;
}

async function getUtxoSnapshot() {
  const height = await rpc("getblockcount");

  if (utxoCache.height === height && utxoCache.addresses && utxoCache.utxos) {
    return utxoCache;
  }

  const utxos = new Map();
  const addresses = new Map();

  for (let blockHeight = 0; blockHeight <= height; blockHeight++) {
    const hash = await rpc("getblockhash", [blockHeight]);
    const block = await getBlockWithTransactions(hash);
    const transactions = block.tx || [];

    for (const txOrId of transactions) {
      const txid = typeof txOrId === "string" ? txOrId : txOrId.txid;
      const tx = await getDecodedTransaction(txid, txOrId);

      for (const vin of tx.vin || []) {
        if (!vin.txid || vin.vout === undefined) {
          continue;
        }

        const spentKey = `${vin.txid}:${vin.vout}`;
        const spent = utxos.get(spentKey);

        if (spent) {
          addresses.set(spent.address, (addresses.get(spent.address) || 0n) - spent.amount);
          utxos.delete(spentKey);
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
  }

  utxoCache = { height, addresses, utxos };
  return utxoCache;
}

app.get("/", async (req, res) => {
  const height = await rpc("getblockcount");

  let blocks = "";

  for (let i = height; i > height - 10 && i >= 0; i--) {
    const hash = await rpc("getblockhash", [i]);
    const block = await rpc("getblock", [hash]);

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
        <input name="query" placeholder="txid or address">
        <button>Search</button>
      </form>

      <p><a href="/richlist">Richlist</a></p>

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
});

app.post("/search", (req, res) => {
  const query = String(req.body.query || "").trim();

  if (/^[0-9a-fA-F]{64}$/.test(query)) {
    res.redirect("/tx/" + query);
    return;
  }

  res.redirect("/address/" + encodeURIComponent(query));
});

app.get("/block/:height", async (req, res) => {
  const height = parseInt(req.params.height);

  const hash = await rpc("getblockhash", [height]);
  const block = await rpc("getblock", [hash]);

  res.send(`
    <h1>Block ${height}</h1>
    <p>Hash: ${block.hash}</p>
    <p>Previous: ${block.previousblockhash}</p>
    <p>Transactions:</p>

    <ul>
      ${block.tx.map(tx => `<li><a href="/tx/${tx}">${tx}</a></li>`).join("")}
    </ul>

    <a href="/">Back</a>
  `);
});

app.get("/tx/:txid", async (req, res) => {
  const tx = await rpc("getrawtransaction", [req.params.txid, true]);

  res.send(`
    <h1>Transaction</h1>

    <p>${tx.txid}</p>

    <pre>${JSON.stringify(tx, null, 2)}</pre>

    <a href="/">Back</a>
  `);
});

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
          <th>Rank</th>
          <th>Address</th>
          <th>Balance</th>
        </tr>
        ${rows}
      </table>

      <a href="/">Back</a>
    </body>
    </html>
  `);
});

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
          <th>Block</th>
          <th>Transaction</th>
          <th>Output</th>
          <th>Amount</th>
        </tr>
        ${rows}
      </table>

      <a href="/">Back</a>
    </body>
    </html>
  `);
});

app.use(express.static("public"));

app.listen(3000, () => {
  console.log("Explorer running on http://localhost:3000");
});

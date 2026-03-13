const express = require("express");
const axios = require("axios");
const fs = require("fs");

const app = express();
app.use(express.urlencoded({ extended: true }));

const config = JSON.parse(
  fs.readFileSync("./config/rpc.json")
);

const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'user',
    password: 'password',
    database: 'dbname'
});

db.connect(err => {
    if(err) {
        console.error('DB connection failed:', err);
    } else {
        console.log('Connected to MariaDB successfully.');
    }
});

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
});

app.post("/search", (req, res) => {
  res.redirect("/tx/" + req.body.query);
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

app.use(express.static("public"));

app.listen(3000, () => {
  console.log("Explorer running on http://localhost:3000");
});

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




const rpcUser = "user";
const rpcPassword = "test";
const rpcPort = 47993; // replace with your testnet RPC port
const rpcUrl = `http://127.0.0.1:${rpcPort}`;

async function rpcCall(method, params = []) {
    const data = {
        jsonrpc: "1.0",
        id: "explorer",
        method,
        params
    };
    const auth = {
        username: rpcUser,
        password: rpcPassword
    };
    const response = await axios.post(rpcUrl, data, { auth });
    return response.data.result;
    const height = await rpcCall("getblockcount");
    console.log("Current chain height:", height);
}
setInterval(syncBlocks, 10000); // check every 10 seconds
async function rpc(method, params = []) {
console.log('Starting syncBlocks');
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
async function syncBlocks() {
    const lastRow = await db.promise().query(
        "SELECT MAX(height) as height FROM blocks"
    );
    let lastHeight = lastRow[0][0].height || 0;

    const chainHeight = await rpcCall("getblockcount");

    console.log(`Syncing from ${lastHeight + 1} to ${chainHeight}`);

    for (let height = lastHeight + 1; height <= chainHeight; height++) {
        const blockHash = await rpcCall("getblockhash", [height]);
        const block = await rpcCall("getblock", [blockHash, true]); // verbosity 2 includes txs

        // Insert block
        await db.promise().query(
            "INSERT IGNORE INTO blocks (height, hash, time) VALUES (?, ?, ?)",
            [block.height, block.hash, new Date(block.time * 1000)]
        );

        // Insert transactions
        for (const tx of block.tx) {
            await db.promise().query(
                "INSERT INTO transactions (txid, blockheight, time) VALUES (?, ?, ?)",
                [tx, block.height, new Date(block.time * 1000)]
            );
        }
	const txRow = rows[0];
	const [blockRows] = await db.promise().query(
	  "SELECT hash FROM blocks WHERE height = ?",
	  [txRow.blockheight]
	);

	blockHash = blockRows[0].hash;
	const [tx] = await db.promise().query(
	  "SELECT * FROM transactions WHERE txid = ?",
	  [req.params.txid]
	);
    }
    console.log("Sync complete");
}

app.get("/", async (req, res) => {
  const height = await rpc("getblockcount");

  let blocks = "";

  for (let i = height; i > height - 100 && i >= 0; i--) {
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

    const txid = req.params.txid;

    try {

        // 1️⃣ Get block height from DB

        const [rows] = await db.promise().query(

            "SELECT blockheight FROM transactions WHERE txid = ?",

            [txid]

        );



        if (!rows.length) {

            return res.send("Transaction not found");

        }

        // 2️⃣ Get block hash

        const [blockRows] = await db.promise().query(

            "SELECT hash FROM blocks WHERE height = ?",

            [rows[0].blockheight]

        );

        const blockHash = blockRows[0].hash;
        console.log("Calling getrawtransaction with txid:", txid);



        // 3️⃣ Now call RPC (after blockHash exists)

        const tx = await rpcCall("getrawtransaction", [

            txid,

            1

        ]);
        res.send(`
	    <h1>Transaction</h1>

	    <p>${tx.txid}</p>

	    <pre>${JSON.stringify(tx, null, 2)}</pre>

	    <a href="/">Back</a>
	  `);


    } catch (err) {



                console.error(err);


                console.error("RPC call failed:", err.response ? err.response.data : err.message);

                res.send("Error fetching transaction");

            }

});

  

app.use(express.static("public"));

app.listen(3000, () => {
  console.log("Explorer running on http://localhost:3000");
});

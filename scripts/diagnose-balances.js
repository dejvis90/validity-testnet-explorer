const axios = require("axios");
const fs = require("fs");
const mysql = require("mysql2/promise");

const config = JSON.parse(fs.readFileSync("./config/rpc.json"));
const coinbaseMaturity = config.coinbaseMaturity || 120;

async function rpcCall(method, params = []) {
  const response = await axios.post(
    `http://${config.rpchost}:${config.rpcport}`,
    {
      jsonrpc: "1.0",
      id: "diagnose-balances",
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

  if (response.data.error) {
    throw new Error(JSON.stringify(response.data.error));
  }

  return response.data.result;
}

function coin(value) {
  return Number(value || 0).toFixed(8);
}

async function main() {
  const db = await mysql.createConnection({
    host: config.dbhost,
    user: config.dbuser,
    password: config.dbpassword,
    database: config.dbname,
    port: config.dbport
  });

  const [[dbTip]] = await db.query(
    "SELECT COALESCE(MAX(height), 0) as height FROM blocks"
  );
  const nodeTip = await rpcCall("getblockcount");
  const immatureHeight = dbTip.height - coinbaseMaturity + 1;

  let dbTipHash = null;
  let nodeTipHashAtDbHeight = null;
  if (dbTip.height > 0 && dbTip.height <= nodeTip) {
    [[{ hash: dbTipHash }]] = await db.query(
      "SELECT hash FROM blocks WHERE height = ?",
      [dbTip.height]
    );
    nodeTipHashAtDbHeight = await rpcCall("getblockhash", [dbTip.height]);
  }

  const [[addressTotal]] = await db.query(
    "SELECT COALESCE(SUM(balance), 0) as total FROM addresses"
  );
  const [[voutTotal]] = await db.query(
    "SELECT COALESCE(SUM(value), 0) as total FROM vouts WHERE spent = 0"
  );
  const [[immatureTotal]] = await db.query(
    `SELECT COALESCE(SUM(v.value), 0) as total
     FROM vouts v
     JOIN transactions t ON v.txid = t.txid
     WHERE v.spent = 0
       AND t.type IN (1, 2)
       AND t.blockheight > ?`,
    [immatureHeight]
  );
  const [[spendableTotal]] = await db.query(
    `SELECT COALESCE(SUM(a.balance - COALESCE(i.immatureBalance, 0)), 0) as total
     FROM addresses a
     LEFT JOIN (
       SELECT v.address, SUM(v.value) as immatureBalance
       FROM vouts v
       JOIN transactions t ON v.txid = t.txid
       WHERE v.spent = 0
         AND t.type IN (1, 2)
         AND t.blockheight > ?
       GROUP BY v.address
     ) i ON i.address = a.address`,
    [immatureHeight]
  );
  const [[richTop100]] = await db.query(
    `SELECT COALESCE(SUM(balance), 0) as total
     FROM (
       SELECT balance
       FROM addresses
       WHERE balance > 0
       ORDER BY balance DESC
       LIMIT 100
     ) richlist`
  );
  const [[addressCount]] = await db.query(
    "SELECT COUNT(*) as count FROM addresses WHERE balance > 0"
  );
  const [typeTotals] = await db.query(
    `SELECT
       t.type,
       COUNT(DISTINCT t.txid) as transactions,
       COALESCE(SUM(CASE WHEN v.spent = 0 THEN v.value ELSE 0 END), 0) as unspent
     FROM transactions t
     LEFT JOIN vouts v ON v.txid = t.txid
     GROUP BY t.type
     ORDER BY t.type`
  );
  const [largestImmature] = await db.query(
    `SELECT v.address, SUM(v.value) as total
     FROM vouts v
     JOIN transactions t ON v.txid = t.txid
     WHERE v.spent = 0
       AND t.type IN (1, 2)
       AND t.blockheight > ?
     GROUP BY v.address
     ORDER BY total DESC
     LIMIT 10`,
    [immatureHeight]
  );

  let txoutSet = null;
  try {
    txoutSet = await rpcCall("gettxoutsetinfo");
  } catch (err) {
    txoutSet = { error: err.message };
  }

  let walletBalance = null;
  try {
    walletBalance = await rpcCall("getbalance");
  } catch (err) {
    walletBalance = { error: err.message };
  }

  const cacheDrift = Number(addressTotal.total) - Number(voutTotal.total);
  const outsideTop100 = Number(addressTotal.total) - Number(richTop100.total);

  console.log("Balance diagnostics");
  console.log("===================");
  console.log(`DB tip: ${dbTip.height}`);
  console.log(`Node tip: ${nodeTip}`);
  console.log(`DB is behind by: ${nodeTip - dbTip.height} blocks`);
  console.log(`DB tip hash matches node: ${dbTipHash && nodeTipHashAtDbHeight ? dbTipHash === nodeTipHashAtDbHeight : "n/a"}`);
  console.log(`Coinbase/coinstake maturity: ${coinbaseMaturity}`);
  console.log("");
  console.log(`addresses total cached: ${coin(addressTotal.total)}`);
  console.log(`vouts unspent total:     ${coin(voutTotal.total)}`);
  console.log(`cache drift:             ${coin(cacheDrift)}`);
  console.log("");
  console.log(`immature mined/staked:   ${coin(immatureTotal.total)}`);
  console.log(`all spendable indexed:   ${coin(spendableTotal.total)}`);
  console.log(`richlist top 100 total:  ${coin(richTop100.total)}`);
  console.log(`outside richlist top100: ${coin(outsideTop100)}`);
  console.log(`positive address count:  ${addressCount.count}`);
  console.log("");
  console.log("Unspent totals by transaction type:");
  for (const row of typeTotals) {
    console.log(`  type ${row.type}: tx=${row.transactions}, unspent=${coin(row.unspent)}`);
  }
  console.log("");
  console.log("Largest immature address totals:");
  for (const row of largestImmature) {
    console.log(`  ${row.address}: ${coin(row.total)}`);
  }
  console.log("");
  console.log("validityd getbalance:");
  console.log(typeof walletBalance === "object" ? JSON.stringify(walletBalance) : coin(walletBalance));
  console.log("");
  console.log("validityd gettxoutsetinfo:");
  console.log(JSON.stringify(txoutSet, null, 2));

  await db.end();
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});

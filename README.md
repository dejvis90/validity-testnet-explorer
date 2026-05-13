# Validity Testnet Explorer

Simple Node.js block explorer for the Validity testnet. It syncs blocks from a running `validityd` RPC node into MariaDB and serves block, transaction, address, and rich-list pages from the indexed database.

## Requirements

- Node.js 18 or newer
- npm
- MariaDB server and client
- A fully running `validityd` node with RPC enabled

The explorer listens on:

```text
http://localhost:3000
```

## Install Node.js

Check your installed version:

```bash
node -v
```

If Node.js is missing or too old, install a current LTS version. On Ubuntu/Debian:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Install MariaDB

```bash
sudo apt install mariadb-server mariadb-client -y
sudo systemctl start mariadb
sudo systemctl enable mariadb
sudo mysql_secure_installation
```

## Create Database And User

Log in as MariaDB root:

```bash
sudo mysql
```

Create the explorer database and user:

```sql
CREATE DATABASE validity_testnet_explorer;
CREATE USER 'validity_explorer'@'localhost' IDENTIFIED BY 'testnet';
GRANT ALL PRIVILEGES ON validity_testnet_explorer.* TO 'validity_explorer'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

Use a stronger password if this is not a local test setup. The explorer reads database credentials only from `config/rpc.json`, so the values in that file must match the database user you create here.

## Create Tables

Log in to the explorer database:

```bash
mysql -u validity_explorer -p validity_testnet_explorer
```

Create the schema:

```sql
CREATE TABLE blocks (
  height BIGINT PRIMARY KEY,
  hash VARCHAR(128),
  time DATETIME
);

CREATE TABLE transactions (
  txid VARCHAR(128) PRIMARY KEY,
  blockheight BIGINT,
  time DATETIME,
  num_outputs INT DEFAULT 0,
  type INT DEFAULT 0
);

CREATE TABLE addresses (
  address VARCHAR(128) PRIMARY KEY,
  balance DECIMAL(32,8) NOT NULL DEFAULT 0
);

CREATE TABLE vouts (
  txid VARCHAR(64),
  n INT,
  address VARCHAR(128),
  value DECIMAL(32,8),
  spent TINYINT(1) DEFAULT 0,
  PRIMARY KEY(txid, n)
);

CREATE TABLE vins (
  txid VARCHAR(64),
  prev_txid VARCHAR(64),
  prev_n INT,
  address VARCHAR(128),
  value DECIMAL(32,8)
);

CREATE INDEX idx_addresses_balance ON addresses (balance);
CREATE INDEX idx_vouts_address_spent ON vouts (address, spent);
CREATE INDEX idx_transactions_type_height ON transactions (type, blockheight);
```

Transaction `type` values are:

- `0`: normal transfer
- `1`: mined coinbase transaction
- `2`: staked/coinstake transaction

The `addresses` table stores cached unspent balances. The explorer updates it during sync when outputs are created and spent, so address pages and the rich list do not need slow full-table balance scans.

## Configure RPC And Database

Copy the example config:

```bash
cp config/rpc.example.json config/rpc.json
```

Edit `config/rpc.json`:

```json
{
  "rpcuser": "YOUR_RPCUSER",
  "rpcpassword": "YOUR_RPCPASSWORD",
  "rpchost": "127.0.0.1",
  "rpcport": 9332,
  "coinbaseMaturity": 120,
  "dbhost": "localhost",
  "dbuser": "validity_explorer",
  "dbpassword": "testnet",
  "dbname": "validity_testnet_explorer",
  "dbport": 3306
}
```

Set `rpcuser`, `rpcpassword`, and `rpcport` to match your `validityd` RPC configuration.

Set `dbhost`, `dbuser`, `dbpassword`, `dbname`, and `dbport` to match your MariaDB setup. The explorer does not store RPC or database credentials in `explorer.js`; it reads them from `config/rpc.json` only.

`coinbaseMaturity` controls when mined/staked outputs are counted as spendable. The current expected Validity testnet value is `120`.

## Install Explorer Dependencies

From the project directory:

```bash
npm install
```

## Run

Start the explorer:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

The explorer syncs blocks every 10 seconds. On first run it starts from the first unsynced block in the `blocks` table.

## Reset And Resync

To rebuild the index from scratch, stop the explorer first, then run:

```sql
SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE vins;
TRUNCATE TABLE vouts;
TRUNCATE TABLE addresses;
TRUNCATE TABLE transactions;
TRUNCATE TABLE blocks;
SET FOREIGN_KEY_CHECKS = 1;
```

Then start the explorer again with:

```bash
npm start
```

## Backfill Address Balances

If you already synced `vouts` before the `addresses` cache existed, rebuild only the cached address balances with:

```sql
TRUNCATE TABLE addresses;

INSERT INTO addresses (address, balance)
SELECT address, SUM(value)
FROM vouts
WHERE spent = 0
GROUP BY address;
```

## Pages

- `/` shows recent indexed blocks.
- `/block/:height` shows one block and its transactions.
- `/tx/:txid` shows one transaction.
- `/address/:address` shows cached spendable balance, immature mined/staked balance, and transactions.
- `/richlist` shows the top 100 cached spendable balances.

## Notes

- `validityd` must be running and reachable by RPC while the explorer syncs.
- Address and rich-list pages read balances from MariaDB, not from wallet RPC calls.
- Rich-list and address balances exclude immature mined/staked outputs until `coinbaseMaturity` confirmations.
- If balances look wrong after schema or sync-logic changes, do a full reset and resync.

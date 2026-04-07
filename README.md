# Validity Testnet Explorer

Simple RPC-based block explorer.

## Requirements

- Node.js
- Running validityd node
- RPC enabled

## Setup
mkJhxt732bcwxcGPnyTEobR4vUnvYPaj3w

Clone repo:

git clone <repo>

Install dependencies:

npm install

Copy RPC config:

cp config/rpc.example.json config/rpc.json

Edit credentials in rpc.json.

## Run

npm start

Open browser:

http://localhost:3000

## Node
Node needs to be atleast v19
If you are using older node (check with node -v),use:
sudo apt remove nodejs

curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -

sudo apt-get install -y nodejs

## Install Maria db

sudo apt install mariadb-server mariadb-client -y

sudo systemctl start mariadb
sudo systemctl enable mariadb

sudo mysql_secure_installation

-- Login as root
mysql -u root -p

-- Create a database for the explorer
CREATE DATABASE db_name;

-- Create a user for the explorer
CREATE USER 'user'@'localhost' IDENTIFIED BY 'yourpassword';

-- Grant privileges
GRANT ALL PRIVILEGES ON db_name.* TO 'user'@'localhost';

-- Apply changes
FLUSH PRIVILEGES;
EXIT;

{
  "rpcuser": "YOUR_RPCUSER",
  "rpcpassword": "YOUR_RPCPASSWORD",
  "rpchost": "127.0.0.1",
  "rpcport": 19332,
  "network": "testnet",

  "dbhost": "localhost",
  "dbuser": "explorer",
  "dbpassword": "yourpassword",
  "dbname": "testnet_explorer",
  "dbport": 3306,
}

USE testnet_explorer;

CREATE TABLE blocks (
    height BIGINT PRIMARY KEY,
    hash VARCHAR(128),
    time DATETIME
);

CREATE TABLE transactions (
    txid VARCHAR(128) PRIMARY KEY,
    blockheight BIGINT,
    time DATETIME
);

CREATE TABLE addresses (
    address VARCHAR(64) PRIMARY KEY,
    balance DECIMAL(32,8)
);


ALTER TABLE transactions ADD COLUMN num_outputs INT DEFAULT 0;


CREATE TABLE vouts (
  txid VARCHAR(64),
  n INT,
  address VARCHAR(128),
  value DECIMAL(32,8),
  PRIMARY KEY(txid, n)
);



ConnectBlock: Consensus::CheckBlock: bad-version, rejected for avg fee protocol nVersion=1 block (code 17)
2026-03-24 13:03:10 InvalidChainFound: invalid block=000072e428a5f5dc3173fc27a5ccd85c9dab13961a7d08140069149201b91150  height=0  log2_work=16.000022  date=2014-02-24 06:00:00

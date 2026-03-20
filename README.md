# Validity Testnet Explorer

Simple RPC-based block explorer.

## Requirements

- Node.js
- Running validityd node
- RPC enabled

## Setup

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
#!/bin/bash

# Your wallet address
ADDR="tb1qYourAddressHere"

# Number of blocks per iteration
BLOCKS=1

# Infinite loop (stop manually with Ctrl+C)
while true; do
    echo "Starting new iteration: generating $BLOCKS block(s)... $(date)"
    
    # Mine blocks
    bitcoin-cli generatetoaddress $BLOCKS $ADDR

    # Check wallet balance
    BALANCE=$(bitcoin-cli getbalance)
    echo "Iteration complete. Wallet balance: $BALANCE"
    
    # Optional pause between iterations (helps if node is busy)
    sleep 0.5
done

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

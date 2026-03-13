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
CREATE DATABASE testnet_explorer;

-- Create a user for the explorer
CREATE USER 'explorer'@'localhost' IDENTIFIED BY 'yourpassword';

-- Grant privileges
GRANT ALL PRIVILEGES ON testnet_explorer.* TO 'explorer'@'localhost';

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

  "port": 3000,
  "disableemails": true,
  "coin": "Validity Testnet",
  "symbol": "VLD"
}
"social": {
  "twitter": "",
  "facebook": "",
  "telegram": "",
  "discord": ""
}

sudo apt install gnupg curl -y

curl -fsSL https://pgp.mongodb.com/server-7.0.asc | \
sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg \
--dearmor

echo "deb [signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

sudo apt update

sudo apt install mongodb-org -y


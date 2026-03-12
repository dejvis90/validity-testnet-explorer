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

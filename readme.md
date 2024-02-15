# Readme

Demonstrates a reorg race condition issue in Geth with RPC call `eth_getTransactionReceipt`.

Immediately after a reorg, `eth_getTransactionReceipt` returns the `blockHash` of the old reorged block rather than the new block. This usually fixes itself but under some conditions can persist.

See [Geth issue 28992](https://github.com/ethereum/go-ethereum/issues/28992)

See [forked blocks tracked by Etherscan](https://etherscan.io/blocks_forked?p=1) 

## Geth info

- Geth Version: `geth version 1.13.11-stable-8f7eb9cc`
- OS: `Linux Ubuntu 22.04.3 LTS (Jammy Jellyfish)`
- Arch: `x86_64`
- Prysm version: `beacon-chain version Prysm/v4.2.1/59b310a2216c57fcf67ea0fdec739dad07aeec8b. Built at: 2024-01-30 16:26:21+00:00`

Geth initially synced via snap sync, switched to `--syncmode full` and `--gcmode archive` after syncing completed. Always `--state.scheme hash` and `--db.engine pebble`.

## Reproducing the issue

Install NodeJS `v20.10.0` (or a similar version).

In the project directory erun `npm install`.

Run `node ./main.js --rpc-http-url=http://127.0.0.1:8545 --rpc-ws-url=http://127.0.0.1:8546` with your ws or http urls.

When an inconsistensy is detected due to reorg a file will be saved under `./reorgs/block-<block number>/attempt-<attempt-number>.json` with the inconsistent data. The script will try 100 times to get consistent data at the given block number before giving up.

import { dirname, join } from 'node:path';
import { WebSocket, } from 'ws';
import { mkdir, writeFile } from 'node:fs/promises';

const argv = process.argv.join(' ');

const HTTP_URL = argv.match(/.*--rpc-http-url(?:=|\s+)['"]*(\S+)['"]*.*/)?.[1]
  || process.env.RPC_HTTP_URL
  || 'http://127.0.0.1:8545';
const WS_URL = argv.match(/.*--rpc-ws-url(?:=|\s+)['"]*(\S+)['"]*.*/)?.[1]
  || process.env.RPC_WS_URL
  || 'ws://127.0.0.1:8546';

console.log(`\x1b[32mrpc http url\x1b[0m:       ${HTTP_URL}`);
console.log(`\x1b[32mrpc websocket url\x1b[0m:  ${WS_URL}`);

let rpcIdSeq = 0;
let runIdSeq = 0;
let lastBlockHeader = await fetch(HTTP_URL, {
  keepalive: true,
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: (rpcIdSeq += 1).toString(),
    method: 'eth_getBlockByNumber',
    params: ['latest', true],
  }),
}).then((res) => res.json()).then(({ result }) => result);
async function onNewBlockHeader(header) {
  const prevHeader = lastBlockHeader;
  lastBlockHeader = header;
  const runId = (runIdSeq++).toLocaleString();
  const prevHeaderNumber = Number(prevHeader.number);
  const headerNumber = Number(header.number);
  const headerDate = new Date(1_000 * Number(header.timestamp));
  const prevHeaderDate = new Date(1_000 * Number(prevHeader.timestamp));
  const isHeaderRerorg = header.number <= prevHeader.number;
  const n = headerNumber.toLocaleString();
  console.info(
    `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
    + ` new block`
    + `\n  \x1b[32mreorg\x1b[0m:        ${isHeaderRerorg ? '\x1b[31myes\x1b[0m' : '\x1b[32mno\x1b[0m'}`
    + `\n  \x1b[32mnumber\x1b[0m`
    + `\n    \x1b[32mheader\x1b[0m:     ${headerNumber.toLocaleString()}  ${header.number}`
    + `\n    \x1b[32mprev\x1b[0m:       ${prevHeaderNumber.toLocaleString()}  ${prevHeader.number}`
    + `\n  \x1b[32mhash\x1b[0m`
    + `\n    \x1b[32mheader\x1b[0m:     \x1b[36m${header.hash.slice(0, 8)}\x1b[90m${header.hash.slice(8)}\x1b[0m`
    + `\n    \x1b[32mprev\x1b[0m:       \x1b[35m${prevHeader.hash.slice(0, 8)}\x1b[90m${prevHeader.hash.slice(8)}\x1b[0m`
    + `\n  \x1b[32mparentHash\x1b[0m`
    + `\n    \x1b[32mheader\x1b[0m:     \x1b[35m${header.parentHash.slice(0, 8)}\x1b[90m${header.parentHash.slice(8)}\x1b[0m`
    + `\n    \x1b[32mprev\x1b[0m:       \x1b[34m${prevHeader.parentHash.slice(0, 8)}\x1b[90m${prevHeader.parentHash.slice(8)}\x1b[0m`
    + `\n  \x1b[32mtimestamp\x1b[0m:`
    + `\n    \x1b[32mheader\x1b[0m:     ${headerDate.toISOString()}  ${header.timestamp}  ${((Date.now() - headerDate.valueOf()) / 1_000).toFixed(1)}s ago`
    + `\n    \x1b[32mprev\x1b[0m:       ${prevHeaderDate.toISOString()}  ${prevHeader.timestamp}  ${((Date.now() - prevHeaderDate.valueOf()) / 1_000).toFixed(1)}s ago`
  )

  // keep fetching the blocks & its txs until we have consistensy
  let attempt = 0;
  /** is eth_getTransactionReceipt inconsistent with eth_getBlockByNumber? */
  let receiptsAreInconsistent = false;
  while (attempt === 0 || receiptsAreInconsistent) {
    attempt += 1;
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 500));

    const block = await fetch(HTTP_URL, {
      keepalive: true,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: (rpcIdSeq += 1).toString(),
        method: 'eth_getBlockByNumber',
        params: [header.number, true],
      }),
    }).then((res) => res.json()).then(({ result }) => result);

    const blockNumber = Number(block.number);
    const blockDate = new Date(1_000 * Number(block.timestamp));

    if (attempt > 100) {
      console.info(
        `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
        + ` \x1b[31mfailed to get consistent block data after ${attempt - 1} attempts\x1b[0m`
        + `\n  \x1b[32mreorg\x1b[0m:        ${isHeaderRerorg ? '\x1b[31myes\x1b[0m' : '\x1b[32mno\x1b[0m'}`
        + `\n  \x1b[32mnumber\x1b[0m`
        + `\n    \x1b[32mheader\x1b[0m:     ${headerNumber.toLocaleString()}  ${header.number}`
        + `\n    \x1b[32mblock\x1b[0m:      ${blockNumber.toLocaleString()}  ${block.number}`
        + `\n    \x1b[32mprev\x1b[0m:       ${prevHeaderNumber.toLocaleString()}  ${prevHeader.number}`
        + `\n  \x1b[32mhash\x1b[0m`
        + `\n    \x1b[32mheader\x1b[0m:     \x1b[36m${header.hash.slice(0, 8)}\x1b[90m${header.hash.slice(8)}\x1b[0m`
        + `\n    \x1b[32mblock\x1b[0m:      \x1b[36m${block.hash.slice(0, 8)}\x1b[90m${block.hash.slice(8)}\x1b[0m`
        + `\n    \x1b[32mprev\x1b[0m:       \x1b[35m${prevHeader.hash.slice(0, 8)}\x1b[90m${prevHeader.hash.slice(8)}\x1b[0m`
        + `\n  \x1b[32mparentHash\x1b[0m`
        + `\n    \x1b[32mheader\x1b[0m:     \x1b[35m${header.parentHash.slice(0, 8)}\x1b[90m${header.parentHash.slice(8)}\x1b[0m`
        + `\n    \x1b[32mblock\x1b[0m:      \x1b[35m${block.parentHash.slice(0, 8)}\x1b[90m${block.parentHash.slice(8)}\x1b[0m`
        + `\n    \x1b[32mprev\x1b[0m:       \x1b[34m${prevHeader.parentHash.slice(0, 8)}\x1b[90m${prevHeader.parentHash.slice(8)}\x1b[0m`
        + `\n  \x1b[32mtimestamp\x1b[0m`
        + `\n    \x1b[32mheader\x1b[0m:     ${headerDate.toISOString()}  ${header.timestamp}  ${((Date.now() - headerDate.valueOf()) / 1_000).toFixed(1)}s ago`
        + `\n    \x1b[32mblock\x1b[0m:      ${blockDate.toISOString()}  ${block.timestamp}  ${((Date.now() - blockDate.valueOf()) / 1_000).toFixed(1)}s ago`
        + `\n    \x1b[32mprev\x1b[0m:       ${prevHeaderDate.toISOString()}  ${prevHeader.timestamp}  ${((Date.now() - prevHeaderDate.valueOf()) / 1_000).toFixed(1)}s ago`
      )
      throw new Error('failed to get consistent block data, exceeded max attempts')
    }

    const receipts = await Promise.all(block.transactions.map((tx) => fetch(HTTP_URL, {
      keepalive: true,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: (rpcIdSeq += 1).toString(),
        method: 'eth_getTransactionReceipt',
        params: [tx.hash],
      })
    }).then((res) => res.json()).then(({ result }) => result)));

    const inconsistentTxs = [];
    for (let tidx = 0, txCount = block.transactions.length; tidx < txCount; tidx++) {
      const tx = block.transactions[tidx];
      const receipt = receipts[tidx];
      if (tx.blockHash !== receipt.blockHash) {
        inconsistentTxs.push({ tx, receipt, });
      }
    }

    receiptsAreInconsistent = inconsistentTxs.length > 0;
    if (receiptsAreInconsistent) {
      const filename = join('reorgs', `block-${headerNumber}`, `attempt-${attempt.toString().padStart(3, '0')}.json`);
      console.warn(
        `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
          + ` \x1b[31minconsistent block data\x1b[0m`
          + `\n  \x1b[32mreorg\x1b[0m:            ${isHeaderRerorg ? '\x1b[31myes\x1b[0m' : '\x1b[32mno\x1b[0m'}`
          + `\n  \x1b[32minconsistent_txs\x1b[0m: ${inconsistentTxs.length.toLocaleString()}`
          + `\n  \x1b[32mfilename\x1b[0m:         ${filename}`
          + `\n  \x1b[32mheader.reorg\x1b[0m:     ${isHeaderRerorg ? '\x1b[31myes\x1b[0m' : '\x1b[32mno\x1b[0m'}`
          + `\n  \x1b[32mnumber\x1b[0m`
          + `\n    \x1b[32mheader\x1b[0m:         ${headerNumber.toLocaleString()}  ${header.number}`
          + `\n    \x1b[32mblock\x1b[0m:          ${blockNumber.toLocaleString()}  ${block.number}`
          + `\n    \x1b[32mprev\x1b[0m:           ${prevHeaderNumber.toLocaleString()}  ${prevHeader.number}`
          + `\n  \x1b[32mhash\x1b[0m`
          + `\n    \x1b[32mheader\x1b[0m:         \x1b[36m${header.hash.slice(0, 8)}\x1b[90m${header.hash.slice(8)}\x1b[0m`
          + `\n    \x1b[32mblock\x1b[0m:          \x1b[36m${block.hash.slice(0, 8)}\x1b[90m${block.hash.slice(8)}\x1b[0m`
          + `\n    \x1b[32mprev\x1b[0m:           \x1b[35m${prevHeader.hash.slice(0, 8)}\x1b[90m${prevHeader.hash.slice(8)}\x1b[0m`
          + `\n  \x1b[32mparentHash\x1b[0m`
          + `\n    \x1b[32mheader\x1b[0m:         \x1b[35m${header.parentHash.slice(0, 8)}\x1b[90m${header.parentHash.slice(8)}\x1b[0m`
          + `\n    \x1b[32mblock\x1b[0m:          \x1b[35m${block.parentHash.slice(0, 8)}\x1b[90m${block.parentHash.slice(8)}\x1b[0m`
          + `\n    \x1b[32mprev\x1b[0m:           \x1b[34m${prevHeader.parentHash.slice(0, 8)}\x1b[90m${prevHeader.parentHash.slice(8)}\x1b[0m`
          + `\n  \x1b[32mtimestamp\x1b[0m`
          + `\n    \x1b[32mheader\x1b[0m:         ${headerDate.toISOString()}  ${header.timestamp}  ${((Date.now() - headerDate.valueOf()) / 1_000).toFixed(1)}s ago`
          + `\n    \x1b[32mblock\x1b[0m:          ${blockDate.toISOString()}  ${block.timestamp}  ${((Date.now() - blockDate.valueOf()) / 1_000).toFixed(1)}s ago`
          + `\n    \x1b[32mprev\x1b[0m:           ${prevHeaderDate.toISOString()}  ${prevHeader.timestamp}  ${((Date.now() - prevHeaderDate.valueOf()) / 1_000).toFixed(1)}s ago`
      )
      await mkdir(dirname(filename), { recursive: true, });
      await writeFile(filename, JSON.stringify({
        timestamp: new Date().toISOString(),
        blockNumber: headerNumber.toLocaleString(),
        headerTimestamp: headerDate.toISOString(),
        blockTimestamp: blockDate.toISOString(),
        inconsistentTransactions: inconsistentTxs,
        header,
        block,
      }, null, 2));
    }
  };

  console.info(
    `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
    + ` block ok`
    + `  \x1b[32mheader.number\x1b[0m=${headerNumber.toLocaleString()}  \x1b[36m${header.hash.slice(0, 8)}\x1b[0m`
  );
}

const ws = new WebSocket(WS_URL);

ws.on('open', function() {
  ws.send(JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_subscribe',
    params: ['newHeads'],
  }));
})

ws.on('message', function(data) {
  const message = JSON.parse(data.toString());
  if (message.method === 'eth_subscription') {
    onNewBlockHeader(message.params.result);
  }
  if (message.method === undefined && message.id === 1) {
    console.log(`\x1b[32msubscribed to new blocks\x1b[0m  subscription=${message.result}`);
  }
})
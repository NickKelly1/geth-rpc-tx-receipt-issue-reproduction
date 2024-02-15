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

let rpcIdSeq = 0;
let runIdSeq = 0;
async function onNewBlockHeader(header) {
  const runId = (runIdSeq++).toLocaleString();
  const headerNumber = Number(header.number);
  const headerDate = new Date(1_000 * Number(header.timestamp));
  const n = headerNumber.toLocaleString();
  console.info(
    `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
    + ` new block`
    + `\n  \x1b[32mheader.number\x1b[0m:      ${headerNumber.toLocaleString()}  ${header.number}`
    + `\n  \x1b[32mheader.hash\x1b[0m:        \x1b[35m${header.hash.slice(0, 10)}\x1b[90m${header.hash.slice(10)}\x1b[0m`
    + `\n  \x1b[32mheader.parentHash\x1b[0m:  \x1b[35m${header.parentHash.slice(0, 10)}\x1b[90m${header.parentHash.slice(10)}\x1b[0m`
    + `\n  \x1b[32mheader.timestamp\x1b[0m:   ${headerDate.toISOString()}  ${header.timestamp}  ${Math.floor((Date.now() - headerDate.valueOf()) / 1_000)}s ago`
  )

  // keep fetching the blocks & its txs until we have consistensy
  let attempt = 0;
  /** is eth_getTransactionReceipt inconsistent with eth_getBlockByNumber? */
  let receiptsAreInconsistent = false;
  while (attempt === 0 || receiptsAreInconsistent) {
    attempt += 1;
    if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 750));

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
        + `\n  \x1b[32mheader.number\x1b[0m:      ${headerNumber.toLocaleString()}  ${header.number}`
        + `\n  \x1b[32mheader.hash\x1b[0m:        \x1b[35m${header.hash.slice(0, 10)}\x1b[90m${header.hash.slice(10)}\x1b[0m`
        + `\n  \x1b[32mheader.parentHash\x1b[0m:  \x1b[35m${header.parentHash.slice(0, 10)}\x1b[90m${header.parentHash.slice(10)}\x1b[0m`
        + `\n  \x1b[32mheader.timestamp\x1b[0m:   ${headerDate.toISOString()}  ${header.timestamp}  ${Math.floor((Date.now() - headerDate.valueOf()) / 1_000)}s ago`
        + `\n  \x1b[32mblock.number\x1b[0m:       ${blockNumber.toLocaleString()} ${block.number}`
        + `\n  \x1b[32mblock.hash\x1b[0m:         \x1b[35m${block.hash.slice(0, 10)}\x1b[90m${block.hash.slice(10)}\x1b[0m`
        + `\n  \x1b[32mblock.parentHash\x1b[0m:   \x1b[35m${block.parentHash.slice(0, 10)}\x1b[90m${block.parentHash.slice(10)}\x1b[0m`
        + `\n  \x1b[32mblock.timestamp\x1b[0m:    ${blockDate.toISOString()}  ${block.timestamp}  ${Math.floor((Date.now() - blockDate.valueOf()) / 1_000)}s ago`
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

    const inconsistentTransactions = [];
    txloop:
    for (let tidx = 0, txCount = block.transactions.length; tidx < txCount; tidx++) {
      const tx = block.transactions[tidx];
      const receipt = receipts[tidx];

      if (tx.blockHash !== receipt.blockHash) {
        inconsistentTransactions.push({ tx, receipt, });
        continue txloop;
      }
    }

    receiptsAreInconsistent = inconsistentTransactions.length > 0;
    if (receiptsAreInconsistent) {
      const filename = join('reorgs', `block-${headerNumber}`, `attempt-${attempt.toString().padStart(3, '0')}.json`);
      console.warn(
        `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
          + ` \x1b[31minconsistent block data\x1b[0m`
          + `\n  \x1b[32mtransactions\x1b[0m:       ${inconsistentTransactions.length.toLocaleString()}`
          + `\n  \x1b[32mfilename\x1b[0m:           ${filename}`
          + `\n  \x1b[32mheader.number\x1b[0m:      ${headerNumber.toLocaleString()}  ${header.number}`
          + `\n  \x1b[32mheader.hash\x1b[0m:        \x1b[35m${header.hash.slice(0, 10)}\x1b[90m${header.hash.slice(10)}\x1b[0m`
          + `\n  \x1b[32mheader.parentHash\x1b[0m:  \x1b[35m${header.parentHash.slice(0, 10)}\x1b[90m${header.parentHash.slice(10)}\x1b[0m`
          + `\n  \x1b[32mheader.timestamp\x1b[0m:   ${headerDate.toISOString()}  ${header.timestamp}  ${Math.floor((Date.now() - headerDate.valueOf()) / 1_000)}s ago`
          + `\n  \x1b[32mblock.number\x1b[0m:       ${blockNumber.toLocaleString()} ${block.number}`
          + `\n  \x1b[32mblock.hash\x1b[0m:         \x1b[35m${block.hash.slice(0, 10)}\x1b[90m${block.hash.slice(10)}\x1b[0m`
          + `\n  \x1b[32mblock.parentHash\x1b[0m:   \x1b[35m${block.parentHash.slice(0, 10)}\x1b[90m${block.parentHash.slice(10)}\x1b[0m`
          + `\n  \x1b[32mblock.timestamp\x1b[0m:    ${blockDate.toISOString()}  ${block.timestamp}  ${Math.floor((Date.now() - blockDate.valueOf()) / 1_000)}s ago`
      )
      await mkdir(dirname(filename), { recursive: true, });
      await writeFile(filename, JSON.stringify({
        timestamp: new Date().toISOString(),
        blockNumber: headerNumber.toLocaleString(),
        headerTimestamp: headerDate.toISOString(),
        blockTimestamp: blockDate.toISOString(),
        inconsistentTransactions,
        header,
        block,
      }, null, 2));
    }
  };

  console.info(
    `\x1b[90m[${new Date().toISOString()}  ${n}  ${runId}]\x1b[0m`
    + ` block ok`
    + `  \x1b[32mheader.number\x1b[0m=${headerNumber.toLocaleString()}  \x1b[35m${header.hash.slice(0, 10)}\x1b[0m`
  );
}

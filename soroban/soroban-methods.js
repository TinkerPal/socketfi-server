require("dotenv").config({ quiet: true });
const {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  TimeoutInfinite,
  Keypair,
  Memo,
  nativeToScVal,
  Account,
} = require("@stellar/stellar-sdk");

const { processArgs } = require("./utils");

const { StellarServers } = require("@sorobuild/stellar-sdk");
const ankrKey = process.env.ANKR_KEY;
const url = `https://rpc.ankr.com/stellar_soroban/${ankrKey}`;
const urlTest = `https://rpc.ankr.com/stellar_testnet_soroban/${ankrKey}`;
const url2 = "https://base-rpc-public.soro.build";
const urlTest2 = "https://soroban-testnet.stellar.org:443";

const urlTest3 = "https://base-rpc-testnet.soro.build";
const serverUrl = {
  rpc: {
    testnet: urlTest2,
    public: url,
  },
  horizon: {
    testnet: `https://rpc.ankr.com/premium-http/stellar_testnet_horizon/${ankrKey}`,
    public: `https://rpc.ankr.com/premium-http/stellar_horizon/${ankrKey}`,
  },
};

const key = process.env.KEY;

const { RpcServer, HorizonServer } = new StellarServers({
  key,
});

const primaryServer = new StellarServers({
  serverUrl,
}).RpcServer;

const secondaryServer = new StellarServers({
  key,
}).RpcServer;

const internalSigner = Keypair.fromSecret(process.env.SIGNER_PRIVATE_KEY);

async function invokeCreate(network, contractId, operation, args) {
  try {
    const invokeArgs = [];

    for (const eachArg of args) {
      if (eachArg?.type === "Wasm") {
        const wasmUpload = bufferStorage[pubKey];

        if (!wasmUpload) {
          return res
            .status(400)
            .json({ error: "Wasm file not found in bufferStorage" });
        }

        invokeArgs.push(nativeToScVal(wasmUpload));
      } else {
        invokeArgs.push(processArgs(eachArg));
      }
    }

    const contract = new Contract(contractId);

    const source = await RpcServer(network).getAccount(
      internalSigner.publicKey()
    );

    const txBuilder = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks[network],
    });

    const tx = txBuilder
      .addOperation(contract.call(operation, ...invokeArgs))
      .setTimeout(TimeoutInfinite);

    const builtTxXdr = tx.build().toXDR();

    const prepareTx = await RpcServer(network).prepareTransaction(builtTxXdr);

    const txSign = TransactionBuilder.fromXDR(prepareTx, Networks[network]);

    txSign.sign(internalSigner);

    const res = await RpcServer(network, "json").sendTransaction(
      txSign.toXDR()
    );

    return res;
  } catch (e) {
    console.log(e.message);
  }
}

// --- tiny helpers -----------------------------------------------------------
const q = new Map();
const enqueue = (k, job) => {
  const prev = q.get(k) || Promise.resolve();
  const next = prev.then(job, job);
  q.set(
    k,
    next.catch(() => {})
  );
  return next;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendWithTimeout(promise, ms) {
  let t;
  try {
    return await Promise.race([
      promise,
      new Promise(
        (_, rej) =>
          (t = setTimeout(() => rej(new Error("WATCHDOG_TIMEOUT")), ms))
      ),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

// Optional: if your server doesn’t already poll, use this
async function pollForFinality(
  server,
  hashHex,
  { tries = 15, delayMs = 1000 } = {}
) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await server.getTransaction(hashHex);
      if (r && (r.status === "SUCCESS" || r.status === "FAILED")) return r;
    } catch (_) {}
    await sleep(delayMs);
  }
  return null;
}

// --- main entry -------------------------------------------------------------
async function invokeContract(network, contractId, operation, args, opts = {}) {
  const {
    watchdogMs = 10_000, // trigger fee-bump if not settled/responded by then
    bumpFactor = 10, // ≥10x to replace mempool entry
    bumpFloorStroops = 2_000_000, // hard floor (tune to your budget)
  } = opts;

  const server = RpcServer(network, "json");
  const contract = new Contract(contractId);

  // PAYER (g-account) — also used as inner source in your current flow
  const payerKeypair = internalSigner;
  const payerId = payerKeypair.publicKey();

  // IMPORTANT: queue by the account whose sequence is used.
  // If inner source ≠ payer, queue by the INNER source instead.
  return enqueue(payerId, async () => {
    // -- 1) Build args -------------------------------------------------------
    const invokeArgs = [];
    for (const a of args || []) {
      if (a && a.type === "Wasm") {
        const wasmUpload = bufferStorage[payerId]; // or bufferStorage[walletId] if inner ≠ payer
        if (!wasmUpload)
          throw new Error("Wasm file not found in bufferStorage");
        invokeArgs.push(nativeToScVal(wasmUpload));
      } else {
        invokeArgs.push(processArgs(a));
      }
    }

    // -- 2) Build INNER tx (source = payer in your code)
    // If inner source ≠ payer, fetch that account here instead:
    // const innerSourceId = walletId; const source = await server.getAccount(innerSourceId);
    const source = await server.getAccount(payerId);

    let inner = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks[network],
    })
      .setTimeout(90)
      .addOperation(contract.call(operation, ...invokeArgs))
      .build();

    // -- 3) Prepare (simulate + footprint/resource fee)
    const preparedXdr = await server.prepareTransaction(inner.toXDR());
    inner = TransactionBuilder.fromXDR(preparedXdr, Networks[network]);

    // -- 4) Sign INNER
    // If the inner source is a *user wallet*, sign with that wallet instead:
    // inner.sign(userWalletKeypair);
    inner.sign(payerKeypair);

    const innerHashHex = inner.hash(Networks[network]).toString("hex");

    // -- 5) Try sending inner with watchdog
    let firstRes;
    try {
      firstRes = await sendWithTimeout(
        server.sendTransaction(inner.toXDR()),
        watchdogMs
      );
      // If your server.sendTransaction already polls to finality, it should return SUCCESS/FAILED here.
      if (firstRes && firstRes.status && firstRes.status !== "PENDING")
        return firstRes;
    } catch (e) {
      if (e.message !== "WATCHDOG_TIMEOUT") throw e; // real error => bubble up
      // Else fall through to fee-bump
    }

    // (Optional) quick peek if inner already finalized while we timed out
    try {
      const maybe = await server.getTransaction(innerHashHex);
      if (maybe?.status === "SUCCESS" || maybe?.status === "FAILED")
        return maybe;
    } catch (_) {}

    // -- 6) Fee-bump fallback (rebid much higher)
    const innerFee = parseInt(inner.fee, 10) || 0;
    const maxFee = Math.max(Math.ceil(innerFee * bumpFactor), bumpFloorStroops);

    let feeBump = TransactionBuilder.buildFeeBumpTransaction(
      payerId, // fee source (g-account)
      maxFee, // total fee in stroops
      inner, // the prepared & signed inner
      Networks[network]
    );
    feeBump.sign(payerKeypair);

    const fbRes = await server.sendTransaction(feeBump.toXDR());
    if (fbRes && fbRes.status && fbRes.status !== "PENDING") return fbRes;

    return fbRes || { status: "PENDING", innerHash: innerHashHex };
  });
}

async function contractGet(pubKey, network, contractId, operation, args) {
  try {
    const invokeArgs = [];

    for (const eachArg of args) {
      if (eachArg?.type === "Wasm") {
        const wasmUpload = bufferStorage[pubKey];

        if (!wasmUpload) {
          return res
            .status(400)
            .json({ error: "Wasm file not found in bufferStorage" });
        }

        invokeArgs.push(nativeToScVal(wasmUpload));

        // Don't delete bufferStorage[pubKey] yet; do it only after successful simulation
      } else {
        invokeArgs.push(processArgs(eachArg));
      }
    }

    const server = RpcServer(network, "json");
    const source = await server.getAccount(pubKey);
    const txBuilder = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks[network],
    });

    const contract = new Contract(contractId);
    const txXdr = txBuilder
      .addOperation(
        contract.call(
          operation,
          ...invokeArgs
          // nativeToScVal("4200", { type: "u32" })
        )
      )
      .setTimeout(TimeoutInfinite)
      .build()
      .toXDR();

    const res = await server.simulateTransaction(txXdr);

    return res;
  } catch (e) {
    console.log(e.message);
  }
}

async function invokeContractScVal(network, contractId, operation, invokeArgs) {
  const memo = "";
  const server = RpcServer(network, "json");
  const contract = new Contract(contractId);
  const source = await server.getAccount(internalSigner.publicKey());

  const txBuilderAny = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: Networks[network],
  })
    .setTimeout(TimeoutInfinite)
    .addOperation(contract.call(operation, ...invokeArgs));

  if (memo?.length > 0) {
    txBuilderAny.addMemo(Memo.text(memo));
  }

  const builtTx = txBuilderAny.build().toXDR();

  const prepareTx = await server.prepareTransaction(builtTx);

  const txSign = TransactionBuilder.fromXDR(prepareTx, Networks[network]);

  txSign.sign(internalSigner);

  const signedTx = txSign.toXDR();

  const res = await server.sendTransaction(signedTx);

  return res;
}

async function sendWithFailover(signedXdr, network) {
  let lastError;

  // Try primary first
  try {
    console.log("1 ran");
    return await primaryServer(network, "json").sendTransaction(signedXdr);
  } catch (err) {
    if (/timeout|ECONNRESET|network|fetch failed/i.test(err.message)) {
      console.warn("Primary RPC failed, switching to secondary...");
      lastError = err;
    } else {
      // Ledger-level error (txBAD_SEQ, txFAILED, etc.) → don’t retry
      throw err;
    }
  }

  // Fallback to secondary
  try {
    console.log("2 ran");
    return await secondaryServer(network, "json").sendTransaction(signedXdr);
  } catch (err) {
    throw lastError || err;
  }
}

module.exports = {
  sendWithFailover,
  invokeCreate,
  internalSigner,
  RpcServer,
  contractGet,
  invokeContract,
  invokeContractScVal,
};

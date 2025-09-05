require("dotenv").config({ quiet: true });
const {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  TimeoutInfinite,
  Keypair,
  Memo,
  Horizon,
  nativeToScVal,
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

    const res = await sendWithFailover(txSign.toXDR(), network);

    return res;
  } catch (e) {
    console.log(e.message);
  }
}

async function invokeContract(network, contractId, operation, args) {
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

    const source = await server.getAccount(internalSigner.publicKey());

    const contract = new Contract(contractId);

    const txBuilderAny = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: Networks[network],
    })
      .setTimeout(TimeoutInfinite)
      .addOperation(contract.call(operation, ...invokeArgs));
    const memo = "";
    if (memo?.length > 0) {
      txBuilderAny.addMemo(Memo.text(memo));
    }

    const txXdr = txBuilderAny.build().toXDR();

    const prepareTx = await server.prepareTransaction(txXdr);
    const txSign = TransactionBuilder.fromXDR(prepareTx, Networks[network]);

    txSign.sign(internalSigner);

    const signedTx = txSign.toXDR();

    const res = await sendWithFailover(signedTx, network);

    return res;
  } catch (e) {
    console.log(e.message);
  }
}

async function anyInvokeExternal(pubkey, network, contractId, operation, args) {
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

    const memo = "";

    const tx = txBuilder
      .addOperation(contract.call(operation, ...invokeArgs))
      .setTimeout(TimeoutInfinite);

    if (memo?.length > 0) {
      tx.addMemo(Memo.text(memo));
    }

    const builtTxXdr = tx.build().toXDR();

    const prepareTx = await RpcServer(network).prepareTransaction(builtTxXdr);

    const txSign = TransactionBuilder.fromXDR(prepareTx, Networks[network]);

    txSign.sign(internalSigner);

    const res = await sendWithFailover(txSign.toXDR(), network);

    return res;
  } catch (e) {
    console.log(e.message);
  }
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

  const res = await sendWithFailover(signedTx, network);

  return res;
}

async function sendWithFailover(signedXdr, network) {
  console.log("send ran");
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

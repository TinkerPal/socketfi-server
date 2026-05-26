const { xdr } = require("@stellar/stellar-sdk");

const { pushProgress } = require("../utils/progress");

const { recordTransaction } = require("../services/transaction.service");
const {
  invokeContract,
  contractGet,
  internalSigner,
} = require("../services/stellar.service");
const { invokeContractMap } = require("../../soroban/soroban-methods");

async function invokeAnyContract(req, res, next) {
  try {
    const {
      network,
      contractId,
      callFunction,
      args,
      txDetails,
      type,
      validatorSigs,
    } = req.invoke;

    console.log("the req invoke are", req.invoke);
    const { signature, signed } = req.passkey;

    const sigObject = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("authenticator_data"),
        val: xdr.ScVal.scvBytes(signed.authenticatorData),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("client_data_json"),
        val: xdr.ScVal.scvBytes(signed.clientDataJSON),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("signature"),
        val: xdr.ScVal.scvBytes(signature),
      }),
    ]);

    pushProgress(req, {
      step: "transaction submission",
      status: "progress",
      detail: "Submitting Signed Transaction",
    });

    let txResponse;
    if (type === "id-mapping") {
      txResponse = await invokeContractMap(
        network,
        contractId,
        callFunction.name || callFunction,
        args,
        validatorSigs,
        sigObject,
        req.signInfo.valid_until_ledger
      );
    } else {
      txResponse = await invokeContract(
        network,
        contractId,
        callFunction.name || callFunction,
        args,
        sigObject,
        req.signInfo.valid_until_ledger
      );
    }

    if (!txResponse) {
      pushProgress(req, {
        step: "transaction creation",
        status: "error",
        detail: "Transaction Submission Failed",
      });

      return res.status(400).json({
        error: "Transaction Submission Failed",
      });
    }

    if (txDetails) {
      const txRecord = {
        ...txDetails,
        userId: txDetails?.userId || req.user.userId,
        txId: txResponse.txHash,
        network,
      };

      await recordTransaction(txRecord);
    }

    if (
      req.dappMiddleware &&
      typeof req.dappMiddleware.afterInvoke === "function"
    ) {
      await req.dappMiddleware.afterInvoke(req, txResponse);
    }

    pushProgress(req, {
      step: "transaction submission",
      status: "done",
      detail: "Transaction Submission Successful",
      eid: `txHash_${txResponse.txHash}`,
    });

    return res.status(200).json({
      message: "transaction successful",
      data: txResponse,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  invokeAnyContract,
};

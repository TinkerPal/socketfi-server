async function beforeInvoke(ctx) {
  const { dappContext } = ctx.invoke;

  if (!dappContext?.aqua) {
    return;
  }

  const aqua = dappContext.aqua;

  // Example checks.
  // Replace with your real Aqua route checks.
  if (aqua.routeChecks && !aqua.route) {
    throw new Error("Aqua route is required");
  }

  ctx.dapp = {
    name: "aqua",
    route: aqua.route || null,
    authArgs: aqua.authArgs || null,
    extraObjects: aqua.extraObjects || null,
  };

  // Optional: append extra computed args safely.
  // Prefer adding to ctx instead of mutating raw args unless needed.
}

async function afterInvoke(ctx, txResponse) {
  // Optional analytics, route logging, dApp-specific recording, etc.
}

module.exports = {
  beforeInvoke,
  afterInvoke,
};

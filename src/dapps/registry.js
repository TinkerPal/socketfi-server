const aquaMiddleware = require("./aqua.middleware");

const dappRegistry = {
  aqua: aquaMiddleware,
};

function getDappMiddleware(name) {
  return dappRegistry[name] || null;
}

module.exports = {
  getDappMiddleware,
};

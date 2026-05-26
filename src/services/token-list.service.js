const { TokenList } = require("../models");

async function addTokenToList(userId, network, tokenContract) {
  return TokenList.addTokenToList(userId, network, tokenContract);
}

async function removeTokenFromList(userId, network, tokenContract) {
  return TokenList.removeTokenFromList(userId, network, tokenContract);
}

async function getTokenList(userId, network) {
  return TokenList.getTokenList(userId, network);
}

module.exports = {
  addTokenToList,
  removeTokenFromList,
  getTokenList,
};

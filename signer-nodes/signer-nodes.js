const productionNodes = [
  { name: "node 1", url: "http://164.68.126.247:3005" },
  { name: "node 2", url: "http://38.242.195.168:3005" },
  { name: "node 3", url: "http://144.91.98.211:3005" },
];
const developmentNodes = [{ name: "node 1", url: "http://localhost:3005" }];

const nodes =
  process.env.ENV === "PRODUCTION" ? productionNodes : developmentNodes;

module.exports = nodes;

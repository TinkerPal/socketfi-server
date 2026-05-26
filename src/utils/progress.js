function pushProgress(req, data) {
  const sId = req.body?.sId || "";

  if (!global.progress || !sId) return;

  global.progress.push(sId, data);
}

module.exports = {
  pushProgress,
};

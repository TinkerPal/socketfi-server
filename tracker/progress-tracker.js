// tracker/progress-tracker.js
const { progress } = require("./progress");

function sseProgress(req, res) {
  const id = req.params.id;

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // nginx/proxy: don't buffer
    // If you need CORS here instead of app-level cors():
    // "Access-Control-Allow-Origin": req.headers.origin || "*",
    // "Access-Control-Allow-Credentials": "true",
  });
  res.flushHeaders?.();
  req.socket.setKeepAlive?.(true, 30_000);

  const lastEid = req.header("Last-Event-ID");

  const send = (evt) => {
    const eid = String(evt.eid ?? evt.ts ?? Date.now());
    const payload = JSON.stringify(evt);
    res.write(`id: ${eid}\n`);
    res.write(`event: step\n`);
    res.write(`data: ${payload}\n\n`);
  };

  // replay history since last id (if any)
  for (const evt of progress.getSince(id, lastEid)) send(evt);

  const unsub = progress.subscribe(id, send);

  // keep-alive/ping to prevent idle timeouts & nudge proxies
  const ping = setInterval(() => res.write(`: ping ${Date.now()}\n\n`), 15_000);

  const cleanup = () => {
    clearInterval(ping);
    unsub();
    res.end();
  };
  req.on("close", cleanup);
  req.on("aborted", cleanup);
}

module.exports = { sseProgress };

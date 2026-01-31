// best-usdc-quotes.js
require("dotenv").config({ quiet: true });
const { Horizon, Asset } = require("@stellar/stellar-sdk");
const { curatedList, curratedList } = require("./curatedAssets");

const ankrKey = process.env.ANKR_KEY;

const PRIMARY = new Horizon.Server("https://horizon.stellar.org");
const BACKUP = new Horizon.Server(
	`https://rpc.ankr.com/premium-http/stellar_horizon/${ankrKey}`,
); // or your RPC

const USDC = new Asset(
	"USDC",
	"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
);
const XLM = Asset.native();

// Tiny caches
const XU_TTL_MS = 3000; // cache XLM/USDC
const PAIR_TTL_MS = 2500; // cache any pair briefly
let xuCache = { at: 0, book: null };
const pairCache = new Map(); // key: "sell|buy" -> {at, book}

const norm = (v) =>
	String(v || "")
		.trim()
		.toUpperCase();
const assetKey = (a) =>
	a.isNative() ? "XLM" : `${a.getCode()}:${a.getIssuer()}`;
const pairKey = (s, b) => `${assetKey(s)}|${assetKey(b)}`;

function withTimeout(promise, ms = 1500) {
	return Promise.race([
		promise,
		new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
	]);
}

async function fetchBookFast(selling, buying) {
	// If you don't want a backup, just call PRIMARY with timeout.
	return Promise.any([
		withTimeout(PRIMARY.orderbook(selling, buying).call()),
		withTimeout(BACKUP.orderbook(selling, buying).call()),
	]);
}

async function fetchBookCached(selling, buying) {
	const key = pairKey(selling, buying);
	const now = Date.now();
	const hit = pairCache.get(key);
	if (hit && now - hit.at < PAIR_TTL_MS) return hit.book;

	const book = await fetchBookFast(selling, buying);
	pairCache.set(key, { at: now, book });
	return book;
}

/**
 * Analyze a book for buying `baseAmount` UNITS of the `selling` asset.
 * No sorting: Horizon gives bids desc, asks asc.
 * Returns { ok, bestBid, bestAsk, mid, spreadPct, vwap }
 */
function analyze(book, baseAmount) {
	const bids = book?.bids || [];
	const asks = book?.asks || [];
	if (!bids.length || !asks.length) return { ok: false };

	const bestBid = Number(bids[0].price); // highest
	const bestAsk = Number(asks[0].price); // lowest
	const mid = (bestBid + bestAsk) / 2;
	const spreadPct = (bestAsk - bestBid) / (mid || 1);

	if (baseAmount <= 0) {
		return { ok: true, bestBid, bestAsk, mid, spreadPct, vwap: mid };
	}

	// BUY 'selling' → walk asks low→high
	let want = baseAmount;
	let spent = 0;
	for (let i = 0; i < asks.length && want > 0; i++) {
		const p = Number(asks[i].price);
		const q = Number(asks[i].amount);
		const take = want > q ? q : want;
		spent += take * p;
		want -= take;
	}
	if (want > 0) return { ok: false }; // insufficient depth

	return {
		ok: true,
		bestBid,
		bestAsk,
		mid,
		spreadPct,
		vwap: spent / baseAmount,
	};
}

/**
 * Sell `sellAmount` units of the selling asset into the book's bids.
 * Returns total counter amount (e.g., USDC received) or null if insufficient depth.
 */
function vwapSellAgainstBids(book, sellAmount) {
	const bids = book?.bids || []; // high→low
	let remain = sellAmount;
	let got = 0;
	for (let i = 0; i < bids.length && remain > 0; i++) {
		const p = Number(bids[i].price);
		const q = Number(bids[i].amount);
		const take = remain > q ? q : remain;
		got += take * p;
		remain -= take;
	}
	return remain > 0 ? null : got;
}

async function bestUsdQuoteOne(token, baseAmount, bookXU) {
	let asset;

	if (
		token.contract ===
			"CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA" ||
		token?.issuer === "native"
	) {
		asset = XLM;
	} else if (token.issuer !== "native" && token.code && token.issuer) {
		asset = new Asset(token.code, token.issuer);
	}

	// Fetch direct ASSET/USDC and via leg ASSET/XLM in parallel (cached)
	const [bookDirect, bookAX] = await Promise.all([
		fetchBookCached(asset, USDC).catch(() => null),
		fetchBookCached(asset, XLM).catch(() => null),
	]);

	const direct = bookDirect ? analyze(bookDirect, baseAmount) : { ok: false };
	const viaA = bookAX ? analyze(bookAX, baseAmount) : { ok: false };

	let via = { ok: false };
	if (viaA.ok && bookXU) {
		// Compute XLM received for baseAmount of ASSET by walking asks (already asc)
		let want = baseAmount;
		let xlmGot = 0;
		const asks = bookAX.asks || [];
		for (let i = 0; i < asks.length && want > 0; i++) {
			const p = Number(asks[i].price); // XLM per 1 ASSET
			const q = Number(asks[i].amount); // ASSET units at that level
			const take = want > q ? q : want;
			xlmGot += take * p;
			want -= take;
		}
		if (want === 0) {
			const usdcFromXlm = vwapSellAgainstBids(bookXU, xlmGot);
			if (usdcFromXlm != null)
				via = { ok: true, vwap: usdcFromXlm / baseAmount };
		}
	}

	const route =
		direct.ok && via.ok
			? direct.vwap <= via.vwap
				? "direct"
				: "xlm-bridge"
			: direct.ok
				? "direct"
				: via.ok
					? "xlm-bridge"
					: "none";

	return {
		contract: token.contract || asset.getCode(), // use contract as key when present
		price: {
			direct: direct.ok ? direct.vwap : 0,
			viaXLM: via.ok ? via.vwap : 0,
		},
		route,
	};
}

/**
 * Batch: array of wallet tokens → keyed by contract.
 * Prefers curated metadata when present; falls back to wallet token.
 */
async function bestUsdQuote(walletTokens, baseAmount = 100) {
	// Normalize & de-duplicate contract IDs requested
	const tokenAddresses = Array.from(
		new Set((walletTokens || []).map((t) => norm(t.address)).filter(Boolean)),
	);

	// Curated lookup map
	const curatedByContract = new Map(
		(curatedList || []).map((t) => [norm(t.contract), t]),
	);

	const tokens = curratedList.filter((token) =>
		tokenAddresses.includes(token.contract),
	);

	// Refresh XLM/USDC once if stale
	let bXU = xuCache.book;
	const now = Date.now();
	if (!bXU || now - xuCache.at > XU_TTL_MS) {
		bXU = await fetchBookCached(XLM, USDC).catch(() => null);
		if (bXU) xuCache = { at: now, book: bXU };
	}

	// Price all tokens in parallel
	const results = await Promise.all(
		tokens.map((t) =>
			bestUsdQuoteOne(t, baseAmount, bXU).catch((e) => ({
				contract: t.contract,
				price: { direct: 0, viaXLM: 0 },
				route: "none",
				error: String(e?.message || e),
			})),
		),
	);

	// Collate by contract
	const out = {};
	for (const r of results) out[r.contract] = r;
	return out;
}

module.exports = { bestUsdQuote, bestUsdQuoteOne };

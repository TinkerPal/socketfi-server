require("dotenv").config({ quiet: true });
const axios = require("axios");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegramMessage(chatId, text) {
	if (!BOT_TOKEN) {
		console.error("[telegram-service] BOT_TOKEN not configured");
		return;
	}

	try {
		await axios.post(`${TELEGRAM_API}/sendMessage`, {
			chat_id: chatId,
			text,
		});
	} catch (err) {
		console.error("[telegram-service] Failed to send message:", err?.response?.data || err.message);
		throw err;
	}
}

async function sendOtpToTelegram(chatId, otp) {
	const message = `🔐 Your SocketFi verification code is:\n\n${otp}\n\nPlease enter this code in the app to complete the linking process.\n\nThis code expires in 15 minutes.`;
	await sendTelegramMessage(chatId, message);
}

module.exports = { sendTelegramMessage, sendOtpToTelegram };

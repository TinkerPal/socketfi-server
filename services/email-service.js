require("dotenv").config({ quiet: true });
const nodemailer = require("nodemailer");
const ejs = require("ejs");
const path = require("path");

const transporter = nodemailer.createTransport({
	host: process.env.MAIL_HOST,
	port: process.env.MAIL_PORT,
	// secure: false,
	// requireTLS: true,
	auth: {
		user: process.env.MAIL_USER,
		pass: process.env.MAIL_PASS,
	},
	tls: { rejectUnauthorized: false },
});

async function sendOtpEmail(to, otp) {
	const templatePath = path.join(
		__dirname,
		"..",
		"views",
		"emails",
		"otp-email.ejs",
	);

	const html = await ejs.renderFile(templatePath, { otp });

	console.log("[email-service] Attempting to send OTP email", {
		to,
		host: process.env.MAIL_HOST,
		port: process.env.MAIL_PORT,
		user: process.env.MAIL_USER,
	});

	await transporter.sendMail({
		from: process.env.MAIL_FROM,
		to,
		subject: "Your SocketFi Verification Code",
		html,
		text: ``,
	});

	console.log("[email-service] Email sent successfully");
}

module.exports = { sendOtpEmail };

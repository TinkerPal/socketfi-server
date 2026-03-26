require("dotenv").config({ quiet: true });
const nodemailer = require("nodemailer");
const ejs = require("ejs");
const path = require("path");

const transporter = nodemailer.createTransport({
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT,
  secure: true,
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
    "otp-email.ejs"
  );

  const html = await ejs.renderFile(templatePath, { otp });

  await transporter.sendMail({
    from: process.env.MAIL_USER,
    to,
    subject: "Your SocketFi Verification Code",
    html,
    text: ``,
  });
}

module.exports = { sendOtpEmail };

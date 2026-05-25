require("dotenv").config({ quiet: true });

const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_USER = process.env.DB_USER;

const MONGODB_URI = `mongodb+srv://${DB_USER}:${DB_PASSWORD}@socketfi.y9aiiy4.mongodb.net/socketfi?retryWrites=true&w=majority&appName=socketfi`;

module.exports = {
  MONGODB_URI,
};

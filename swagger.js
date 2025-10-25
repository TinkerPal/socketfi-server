// swagger.js
const swaggerJSDoc = require("swagger-jsdoc");

const servers =
  process.env.MODE === "PRODUCTION"
    ? [
        { url: "https://socketfi.com", description: "Prod (root)" },
        { url: "https://app.socket.fi", description: "Prod (app)" },
      ]
    : [{ url: "http://localhost:3000", description: "Local" }];

/** @type {import('swagger-jsdoc').Options} */
const options = {
  definition: {
    openapi: "3.0.3",
    info: {
      title: "SocketFi Backend API",
      version: "1.0.0",
      description:
        "OpenAPI docs for the SocketFi backend (auth, wallet, swaps, quotes, stats, etc.).",
    },
    servers,
    components: {
      securitySchemes: {
        // for endpoints that expect an Authorization: Bearer <token>
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
        // for endpoints that rely on httpOnly cookies (e.g., authInfo, activateInfo, signInfo)
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "authInfo", // overridden per-path if needed
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string", nullable: true },
            verified: { type: "boolean", nullable: true },
          },
        },
        InitAuthRequest: {
          type: "object",
          required: ["username", "network"],
          properties: {
            username: { type: "string", example: "alaa_dev" },
            network: { type: "string", example: "PUBLIC" },
          },
        },
        InitAuthResponse: {
          type: "object",
          properties: {
            options: {
              type: "object",
              description: "WebAuthn options payload",
            },
            existingUser: { type: "boolean" },
            id: { type: "string" },
          },
        },
        VerifyAuthRequest: {
          type: "object",
          required: ["authData", "id"],
          properties: {
            authData: {
              type: "object",
              description: "WebAuthn response object",
            },
            id: { type: "string" },
            network: { type: "string", nullable: true, example: "PUBLIC" },
          },
        },
        VerifyAuthResponse: {
          type: "object",
          properties: {
            verified: { type: "boolean" },
            accessToken: { type: "string" },
            userProfile: {
              type: "object",
              properties: {
                username: { type: "string" },
                linkedAccounts: { type: "array", items: { type: "object" } },
                userId: { type: "string" },
                passkey: { type: "string", nullable: true },
                address: { type: "object", additionalProperties: true },
              },
            },
          },
        },
        AnyInvokeExternalRequest: {
          type: "object",
          required: ["pubKey", "contractId", "network", "callFunction"],
          properties: {
            pubKey: { type: "string" },
            contractId: { type: "string" },
            network: { type: "string", example: "PUBLIC" },
            memo: { type: "string", nullable: true },
            sId: { type: "string", nullable: true },
            callFunction: {
              type: "object",
              properties: {
                name: { type: "string", example: "deposit" },
                inputs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      type: { type: "string", example: "i128" },
                      value: { nullable: true },
                    },
                  },
                },
              },
              required: ["name"],
            },
          },
        },
        SubmitTxExternalRequest: {
          type: "object",
          required: ["signedTx", "network"],
          properties: {
            signedTx: { type: "string" },
            network: { type: "string", example: "PUBLIC" },
            txDetails: { type: "object", nullable: true },
            sId: { type: "string", nullable: true },
          },
        },
        QuoteRequest: {
          type: "object",
          required: ["protocol", "tokenIn", "tokenOut", "amount"],
          properties: {
            protocol: { type: "string", example: "AQUA" },
            tokenIn: {
              type: "object",
              properties: {
                contract: { type: "string" },
                code: { type: "string" },
                decimals: { type: "integer" },
              },
            },
            tokenOut: {
              type: "object",
              properties: {
                contract: { type: "string" },
                code: { type: "string" },
                decimals: { type: "integer" },
              },
            },
            amount: { type: "string", example: "100.5" },
          },
        },
      },
    },
    security: [], // set per-path below with @swagger
    tags: [
      { name: "Auth", description: "Passkey (WebAuthn) endpoints" },
      {
        name: "Wallet",
        description: "Wallet creation, activation, invocation",
      },
      { name: "Swap", description: "AQUA & Soroswap routes" },
      { name: "Quotes", description: "Pricing and quotes" },
      { name: "Stats", description: "User transactions, tokens, points" },
      { name: "Misc", description: "Miscellaneous endpoints" },
    ],
  },
  // Tell swagger-jsdoc where to look for route JSDoc comments
  apis: ["./index.js", "./routes/*.js"], // adjust to your file names
};

const swaggerSpec = swaggerJSDoc(options);

module.exports = { swaggerSpec };

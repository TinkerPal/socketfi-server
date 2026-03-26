/**
 * @swagger
 * /process/progress/{id}:
 *   get:
 *     tags: [Misc]
 *     summary: Server-Sent Events stream for progress updates
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, example: progress-123 }
 *     responses:
 *       200: { description: "SSE stream" }
 */

/**
 * @swagger
 * /auth/get-account:
 *   get:
 *     tags: [Auth]
 *     summary: Check username availability or fetch basic account info
 *     parameters:
 *       - in: query
 *         name: username
 *         schema: { type: string, example: alaa_dev }
 *         required: true
 *     responses:
 *       200:
 *         description: Availability or basic info
 *         content:
 *           application/json:
 *             examples:
 *               available:
 *                 value: { description: "Username available — sign up to claim it", existingUser: false, id: "" }
 *               taken:
 *                 value: { description: "Username taken — log in if it’s yours", existingUser: true, id: "USER_ID_123" }
 *       400:
 *         description: Bad input
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */

/**
 * @swagger
 * /init-auth:
 *   post:
 *     tags: [Auth]
 *     summary: Initialize login or registration (WebAuthn)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username, network]
 *             properties:
 *               username: { type: string, example: alaa_dev }
 *               network: { type: string, example: PUBLIC }
 *     responses:
 *       200:
 *         description: WebAuthn options and flow flag
 *         content:
 *           application/json:
 *             examples:
 *               existingUser:
 *                 value: { options: { challenge: "..." }, existingUser: true, id: "USER_ID_123" }
 *               newUser:
 *                 value: { options: { challenge: "..." }, existingUser: false, id: "NEW_USER_ID" }
 *       409: { description: Username reserved/unavailable }
 *       400: { description: Invalid body }
 */

/**
 * @swagger
 * /verify-auth:
 *   post:
 *     tags: [Auth]
 *     summary: Verify WebAuthn response (login or register)
 *     description: Reads the httpOnly cookie `authInfo` set by `/init-auth` and verifies the response.
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [authData, id]
 *             properties:
 *               authData: { type: object, description: "WebAuthn assertion/attestation" }
 *               id: { type: string, example: progress-123 }
 *               network: { type: string, nullable: true, example: PUBLIC }
 *     responses:
 *       200:
 *         description: JWT and profile on success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verified: { type: boolean }
 *                 accessToken: { type: string }
 *                 userProfile: { type: object }
 *       400: { description: Verification failed }
 */

/**
 * @swagger
 * /init-add-email:
 *   post:
 *     tags: [Auth]
 *     summary: Send a verification code to an email address
 *     description: Sends a 6-digit OTP to the provided email address. Requires a valid JWT. Calling again overwrites any previous pending code.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, example: "user@example.com" }
 *     responses:
 *       200:
 *         description: OTP sent
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *       400: { description: Invalid email format }
 *       401: { description: Missing/invalid bearer token }
 *       409: { description: Email already in use by another account }
 *       500: { description: Failed to send email }
 */

/**
 * @swagger
 * /verify-email:
 *   post:
 *     tags: [Auth]
 *     summary: Verify an OTP and add the email to the user account
 *     description: Validates the 6-digit code and associates the email with the authenticated user. Code expires after 10 minutes or after 5 failed attempts.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp]
 *             properties:
 *               email: { type: string, example: "user@example.com" }
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: Email verified and added
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *       400: { description: Invalid or incorrect OTP }
 *       401: { description: Missing/invalid bearer token }
 *       404: { description: No pending verification for this email }
 *       410: { description: OTP has expired }
 *       429: { description: Too many failed attempts }
 */

/**
 * @swagger
 * /init-twitter-auth:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate Twitter OAuth flow to link a Twitter account
 *     description: |
 *       Authenticates the user via JWT accessToken query param, stores context in session,
 *       then redirects the browser to Twitter OAuth. After the user authorizes, Twitter redirects
 *       back to `/auth/twitter/callback`, which stores the Twitter profile and redirects to
 *       `${CLIENT_URL}/settings/connect`.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *         description: JWT access token of the logged-in user
 *     responses:
 *       302:
 *         description: Redirects to Twitter OAuth
 *       401: { description: Missing/invalid accessToken }
 */

/**
 * @swagger
 * /init-discord-auth:
 *   get:
 *     tags: [Auth]
 *     summary: Initiate Discord OAuth flow to link a Discord account
 *     description: |
 *       Authenticates the user via accessToken query param, stores context in session,
 *       then redirects the browser to Discord OAuth. After the user authorizes, Discord redirects
 *       back to `/auth/discord/callback`, which stores the Discord profile and redirects to
 *       `${CLIENT_URL}/settings/connect`.
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema: { type: string }
 *         description: JWT access token of the logged-in user
 *     responses:
 *       302:
 *         description: Redirects to Discord OAuth
 *       401: { description: Missing/invalid accessToken }
 */

/**
 * @swagger
 * /init-telegram-link:
 *   post:
 *     tags: [Auth]
 *     summary: Initiate Telegram account linking
 *     description: |
 *       User provides their Telegram username to start the linking process.
 *       A pending record is created. The user must then open their Telegram bot and send /start.
 *       The bot will reply with a 6-digit OTP. The user then calls /verify-telegram-otp to complete linking.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [username]
 *             properties:
 *               username: { type: string, example: "johndoe" }
 *     responses:
 *       200:
 *         description: Linking initiated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pendingId: { type: string }
 *                 expiresAt: { type: string, format: date-time }
 *                 message: { type: string }
 *       400: { description: Invalid username format or missing field }
 *       401: { description: Missing/invalid bearer token }
 *       409: { description: Telegram account already linked to another user }
 */

/**
 * @swagger
 * /verify-telegram-otp:
 *   post:
 *     tags: [Auth]
 *     summary: Verify the OTP received via Telegram and link the account
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [otp]
 *             properties:
 *               otp: { type: string, example: "123456" }
 *     responses:
 *       200:
 *         description: OTP verification result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string, nullable: true }
 *                 error: { type: string, nullable: true }
 *       401: { description: Missing/invalid bearer token }
 */

/**
 * @swagger
 * /telegram/set-webhook:
 *   get:
 *     tags: [Auth]
 *     summary: Set telegram bot webhook endpoint
//  *     description: Receives updates from the Telegram bot. Handles /start command to send OTP to the user.
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *     responses:
 *       200: { description: Webhook processed }
 */

/**
 * @swagger
 * /telegram/webhook:
 *   post:
 *     tags: [Auth]
 *     summary: Telegram bot webhook endpoint
 *     description: Receives updates from the Telegram bot. Handles /start command to send OTP to the user.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200: { description: Webhook processed }
 */

/**
 * @swagger
 * /init-activate-account:
 *   post:
 *     tags: [Wallet]
 *     summary: Start account activation on another network (WebAuthn challenge)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [network]
 *             properties:
 *               network: { type: string, example: TESTNET }
 *     responses:
 *       200: { description: Options issued (cookie `activateInfo` set) }
 *       401: { description: Missing/invalid bearer token }
 *       400: { description: Invalid body }
 */

/**
 * @swagger
 * /activate-account:
 *   post:
 *     tags: [Wallet]
 *     summary: Verify activation WebAuthn response and create wallet on target network
 *     security:
 *       - bearerAuth: []
 *       - activateCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [network, activationData]
 *             properties:
 *               network: { type: string, example: TESTNET }
 *               activationData: { type: object }
 *               txDetails: { type: object, nullable: true }
 *     responses:
 *       200: { description: Activated with user profile }
 *       400: { description: Invalid signature or flow }
 *       401: { description: Unauthorized }
 */

/**
 * @swagger
 * /load-contract-specs:
 *   post:
 *     tags: [Wallet]
 *     summary: Load contract specs by ID and network
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, network]
 *             properties:
 *               contractId: { type: string, example: C... }
 *               network: { type: string, example: PUBLIC }
 *     responses:
 *       200: { description: Contract spec loaded }
 *       400: { description: Error loading spec }
 */

/**
 * @swagger
 * /access-load-wallet:
 *   post:
 *     tags: [Wallet]
 *     summary: Resolve a user's wallet and contract specs by wallet or username
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             oneOf:
 *               - required: [wallet, network]
 *               - required: [username, network]
 *             properties:
 *               wallet: { type: string, example: C... }
 *               username: { type: string, example: alaa_dev }
 *               network: { type: string, example: PUBLIC }
 *     responses:
 *       200: { description: Contract spec + wallet returned }
 *       400: { description: Invalid body or not found }
 */

/**
 * @swagger
 * /any-invoke-external:
 *   post:
 *     tags: [Wallet]
 *     summary: Prepare a Soroban transaction (unsigned XDR)
 *     description: Builds and prepares a contract call; returns prepared XDR to sign client-side.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pubKey, contractId, network, callFunction]
 *             properties:
 *               pubKey: { type: string, example: "G..." }
 *               contractId: { type: string, example: "C..." }
 *               network: { type: string, example: PUBLIC }
 *               memo: { type: string, nullable: true }
 *               sId: { type: string, nullable: true }
 *               callFunction:
 *                 type: object
 *                 required: [name]
 *                 properties:
 *                   name: { type: string, example: deposit }
 *                   inputs:
 *                     type: array
 *                     items:
 *                       type: object
 *                       properties:
 *                         type: { type: string, example: i128 }
 *                         value: { nullable: true }
 *     responses:
 *       200:
 *         description: Prepared XDR
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 xdr: { type: string }
 *       400: { description: Build failed }
 */

/**
 * @swagger
 * /submit-transaction-external:
 *   post:
 *     tags: [Wallet]
 *     summary: Submit a signed XDR
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [signedTx, network]
 *             properties:
 *               signedTx: { type: string, description: "Base64 XDR" }
 *               network: { type: string, example: PUBLIC }
 *               txDetails: { type: object, nullable: true }
 *               sId: { type: string, nullable: true }
 *     responses:
 *       200: { description: Submission result with tx hash }
 *       400: { description: Submission failed }
 */

/**
 * @swagger
 * /init-sign-transaction:
 *   post:
 *     tags: [Wallet]
 *     summary: Start a WebAuthn-gated call (sets `signInfo` cookie)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, network, callFunction]
 *             properties:
 *               contractId: { type: string, example: "C..." }
 *               network: { type: string, example: PUBLIC }
 *               callFunction: { type: object }
 *               sId: { type: string, nullable: true }
 *     responses:
 *       200: { description: "Options issued" }
 *       401: { description: "Missing/invalid bearer token" }
 *       400: { description: "Bad input" }
 */

/**
 * @swagger
 * /any-invoke-with-sig:
 *   post:
 *     tags: [Wallet]
 *     summary: Execute a WebAuthn-approved call (BLS aggregated)
 *     security:
 *       - bearerAuth: []
 *       - signCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, network, callFunction, sigData]
 *             properties:
 *               contractId: { type: string }
 *               network: { type: string }
 *               callFunction: { type: object }
 *               sigData: { type: object, description: "WebAuthn assertion" }
 *               txDetails: { type: object, nullable: true }
 *               sId: { type: string, nullable: true }
 *     responses:
 *       200: { description: "Transaction submitted" }
 *       400: { description: "Validation or submission error" }
 */

/**
 * @swagger
 * /aqua-swap-with-sig:
 *   post:
 *     tags: [Swap]
 *     summary: Execute AQUA chained swap via WebAuthn + BLS
 *     security:
 *       - bearerAuth: []
 *       - signCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, network, callFunction, sigData, tokenIn, tokenOut]
 *             properties:
 *               contractId: { type: string }
 *               network: { type: string }
 *               callFunction: { type: object }
 *               sigData: { type: object }
 *               tokenIn:
 *                 type: object
 *                 properties:
 *                   contract: { type: string }
 *                   code: { type: string }
 *                   amount: { type: string }
 *                   decimals: { type: integer }
 *               tokenOut:
 *                 type: object
 *                 properties:
 *                   contract: { type: string }
 *                   code: { type: string }
 *                   decimals: { type: integer }
 *               sId: { type: string, nullable: true }
 *     responses:
 *       200: { description: "Swap OK" }
 *       400: { description: "Swap failed" }
 */

/**
 * @swagger
 * /soroswap-swap-with-sig:
 *   post:
 *     tags: [Swap]
 *     summary: Execute Soroswap swap via WebAuthn + BLS
 *     security:
 *       - bearerAuth: []
 *       - signCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, network, callFunction, sigData, tokenIn, tokenOut, swapData]
 *             properties:
 *               contractId: { type: string }
 *               network: { type: string }
 *               callFunction: { type: object }
 *               sigData: { type: object }
 *               tokenIn: { type: object }
 *               tokenOut: { type: object }
 *               swapData:
 *                 type: object
 *                 description: Router path and amountOutMin
 *               sId: { type: string, nullable: true }
 *     responses:
 *       200: { description: "Swap OK" }
 *       400: { description: "Swap failed" }
 */

/**
 * @swagger
 * /upgrade-wallet-with-sig:
 *   post:
 *     tags: [Wallet]
 *     summary: Upgrade wallet contract to latest version (WebAuthn + BLS)
 *     security:
 *       - bearerAuth: []
 *       - signCookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, network, callFunction, sigData]
 *             properties:
 *               contractId: { type: string }
 *               network: { type: string }
 *               callFunction: { type: object }
 *               sigData: { type: object }
 *               sId: { type: string, nullable: true }
 *     responses:
 *       200: { description: "Upgrade submitted" }
 *       400: { description: "Upgrade failed" }
 */

/**
 * @swagger
 * /get-quote:
 *   post:
 *     tags: [Quotes]
 *     summary: Get best quote for a token pair
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [protocol, tokenIn, tokenOut, amount]
 *             properties:
 *               protocol: { type: string, example: AQUA }
 *               tokenIn:
 *                 type: object
 *                 properties:
 *                   contract: { type: string }
 *                   code: { type: string }
 *                   decimals: { type: integer }
 *               tokenOut:
 *                 type: object
 *                 properties:
 *                   contract: { type: string }
 *                   code: { type: string }
 *                   decimals: { type: integer }
 *               amount: { type: string, example: "100.5" }
 *     responses:
 *       200: { description: "Quote OK" }
 *       400: { description: "Bad request" }
 */

/**
 * @swagger
 * /get-account-stats:
 *   post:
 *     tags: [Stats]
 *     summary: Get user stats, tokens, prices, version info, and points
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [network]
 *             properties:
 *               network: { type: string, example: PUBLIC }
 *     responses:
 *       200: { description: "Stats payload" }
 *       401: { description: "Missing/invalid bearer token" }
 *       400: { description: "Invalid body" }
 */

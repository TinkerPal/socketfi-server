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

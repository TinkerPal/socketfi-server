/**
 * @openapi
 * /user/create:
 *      post:
 *         summary: Create an user account, this will only be done with an user with required permission and a super admin.
 *         tags:
 *            - User
 *         security:
 *           - bearerAuth: []
 *         requestBody:
 *              required: true
 *              content:
 *                  application/json:
 *                     schema:
 *                        $ref: '#/components/schemas/UserCreation'
 *         responses:
 *           "201":
 *             description: Admin account created successfully
 *             content:
 *               application/json:
 *                 schema:
 *                   type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     message:
 *                       type: string
 *                       example: "Account created, please check email for credentials"
 *                     data:
 *                       type: null
 *                       example: null
 *           "400":
 *             description: Bad Request - Invalid input data
 *           "401":
 *             description: Unauthorized - Invalid or missing token
 *           "409":
 *             description: Conflict - Admin account already exists with this email
 */

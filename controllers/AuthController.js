import sha1 from 'sha1';
import { v4 as uuidv4 } from 'uuid';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const UNAUTHORIZED = 'Unauthorized';

const USERSCOLLECTION = 'users';

const TOKEN = 'x-token';

export default class AuthController {
  static async getConnect(request, response) {
    const auth = request.headers.authorization;
    if (!auth) return response.status(401).send({ error: UNAUTHORIZED });

    const extractAuth = auth.split('Basic ')[1];
    const decodeAuth = Buffer.from(extractAuth, 'base64').toString('utf-8');
    const [email, password] = decodeAuth.split(':');
    if (!email || !password) return response.status(401).send({ error: UNAUTHORIZED });

    const user = { email, password: sha1(password) };
    const getUser = await dbClient.db.collection(USERSCOLLECTION).findOne(user);
    if (!getUser) return response.status(401).send({ error: UNAUTHORIZED });
    const token = uuidv4();
    await redisClient.set(`auth_${token}`, getUser._id.toString(), 24 * 60 * 60);
    return response.status(200).send({ token });
  }

  static async getDisconnect(request, response) {
    const xToken = request.headers[TOKEN];
    const userId = await redisClient.get(`auth_${xToken}`);
    if (!userId) return response.status(401).send({ error: UNAUTHORIZED });
    await redisClient.del(`auth_${xToken}`);
    return response.status(204).send();
  }
}

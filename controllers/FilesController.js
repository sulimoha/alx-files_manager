import fs from 'fs';
import mime from 'mime-types';
import Bull from 'bull';
import { ObjectId } from 'mongodb';
import { v4 as uuidv4 } from 'uuid';
import dbClient from '../utils/db';
import redisClient from '../utils/redis';

const UNAUTHORIZED = 'Unauthorized';
const NOTFOUND = 'Not found';
const MISSINGNAME = 'Missing name';
const MISSINGTYPE = 'Missing type';
const MISSINGDATA = 'Missing data';
const PARENTNOTFOUND = 'Parent not found';
const PARENTNOTFOLDER = 'Parent is not a folder';
const FOLDERNOCONTENT = "A folder doesn't have content";

const USERSCOLLECTION = 'users';
const FILESCOLLECTION = 'files';

const TOKEN = 'x-token';

const FOLDER = 'folder';
const FILE = 'file';
const IMAGE = 'image';

async function getUser(token) {
  const userId = await redisClient.get(`auth_${token}`);
  if (!userId) return null;
  const user = await dbClient.db.collection(USERSCOLLECTION).findOne({ _id: ObjectId(userId) });
  if (!user) return null;
  return user;
}

export default class FilesController {
  static async postUpload(request, response) {
    const fileQueue = new Bull('fileQueue');

    const xToken = request.headers[TOKEN];
    const user = await getUser(xToken);
    if (!user) return response.status(401).send({ error: UNAUTHORIZED });

    const {
      name, type, isPublic, data,
    } = request.body;
    const parentId = request.body.parentId || 0;
    const validTypes = [FOLDER, FILE, IMAGE];

    if (!name) return response.status(400).send({ error: MISSINGNAME });
    if (!type || !validTypes.includes(type)) {
      return response.status(400).send({ error: MISSINGTYPE });
    }
    if (!data && type !== FOLDER) return response.status(400).send({ error: MISSINGDATA });
    if (parentId) {
      const query = { _id: ObjectId(parentId) };
      const parent = await dbClient.db.collection(FILESCOLLECTION).findOne(query);
      if (!parent) {
        return response.status(400).send({ error: PARENTNOTFOUND });
      }
      if (parent.type !== FOLDER) {
        return response.status(400).send({ error: PARENTNOTFOLDER });
      }
    }
    if (type === FOLDER) {
      const document = {
        userId: user._id,
        name,
        type,
        isPublic: isPublic || false,
        parentId: parentId === 0 ? parentId : ObjectId(parentId),
      };
      const result = await dbClient.db.collection(FILESCOLLECTION).insertOne(document);
      return response.status(201).send({
        id: result.insertedId,
        userId: user._id,
        name,
        type,
        isPublic: isPublic || false,
        parentId,
      });
    }
    let localPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    const filename = uuidv4();
    const clearData = Buffer.from(data, 'base64');
    try {
      if (!fs.existsSync(localPath)) {
        fs.mkdirSync(localPath, { recursive: true });
      }
      localPath = `${localPath}/${filename}`;
      fs.writeFile(localPath, clearData, (error) => {
        if (error) console.log(error);
      });
    } catch (error) {
      console.log(error);
    }
    const document = {
      userId: user._id,
      name,
      type,
      isPublic: !!isPublic,
      parentId: parentId === 0 ? parentId : ObjectId(parentId),
      localPath,
    };
    const result = await dbClient.db.collection(FILESCOLLECTION).insertOne(document);
    const fileId = result.insertedId;
    if (type === 'image') {
      await fileQueue.add({
        userId: user._id,
        fileId,
      });
    }
    return response.status(201).send({
      id: fileId,
      userId: user._id,
      name,
      type,
      isPublic: !!isPublic,
      parentId,
    });
  }

  static async getShow(request, response) {
    const xToken = request.headers[TOKEN];
    const user = await getUser(xToken);
    if (!user) return response.status(401).send({ error: UNAUTHORIZED });

    const fileId = request.params.id;
    if (!fileId) return response.status(404).send({ error: NOTFOUND });

    const query = { _id: ObjectId(fileId), userId: user._id };
    const file = await dbClient.db.collection(FILESCOLLECTION).findOne(query);

    if (!file) return response.status(404).send({ error: NOTFOUND });

    return response.status(200).send({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    });
  }

  static async getIndex(request, response) {
    const xToken = request.headers[TOKEN];
    const user = await getUser(xToken);
    if (!user) return response.status(401).send({ error: UNAUTHORIZED });

    const parentId = request.query.parentId || 0;
    const page = request.query.page || 0;
    let match;

    if (parentId === 0) match = {};
    else {
      match = {
        parentId: parentId === '0' ? Number(parentId) : ObjectId(parentId),
      };
    }

    const limit = 20;
    const skip = page * limit;
    const filesList = await dbClient.db.collection(FILESCOLLECTION).aggregate([
      {
        $match: match,
      },
      { $skip: skip },
      { $limit: limit },
    ]).toArray();

    const resultList = filesList.map((file) => ({
      id: file._id,
      userId: file.userId,
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId,
    }));

    return response.status(200).send(resultList);
  }

  static async putPublish(request, response) {
    const xToken = request.headers[TOKEN];
    const user = await getUser(xToken);
    if (!user) return response.status(401).send({ error: UNAUTHORIZED });

    const fileId = request.params.id || '';
    if (fileId === '') return response.status(404).send({ error: NOTFOUND });
    const query = { _id: ObjectId(fileId), userId: user._id };
    const file = await dbClient.db.collection(FILESCOLLECTION).findOne(query);

    if (!file) return response.status(404).send({ error: NOTFOUND });

    const updateValue = { $set: { isPublic: true } };
    dbClient.db.collection(FILESCOLLECTION).updateOne(query, updateValue, (error) => {
      if (error) throw error;
    });

    return response.status(200).send({
      id: file._id,
      userId: user._id,
      name: file.name,
      type: file.type,
      isPublic: true,
      parentId: file.parentId,
    });
  }

  static async putUnPublish(request, response) {
    const xToken = request.headers[TOKEN];
    const user = await getUser(xToken);
    if (!user) return response.status(401).send({ error: UNAUTHORIZED });

    const fileId = request.params.id || '';
    if (fileId === '') return response.status(404).send({ error: NOTFOUND });
    const query = { _id: ObjectId(fileId), userId: user._id };
    const file = await dbClient.db.collection(FILESCOLLECTION).findOne(query);

    if (!file) return response.status(404).send({ error: NOTFOUND });

    const updateValue = { $set: { isPublic: false } };
    dbClient.db.collection(FILESCOLLECTION).updateOne(query, updateValue, (error) => {
      if (error) throw error;
    });

    return response.status(200).send({
      id: file._id,
      userId: user._id,
      name: file.name,
      type: file.type,
      isPublic: false,
      parentId: file.parentId,
    });
  }

  static async getFile(request, response) {
    const fileId = request.params.id || '';
    if (fileId === '') return response.status(404).send({ error: NOTFOUND });

    const size = request.query.size || 0;

    const query = { _id: ObjectId(fileId) };

    const file = await dbClient.db.collection(FILESCOLLECTION).findOne(query);
    if (!file) return response.status(404).send({ error: NOTFOUND });

    const path = size === 0 ? file.localPath : `${file.localPath}_${size}`;

    if (!file.isPublic) {
      const xToken = request.headers[TOKEN];
      const user = await getUser(xToken);
      if (!user || user._id.toString() !== file.userId.toString()) {
        return response.status(404).send({ error: NOTFOUND });
      }
    }

    if (file.type === FOLDER) return response.status(400).send({ error: FOLDERNOCONTENT });

    try {
      const mimeType = mime.lookup(file.name);
      response.setHeader('Content-Type', mimeType);
      const data = fs.readFileSync(path);
      return response.status(200).send(data);
    } catch (error) {
      return response.status(404).send({ error: NOTFOUND });
    }
  }
}

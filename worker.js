import Bull from 'bull';
import fs from 'fs';
import { ObjectId } from 'mongodb';
import imageThumbnail from 'image-thumbnail';
import dbClient from './utils/db';

const fileQueue = new Bull('fileQueue');
const userQueue = new Bull('userQueue');

fileQueue.process(async (job) => {
  const { fileId } = job.data;
  const { userId } = job.data;
  if (!fileId) throw Error('Missing fileId');
  if (!userId) throw Error('Missing userId');

  const file = await dbClient.db.collection('files').findOne({ _id: ObjectId(fileId), userId: ObjectId(userId) });
  if (!file) throw Error('File not found');

  const path = file.localPath;

  try {
    const thumbnail = await imageThumbnail(path, { width: 100 });
    fs.writeFileSync(`${path}_100`, thumbnail);

    const thumbnail250 = await imageThumbnail(path, { width: 250 });
    fs.writeFileSync(`${path}_250`, thumbnail250);

    const thumbnail500 = await imageThumbnail(path, { width: 500 });
    fs.writeFileSync(`${path}_500`, thumbnail500);
  } catch (e) {
    console.log(e);
  }
});

userQueue.process(async (job) => {
  const { userId } = job.data;
  if (!userId) throw Error('Missing userId');

  const user = await dbClient.db.collection('users').findOne({ _id: ObjectId(userId) });
  if (!user) throw Error('User not found');

  console.log(`Welcome ${user.email}`);
});

import express from 'express';
import router from './routes/index';

const port = process.env.PORT || 5000;
const app = express();

app.use('/', router);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

const express = require('express');
const app = express();
const PORT = 4005;

app.use(express.json());

app.listen(PORT, () => {
    console.log(`Reminder Service running on port ${PORT}`);
});
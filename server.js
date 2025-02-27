const express = require('express');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 4005;

app.use(express.json());

// Mock Database for Reminders
let reminders = {};

// Create a Reminder
app.post('/reminders', (req, res) => {
    const { userId, title, description, datetime } = req.body;

    if (!userId || !title || !datetime) {
        return res.status(400).json({ error: "User ID, title, and datetime are required" });
    }

    const reminderId = uuidv4();
    const newReminder = { reminderId, userId, title, description, datetime, completed: false };

    if (!reminders[userId]) {
        reminders[userId] = [];
    }
    reminders[userId].push(newReminder);

    res.status(201).json({ message: "Reminder created successfully", reminder: newReminder });
});

// Get Reminders for a Specific User
app.get('/reminders/:userId', (req, res) => {
    const { userId } = req.params;

    if (!reminders[userId]) {
        return res.status(404).json({ message: "No reminders found for this user" });
    }

    res.json({ userId, reminders: reminders[userId] });
});

// Update a Reminder
app.put('/reminders/:reminderId', (req, res) => {
    const { reminderId } = req.params;
    const { userId, title, description, datetime, completed } = req.body;

    if (!userId || !reminders[userId]) {
        return res.status(404).json({ error: "User not found" });
    }

    let reminder = reminders[userId].find(r => r.reminderId === reminderId);
    if (!reminder) {
        return res.status(404).json({ error: "Reminder not found" });
    }

    if (title) reminder.title = title;
    if (description) reminder.description = description;
    if (datetime) reminder.datetime = datetime;
    if (completed !== undefined) reminder.completed = completed;

    res.json({ message: "Reminder updated successfully", reminder });
});

// Delete a Reminder
app.delete('/reminders/:reminderId', (req, res) => {
    const { reminderId } = req.params;
    const { userId } = req.body;

    if (!userId || !reminders[userId]) {
        return res.status(404).json({ error: "User not found" });
    }

    reminders[userId] = reminders[userId].filter(r => r.reminderId !== reminderId);

    res.json({ message: "Reminder deleted successfully" });
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: "Reminder Service is running" });
});

app.listen(PORT, () => {
    console.log(`Reminder Service running on port ${PORT}`);
});

// reminder-service (app.js)
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const admin = require('firebase-admin');
const app = express();
const PORT = 4005;

dotenv.config();
app.use(express.json());
app.use(cors({
    origin: 'http://middleware:3001',
    credentials: true,
}));

// Initialize Firebase
const firebaseCredentials = process.env.FIREBASE_CREDENTIALS;

if (!firebaseCredentials) {
    console.error('FIREBASE_CREDENTIALS environment variable is not set');
    process.exit(1); // Exit if credentials are missing
}

let serviceAccount;
try {
    // Decode base64-encoded credentials and parse as JSON
    serviceAccount = JSON.parse(Buffer.from(firebaseCredentials, 'base64').toString('utf8'));
} catch (error) {
    console.error('Error parsing FIREBASE_CREDENTIALS as base64 JSON:', error.message);
    process.exit(1); // Exit if parsing fails
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Create a Reminder
app.post('/reminders', async (req, res) => {
    const { userId, title, description, datetime } = req.body;

    if (!userId || !title || !datetime) {
        return res.status(400).json({ error: 'User ID, title, and datetime are required' });
    }

    try {
        const reminderData = {
            userId,
            title,
            description: description || '',
            datetime,
            completed: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        };

        const docRef = await db.collection('reminders').add(reminderData);
        const newReminder = { reminderId: docRef.id, ...reminderData };

        console.log('Reminder created:', newReminder);
        res.status(201).json({ message: 'Reminder created successfully', reminder: newReminder });
    } catch (error) {
        console.error('Error creating reminder in Firebase:', error);
        res.status(500).json({ error: 'Failed to create reminder', details: error.message });
    }
});

// Get Reminders for a Specific User
app.get('/reminders/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const snapshot = await db.collection('reminders')
            .where('userId', '==', userId)
            .orderBy('datetime', 'asc')
            .get();

        if (snapshot.empty) {
            console.log('No reminders found for userId:', userId);
            return res.json({ userId, reminders: [] });
        }

        const reminders = snapshot.docs.map(doc => ({
            reminderId: doc.id,
            ...doc.data()
        }));

        console.log('Reminders retrieved for userId:', userId, reminders);
        res.json({ userId, reminders });
    } catch (error) {
        console.error('Error fetching reminders:', error);
        res.status(500).json({ error: 'Failed to fetch reminders', details: error.message });
    }
});

// Update a Reminder
app.put('/reminders/:reminderId', async (req, res) => {
    const { reminderId } = req.params;
    const { userId, title, description, datetime, completed } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const reminderRef = db.collection('reminders').doc(reminderId);
        const doc = await reminderRef.get();

        if (!doc.exists || doc.data().userId !== userId) {
            return res.status(404).json({ error: 'Reminder not found or unauthorized' });
        }

        const updates = {};
        if (title) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (datetime) updates.datetime = datetime;
        if (completed !== undefined) updates.completed = completed;

        await reminderRef.update(updates);
        const updatedReminder = { reminderId, ...doc.data(), ...updates };

        console.log('Reminder updated:', updatedReminder);
        res.json({ message: 'Reminder updated successfully', reminder: updatedReminder });
    } catch (error) {
        console.error('Error updating reminder:', error);
        res.status(500).json({ error: 'Failed to update reminder', details: error.message });
    }
});

// Delete a Reminder
app.delete('/reminders/:reminderId', async (req, res) => {
    const { reminderId } = req.params;
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const reminderRef = db.collection('reminders').doc(reminderId);
        const doc = await reminderRef.get();

        if (!doc.exists || doc.data().userId !== userId) {
            return res.status(404).json({ error: 'Reminder not found or unauthorized' });
        }

        await reminderRef.delete();
        console.log('Reminder deleted:', reminderId);
        res.json({ message: 'Reminder deleted successfully' });
    } catch (error) {
        console.error('Error deleting reminder:', error);
        res.status(500).json({ error: 'Failed to delete reminder', details: error.message });
    }
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'Reminder Service is running' });
});

app.listen(PORT, () => {
    console.log(`Reminder Service running on port ${PORT}`);
});
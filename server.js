// Import required modules
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const admin = require('firebase-admin');

// Initialize Express app
const app = express();
const PORT = 4005;

// Load environment variables
dotenv.config();

// Middleware setup
app.use(express.json());
app.use(cors({
    origin: 'http://middleware:3001',
    credentials: true,
}));

// Initialize Firebase
const firebaseCredentials = process.env.FIREBASE_CREDENTIALS;

// Validate Firebase credentials
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

// Utility Functions

/**
 * Logs changes to Firestore for auditing purposes.
 * @param {string} action - The action performed (e.g., CREATE, UPDATE, DELETE).
 * @param {string} userId - The ID of the user performing the action.
 * @param {string} entity - The entity being modified (e.g., 'Reminder').
 * @param {string} entityId - The ID of the entity being modified.
 * @param {string} entityName - The name of the entity being modified.
 * @param {object} details - Additional details about the change.
 */
async function logChange(action, userId, entity, entityId, entityName, details = {}) {
    try {
        // Fetch user name from users collection
        let userName = 'Unknown';
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                userName = userDoc.data().name || 'Unnamed User';
            }
        } catch (error) {
            console.error(`Error fetching user ${userId}:`, error);
        }

        const logEntry = {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            action,
            userId: userId || 'unknown',
            userName,
            entity,
            entityId,
            entityName: entityName || 'N/A',
            details,
        };
        await db.collection('logs').add(logEntry);
        console.log(`Logged: ${action} on ${entity} (${entityId}, ${entityName}) by ${userId} (${userName})`);
    } catch (error) {
        console.error('Error logging change:', error);
    }
}

// API Endpoints


/**
 * Fetch all reminders for an organization
 * @route GET /api/reminders/all
 * @description Fetch all reminders for patients in a given organization
 */
app.get('/api/reminders/all', async (req, res) => {
    const { organizationId } = req.query;
    console.log('Fetching all reminders for organizationId:', organizationId);

    try {
        const patientsSnapshot = await db.collection('users')
            .where('organizationId', '==', organizationId)
            .where('role', '==', 'user')
            .get();

        if (patientsSnapshot.empty) {
            console.log('No patients found for organizationId:', organizationId);
            return res.json([]);
        }

        const patientIds = patientsSnapshot.docs.map(doc => doc.id);
        const remindersSnapshot = await db.collection('reminders')
            .where('userId', 'in', patientIds.length > 0 ? patientIds : ['none'])
            .orderBy('datetime', 'asc')
            .get();

        const reminders = remindersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log('Reminders retrieved for organization:', reminders);
        res.json(reminders);
    } catch (error) {
        console.error('Error fetching all reminders:', error.message);
        res.status(500).json([]);
    }
});


/**
 * Create a new reminder.
 * @route POST /reminders
 * @param {string} userId - The ID of the user creating the reminder.
 * @param {string} title - The title of the reminder.
 * @param {string} description - The description of the reminder (optional).
 * @param {string} datetime - The date and time of the reminder.
 */
app.post('/reminders', async (req, res) => {
    const { userId, title, description, datetime } = req.body;

    // Input validation
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

        await logChange('CREATE', userId, 'Reminder', docRef.id, title, { data: reminderData });
        console.log('Reminder created:', newReminder);
        res.status(201).json({ message: 'Reminder created successfully', reminder: newReminder });
    } catch (error) {
        console.error('Error creating reminder in Firebase:', error);
        res.status(500).json({ error: 'Failed to create reminder', details: error.message });
    }
});

/**
 * Get reminders for a specific user.
 * @route GET /reminders/:userId
 * @param {string} userId - The ID of the user to fetch reminders for.
 */
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

/**
 * Update a reminder.
 * @route PUT /reminders/:reminderId
 * @param {string} reminderId - The ID of the reminder to update.
 * @param {string} userId - The ID of the user updating the reminder.
 * @param {string} title - The updated title of the reminder (optional).
 * @param {string} description - The updated description of the reminder (optional).
 * @param {string} datetime - The updated date and time of the reminder (optional).
 * @param {boolean} completed - The updated completion status of the reminder (optional).
 */
app.put('/reminders/:reminderId', async (req, res) => {
    const { reminderId } = req.params;
    const { userId, title, description, datetime, completed } = req.body;

    // Input validation
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const reminderRef = db.collection('reminders').doc(reminderId);
        const doc = await reminderRef.get();

        if (!doc.exists || doc.data().userId !== userId) {
            return res.status(404).json({ error: 'Reminder not found or unauthorized' });
        }

        const oldData = doc.data();
        const updates = {};
        if (title) updates.title = title;
        if (description !== undefined) updates.description = description;
        if (datetime) updates.datetime = datetime;
        if (completed !== undefined) updates.completed = completed;

        await reminderRef.update(updates);
        const updatedReminder = { reminderId, ...oldData, ...updates };

        await logChange('UPDATE', userId, 'Reminder', reminderId, title || oldData.title, { oldData, newData: updates });
        console.log('Reminder updated:', updatedReminder);
        res.json({ message: 'Reminder updated successfully', reminder: updatedReminder });
    } catch (error) {
        console.error('Error updating reminder:', error);
        res.status(500).json({ error: 'Failed to update reminder', details: error.message });
    }
});

/**
 * Delete a reminder.
 * @route DELETE /reminders/:reminderId
 * @param {string} reminderId - The ID of the reminder to delete.
 * @param {string} userId - The ID of the user deleting the reminder.
 */
app.delete('/reminders/:reminderId', async (req, res) => {
    const { reminderId } = req.params;
    const { userId } = req.body;

    // Input validation
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const reminderRef = db.collection('reminders').doc(reminderId);
        const doc = await reminderRef.get();

        if (!doc.exists || doc.data().userId !== userId) {
            return res.status(404).json({ error: 'Reminder not found or unauthorized' });
        }

        const reminderData = doc.data();
        await logChange('DELETE', userId, 'Reminder', reminderId, reminderData.title, { data: reminderData });
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

// Start the server
app.listen(PORT, () => {
    console.log(`Reminder Service running on port ${PORT}`);
});
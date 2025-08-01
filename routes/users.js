// routes/users.js
const express = require('express');
const { admin } = require('../config/firebase');
const router = express.Router();

const db = admin.firestore();
const usersCollection = db.collection('users');

/**
 * @route   GET /api/users/profile
 * @desc    Get current user's profile
 * @access  Private
 */
router.get('/profile', async (req, res) => {
  try {
    const userDoc = await usersCollection.doc(req.user.uid).get();
    
    if (!userDoc.exists) {
      // If no profile in Firestore, create one from Auth data
      const userRecord = await admin.auth().getUser(req.user.uid);
      const initialProfile = {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName || 'Anonymous User',
        photoURL: userRecord.photoURL || null,
        address: '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      // Save this initial profile to Firestore for consistency
      await usersCollection.doc(req.user.uid).set(initialProfile);
      return res.json(initialProfile);
    }
    
    res.json({ id: userDoc.id, ...userDoc.data() });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ message: 'Failed to fetch user profile' });
  }
});

/**
 * @route   PUT /api/users/profile
 * @desc    Create or update user profile
 * @access  Private
 */
router.put('/profile', async (req, res) => {
  try {
    const userId = req.user.uid;
    const { displayName, address, photoURL } = req.body;

    // Data to update in Firebase Auth
    const authUpdatePayload = {};
    if (displayName) authUpdatePayload.displayName = displayName;
    if (photoURL) authUpdatePayload.photoURL = photoURL;

    // Data to update in Firestore
    const firestoreUpdatePayload = {
      email: req.user.email, // Keep email in sync
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    if (displayName) firestoreUpdatePayload.displayName = displayName;
    if (address) firestoreUpdatePayload.address = address;
    if (photoURL) firestoreUpdatePayload.photoURL = photoURL;
    
    // Update Firebase Authentication profile
    if (Object.keys(authUpdatePayload).length > 0) {
        await admin.auth().updateUser(userId, authUpdatePayload);
    }

    // Create or update the profile in Firestore users collection
    await usersCollection.doc(userId).set(firestoreUpdatePayload, { merge: true });
    
    res.json({ message: 'Profile updated successfully', profile: firestoreUpdatePayload });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ message: 'Failed to update profile', error: error.message });
  }
});

module.exports = router;
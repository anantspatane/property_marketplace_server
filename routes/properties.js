const express = require('express');
const { admin } = require('../config/firebase');
const router = express.Router();

const db = admin.firestore();
const propertiesCollection = db.collection('properties');
const usersCollection = db.collection('users');

// GET /api/properties - Get all properties with owner details
router.get('/', async (req, res) => {
  try {
    const userId = req.user.uid;
    const { myProperties } = req.query; // Check if user wants only their properties
    
    let query = propertiesCollection;
    
    // If myProperties=true, filter by current user
    if (myProperties === 'true') {
      query = query.where('userId', '==', userId);
    }
    
    const snapshot = await query.orderBy('createdAt', 'desc').get();
    
    if (snapshot.empty) {
      return res.json([]);
    }
    
    const properties = [];
    const userIds = new Set();
    
    // Collect all property data and unique user IDs
    snapshot.forEach(doc => {
      const propertyData = doc.data();
      properties.push({
        id: doc.id,
        ...propertyData
      });
      userIds.add(propertyData.userId);
    });
    
    // Fetch user details for all property owners
    const userPromises = Array.from(userIds).map(async (uid) => {
      try {
        // First try to get from users collection
        const userDoc = await usersCollection.doc(uid).get();
        if (userDoc.exists) {
          return { uid, ...userDoc.data() };
        }
        
        // Fallback to Firebase Auth if not in users collection
        const userRecord = await admin.auth().getUser(uid);
        return {
          uid: userRecord.uid,
          email: userRecord.email,
          displayName: userRecord.displayName || 'Anonymous User',
          phone: userRecord.phoneNumber || null,
          photoURL: userRecord.photoURL || null
        };
      } catch (error) {
        console.error(`Error fetching user ${uid}:`, error);
        return {
          uid,
          email: 'Unknown',
          displayName: 'Unknown User',
          phone: null,
          photoURL: null
        };
      }
    });
    
    const users = await Promise.all(userPromises);
    const userMap = users.reduce((acc, user) => {
      acc[user.uid] = user;
      return acc;
    }, {});
    
    // Combine properties with owner details
    const propertiesWithOwners = properties.map(property => ({
      ...property,
      owner: {
        uid: property.userId,
        email: userMap[property.userId]?.email || 'Unknown',
        displayName: userMap[property.userId]?.displayName || 'Unknown User',
        phone: userMap[property.userId]?.phone || null,
        photoURL: userMap[property.userId]?.photoURL || null
      },
      isOwnProperty: property.userId === userId
    }));
    
    res.json(propertiesWithOwners);
  } catch (error) {
    console.error('Error fetching properties:', error);
    res.status(500).json({ 
      message: 'Failed to fetch properties',
      error: error.message 
    });
  }
});

// POST /api/properties - Create a new property
router.post('/', async (req, res) => {
  try {
    const userId = req.user.uid;
    const userEmail = req.user.email;
    const propertyData = req.body;
    
    // Validate required fields
    const requiredFields = ['name', 'type', 'location', 'price'];
    const missingFields = requiredFields.filter(field => !propertyData[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        message: 'Missing required fields',
        missingFields
      });
    }
    
    // Get or create user profile
    let userProfile;
    try {
      const userDoc = await usersCollection.doc(userId).get();
      if (userDoc.exists) {
        userProfile = userDoc.data();
      } else {
        // Create user profile from auth data
        const userRecord = await admin.auth().getUser(userId);
        userProfile = {
          email: userRecord.email,
          displayName: userRecord.displayName || propertyData.ownerName || 'Anonymous User',
          phone: userRecord.phoneNumber || propertyData.ownerPhone || null,
          photoURL: userRecord.photoURL || null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        };
        await usersCollection.doc(userId).set(userProfile);
      }
    } catch (error) {
      console.error('Error handling user profile:', error);
      userProfile = {
        email: userEmail,
        displayName: propertyData.ownerName || 'Anonymous User',
        phone: propertyData.ownerPhone || null,
        photoURL: null
      };
    }
    
    // Add user ID and timestamps
    const newProperty = {
      ...propertyData,
      userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    const docRef = await propertiesCollection.add(newProperty);
    
    // Get the created document to return it with owner details
    const createdDoc = await docRef.get();
    const createdProperty = {
      id: createdDoc.id,
      ...createdDoc.data(),
      owner: {
        uid: userId,
        email: userProfile.email,
        displayName: userProfile.displayName,
        phone: userProfile.phone,
        photoURL: userProfile.photoURL
      },
      isOwnProperty: true
    };
    
    res.status(201).json(createdProperty);
  } catch (error) {
    console.error('Error creating property:', error);
    res.status(500).json({ 
      message: 'Failed to create property',
      error: error.message 
    });
  }
});

// GET /api/properties/:id - Get a specific property with owner details
router.get('/:id', async (req, res) => {
  try {
    const propertyId = req.params.id;
    const userId = req.user.uid;
    
    const doc = await propertiesCollection.doc(propertyId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ message: 'Property not found' });
    }
    
    const property = { id: doc.id, ...doc.data() };
    
    // Get owner details
    let owner;
    try {
      const userDoc = await usersCollection.doc(property.userId).get();
      if (userDoc.exists) {
        owner = userDoc.data();
      } else {
        const userRecord = await admin.auth().getUser(property.userId);
        owner = {
          email: userRecord.email,
          displayName: userRecord.displayName || 'Anonymous User',
          phone: userRecord.phoneNumber || null,
          photoURL: userRecord.photoURL || null
        };
      }
    } catch (error) {
      owner = {
        email: 'Unknown',
        displayName: 'Unknown User',
        phone: null,
        photoURL: null
      };
    }
    
    const propertyWithOwner = {
      ...property,
      owner: {
        uid: property.userId,
        ...owner
      },
      isOwnProperty: property.userId === userId
    };
    
    res.json(propertyWithOwner);
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({ 
      message: 'Failed to fetch property',
      error: error.message 
    });
  }
});

// PUT /api/properties/:id - Update a property (only owner can update)
router.put('/:id', async (req, res) => {
  try {
    const propertyId = req.params.id;
    const userId = req.user.uid;
    const updateData = req.body;
    
    // First, check if the property exists and belongs to the user
    const doc = await propertiesCollection.doc(propertyId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ message: 'Property not found' });
    }
    
    const property = doc.data();
    if (property.userId !== userId) {
      return res.status(403).json({ message: 'Access denied - You can only update your own properties' });
    }
    
    // Update the property
    const updatedData = {
      ...updateData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await propertiesCollection.doc(propertyId).update(updatedData);
    
    // Get the updated document with owner details
    const updatedDoc = await propertiesCollection.doc(propertyId).get();
    const userDoc = await usersCollection.doc(userId).get();
    const userProfile = userDoc.exists ? userDoc.data() : {};
    
    const updatedProperty = {
      id: updatedDoc.id,
      ...updatedDoc.data(),
      owner: {
        uid: userId,
        email: userProfile.email || req.user.email,
        displayName: userProfile.displayName || 'Anonymous User',
        phone: userProfile.phone || null,
        photoURL: userProfile.photoURL || null
      },
      isOwnProperty: true
    };
    
    res.json(updatedProperty);
  } catch (error) {
    console.error('Error updating property:', error);
    res.status(500).json({ 
      message: 'Failed to update property',
      error: error.message 
    });
  }
});

// DELETE /api/properties/:id - Delete a property (only owner can delete)
router.delete('/:id', async (req, res) => {
  try {
    const propertyId = req.params.id;
    const userId = req.user.uid;
    
    // First, check if the property exists and belongs to the user
    const doc = await propertiesCollection.doc(propertyId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ message: 'Property not found' });
    }
    
    const property = doc.data();
    if (property.userId !== userId) {
      return res.status(403).json({ message: 'Access denied - You can only delete your own properties' });
    }
    
    // Delete the property
    await propertiesCollection.doc(propertyId).delete();
    
    res.json({ message: 'Property deleted successfully' });
  } catch (error) {
    console.error('Error deleting property:', error);
    res.status(500).json({ 
      message: 'Failed to delete property',
      error: error.message 
    });
  }
});

// GET /api/properties/user/:userId - Get properties by specific user (public endpoint)
router.get('/user/:userId', async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    const currentUserId = req.user.uid;
    
    const snapshot = await propertiesCollection
      .where('userId', '==', targetUserId)
      .orderBy('createdAt', 'desc')
      .get();
    
    if (snapshot.empty) {
      return res.json([]);
    }
    
    // Get user details
    let owner;
    try {
      const userDoc = await usersCollection.doc(targetUserId).get();
      if (userDoc.exists) {
        owner = userDoc.data();
      } else {
        const userRecord = await admin.auth().getUser(targetUserId);
        owner = {
          email: userRecord.email,
          displayName: userRecord.displayName || 'Anonymous User',
          phone: userRecord.phoneNumber || null,
          photoURL: userRecord.photoURL || null
        };
      }
    } catch (error) {
      owner = {
        email: 'Unknown',
        displayName: 'Unknown User',
        phone: null,
        photoURL: null
      };
    }
    
    const properties = [];
    snapshot.forEach(doc => {
      properties.push({
        id: doc.id,
        ...doc.data(),
        owner: {
          uid: targetUserId,
          ...owner
        },
        isOwnProperty: targetUserId === currentUserId
      });
    });
    
    res.json(properties);
  } catch (error) {
    console.error('Error fetching user properties:', error);
    res.status(500).json({ 
      message: 'Failed to fetch user properties',
      error: error.message 
    });
  }
});

module.exports = router;
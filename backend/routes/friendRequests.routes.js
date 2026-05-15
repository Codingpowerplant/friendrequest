const express = require('express');
const router = express.Router();
const { sendFriendRequest } = require('../controllers/friendRequestController');
const { protect } = require('../middleware/authMiddleware');

router.post('/', protect, sendFriendRequest);

module.exports = router;

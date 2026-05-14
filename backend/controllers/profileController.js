const Product = require('../models/Product');
const Post = require('../models/Post');
const Profile = require('../models/Profile');
const User = require('../models/User');
const { buildMediaUrl } = require('../services/mediaUrlService');
const { findUserAcrossRolesById, normalizeBaseUser } = require('../services/userModelService');
const { toUploadPath } = require('../middleware/upload');

async function ensureProfile(user) {
    let profile = await Profile.findOne({ userId: user.id, role: user.role });
    if (!profile) {
        profile = await Profile.create({ userId: user.id, role: user.role });
    }
    return profile;
}

async function buildProfileResponse(profileDoc, user, req) {
    const [productCount, postCount] = await Promise.all([
        Product.countDocuments({ 'seller.userId': user.id }),
        Post.countDocuments({ 'author.userId': user.id }),
    ]);

    return {
        id: String(user._id || user.id || profileDoc.userId),
        userId: String(user._id || user.id || profileDoc.userId),
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        age: user.age,
        gender: user.gender,
        address: user.address,
        phone: user.phone,
        paymentMethod: user.paymentMethod,
        bio: profileDoc.bio,
        location: profileDoc.location || user.address,
        farmName: profileDoc.farmName,
        products: profileDoc.products,
        cropTypes: profileDoc.cropTypes,
        farmLocation: profileDoc.farmLocation,
        farmSizeAcres: profileDoc.farmSizeAcres,
        avatarUrl: buildMediaUrl(req, profileDoc.avatarPath),
        coverUrl: buildMediaUrl(req, profileDoc.coverPath),
        createdAt: profileDoc.createdAt,
        updatedAt: profileDoc.updatedAt,
        stats: {
            products: productCount,
            posts: postCount,
        },
    };
}

async function getCurrentProfile(req, res) {
    try {
        const profile = await ensureProfile(req.user);
        const data = await buildProfileResponse(profile, req.user, req);
        return res.json({ success: true, data });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Failed to load profile.' });
    }
}

async function getProfileById(req, res) {
    try {
        const foundUser = await findUserAcrossRolesById(req.params.id);
        if (!foundUser) {
            return res.status(404).json({ success: false, message: 'Profile not found.' });
        }

        const baseUser = normalizeBaseUser(foundUser);
        const profile = await ensureProfile(baseUser);
        const data = await buildProfileResponse(profile, baseUser, req);

        if (req.user) {
            const currentUserId = String(req.user._id || req.user.id);
            const targetUserId = String(foundUser._id || foundUser.id);
            data.relationship = {
                isOwnProfile: currentUserId === targetUserId,
                isFriend: Array.isArray(req.user.friends) && req.user.friends.some((item) => String(item.userId) === targetUserId),
                requestSent: Array.isArray(req.user.outgoingFriendRequests) && req.user.outgoingFriendRequests.some((item) => String(item.to) === targetUserId && item.status === 'pending'),
                requestReceived: Array.isArray(req.user.incomingFriendRequests) && req.user.incomingFriendRequests.some((item) => String(item.from) === targetUserId && item.status === 'pending'),
            };
        }

        return res.json({ success: true, data });
    } catch (error) {
        return res.status(400).json({ success: false, message: 'Invalid profile id.' });
    }
}

async function sendFriendRequest(req, res) {
    try {
        const requesterId = String(req.user._id || req.user.id);
        const recipientId = String(req.params.id);

        if (requesterId === recipientId) {
            return res.status(400).json({ success: false, message: 'You cannot send a friend request to yourself.' });
        }

        const recipient = await User.findById(recipientId);
        if (!recipient || !recipient.isActive) {
            return res.status(404).json({ success: false, message: 'Recipient not found.' });
        }

        const alreadyFriends = Array.isArray(req.user.friends) && req.user.friends.some((item) => String(item.userId) === recipientId);
        if (alreadyFriends) {
            return res.status(400).json({ success: false, message: 'You are already friends with this user.' });
        }

        const existingOutgoing = Array.isArray(req.user.outgoingFriendRequests) && req.user.outgoingFriendRequests.some((item) => String(item.to) === recipientId && item.status === 'pending');
        if (existingOutgoing) {
            return res.status(400).json({ success: false, message: 'Friend request already sent.' });
        }

        const existingIncoming = Array.isArray(req.user.incomingFriendRequests) && req.user.incomingFriendRequests.some((item) => String(item.from) === recipientId && item.status === 'pending');
        if (existingIncoming) {
            return res.status(400).json({ success: false, message: 'This user has already sent you a friend request.' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $push: {
                outgoingFriendRequests: { to: recipientId, status: 'pending', createdAt: new Date() },
            },
        });

        await User.findByIdAndUpdate(recipientId, {
            $push: {
                incomingFriendRequests: { from: req.user._id, status: 'pending', createdAt: new Date() },
                notifications: {
                    type: 'friend_request',
                    title: 'New friend request',
                    body: `${req.user.fullName || 'Someone'} has sent you a friend request.`,
                    href: `profile.html?user=${requesterId}`,
                    senderName: req.user.fullName || 'Unknown user',
                    senderRole: req.user.role || 'Member',
                    read: false,
                    createdAt: new Date(),
                },
            },
        });

        return res.json({ success: true, message: 'Friend request sent.' });
    } catch (error) {
        return res.status(400).json({ success: false, message: 'Failed to send friend request.' });
    }
}

async function updateCurrentProfile(req, res) {
    try {
        const profile = await ensureProfile(req.user);
        const { fullName, phone, address, paymentMethod, bio, location, farmName, products, cropTypes, farmLocation, farmSizeAcres } = req.body;

        let userDoc = req.userDoc;
        if (!userDoc) {
            const userId = req.user?._id || req.user?.id;
            userDoc = await User.findById(userId);
            if (!userDoc) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }
        }

        if (fullName !== undefined) userDoc.fullName = String(fullName).trim();
        if (phone !== undefined) userDoc.phone = String(phone).trim();
        if (address !== undefined) userDoc.address = String(address).trim();
        if (paymentMethod !== undefined) userDoc.paymentMethod = String(paymentMethod).trim();
        await userDoc.save();

        if (bio !== undefined) profile.bio = String(bio).trim();
        if (location !== undefined) profile.location = String(location).trim();
        if (farmName !== undefined) profile.farmName = String(farmName).trim();
        if (products !== undefined) profile.products = String(products).trim();
        if (cropTypes !== undefined) {
            profile.cropTypes = Array.isArray(cropTypes)
                ? cropTypes.map(item => String(item).trim()).filter(Boolean)
                : String(cropTypes).split(',').map(item => item.trim()).filter(Boolean);
        }
        if (farmLocation !== undefined) profile.farmLocation = String(farmLocation).trim();
        if (farmSizeAcres !== undefined && farmSizeAcres !== '') profile.farmSizeAcres = Number(farmSizeAcres) || 0;
        await profile.save();

        const refreshedUser = {
            ...req.user,
            id: String(userDoc._id || req.user.id),
            fullName: userDoc.fullName,
            phone: userDoc.phone,
            address: userDoc.address,
            paymentMethod: userDoc.paymentMethod,
        };

        const data = await buildProfileResponse(profile, refreshedUser, req);
        return res.json({ success: true, message: 'Profile updated successfully.', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: 'Failed to update profile.' });
    }
}

async function updateFarmerProfile(req, res) {
    if (req.user.role !== 'farmer') {
        return res.status(403).json({ success: false, message: 'Only farmers can update farmer profile fields.' });
    }

    return updateCurrentProfile(req, res);
}

async function uploadAvatar(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Avatar image is required.' });
        }

        const profile = await ensureProfile(req.user);
        profile.avatarPath = toUploadPath(req.file);
        await profile.save();

        const data = await buildProfileResponse(profile, req.user, req);
        const userDoc = await User.findById(req.user._id || req.user.id);
        if (userDoc) {
            userDoc.avatar = { url: data.avatarUrl, publicId: req.file.filename };
            await userDoc.save();
        }

        return res.json({ success: true, message: 'Avatar uploaded successfully.', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: 'Failed to upload avatar.' });
    }
}

async function uploadCover(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Cover image is required.' });
        }

        const profile = await ensureProfile(req.user);
        profile.coverPath = toUploadPath(req.file);
        await profile.save();

        const data = await buildProfileResponse(profile, req.user, req);
        const userDoc = await User.findById(req.user._id || req.user.id);
        if (userDoc) {
            userDoc.coverImage = { url: data.coverUrl, publicId: req.file.filename };
            await userDoc.save();
        }

        return res.json({ success: true, message: 'Cover uploaded successfully.', data });
    } catch (error) {
        return res.status(400).json({ success: false, message: 'Failed to upload cover image.' });
    }
}

module.exports = {
    getCurrentProfile,
    getProfileById,
    sendFriendRequest,
    updateCurrentProfile,
    updateFarmerProfile,
    uploadAvatar,
    uploadCover,
};
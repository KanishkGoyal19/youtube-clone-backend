import { asyncHandler } from "../utils/asyncHandler.js"
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.models.js"
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"
const registerUser = asyncHandler(async (req, res) => {
    // Destructure with correct schema field name (fullname)
    const { fullname, email, username, password } = req.body;

    // 1. Field Presence Validation
    if (!fullname || !email || !username || !password) {
        throw new ApiError(400, "All fields are required");
    }

    // 2. Empty Field Check
    if ([fullname, username, email, password].some(field => field.trim() === "")) {
        throw new ApiError(400, "Fields cannot contain only whitespace");
    }

    // 3. Email Format Validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        throw new ApiError(400, "Invalid email format");
    }

    // 4. Password Strength Check
    if (password.length < 6) {
        throw new ApiError(400, "Password must be at least 6 characters");
    }

    // 5. Existing User Check
    const existedUser = await User.findOne({
        $or: [{ username }, { email }]
    });
    if (existedUser) {
        throw new ApiError(409, "Username or email already exists");
    }

    // 6. Avatar Handling
    const coverLocalPath = req.files?.coverImage?.[0]?.path;
    const avatarLocalPath = req.files?.avatar?.[0]?.path;
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required");
    }

    // 7. Cloudinary Uploads
    // const avatar = await uploadOnCloudinary(avatarLocalPath);
    // if (!avatar?.url) {
    //     throw new ApiError(500, "Failed to upload avatar");
    // }

    let avatar;
    try {
        avatar = await uploadOnCloudinary(avatarLocalPath);
        console.log('Uploaded avatar');
    } catch (error) {
        console.error('Avatar upload error: ', error);
        throw new ApiError(500, "Failed to upload avatar");
    }


    // 8. Optional Cover Image Handling
    let coverImage;
    try {
        coverImage = await uploadOnCloudinary(coverLocalPath);
        console.log('Uploaded Cover Image');
    }
    catch (error) {
        console.log('Error uploading cover image');
        throw new ApiError(400, "Cover Image is required");

    }

    // 9. User Creation
    try {
        const user = await User.create({
            fullname,
            email,
            username,
            password,
            avatar: avatar.url,
            coverImage: coverImage?.url || ""
        });

        const createdUser = await User.findById(user._id).select(
            "-password -refreshToken"
        )

        if (!createdUser) {
            throw new ApiError(500, "Something went wrong")
        }

        // 10. Success Response
        return res.status(201).json(new ApiResponse(200, createdUser, "User registered Succesfully"));
    } catch (error) {
        console.log('User Creation Failed')
        if (avatar) {
            await deleteFromCloudinary(avatar.public_id)
        }
        if (coverImage) {
            await deleteFromCloudinary(coverImage.public_id)
        }
        throw new ApiError(500, "Something went wrong, and images were deleted")

    }
});

const generateAccessandRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId)
        if (!user) {
            throw new ApiError(404, "User does not exist")
        }
        const accessToken = user.generateRefreshToken()
        const refreshToken = user.generateAccessToken()

        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })
        return { accessToken, refreshToken }
    } catch (error) {
        throw new ApiError(500, 'Something went wrong while generating access and refresh token')

    }

}

const loginUser = asyncHandler(async (req, res) => {
    const { email, username, password } = req.body;

    // Input validation: Ensure either email or username and password are provided
    if ((!email && !username) || !password) {
        throw new ApiError(400, "Either email or username and password are required.");
    }

    // If email is provided, validate its format using a regular expression.
    // The regex below checks for a basic email format.
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ApiError(400, "Invalid email format.");
    }

    // Query the database using trimmed values for consistency
    const user = await User.findOne({
        $or: [{ username: username ? username.trim() : undefined }, { email: email ? email.trim() : undefined }]
    });
    if (!user) {
        throw new ApiError(404, "User Not Found");
    }

    const isPasswordCorrect = await user.isPasswordCorrect(password);
    if (!isPasswordCorrect) {
        throw new ApiError(401, "Invalid Credentials");
    }

    const { accessToken, refreshToken } = await generateAccessandRefreshToken(user._id);

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production"
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(
            200,
            { user: loggedInUser, accessToken, refreshToken },
            "User logged in succesfully"
        ));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
    if (!incomingRefreshToken) {
        throw new ApiError(401, "Refresh Token is required")
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )
        const user = await User.findById(decodedToken?._id)
        if (!user) {
            throw new ApiError(401, "Invalid refresh token")
        }
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Invalid refresh token")
        }
        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production"
        }
        const { accessToken, refreshToken: newRefreshToken } = await generateAccessandRefreshToken(user._id)
        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(new ApiResponse(
                200,
                { accessToken, refreshToken: newRefreshToken },
                "Access Token refreshed successfully")
            )
    } catch (error) {
        throw new ApiError(500, "Something Went Wrong while refreshing access Token")
    }
})

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        {
            $set: { refreshToken: undefined, }
        },
        { new: true }
    )
    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production"
    }
    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "User logged out successfully"))
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body
    const user = await User.findById(req.user?._id)
    const isPasswordValid = await user.isPasswordCorrect(currentPassword)
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid current password")
    }
    user.password = newPassword
    await user.save({ validateBeforeSave: false })
    return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, req.user, "User retrieved successfully"))
})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullname, email } = req.body  //req.body has all the fields we are alloweing the user to update
    if (!fullname || !email) {
        throw new ApiError(400, "All fields are required")
    }
    User.findByIdAndUpdate(req.user?._id,
        {
            $set:
                { fullname, email }
        },
        { new: true }
    ).select("-password -refreshToken")

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Account details updated successfully"))
})

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    if (!avatar.url) {
        throw new ApiError(500, "Failed to upload avatar")
    }
    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:
                { avatar: avatar.url }
        },
        { new: true }
    ).select("-password -refreshToken")

    res.status(200).json(new ApiResponse(200, user, "Avatar updated successfully"))
})

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path
    if (!coverImageLocalPath) {
        throw new ApiError(400, "Cover Image file is required")
    }
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)
    if (!coverImage.url) {
        throw new ApiError(500, "Failed to upload cover image")
    }
    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:
                { coverImage: coverImage.url }
        },
        { new: true }
    ).select("-password -refreshToken")

    res.status(200).json(new ApiResponse(200, user, "Cover Image updated successfully"))

})

export {
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage
}
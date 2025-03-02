import { v2 as cloudinary } from 'cloudinary';
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

// Configuration
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadOnCloudinary = async (localfilepath) => {
    try {
        if (!localfilepath) {
            return null; // Return null if file path is not provided
        }

        // Wait for the Cloudinary upload to complete
        const uploadResult = await cloudinary.uploader.upload(localfilepath, {
            resource_type: "auto", // Automatically detect file type (image, video, etc.)
        });

        // Log success
        console.log("File Uploaded Successfully");

        // Delete the local file after uploading
        fs.unlinkSync(localfilepath);

        // Return the Cloudinary upload result (e.g., URL)
        return uploadResult; // This will return the object containing details like url, public_id, etc.

    } catch (error) {
        // Delete the local file in case of error
        fs.unlinkSync(localfilepath);

        // Log the error for debugging
        console.error("Cloudinary Upload Error: ", error);

        return null; // Return null if something goes wrong
    }
}

const deleteFromCloudinary = async(publicId)=>{
    try{
        const result = await cloudinary.uploader.destroy(publicId)
    }
    catch(error){
        console.log('error deleting from cloudinary', error);
        return null;
    }
}

export { uploadOnCloudinary, deleteFromCloudinary };

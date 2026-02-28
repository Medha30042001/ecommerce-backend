import multer from "multer";

// store in memory, we'll upload to Supabase Storage ourselves
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export default upload;
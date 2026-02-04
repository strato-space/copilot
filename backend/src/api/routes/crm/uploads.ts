import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { getLogger } from '../../../utils/logger.js';

const router = Router();
const logger = getLogger();

// Configure upload directory
const getUploadDir = (): string => {
    const dir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

// Configure multer storage
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, getUploadDir());
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
        const ext = path.extname(file.originalname);
        cb(null, `${file.fieldname}-${uniqueSuffix}${ext}`);
    },
});

// Configure multer
const upload = multer({
    storage,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10), // 10MB default
    },
});

/**
 * Upload single file
 * POST /api/crm/upload/file
 */
router.post('/file', upload.single('file'), (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No file uploaded' });
            return;
        }

        const file = req.file;
        const fileUrl = `/uploads/${file.filename}`;

        res.status(200).json({
            success: true,
            file: {
                originalName: file.originalname,
                filename: file.filename,
                mimetype: file.mimetype,
                size: file.size,
                url: fileUrl,
            },
        });
    } catch (error) {
        logger.error('Error uploading file:', error);
        res.status(500).json({ error: String(error) });
    }
});

/**
 * Upload multiple files
 * POST /api/crm/upload/files
 */
router.post('/files', upload.array('filesArray', 10), (req: Request, res: Response) => {
    try {
        const files = req.files as Express.Multer.File[];

        if (!files || files.length === 0) {
            res.status(400).json({ error: 'No files uploaded' });
            return;
        }

        const uploadedFiles = files.map((file) => ({
            originalName: file.originalname,
            filename: file.filename,
            mimetype: file.mimetype,
            size: file.size,
            url: `/uploads/${file.filename}`,
        }));

        res.status(200).json({
            success: true,
            files: uploadedFiles,
        });
    } catch (error) {
        logger.error('Error uploading files:', error);
        res.status(500).json({ error: String(error) });
    }
});

export default router;

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { AppError } from '../middleware/error.js';
import { sendOk } from '../middleware/response.js';
import authMiddleware from '../middleware/auth.js';
import { requireAdmin } from '../middleware/roleGuard.js';

const router = Router();

const ALLOWED_MIME = new Set([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const getUploadDir = (): string => {
    const baseDir = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');
    const dir = path.join(baseDir, 'expenses');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

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

const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024,
    },
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIME.has(file.mimetype)) {
            cb(new AppError('Unsupported file type', 400, 'VALIDATION_ERROR'));
            return;
        }
        cb(null, true);
    },
});

router.post('/uploads/expense-attachments', authMiddleware, requireAdmin, upload.single('file'), (req: Request, res: Response) => {
    if (!req.file) {
        throw new AppError('No file uploaded', 400, 'VALIDATION_ERROR');
    }
    const file = req.file;
    const fileUrl = `/uploads/expenses/${file.filename}`;
    sendOk(res, { name: file.filename, url: fileUrl }, 201);
});

export default router;

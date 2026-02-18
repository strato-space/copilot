const multer = require('multer');
const { v1: uuidv1 } = require('uuid');
const path = require("path");
const _ = require("lodash");
const constants = require('../../constants');


/*
    fieldname	Field name specified in the form	 
    originalname	Name of the file on the user’s computer	 
    encoding	Encoding type of the file	 
    mimetype	Mime type of the file	 
    size	Size of the file in bytes	 
    destination	The folder to which the file has been saved	DiskStorage
    filename	The name of the file within the destination	DiskStorage
    path	The full path to the uploaded file	DiskStorage
    buffer	A Buffer of the entire file	MemoryStorage

*/
/*

In filename:  {
  fieldname: 'file',
  originalname: 'image-big-5.jpg',
  encoding: '7bit',
  mimetype: 'image/jpeg'
}

*/
const fileFilter = (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    const mime_whitelist = [
        'video/x-msvideo',
        'video/mp4',
        'video/mpeg',
        'video/ogg',
        'video/webm',
        'image/webp',
        'image/gif',
        'image/jpeg',
        'image/png',
        'image/svg+xml',
        // Добавляем поддержку аудио файлов
        'audio/mpeg',
        'audio/mp4',
        'audio/wav',
        'audio/ogg',
        'audio/webm',
        'audio/x-m4a'
    ]
    const ext_blacklist = [
        'php',
        'js',
        'jsm',
        'sh',
        'htaccess'
    ]

    // if (!mime_whitelist.includes(file.mimetype)) {
    //     cb(null, false);
    //     return;
    // }

    if (ext_blacklist.includes(ext)) {
        cb(null, false);
        return;
    }
    cb(null, true)
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const path = require.main.path + "/uploads";
        cb(null, path)
    },
    filename: (req, file, cb) => {
        const randomName = uuidv1();
        const ext = file.originalname.split('.').pop();
        cb(null, randomName + '.' + ext)
    }
})

const uploader = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        files: 12,
        fileSize: constants.file_storage.MAX_FILE_SIZE
    }
})

const controller = {};

controller.getUploader = () => {
    return uploader;
}

controller.handleSingle = async (req, res, next) => {
    //TODO: ?add filename in DB
    if (_.isUndefined(req.file)) res.status(500).send("server error");
    try {
        res.status(200).send('/uploads/' + req.file.filename);
    } catch (error) {
        console.log(error)
        res.status(500).send("server error");
    }
};

controller.handleArray = async (req, res, next) => {
    try {
        res.status(200).json(req.files.map(f => new Object({ url: '/uploads/' + f.filename })));
    } catch (error) {
        res.status(500).json({ result: "error", error: "server error" });
    }
};

module.exports = controller;

const express = require("express");
const router = express.Router();
const controller = require("../controllers/index");

router.post("/file/", controller.upload.getUploader().single("file"), controller.upload.handleSingle);
router.post("/files/", controller.upload.getUploader().array("filesArray"), controller.upload.handleArray);

module.exports = router;